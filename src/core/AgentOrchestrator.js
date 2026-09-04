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
  // Terms are compared bare: the quoted entity in `npm package "commander"?`
  // arrived as `"commander"?` and matched nothing (R17, 2026-09-04).
  return query.toLowerCase().split(/\s+/)
    .map(term => term.replace(/[^\p{L}\p{N}]/gu, ''))
    .some(term => term.length > 3 && lc.includes(term));
}

/**
 * Truncate text to a safe token budget (~8 000 chars ≈ ~2 000 tokens).
 */
function truncate(text, maxChars = 8000) {
  if (!text || text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n[...truncated]';
}

/**
 * Literal provenance check: every version, date and large number in the
 * answer must appear somewhere in the fetched source text. Returns the raw
 * strings that do not (deduplicated, in answer order). Comparison is
 * case-insensitive with whitespace and thousands separators removed, so
 * "6.3.3" matches "6.3.3" and "1,234" matches "1 234". URLs in the answer are
 * ignored: they are citations, not claims.
 */
const MONTHS = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
const VALUE_PATTERNS = [
  /\b\d+\.\d+(?:\.\d+){0,2}\b/g,                                   // versions 1.2 / 1.2.3 / 1.2.3.4
  /\b\d{4}-\d{2}-\d{2}\b/g,                                          // ISO dates
  new RegExp(`\\b${MONTHS}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, 'gi'), // January 18, 2024
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTHS}\\.?\\s+\\d{4}\\b`, 'gi'),   // 18 January 2024
  /\b\d{1,3}(?:,\d{3})+\b|\b\d{4,}\b/g,                              // 1,234 / 12345
];

function normalizeValue(value) {
  return value.toLowerCase().replace(/[\s,]/g, '');
}

export function unverifiedValues(answer, sourceText) {
  if (!answer) return [];
  const stripped = answer.replace(/https?:\/\/\S+/g, ' ');
  const haystack = normalizeValue(sourceText || '');
  const missing = [];
  const seen = new Set();
  for (const pattern of VALUE_PATTERNS) {
    for (const match of stripped.matchAll(pattern)) {
      const raw = match[0];
      const key = normalizeValue(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (!haystack.includes(key)) missing.push(raw);
    }
  }
  // "2024" inside an already-flagged "January 18, 2024" is the same claim.
  return missing.filter((v, i) => !missing.some((o, j) => j !== i && o.length > v.length && o.includes(v)));
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
        // A model that fences its list ("```\nq1\nq2\n```") or quotes each
        // query leaks the fence and quote characters into the queries; the
        // R14 Julia run spent two of its three searches on the literal "```".
        .map(l => l.replace(/^```\w*\s*|\s*```$/g, '').replace(/^[`"']+|[`"']+$/g, '').trim())
        .filter(Boolean)
        // A line with no letter or digit left is punctuation, not a query.
        .filter(l => /[\p{L}\p{N}]/u.test(l))
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
    // A quoted term in the prompt ("commander") is the thing being asked
    // about. A planner told to search the bare entity reduced
    // 'npm package "commander"' to "npm", fetched only npm's own docs and
    // answered from memory (R17, 2026-09-04). Every query carries the quoted
    // terms.
    const quotedTerms = [...prompt.matchAll(/"([^"\n]{2,60})"/g)].map(m => m[1].trim()).filter(Boolean);
    if (quotedTerms.length > 0) {
      searchQueries = searchQueries.map(q =>
        quotedTerms.every(t => q.toLowerCase().includes(t.toLowerCase())) ? q : `${q} ${quotedTerms.join(' ')}`.trim()
      );
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
    /** url -> { title, text }: the engine's excerpt, evidence of last resort for a page that cannot be fetched. */
    const excerpts = new Map();

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
                // What the engine saw of the page: the snippet plus the
                // page's own meta description, which for npmjs.com carries
                // "Latest version: 15.0.0" while the snippet does not.
                const excerpt = [r.snippet, r.pagemap?.metatags?.description].filter(Boolean).join(' ');
                if (r.link && excerpt && !excerpts.has(r.link)) excerpts.set(r.link, { title: r.title || '', text: excerpt });
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
      } catch {
        // The page is out of reach (challenge page, 403, timeout) but the
        // search engine's excerpt of it is not: npmjs.com's "Latest version:
        // 15.0.0" sat in the snippet while every fetch of the package page was
        // challenged, and the run ended with no evidence at all (R17,
        // 2026-09-04). Keep a relevant snippet as evidence, labelled as one.
        const excerpt = excerpts.get(url);
        if (excerpt && isRelevant(excerpt.text, prompt)) {
          evidence.push({ url, title: excerpt.title, text: excerpt.text, snippet: true, step });
        }
      }
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
      .map(e => `--- Source: ${e.url}${e.snippet ? ' (search-result snippet; the page itself could not be fetched)' : ''} ---\n${truncate(e.text, perSourceCap)}`)
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
    let unverified = [];

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

      // A small model fills gaps from memory: "Swift 5.9.3", "commander 8.6.2
      // published January 18, 2024" — none of it on any fetched page (R17,
      // 2026-09-04). Versions, dates and counts in the answer must appear in
      // the source text; what does not gets one corrective rewrite, and
      // whatever still remains is named in the answer and in `provenance`.
      unverified = unverifiedValues(answer, combinedText);
      if (unverified.length > 0) {
        const retryPrompt =
          `${synthesisPrompt}\n\nYour previous answer was:\n${fenceUntrusted(answer, 'previous answer')}\n` +
          `It contains values that appear nowhere in the source text: ${unverified.map(v => `"${v}"`).join(', ')}. ` +
          `Rewrite the answer. Keep only values that the sources state, spelled as the sources spell them. ` +
          `Where the sources do not state a value, say that it is not stated instead of guessing.`;
        try {
          const { text: rewritten } = await this._getSamplingClient().complete(retryPrompt, { maxTokens: 1024 });
          if (rewritten && rewritten.trim()) {
            answer = rewritten;
            unverified = unverifiedValues(answer, combinedText);
          }
        } catch {
          // Keep the first answer; it is flagged below.
        }
      }
      if (unverified.length > 0) {
        answer +=
          `\n\nProvenance warning: ${unverified.map(v => `"${v}"`).join(', ')} ` +
          `${unverified.length === 1 ? 'does' : 'do'} not appear in the fetched sources and may be invented.`;
      }
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
      evidence: degraded ? evidence : evidence.map(e => (e.snippet ? { url: e.url, snippet: true } : { url: e.url })),
      degraded,
      reason: degradedReason,
      steps: step,
      urls_fetched: urlsFetched,
      provenance: { checked: !degraded, unverified }
    };
  }

  async destroy() {
    if (this._researchOrchestrator && typeof this._researchOrchestrator.destroy === 'function') {
      await this._researchOrchestrator.destroy();
    }
  }
}

export default AgentOrchestrator;
