/**
 * fallbackHints — one sentence appended to every error result naming the
 * tool (or parameter change) to try next.
 *
 * Why: invocation logs (2026-09) show that after a failure the model's most
 * common move is the same tool with the same params. The hint gives it a
 * better move than a retry, and the server `instructions` tell it to follow
 * the hint. Text errors get a trailing "Next step:" line; JSON errors get a
 * `next_step` field. Applied by withAuth, so no tool handler needs to know.
 */

export const FALLBACK_HINTS = Object.freeze({
  fetch_url: 'For a JS-rendered page or an empty shell use scrape; after a 403/429/CAPTCHA/challenge page use stealth_mode operation:"scrape". Do not repeat the same fetch_url call.',
  extract_text: 'Use scrape formats:["markdown"] (renders more pages); after a 403/429/challenge page use stealth_mode operation:"scrape".',
  extract_links: 'Use scrape formats:["links"]; for a whole site use map_site.',
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
  get_batch_results: 'An unknown or expired batchId cannot be recovered - run batch_scrape again only if the results are still needed.',
  process_document: 'For an HTML page use scrape formats:["markdown"]; sourceType:"pdf_url" needs a URL that serves a PDF.',
  summarize_content: 'Pass the text itself (e.g. markdown from a scrape result), not a URL.',
  analyze_content: 'Pass the text itself (e.g. markdown from a scrape result), not a URL.',
  extract_structured: 'Use scrape_structured with known selectors, or extract_with_llm with provider:"openai"/"anthropic" if no local model is available.',
  extract_with_llm: 'If Ollama is unreachable pass provider:"openai" or "anthropic" with a key, or use extract_structured (CSS fallback needs no LLM).',
  list_ollama_models: 'Ollama is not reachable - use extract_with_llm with provider:"openai"/"anthropic", or extract_structured.',
  scrape_with_actions: 'Check the selector against scrape formats:["html"] output; for a one-shot render of a blocked page use stealth_mode operation:"scrape".',
  deep_research: 'Use agent for a shorter answer, or search_web followed by scrape on the sources that matter.',
  scrape: 'After a 403/429/CAPTCHA/challenge page or an empty shell use stealth_mode operation:"scrape"; if the content needs a click or login use scrape_with_actions.',
  agent: 'Use deep_research for exhaustive sourcing, or search_web followed by scrape on the sources that matter.',
  track_changes: 'compare needs an existing baseline - run operation:"create_baseline" for this URL first; for a one-off read use scrape.',
  generate_llms_txt: 'Run map_site first to confirm the site is crawlable.',
  stealth_mode: 'Use scrape_with_actions with browserOptions.stealth:true for a click/scroll/wait chain. Do not retry the same URL with fetch_url or scrape - they are weaker.',
  localization: 'Use stealth_mode operation:"scrape" after configure_country, or set an Accept-Language header via fetch_url headers.',
  scrape_template: 'Use template:"list" to see valid template ids, template:"auto" to pick from the URL, or scrape for a site without a template.'
});

/**
 * Append the hint for `toolName` to an error result in place. No-op for
 * success results, unknown tools, non-text content, or a hint already present.
 */
export function appendFallbackHint(toolName, result) {
  const hint = FALLBACK_HINTS[toolName];
  if (!hint || result?.isError !== true || !Array.isArray(result.content)) return result;
  const first = result.content[0];
  if (first?.type !== 'text' || typeof first.text !== 'string') return result;
  if (first.text.includes(hint)) return result;
  try {
    const parsed = JSON.parse(first.text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      parsed.next_step = hint;
      first.text = JSON.stringify(parsed, null, 2);
      return result;
    }
  } catch {
    // plain text
  }
  first.text = `${first.text}\nNext step: ${hint}`;
  return result;
}
