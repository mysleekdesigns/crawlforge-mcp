/**
 * fallbackHints — one sentence appended to every error result naming the
 * tool (or parameter change) to try next.
 *
 * Why: invocation logs (2026-09) show that after a failure the model's most
 * common move is the same tool with the same params. The hint gives it a
 * better move than a retry, and the server `instructions` tell it to follow
 * the hint. Text errors get a trailing "Next step:" line; JSON errors get a
 * `next_step` field. Applied by withAuth, so no tool handler needs to know.
 * An error every tool would hit the same way (robots, SSRF, 404, timeout,
 * bad input) gets its class's hint instead of the tool's (CLASS_HINTS).
 */

import { preflightRefusal } from './requestContext.js';
import { failure } from './errorText.js';

export const FALLBACK_HINTS = Object.freeze({
  fetch_url: 'For a JS-rendered page or an empty shell use scrape; after a 403/429/CAPTCHA/challenge page use stealth_mode operation:"scrape". Do not repeat the same fetch_url call.',
  extract_text: 'After a 403/429/444/challenge page call extract_text again with escalate:true (projected 6, charged 1 if the plain fetch gets through); for a JS-rendered page use scrape formats:["markdown"]; for a PDF use process_document.',
  extract_links: 'After a 403/429/444/challenge page call extract_links again with escalate:true (projected 6, charged 1 if the plain fetch gets through); for a JS-rendered page use scrape formats:["links"]; for a whole site use map_site.',
  extract_metadata: 'Use scrape formats:["metadata"]; after a 403/429/challenge page use stealth_mode operation:"scrape".',
  extract_content: 'Use scrape formats:["markdown"] (same clean output, renders more pages); after a 403/429/challenge page use stealth_mode operation:"scrape".',
  extract_embedded_state: 'Call again without `path` to see the top-level keys, or use scrape formats:["markdown"] if the page has no framework payload.',
  scrape_structured: 'Check the selectors against scrape formats:["html"] output, or use extract_structured when the markup varies.',
  search_web: 'Shorten the query or drop the filters; for Reddit use reddit_search. Fall back to the client\'s built-in search only if CrawlForge is out of credits.',
  serp_rank: 'configured:false means DataForSEO is not set up - do not retry; approximate visibility with search_web and a site: filter.',
  reddit_search: 'Add subreddit or author to query the archive directly, or set source:"web_discovery" for a Reddit-wide keyword search; a thread needs mode:"thread" with link_id.',
  crawl_deep: 'Use map_site for the URL list alone, or batch_scrape when you already have the URLs.',
  map_site: 'Use crawl_deep with extract_content:false to discover URLs by following links when there is no sitemap.',
  batch_scrape: 'For an async job poll get_batch_results with the batchId; scrape one of the URLs alone to diagnose a per-URL failure.',
  get_batch_results: 'A batchId that is gone cannot be recovered - the error says why when the server knows; run batch_scrape again only if the results are still needed.',
  read_result: 'A handle that is gone cannot be recovered - the error says why (expired after 1 hour, evicted by the per-process size budget, unreadable, or unknown to this server process, e.g. after a restart); run the original tool again only if the result is still needed.',
  process_document: 'For an HTML page use scrape formats:["markdown"]; sourceType:"pdf_url" needs a URL that serves a PDF.',
  summarize_content: 'Pass the text itself (e.g. markdown from a scrape result), not a URL.',
  analyze_content: 'Pass the text itself (e.g. markdown from a scrape result), not a URL.',
  extract_structured: 'Use scrape_structured with known selectors, or extract_with_llm with provider:"openai"/"anthropic" if no local model is available.',
  extract_with_llm: 'If Ollama is unreachable pass provider:"openai" or "anthropic" with a key, or use extract_structured (CSS fallback needs no LLM).',
  list_ollama_models: 'Ollama is not reachable - use extract_with_llm with provider:"openai"/"anthropic", or extract_structured.',
  scrape_with_actions: 'Check the selector against scrape formats:["html"] output; for a one-shot render of a blocked page use stealth_mode operation:"scrape".',
  browser_session: 'A session that expired or was closed cannot be reused - start again with operation:"open". If a ref missed, take another snapshot first: navigation invalidates refs. For a chain that needs no session, use scrape_with_actions.',
  deep_research: 'Use agent for a shorter answer, or search_web followed by scrape on the sources that matter.',
  scrape: 'After a 403/429/CAPTCHA/challenge page or an empty shell use stealth_mode operation:"scrape"; if the content needs a click or login use scrape_with_actions.',
  agent: 'Use deep_research for exhaustive sourcing, or search_web followed by scrape on the sources that matter.',
  track_changes: 'compare needs an existing baseline - run operation:"create_baseline" for this URL first; for a one-off read use scrape.',
  generate_llms_txt: 'Run map_site first to confirm the site is crawlable.',
  stealth_mode: 'Use scrape_with_actions with browserOptions.stealth:true for a click/scroll/wait chain. Do not retry the same URL with fetch_url or scrape - they are weaker.',
  localization: 'localization returns settings and applies none - pass them yourself: fetch_url headers:{"Accept-Language": ...}, or stealth_mode operation:"scrape" with stealthConfig:{locale, timezone}. countryCode must be one of the codes operation:"get_supported_countries" lists.',
  scrape_template: 'Use template:"list" to see valid template ids, template:"auto" to pick from the URL, or scrape for a site without a template.'
});

