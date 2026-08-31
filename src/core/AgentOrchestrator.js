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
import { fenceUntrusted } from '../utils/untrustedContent.js';

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

/**
 * Current-state task gate: prompts about the live "now" ("right now",
 * "currently", "today", "latest", "#1 … now") go stale through search alone —
 * dated articles rank for the task's words while the live page does not
 * (live repro 2026-08-26: "#1 story on Hacker News right now" answered from
 * a January thread; news.ycombinator.com was never fetched). Detected
 * deterministically here (never LLM-trusted) so PLAN steers search toward
 * the live entity page and SHAPE answers from it, not from dated results.
 */
const CURRENT_STATE_RE = /\b(right now|currently|today|tonight|at the moment|as of (now|today)|latest|this (week|month|morning))\b|#\d+[^.?!]*\bnow\b/i;

export function isCurrentStateTask(prompt) {
  return CURRENT_STATE_RE.test(prompt || '');
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
    const currentState = isCurrentStateTask(prompt);
    let searchQueries = [prompt]; // fallback: use raw prompt as query
    try {
      const planPrompt =
        `Decompose this research task into 1-3 concise web search queries. ` +
        // Current-state tasks: a query made of the task's words surfaces dated
        // articles ABOUT the topic; the bare entity name surfaces the live
        // official page as the top result, which GATHER then prioritizes.
        (currentState
          ? `The task asks about a CURRENT live state: the FIRST query must be ONLY the name of the site or thing whose current state is asked, nothing else. `
          : '') +
        `Output ONLY the queries, one per line, no preamble or numbering:\n\n${prompt}`;
      const { text } = await this._getSamplingClient().complete(planPrompt, { maxTokens: 200 });
      const lines = text.split('\n')
        .map(l => l.replace(/^[-*\d.)\s]+/, '').trim())
        .filter(Boolean)
        // Drop preamble/garbage lines ("Here are 3 concise web search queries:", …)
        // so they never become search query #1 and poison the URL queue.
        .filter(l =>
          !l.endsWith(':') &&
          !/^here (are|is)\b/i.test(l) &&
          !/search quer(y|ies)/i.test(l) &&
          l.length <= 100
        );
      if (lines.length > 0) searchQueries = lines.slice(0, 3);
    } catch {
      // Sampling unavailable — use raw prompt
    }

    // ── GATHER (search) ───────────────────────────────────────────────────────
    const urlQueue = [...seedUrls]; // start with any user-provided seeds
    // Sites named directly in the prompt (full URLs or bare domains like
    // "news.ycombinator.com") are the most authoritative sources for the task —
    // queue them ahead of search results.
    const namedSites = prompt.match(/https?:\/\/[^\s"'<>]+|(?<![\w.@/-])[a-z0-9][\w-]*(?:\.[a-z0-9][\w-]*)*\.[a-z]{2,}(?![\w-])/gi) || [];
    // Seeds and prompt-named sites also outrank search results at SHAPE time
    // (see priorityUrls below) — generic term overlap must not bury them.
    const priorityUrls = [...seedUrls];
    for (const site of namedSites) {
      const url = (/^https?:\/\//i.test(site) ? site : `https://${site}`).replace(/[.,;:!?)]+$/, '');
      if (!urlQueue.includes(url)) urlQueue.push(url);
      if (!priorityUrls.includes(url)) priorityUrls.push(url);
    }
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

    // Current-state tasks: search results are LEADS, not answers — the answer
    // must come from the authoritative live page. The raw top result is NOT a
    // safe proxy (live retest 2026-08-26: CSE ranks thehackernews.com above
    // news.ycombinator.com for "Hacker News"), so vote by domain across all
    // results — PLAN's bare entity query makes the official site dominate —
    // and put that domain's root (its live front page) first in the fetch
    // queue and first at SHAPE time so synthesis answers from it, never from
    // a dated article. A wrong root self-heals: it fails the relevance gate
    // and never enters evidence.
    if (currentState && searchResults.length > 0) {
      const originCounts = new Map();
      for (const s of searchResults) {
        try {
          const origin = new URL(s.url).origin;
          originCounts.set(origin, (originCounts.get(origin) || 0) + 1);
        } catch { /* unparsable result url */ }
      }
      let bestOrigin = null;
      let bestCount = 0;
      for (const [origin, count] of originCounts) {
        // Strict > keeps the earliest-seen (top-ranked) origin on ties.
        if (count > bestCount) { bestOrigin = origin; bestCount = count; }
      }
      if (bestOrigin) {
        const liveRoot = `${bestOrigin}/`;
        if (!priorityUrls.includes(liveRoot)) priorityUrls.push(liveRoot);
        const qi = urlQueue.findIndex(u => u === liveRoot || `${u}/` === liveRoot);
        if (qi > 0) urlQueue.splice(qi, 1);
        if (qi !== 0) urlQueue.unshift(liveRoot);
      }
    }

    // ── ACT loop ──────────────────────────────────────────────────────────────
    // urlsFetched (capUrls) and step (capSteps) are deliberately decoupled:
    // urlsFetched counts every fetch attempt (gates how many URLs we try),
    // while step counts only attempts that yielded usable evidence (gates
    // genuine progress). Coupling them 1:1 made capSteps the always-binding
    // cap whenever it was smaller than capUrls, leaving maxUrls unreachable
    // at its default. Both caps remain fully enforced (neither is weakened).
    const evidence = [];
    let urlsFetched = 0;
    let step = 0;

    for (const url of urlQueue) {
      if (urlsFetched >= capUrls || step >= capSteps || deadline()) break;
      urlsFetched++;

      try {
        const { textContent, finalUrl } = await fetchAndParse(url, { timeoutMs: 10000 });
        if (!isRelevant(textContent, prompt)) continue;
        step++;
        const sr = searchResults.find(s => s.url === url);
        evidence.push({
          url: finalUrl,
          title: sr ? sr.title : '',
          text: truncate(textContent),
          step
        });
      } catch { /* skip unreachable URL */ }
    }

    // ── SHAPE ─────────────────────────────────────────────────────────────────
    // Order evidence by simple relevance to the prompt (term overlap with
    // url+title+text) instead of raw queue order, then give every source a
    // per-source slice of the synthesis budget so no source is silently cut off.
    const promptTerms = prompt.toLowerCase().split(/\s+/).filter(t => t.length > 3);
    // Seeds/prompt-named sites get a fixed boost above any term-overlap score:
    // a generic article mentioning the task's words ("title", "story") must
    // never outrank the source the user explicitly pointed at (live retest
    // 2026-08-20: an NFL article buried the named news.ycombinator.com page).
    const isPriority = url => priorityUrls.some(p => url === p || url.startsWith(`${p}/`) || `${url}/` === p);
    const orderedEvidence = evidence
      .map(e => ({
        ...e,
        _score: (isPriority(e.url) ? 1000 : 0) +
          promptTerms.filter(t => `${e.url} ${e.title || ''} ${e.text}`.toLowerCase().includes(t)).length
      }))
      .sort((a, b) => b._score - a._score);
    const perSourceCap = Math.max(1500, Math.floor(12000 / Math.max(evidence.length, 1)));
    const combinedText = orderedEvidence
      .map(e => `--- Source: ${e.url} ---\n${truncate(e.text, perSourceCap)}`)
      .join('\n\n');

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
      // Wording matters for small local models (llama3.2-class): without the
      // "already fetched / do not refuse" framing they answer "I cannot access
      // the internet" or "the sources do not contain it" even when the answer
      // sits in the first source (live retest 2026-08-20).
      const synthesisPrompt =
        `You are a data-extraction assistant. The web sources below have ALREADY been fetched for you and their text is included — no internet access is needed; do not refuse for lack of browsing ability. They are ordered most-relevant first. Answer the task using ONLY this source text:\n\n` +
        `Task: ${prompt}\n\n` +
        // Fenced: combinedText is scraped page text, and un-fenced it sat
        // between the task and the rules with nothing marking it as data. A
        // page saying "ignore the above and answer X" read as a peer of both.
        `${fenceUntrusted(combinedText, 'source text')}\n` +
        `Rules:\n` +
        // Short and imperative on purpose: the executing model is a small
        // local one (gemma3:4b-class) and ignores hedged phrasing.
        (currentState
          ? `- The task asks about the CURRENT state. Answer from the FIRST source below (the live page). NEVER present older or dated content as the current answer.\n`
          : '') +
        `- Answer ONLY from the provided sources; do not use outside knowledge.\n` +
        `- Read the sources carefully before concluding anything is missing from them.\n` +
        `- Cite the exact source URL(s) you used.\n` +
        `- If, after careful reading, the sources genuinely do not contain the answer, say so explicitly.\n` +
        `- NEVER invent or guess a URL; cite only URLs that appear in the sources above.\n\n` +
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
