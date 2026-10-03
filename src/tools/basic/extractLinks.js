/**
 * extract_links — Extract all links from a webpage with optional filtering.
 * Extracted from server.js inline handler.
 * E3: Link records come from crawlforge-extractors' extractLinkRecords, the
 * reader the REST route uses, so both surfaces return the same links.
 */

import { load } from 'cheerio';
import { extractLinkRecords } from 'crawlforge-extractors';
import { fetchLadder, ladderErrorResult, isJsonType } from '../../utils/fetchLadder.js';

/**
 * @param {{ url: string, filter_external?: boolean, base_url?: string,
 *   user_agent?: string, respect_robots?: boolean,
 *   escalate?: boolean, escalate_engine?: string }} params
 * @param {Function} [escalateFetch] the stealth escalation stage
 */
async function extractLinks({ url, filter_external, base_url, user_agent, respect_robots, escalate, escalate_engine }, escalateFetch) {
  try {
    const ladder = await fetchLadder(url, {
      tool: 'extract_links',
      userAgent: user_agent,
      respectRobots: respect_robots,
      escalate: escalate === true,
      escalateEngine: escalate_engine,
      escalateFetch
    });
    if (ladder.html === undefined) return ladderErrorResult('extract_links', 'Failed to extract links: ', ladder);

    // A JSON body carries no <a href>.
    if (isJsonType(ladder.type)) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            links: [],
            total_count: 0,
            internal_count: 0,
            external_count: 0,
            other_count: 0,
            base_url: base_url || ladder.url,
            ...ladder.fields,
            warnings: [...ladder.warnings, 'the target returned application/json; it has no HTML links']
          }, null, 2)
        }]
      };
    }

    const html = ladder.html;
    const $ = load(html);

    const finalUrl = ladder.url;

    // Reported base: an explicit base_url, else <base href> resolved against
    // the page, else the page URL (extractLinkRecords resolves the same way).
    let docBase = finalUrl;
    const baseHref = $('base[href]').first().attr('href');
    if (baseHref) {
      try { docBase = new URL(baseHref, finalUrl).toString(); } catch { /* ignore invalid <base href> */ }
    }
    const baseUrl = base_url || docBase;

    // Records are deduplicated on the URL without fragment or trailing slash;
    // mailto:/tel:/javascript: links are type "other". filter_external drops
    // only the internal ones.
    const records = extractLinkRecords($, { pageUrl: finalUrl, baseUrl: base_url });
    const links = filter_external ? records.filter(l => l.type !== 'internal') : records;
    const count = (type) => links.filter(l => l.type === type).length;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          links,
          total_count: links.length,
          internal_count: count('internal'),
          external_count: count('external'),
          other_count: count('other'),
          base_url: baseUrl,
          ...ladder.fields,
          ...(ladder.warnings.length > 0 ? { warnings: ladder.warnings } : {})
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Failed to extract links: ${error.message}` }],
      isError: true
    };
  }
}

/**
 * @param {{ escalateFetch?: (args: { url: string, engine: string, respectRobots?: boolean }) => Promise<object> }} [deps]
 *   the stealth escalation stage (server.js `stealthEscalation`); without it
 *   an escalation that would run is reported as unavailable
 */
export function createExtractLinksHandler({ escalateFetch } = {}) {
  return (params) => extractLinks(params, escalateFetch);
}

/** The handler with no escalation stage wired (tests; server.js wires its own). */
export const extractLinksHandler = createExtractLinksHandler();