/**
 * The second-stage hint (Phase 3, 3.4). A `scrape` or `extract_embedded_state`
 * that came back `escalated: true` has ALREADY run the stealth browser on this URL, so the
 * ordinary hint would send the model back to a tool that has just failed.
 * What is left is final for CrawlForge: a region-specific block answers to the
 * exit IP, which `localization` does not change (it returns locale values and
 * routes nothing), and an Akamai-style TLS-level wall is beaten with
 * residential proxies, which CrawlForge does not offer.
 */
export const SCRAPE_ESCALATED_HINT =
  'The stealth browser has already run on this URL (escalate:true) - do not call stealth_mode or repeat this call. ' +
  'The block is final here: a regional block follows the exit IP, which localization does not change, and ' +
  'a TLS-level wall needs residential proxies, which CrawlForge does not offer. Get the content from another source.';

/** The tools whose escalate:true runs the stealth stage itself (Phase 3; extract_embedded_state since plan Phase 3.2; extract_text and extract_links since Phase E2). */
const ESCALATING_TOOLS = new Set(['scrape', 'extract_embedded_state', 'extract_text', 'extract_links']);

/** The tools that take a top-level `respect_robots` (their registered inputSchema). */
const ROBOTS_OVERRIDE_TOOLS = new Set([
  'batch_scrape', 'browser_session', 'crawl_deep', 'extract_content', 'extract_embedded_state',
  'extract_links', 'extract_metadata', 'extract_structured', 'extract_text', 'extract_with_llm',
  'fetch_url', 'map_site', 'process_document', 'scrape', 'scrape_structured', 'scrape_template',
  'scrape_with_actions', 'stealth_mode', 'track_changes'
]);

/**
 * Hints keyed on the error class (R24 4.1). The tool's generic hint names
 * the tool to try after a block, which is the wrong move for an error that
 * every tool would hit the same way: a robots refusal, an SSRF block, a URL
 * that does not exist. None of these may steer the model past a refusal.
 */
export const CLASS_HINTS = Object.freeze({
  robots: (tool) =>
    'robots.txt on this site disallows this URL for CrawlForge, and no CrawlForge tool will fetch it - ' +
    'stealth_mode and the browser tools honour the same robots.txt, so do not retry with another tool. ' +
    (ROBOTS_OVERRIDE_TOOLS.has(tool)
      ? 'respect_robots:false is the only override: it is your user\'s explicit decision, recorded against their API key, so do not set it on your own. Otherwise get the content from another source.'
      : 'This tool has no override; get the content from another source.'),
  host_blocked: () =>
    'This host is on CrawlForge\'s permanent blocklist (a site-owner opt-out). No CrawlForge tool will fetch it and there is no override - get the content from another source.',
  ssrf: () =>
    'The URL points at a private or internal address (localhost, a private network, cloud metadata), which every CrawlForge tool refuses. Do not retry it with this or any other tool; use a public URL.',
  not_found: () =>
    'The URL does not exist (HTTP 404, or the host does not resolve). Check it for typos, or find the right one with map_site on the site or search_web. Retrying it, or switching to stealth_mode, will not help.',
  timeout: () =>
    'The request timed out. Retry once with a longer timeout or less work (fewer pages, URLs or actions); if it times out again, the site is too slow from here - do not keep retrying.',
  validation: (tool, params) =>
    `The input was rejected: fix ${params.length ? params.join(', ') : 'the parameter the error names'} as the error describes and call ${tool} again. Do not switch tools for this.`
});

