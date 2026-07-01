/**
 * serp_rank tool
 *
 * Reports where a target domain ranks in Google's REAL organic results for a
 * keyword — the SERP position that Google Custom Search (search_web) cannot
 * give you. Backed by the DataForSEO SERP adapter.
 *
 * Honesty rule: if DataForSEO is not configured, this returns an explained
 * { configured: false } result — it never fabricates a rank.
 */

import { z } from 'zod';
import { DataForSEOSearchAdapter } from './adapters/dataforseoSearch.js';

/** How many top organic results to return as the SERP listing (`results`).
 * The first Google page is ~10; bounding it keeps the tool payload small while
 * still surfacing the competitors that matter. */
const RESULTS_LIMIT = 10;

const SerpRankSchema = z.object({
  keyword: z.string().min(1),
  target: z.string().min(1), // domain or URL to locate in the SERP
  location_name: z.string().optional().default('United States'),
  location_code: z.number().int().optional(),
  language_code: z.string().optional().default('en'),
  device: z.enum(['desktop', 'mobile']).optional().default('desktop'),
  depth: z.number().int().min(10).max(200).optional().default(100), // DataForSEO caps depth at 200
});

/** Reduce a domain or URL to a bare, comparable host: "https://www.Example.com/x" → "example.com". */
function toBareDomain(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0];
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
      seResultsCount: meta.seResultsCount,
      checkUrl: meta.checkUrl, // link to view the real SERP
      cost: meta.cost, // USD charged by DataForSEO for this lookup
      checkedAt: new Date().toISOString(),
    };
  }
}

export default SerpRankTool;
