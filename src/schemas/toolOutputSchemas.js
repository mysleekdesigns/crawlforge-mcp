/**
 * toolOutputSchemas — MCP `outputSchema` shapes for structured tool results (Phase 6).
 *
 * Each entry is a plain zod RAW SHAPE (an object of validators), not a
 * z.object(shape) — callers wrap it themselves (see src/server/registerTool.js).
 *
 * These are documentation/discovery schemas for MCP clients, not runtime
 * enforcement: the SDK validates a tool's `structuredContent` against its
 * outputSchema on every successful call, so every field here must be
 * `.optional()` (every top-level key, and every nested object uses
 * `.passthrough()`) to guarantee a legitimate result can never fail
 * validation. Shapes are derived directly from the object each tool actually
 * returns (see server.js registrations + the tool source files under
 * src/tools/).
 */

import { z } from 'zod';

// `_cost` is injected by withAuth into the legacy JSON-text copy of the
// result (never into structuredContent directly) — included here anyway so
// clients that copy `content[0].text` into structuredContent-shaped code
// don't fail validation.
const costShape = z.object({
  projected: z.number().optional().describe('Credits projected for this call before execution'),
  actual: z.number().optional().describe('Credits actually charged (0 in creator mode, half-rate on error)'),
  remaining_credits: z.number().nullable().optional().describe('Credits remaining on the account after this call, if known'),
  projection_note: z.string().optional().describe('Human-readable note about how the cost was projected')
}).passthrough().optional().describe('Cost-transparency metadata (D3.5), present when injected into the text copy of the result');

// ── scrape ──────────────────────────────────────────────────────────────────

const scrapeLinkShape = z.object({
  href: z.string().optional(),
  text: z.string().optional(),
  is_external: z.boolean().optional(),
  original_href: z.string().optional()
}).passthrough();

const scrapeLinksShape = z.object({
  links: z.array(scrapeLinkShape).optional(),
  total_count: z.number().optional(),
  internal_count: z.number().optional(),
  external_count: z.number().optional()
}).passthrough();

const scrapeMetadataShape = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  canonical_url: z.string().optional(),
  author: z.string().optional(),
  robots: z.string().optional(),
  viewport: z.string().optional(),
  og_tags: z.record(z.unknown()).optional(),
  twitter_tags: z.record(z.unknown()).optional(),
  json_ld: z.array(z.unknown()).optional(),
  microdata: z.array(z.unknown()).optional(),
  url: z.string().optional()
}).passthrough();

const scrapeShape = {
  success: z.boolean().optional().describe('Whether the scrape completed'),
  url: z.string().optional().describe('Final URL after redirects'),
  content: z.object({
    markdown: z.string().optional(),
    html: z.string().optional(),
    rawHtml: z.string().optional(),
    text: z.string().optional(),
    links: scrapeLinksShape.optional(),
    metadata: scrapeMetadataShape.optional(),
    branding: z.record(z.unknown()).optional().describe('Static design tokens: colors, fonts, logo'),
    screenshots: z.array(z.object({}).passthrough()).optional().describe('Present for the "screenshot" format; each item carries a resourceUri once published'),
    json: z.unknown().optional().describe('Result of the {type:"json"} format (LLM-structured extraction)')
  }).passthrough().optional().describe('One key per requested format'),
  warnings: z.array(z.string()).optional().describe('Per-format warnings; partial success never fails the whole call'),
  _cost: costShape
};

// ── map_site ────────────────────────────────────────────────────────────────

const mapSiteShape = {
  base_url: z.string().optional(),
  total_urls: z.number().optional(),
  urls: z.union([
    z.array(z.string()),
    z.record(z.array(z.string()))
  ]).optional().describe('Flat array of URLs, or grouped-by-path object when group_by_path=true (default)'),
  metadata: z.record(z.unknown()).optional().describe('Per-URL metadata when include_metadata=true'),
  site_map: z.object({
    root: z.array(z.string()).optional(),
    sections: z.record(z.unknown()).optional(),
    depth_levels: z.record(z.unknown()).optional()
  }).passthrough().optional(),
  statistics: z.object({
    total_urls: z.number().optional(),
    unique_paths: z.number().optional(),
    file_extensions: z.record(z.number()).optional(),
    query_parameters: z.number().optional(),
    secure_urls: z.number().optional(),
    max_depth: z.number().optional(),
    average_depth: z.number().optional(),
    url_lengths: z.object({
      min: z.number().nullable().optional(),
      max: z.number().optional(),
      average: z.number().optional()
    }).passthrough().optional()
  }).passthrough().optional(),
  domain_filter_config: z.unknown().nullable().optional(),
  filter_stats: z.unknown().nullable().optional(),
  ranked_urls: z.array(z.object({
    url: z.string().optional(),
    score: z.number().optional()
  }).passthrough()).optional().describe('Present only when the `search` param was set'),
  _cost: costShape
};