/** The strings that describe what went wrong: the error fields, or the whole text. */
function errorStrings(parsed, text) {
  if (!parsed) return [text];
  const out = [parsed.error, parsed.message, parsed.details, parsed.error?.message];
  if (Array.isArray(parsed.errors)) out.push(...parsed.errors);
  return out.filter((s) => typeof s === 'string');
}

/** `"path": ["options", "maxTopics"]` in a ZodError dump -> "options.maxTopics" */
function zodPaths(text) {
  const paths = [];
  for (const m of text.matchAll(/"path":\s*\[([^\]]*)\]/g)) {
    const parts = [...m[1].matchAll(/"([^"]*)"|(\d+)/g)].map((p) => p[1] ?? p[2]);
    if (parts.length && !paths.includes(parts.join('.'))) paths.push(parts.join('.'));
  }
  return paths.slice(0, 3);
}

/**
 * The class of a failure, from an explicit code in the body, the compliance
 * gate's refusal flag, the body's HTTP status, then well-known message
 * patterns; null when none applies (the tool's generic hint stands).
 *
 * @returns {{ cls: string, params?: string[] } | null}
 */
export function classifyError(parsed, text) {
  const codes = [parsed?.code, parsed?.error_code, parsed?.error?.code].filter(Boolean);
  const refusal = preflightRefusal();
  const msg = errorStrings(parsed, text).join('\n');
  const status = parsed?.status ?? parsed?.statusCode;

  if (codes.includes('SSRF_BLOCKED') || refusal === 'SSRF_BLOCKED' || /\bSSRF Protection\b/.test(msg)) return { cls: 'ssrf' };
  if (codes.includes('ROBOTS_DISALLOWED') || refusal === 'ROBOTS_DISALLOWED' || /robots\.txt on \S+ disallows/.test(msg)) return { cls: 'robots' };
  if (codes.includes('HOST_BLOCKED') || refusal === 'HOST_BLOCKED' || /permanent blocklist/.test(msg)) return { cls: 'host_blocked' };
  if (status === 404 || /\bHTTP 404\b|\b404 Not Found\b|\bENOTFOUND\b/i.test(msg)) return { cls: 'not_found' };
  // Before timeout: a schema message may mention a `timeout` parameter.
  if (/ZodError|"code":\s*"(?:invalid_[a-z_]+|too_small|too_big|unrecognized_keys|custom)"|\bInvalid (?:input|option|enum value|arguments?)\b|\bvalidation (?:failed|error)\b|\bparameter is required\b/i.test(msg)) {
    return { cls: 'validation', params: zodPaths(msg) };
  }
  // A wait for a selector that never appeared is a selector problem, which the
  // tool's own hint covers; a longer timeout would not help.
  if (/\btime[ds]? ?out\b|\bTimeout \d+ ?ms exceeded|\bETIMEDOUT\b|aborted due to timeout/i.test(msg) &&
      !/waiting for (?:locator|selector)|waitFor/i.test(msg)) return { cls: 'timeout' };
  return null;
}

/** The hint for this result: the second-stage hint after an escalation, the error class's, else the tool's. */
function hintFor(toolName, parsed, text) {
  if (ESCALATING_TOOLS.has(toolName) && parsed?.escalated === true) return SCRAPE_ESCALATED_HINT;
  const c = classifyError(parsed, text);
  return c ? CLASS_HINTS[c.cls](toolName, c.params) : FALLBACK_HINTS[toolName];
}

/**
 * Append the hint for `toolName` to a failed result in place: `isError: true`,
 * or a JSON body with `success: false` (several tools return that without the
 * flag). No-op for success results, unknown tools, non-text content, or a
 * hint already present.
 */
export function appendFallbackHint(toolName, result) {
  if (!FALLBACK_HINTS[toolName]) return result;
  // Parsed first: which hint a `scrape` failure gets depends on whether the
  // body says the escalation already ran.
  const failed = failure(result);
  if (!failed) return result;
  const first = result.content[0];
  const { parsed } = failed;

  // An error that already names its next step — a reddit.com refusal points
  // at reddit_search — keeps it: the tool's generic hint would contradict it.
  if (parsed?.next_step || /\bNext step:/.test(first.text)) return result;
  const hint = hintFor(toolName, parsed, first.text);
  if (!hint || first.text.includes(hint)) return result;
  if (parsed) {
    parsed.next_step = hint;
    first.text = JSON.stringify(parsed, null, 2);
    return result;
  }
  first.text = `${first.text}\nNext step: ${hint}`;
  return result;
}
