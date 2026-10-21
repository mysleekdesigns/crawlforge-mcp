/**
 * serp_rank tool
 *
 * Reports where a target domain ranks in Google's REAL organic results for a
 * keyword — the SERP position that search_web, a general web search, cannot
 * give you. Backed by the DataForSEO SERP adapter.
 *
 * Honesty rule: if DataForSEO is not configured, this returns an explained
 * { configured: false } result — it never fabricates a rank.
 */

import { z } from 'zod';
import { DataForSEOSearchAdapter } from './adapters/dataforseoSearch.js';

/** Words too common to tell a relevant result from an unrelated one. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'how', 'what', 'why', 'who', 'when', 'where',
  'are', 'you', 'your', 'best', 'from', 'near', 'can', 'does', 'that', 'this',
]);

/** Below this share of top results mentioning the keyword, a SERP is flagged. */
const DECOY_THRESHOLD = 0.2;
/** Fewer results than this is too little to judge. */
const DECOY_MIN_RESULTS = 3;

/** The keyword's distinctive words: lowercased, 3+ characters, stopwords out. */
function keywordTokens(keyword) {
  const words = String(keyword).toLowerCase().split(/[^\p{L}\p{N}]+/u);
  return [...new Set(words.filter((w) => w.length >= 3 && !STOPWORDS.has(w)))];
}

/**
 * Whether a SERP looks like a decoy. Google serves some scrapers real-looking
 * results that have nothing to do with the query, and DataForSEO passes such
 * a page on as a valid one: on 2026-10-19 "crawlforge" came back as 19
 * crawl/MCP pages, none naming CrawlForge, while Search Console had the site
 * at #1 and a second lookup a minute later did too. So check whether the top
 * results mention the keyword at all.
 *
 * @returns {{ checked: number, matching: number, suspect: boolean } | null}
 *   null when the keyword has no usable word or there are too few results.
 */
export function assessSerpRelevance(keyword, results) {
  const tokens = keywordTokens(keyword);
  const top = results.slice(0, RESULTS_LIMIT);
  if (tokens.length === 0 || top.length < DECOY_MIN_RESULTS) return null;

  const matching = top.filter((r) => {
    const text = `${r.title ?? ''} ${r.url ?? ''} ${r.snippet ?? ''}`.toLowerCase();
    return tokens.some((t) => text.includes(t));
  }).length;
  return { checked: top.length, matching, suspect: matching / top.length < DECOY_THRESHOLD };
}

/** How many top organic results to return as the SERP listing (`results`).
 * The first Google page is ~10; bounding it keeps the tool payload small while
 * still surfacing the competitors that matter. */
const RESULTS_LIMIT = 10;

const SerpRankSchema = z.object({
  keyword: z.string().min(1),
  target: z.string().min(1), // domain or URL; matched by host (subdomains included), never by exact URL
  location_name: z.string().optional().default('United States'),
  location_code: z.number().int().optional(),
  language_code: z.string().optional().default('en'),
  device: z.enum(['desktop', 'mobile']).optional().default('desktop'),
  // DataForSEO bills per 10 results scanned and gets slower the deeper it goes,
  // so the default stays shallow: 20 covers Google's first two pages for $0.004.
  // Raise it (max 200, their cap) when a deeper position is worth the spend.
  depth: z.number().int().min(10).max(200).optional().default(30),
});

/** Reduce a domain or URL to a bare, comparable host: "https://www.Example.com/x" → "example.com".
 * Path, query, fragment, userinfo and port go too, as the REST route's URL-hostname parse drops them. */
