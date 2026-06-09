/**
 * AgentOrchestrator — autonomous NL-prompt → search/navigate/extract → answer.
 *
 * Design: hardcoded 3-action state machine.
 *   PLAN   — one SamplingClient call to decompose prompt into search queries
 *   GATHER — search_web (≤maxUrls results total)
 *   ACT    — fetchAndParse + relevance gate per URL
 *   DECIDE — loop or answer (step/URL/time hard stops; never LLM-trusted)
 *   SHAPE  — schema→ExtractWithLlm prose→synthesis via SamplingClient
 *
 * Hard stops (enforced here, not by the LLM):
 *   1. maxSteps iterations of the ACT loop
 *   2. maxUrls total URLs fetched
 *   3. wallClockMs wall-clock milliseconds (default 120 000)
 *
 * No-LLM-key path: if all LLM calls fail, return collected evidence + {degraded:true}.
 * pro model: delegates to ResearchOrchestrator.conductResearch() for richer synthesis.
 */

import { fetchAndParse } from '../tools/extract/_fetchAndParse.js';
import { SamplingClient } from './SamplingClient.js';

const DEFAULT_WALL_CLOCK_MS = 120_000;
const DEFAULT_MAX_STEPS = 5;
const DEFAULT_MAX_URLS = 10;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Naive relevance gate: does the fetched text contain any query term?
 * Avoids an LLM call for an obviously irrelevant page.
 */
function isRelevant(text, query) {
  if (!text || !query) return true; // fail-open
  const lc = text.toLowerCase();
  return query.toLowerCase().split(/\s+/).some(term => term.length > 3 && lc.includes(term));
}

/**
 * Truncate text to a safe token budget (~8 000 chars ≈ ~2 000 tokens).
 */