// ── serp_rank ───────────────────────────────────────────────────────────────

const serpRankResultShape = z.object({
  position: z.number().nullable().optional(),
  rankAbsolute: z.number().nullable().optional(),
  domain: z.string().optional(),
  url: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  snippet: z.string().nullable().optional()
}).passthrough();

const serpRankShape = {
  configured: z.boolean().optional().describe('False when DATAFORSEO_LOGIN/PASSWORD are unset — no rank was fabricated'),
  keyword: z.string().optional(),
  target: z.string().optional().describe('Bare target domain, normalized'),
  note: z.string().optional().describe('Present when configured=false, explains how to enable'),
  found: z.boolean().optional().describe('Whether the target appeared anywhere in the scanned SERP'),
  position: z.number().nullable().optional().describe('Best (lowest) organic rank; null = not within top `depth`'),
  rankAbsolute: z.number().nullable().optional(),
  url: z.string().nullable().optional().describe('URL of the target\'s best-ranking result'),
  title: z.string().nullable().optional(),
  allPositions: z.array(serpRankResultShape).optional().describe('Every position the target holds on this SERP'),
  results: z.array(serpRankResultShape).optional().describe('Top organic competitors as Google actually ranks them (capped)'),
  location: z.unknown().optional(),
  device: z.string().optional(),
  depthScanned: z.number().optional(),
  organicResults: z.number().optional(),
  seResultsCount: z.number().optional(),
  checkUrl: z.string().optional().describe('Link to view the real SERP on DataForSEO'),
  cost: z.number().optional().describe('USD charged by DataForSEO for this lookup (separate from CrawlForge credits)'),
  checkedAt: z.string().optional(),
  _cost: costShape
};

// ── reddit_search ───────────────────────────────────────────────────────────

const redditPostShape = z.object({
  id: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  subreddit: z.string().nullable().optional(),
  created_utc: z.number().nullable().optional(),
  created_iso: z.string().nullable().optional(),
  score: z.number().nullable().optional(),
  num_comments: z.number().nullable().optional(),
  selftext: z.string().nullable().optional(),
  selftext_truncated: z.boolean().optional(),
  url: z.string().nullable().optional(),
  permalink: z.string().nullable().optional().describe('Full reddit.com URL of the post')
}).passthrough();

const redditCommentShape = z.object({
  id: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  subreddit: z.string().nullable().optional(),
  created_utc: z.number().nullable().optional(),
  created_iso: z.string().nullable().optional(),
  score: z.number().nullable().optional(),
  body: z.string().nullable().optional(),
  body_truncated: z.boolean().optional(),
  link_id: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  permalink: z.string().nullable().optional()
}).passthrough();

const redditSearchShape = {
  source: z.enum(['arctic_shift', 'pullpush', 'web_discovery']).optional().describe('Which backend served this result — an archive, or web discovery (site-restricted web search hydrated from the archive) for Reddit-wide keyword search'),
  mode: z.string().optional(),
  query: z.string().nullable().optional(),
  subreddit: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  link_id: z.string().optional().describe('Present in thread mode'),
  count: z.number().optional(),
  results: z.array(z.union([redditPostShape, redditCommentShape])).optional().describe('posts/comments modes'),
  post: redditPostShape.nullable().optional().describe('thread mode: the post itself'),
  comments: z.array(z.unknown()).optional().describe('thread mode: nested comment tree ({...comment, replies:[...]}); collapsed branches appear as {more_count, more_ids}'),
  comment_count: z.number().optional(),
  fallback_used: z.string().optional().describe('Present when the primary archive failed and the fallback served the result'),
  notes: z.array(z.string()).optional().describe('Data-provenance caveats (archive freshness, coverage gaps)'),
  checkedAt: z.string().optional(),
  _cost: costShape
};

// ── search_web ──────────────────────────────────────────────────────────────

const searchWebResultShape = z.object({
  title: z.string().optional(),
  link: z.string().optional(),
  snippet: z.string().optional(),
  displayLink: z.string().optional(),
  formattedUrl: z.string().optional(),
  htmlSnippet: z.string().optional(),
  pagemap: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional()
}).passthrough();