function toBareDomain(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split(/[/?#]/)[0]
    .replace(/^.*@/, '')
    .replace(/:\d*$/, '')
    .replace(/^www\./, '');
}

/** True when a SERP result's domain is the target domain (or a subdomain of it). */
function domainMatches(resultDomain, target) {
  const d = toBareDomain(resultDomain);
  return d === target || d.endsWith(`.${target}`);
}

export class SerpRankTool {
  constructor(options = {}) {
    // DataForSEO uses its own credentials, separate from CrawlForge billing.
    // The server can start without them — we degrade gracefully at execute().
    this.login = options.login || process.env.DATAFORSEO_LOGIN || null;
    this.password = options.password || process.env.DATAFORSEO_PASSWORD || null;
    this.apiBaseUrl = options.apiBaseUrl; // optional override for tests / self-host
    this.timeoutMs = options.timeoutMs;   // optional override for tests / self-host
  }

  async execute(params) {
    const validated = SerpRankSchema.parse(params);

    // Graceful degradation — NEVER fake a rank. If unconfigured, explain the fix.
    if (!this.login || !this.password) {
      return {
        configured: false,
        keyword: validated.keyword,
        target: toBareDomain(validated.target),
        note:
          'SERP rank tracking is not configured. Set DATAFORSEO_LOGIN and ' +
          'DATAFORSEO_PASSWORD to enable real Google organic rank lookups. ' +
          'Get credentials at https://app.dataforseo.com/api-access',
      };
    }

    const adapter = new DataForSEOSearchAdapter(this.login, this.password, {
      apiBaseUrl: this.apiBaseUrl,
      timeoutMs: this.timeoutMs,
    });

    const { items, meta } = await adapter.search({
      keyword: validated.keyword,
      locationName: validated.location_name,
      locationCode: validated.location_code,
      languageCode: validated.language_code,
      device: validated.device,
      depth: validated.depth,
    });

    const target = toBareDomain(validated.target);

    // A domain can rank multiple times — collect every organic hit, best first.
    const matches = items
      .filter((it) => domainMatches(it.domain, target))
      .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity))
      .map((it) => ({
        position: it.position,
        rankAbsolute: it.rankAbsolute,
        url: it.url,
        title: it.title,
      }));

    const best = matches[0] || null;

    // The SERP listing itself — the top organic competitors as Google actually
    // ranks them, not just the target. Bounded to the first page so the payload
    // stays small; each item already carries { position, rankAbsolute, domain,
    // url, title, snippet } from the adapter. This is what "SERP results" means.
    const results = items
      .slice()
      .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity))
      .slice(0, RESULTS_LIMIT)
      .map((it) => ({
        position: it.position,
        rankAbsolute: it.rankAbsolute,
        domain: it.domain,
        url: it.url,
        title: it.title,
        snippet: it.snippet,
      }));

    const relevance = assessSerpRelevance(validated.keyword, results);
    const suspect = relevance?.suspect ?? false;

    return {
      configured: true,
      keyword: validated.keyword,
      target,
      found: matches.length > 0,
      position: best ? best.position : null, // organic rank; null = not within top `depth`
      rankAbsolute: best ? best.rankAbsolute : null,
      url: best ? best.url : null,
      title: best ? best.title : null,
      allPositions: matches, // every place the domain ranks on this SERP
      results, // the top organic results (the SERP listing), best-first, capped
      location: meta.location,
      device: meta.device,
      depthScanned: meta.depth,
      organicResults: meta.organicCount,
      seResultsCount: meta.seResultsCount ?? undefined, // omitted when unknown (see the adapter)
      checkUrl: meta.checkUrl, // link to view the real SERP
      cost: meta.cost, // USD charged by DataForSEO for this lookup
      checkedAt: new Date().toISOString(),
      // true when the top results barely mention the keyword: a likely decoy SERP
      suspect,
      ...(suspect
        ? {
            warnings: [
              `These results look unrelated to the keyword (${relevance.matching} of the top ${relevance.checked} mention it). ` +
                'Google may have served a decoy results page. Re-run the lookup, or check Search Console, before acting on this rank.',
            ],
          }
        : {}),
    };
  }
}

export default SerpRankTool;
