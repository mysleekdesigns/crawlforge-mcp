/**
 * extract_links — Extract all links from a webpage with optional filtering.
 * Extracted from server.js inline handler.
 */

import { load } from 'cheerio';
import { fetchWithTimeout } from './_fetch.js';

/**
 * @param {{ url: string, filter_external?: boolean, base_url?: string }} params
 */
export async function extractLinksHandler({ url, filter_external, base_url }) {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = load(html);

    const finalUrl = response.url || url;
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

      if (!href) return;

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
          base_url: baseUrl
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
