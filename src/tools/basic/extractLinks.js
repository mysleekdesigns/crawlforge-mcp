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

    const baseUrl = base_url || new URL(url).origin;
    const pageUrl = new URL(url);
    const links = [];

    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      const text = $(element).text().trim();

      if (!href) return;

      let absoluteUrl;
      let isExternal = false;

      try {
        if (href.startsWith('http://') || href.startsWith('https://')) {
          absoluteUrl = href;
          isExternal = new URL(href).origin !== pageUrl.origin;
        } else {
          absoluteUrl = new URL(href, baseUrl).toString();
          isExternal = false;
        }

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