const searchWebShape = {
  query: z.string().optional(),
  effective_query: z.string().optional().describe('Present when query expansion changed the query actually used'),
  expanded_queries: z.array(z.string()).optional(),
  results: z.array(searchWebResultShape).optional(),
  total_results: z.union([z.string(), z.number()]).optional(),
  search_time: z.number().optional(),
  offset: z.number().optional(),
  limit: z.number().optional(),
  cached: z.boolean().optional(),
  provider: z.object({
    name: z.string().optional(),
    backend: z.string().optional(),
    note: z.string().optional(),
    instanceUrl: z.string().nullable().optional(),
    capabilities: z.record(z.unknown()).optional()
  }).passthrough().optional(),
  localization: z.object({
    applied: z.boolean().optional(),
    countryCode: z.string().optional(),
    language: z.string().optional(),
    searchDomain: z.string().optional(),
    geoTargeting: z.boolean().optional()
  }).passthrough().nullable().optional(),
  processing: z.object({
    ranking: z.record(z.unknown()).nullable().optional(),
    deduplication: z.record(z.unknown()).nullable().optional(),
    query_expansion: z.record(z.unknown()).nullable().optional(),
    localization_applied: z.boolean().optional()
  }).passthrough().optional(),
  _cost: costShape
};

// ── extract_structured ───────────────────────────────────────────────────────

const extractStructuredShape = {
  success: z.boolean().optional().describe('False when the extraction errored or a required field came back missing or empty'),
  url: z.string().optional(),
  data: z.record(z.unknown()).optional().describe('Extracted fields matching the requested schema'),
  extraction_method: z.string().optional().describe('"llm" | "css_fallback" | "keyword_fallback" | "none"'),
  confidence: z.number().optional(),
  schema_used: z.record(z.unknown()).optional(),
  processingTime: z.number().optional(),
  error: z.string().optional(),
  validation: z.object({
    valid: z.boolean().optional(),
    errors: z.array(z.string()).optional()
  }).passthrough().optional(),
  extractionNotes: z.array(z.string()).optional(),
  _cost: costShape
};

// ── crawl_deep ────────────────────────────────────────────────────────────────

const crawlDeepPageShape = z.object({
  url: z.string().optional(),
  depth: z.number().optional(),
  title: z.string().optional(),
  links_count: z.number().optional(),
  content_length: z.number().optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
  content: z.string().optional(),
  truncated: z.boolean().optional(),
  metadata: z.unknown().optional()
}).passthrough();

const crawlDeepShape = {
  success: z.boolean().optional().describe('False only when the crawl was cancelled via elicitation decline'),
  error: z.string().optional(),
  url: z.string().optional(),
  crawl_depth: z.number().optional(),
  pages_crawled: z.number().optional(),
  pages_found: z.number().optional(),
  error_count: z.number().optional(),
  duration_ms: z.number().optional(),
  pages_per_second: z.number().optional(),
  results: z.array(crawlDeepPageShape).optional(),
  errors: z.array(z.unknown()).optional(),
  stats: z.unknown().optional(),
  site_structure: z.object({
    total_pages: z.number().optional(),
    depth_distribution: z.record(z.number()).optional()
      .describe('Pages per crawl depth (links from the start URL)'),
    path_depth_distribution: z.record(z.number()).optional()
      .describe('Pages per URL path-segment depth'),
    path_patterns: z.record(z.number()).optional(),
    file_types: z.record(z.number()).optional(),
    subdomains: z.array(z.string()).optional()
  }).passthrough().optional(),
  domain_filter_config: z.unknown().nullable().optional(),
  link_analysis: z.unknown().nullable().optional(),
  session: z.object({
    enabled: z.boolean().optional(),
    cookies_captured: z.number().optional()
  }).passthrough().optional(),
  crawled_at: z.string().optional().describe('When the pages were actually fetched (ISO 8601)'),
  cached: z.boolean().optional().describe('True when this response was replayed from an earlier crawl rather than crawled now; crawled_at gives its age'),
  _cost: costShape
};

// ── Export ────────────────────────────────────────────────────────────────────

export const OUTPUT_SCHEMAS = {
  scrape: scrapeShape,
  map_site: mapSiteShape,
  serp_rank: serpRankShape,
  reddit_search: redditSearchShape,
  search_web: searchWebShape,
  extract_structured: extractStructuredShape,
  crawl_deep: crawlDeepShape
};

export default OUTPUT_SCHEMAS;