function truncate(text, maxChars = 8000) {
  if (!text || text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n[...truncated]';
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export class AgentOrchestrator {
  /**
   * @param {object} options
   * @param {object|null} options.mcpServer  - McpServer instance (for SamplingClient)
   * @param {object}      options.searchConfig - passed to SearchWebTool constructor
   * @param {object}      options.llmConfig    - passed to ExtractWithLlm constructor
   */
  constructor(options = {}) {
    this._mcpServer = options.mcpServer || null;
    this._searchConfig = options.searchConfig || {};
    this._llmConfig = options.llmConfig || {};
    this._samplingClient = null;
    this._searchTool = null;
    this._extractWithLlm = null;
    this._researchOrchestrator = null;
  }

  /** Set MCP server (called by agent.js after construction). */
  setMcpServer(mcpServer) {
    this._mcpServer = mcpServer;
    this._samplingClient = null; // reset so it is rebuilt with the new server
  }

  // ── Lazy accessors ──────────────────────────────────────────────────────────

  _getSamplingClient() {
    if (!this._samplingClient) {
      this._samplingClient = new SamplingClient({ mcpServer: this._mcpServer });
    }
    return this._samplingClient;
  }

  async _getSearchTool() {
    if (!this._searchTool) {
      const { SearchWebTool } = await import('../tools/search/searchWeb.js');
      this._searchTool = new SearchWebTool(this._searchConfig);
    }
    return this._searchTool;
  }

  async _getExtractWithLlm() {
    if (!this._extractWithLlm) {
      const { ExtractWithLlm } = await import('../tools/extract/extractWithLlm.js');
      this._extractWithLlm = new ExtractWithLlm(this._llmConfig);
    }
    return this._extractWithLlm;
  }

  async _getResearchOrchestrator() {
    if (!this._researchOrchestrator) {
      const { ResearchOrchestrator } = await import('./ResearchOrchestrator.js');
      this._researchOrchestrator = new ResearchOrchestrator({
        maxUrls: 50,
        timeLimit: DEFAULT_WALL_CLOCK_MS,
        // Without this the orchestrator builds a keyless SearchWebTool and
        // every pro-model search silently fails (zero sources).
        searchConfig: this._searchConfig
      });
    }
    return this._researchOrchestrator;
  }

  // ── Main entry ──────────────────────────────────────────────────────────────

  /**
   * Run the agent loop.
   *
   * @param {object} params
   * @param {string}    params.prompt      - Natural-language task
   * @param {string[]}  [params.urls]      - Seed URLs (skips search for those)
   * @param {object}    [params.schema]    - JSON schema for structured output
   * @param {string}    [params.model]     - 'default' | 'pro'
   * @param {number}    [params.maxSteps]  - Max ACT iterations (≤10)
   * @param {number}    [params.maxUrls]   - Max URLs to fetch (≤20)
   * @param {number}    [params.wallClockMs] - Wall-clock budget in ms
   * @returns {Promise<object>}
   */
  async run(params) {
    const {
      prompt,
      urls: seedUrls = [],
      schema,
      model = 'default',
      maxSteps = DEFAULT_MAX_STEPS,
      maxUrls = DEFAULT_MAX_URLS,
      wallClockMs = DEFAULT_WALL_CLOCK_MS
    } = params;

    const startTime = Date.now();
    const deadline = () => (Date.now() - startTime) >= wallClockMs;

    // Hard-cap params regardless of what caller sends
    const capSteps = Math.min(maxSteps, 10);
    const capUrls = Math.min(maxUrls, 20);

    // pro model: delegate to ResearchOrchestrator
    if (model === 'pro') {
      try {
        const orchestrator = await this._getResearchOrchestrator();
        const result = await orchestrator.conductResearch(prompt, {
          maxUrls: capUrls,
          timeLimit: wallClockMs,
          researchApproach: 'focused'
        });
        // conductResearch never rejects — failures come back as an error payload
        if (result?.error) {
          return {
            success: false,
            degraded: true,
            reason: `pro research failed: ${result.error}`,
            answer: null
          };
        }
        return { success: true, answer: result, model: 'pro', degraded: false };
      } catch (err) {
        // Fall through to default path on pro failure
        return {
          success: false,
          degraded: true,
          reason: `pro research failed: ${err.message}`,
          answer: null
        };
      }
    }

    // ── PLAN ──────────────────────────────────────────────────────────────────
    let searchQueries = [prompt]; // fallback: use raw prompt as query
    try {
      const planPrompt =
        `Decompose this research task into 1-3 concise web search queries (one per line, no bullets):\n\n${prompt}`;
      const { text } = await this._getSamplingClient().complete(planPrompt, { maxTokens: 200 });
      const lines = text.split('\n').map(l => l.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean);
      if (lines.length > 0) searchQueries = lines.slice(0, 3);
    } catch {
      // Sampling unavailable — use raw prompt
    }

    // ── GATHER (search) ───────────────────────────────────────────────────────
    const urlQueue = [...seedUrls]; // start with any user-provided seeds
    const searchResults = [];

    if (urlQueue.length < capUrls) {
      try {
        const searchTool = await this._getSearchTool();
        for (const q of searchQueries) {
          if (deadline()) break;
          try {
            const sr = await searchTool.execute({ query: q, limit: Math.ceil(capUrls / searchQueries.length) });
            // SearchWebTool.execute() returns the raw results object; the MCP content-wrapped
            // shape only appears if a caller (e.g. server.js) wraps it. Handle both.
            const parsed = sr?.content?.[0]?.text ? JSON.parse(sr.content[0].text) : sr;
            if (parsed?.results) {
              for (const r of parsed.results) {
                if (r.link && !urlQueue.includes(r.link)) urlQueue.push(r.link);
                searchResults.push({ query: q, title: r.title || '', url: r.link || '', snippet: r.snippet || '' });
              }
            }
          } catch { /* skip failed search */ }
        }
      } catch { /* search tool init failed */ }
    }

    // ── ACT loop ──────────────────────────────────────────────────────────────
    const evidence = [];
    let urlsFetched = 0;
    let step = 0;

    for (const url of urlQueue) {
      if (step >= capSteps || urlsFetched >= capUrls || deadline()) break;
      step++;
      urlsFetched++;

      try {
        const { textContent, finalUrl } = await fetchAndParse(url, { timeoutMs: 10000 });
        if (!isRelevant(textContent, prompt)) continue;
        evidence.push({
          url: finalUrl,
          text: truncate(textContent),
          step
        });
      } catch { /* skip unreachable URL */ }
    }

    // ── SHAPE ─────────────────────────────────────────────────────────────────
    const combinedText = evidence.map(e => `--- Source: ${e.url} ---\n${e.text}`).join('\n\n');

    if (!combinedText.trim()) {
      return {
        success: true,
        degraded: true,
        reason: 'No content could be fetched for the given prompt.',
        search_results: searchResults,
        evidence: [],
        answer: null,
        steps: step,
        urls_fetched: urlsFetched
      };
    }

    // Schema path: use ExtractWithLlm for structured output
    if (schema && Object.keys(schema).length > 0) {
      try {
        const extractWithLlm = await this._getExtractWithLlm();
        const result = await extractWithLlm.execute({
          content: combinedText,
          prompt: `From the following research sources, answer this task and extract structured data:\n${prompt}`,
          schema,
          provider: 'auto'
        });
        return {
          success: result.success,
          answer: result.success ? result.data : null,
          structured: true,
          search_results: searchResults,
          evidence: evidence.map(e => ({ url: e.url })),
          degraded: !result.success,
          reason: result.success ? undefined : result.error,
          steps: step,
          urls_fetched: urlsFetched
        };
      } catch (err) {
        // Fall through to prose synthesis
      }
    }

    // Prose synthesis via SamplingClient
    let answer = null;
    let degraded = false;
    let degradedReason;

    try {
      const synthesisPrompt =
        `You are a research assistant. Based on the sources below, answer this task:\n\n` +
        `Task: ${prompt}\n\n` +
        `${truncate(combinedText, 12000)}\n\n` +
        `Provide a clear, concise answer.`;

      const { text } = await this._getSamplingClient().complete(synthesisPrompt, { maxTokens: 1024 });
      answer = text;
    } catch (err) {
      degraded = true;
      degradedReason = `LLM synthesis unavailable: ${err.message}`;
      // Return raw evidence so the host LLM can synthesize
      answer = null;
    }

    return {
      success: true,
      answer,
      search_results: searchResults,
      evidence: degraded ? evidence : evidence.map(e => ({ url: e.url })),
      degraded,
      reason: degradedReason,
      steps: step,
      urls_fetched: urlsFetched
    };
  }

  async destroy() {
    if (this._researchOrchestrator && typeof this._researchOrchestrator.destroy === 'function') {
      await this._researchOrchestrator.destroy();
    }
  }
}

export default AgentOrchestrator;
