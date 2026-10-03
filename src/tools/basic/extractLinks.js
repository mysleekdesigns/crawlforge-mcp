/**
 * extract_links — Extract all links from a webpage with optional filtering.
 * Extracted from server.js inline handler.
 */

import { load } from 'cheerio';
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
    const pageUrl = new URL(finalUrl);

    // <base href>, if present, overrides the page URL as the resolution base
    // for relative links (but an explicit base_url override wins over both).
    let docBase = finalUrl;
    const baseHref = $('base[href]').first().attr('href');
    if (baseHref) {
      try { docBase = new URL(baseHref, finalUrl).toString(); } catch { /* ignore invalid <base href> */ }
    }

    const baseUrl = base_url || docBase;
    const links = [];

    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      const text = $(element).text().trim();

      // A javascript: pseudo-link ("Cookie Settings") is a button, not a
      // link; it was counted as an external link on boeing.com (R20).
      if (!href || /^\s*javascript:/i.test(href)) return;

      try {
        const absoluteUrl = new URL(href, baseUrl).toString();
        const isExternal = new URL(absoluteUrl).origin !== pageUrl.origin;

        if (filter_external && !isExternal) return;

        links.push({ href: absoluteUrl, text, is_external: isExternal, original_href: href });
      } catch {
        // skip invalid URLs
      }
    });

    const uniqueLinks = links.filter((link, index, arr) =>
      arr.findIndex(l => l.href === link.href) === index
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          links: uniqueLinks,
          total_count: uniqueLinks.length,
          internal_count: uniqueLinks.filter(l => !l.is_external).length,
          external_count: uniqueLinks.filter(l => l.is_external).length,
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
