/**
 * scrape_structured — Extract structured data using CSS selectors.
 * Extracted from server.js inline handler.
 * B1: Support attribute extraction (selector@attr), add max_results,
 *     fix elements_found to report real per-field DOM match counts.
 */

import { load } from 'cheerio';
import { fetchWithTimeout } from './_fetch.js';

/**
 * Parse a selector string that may include an attribute suffix: "css@attr"
 * e.g. "a.link@href" -> { selector: "a.link", attribute: "href" }
 *      "img@src"      -> { selector: "img",    attribute: "src" }
 *      "h1"           -> { selector: "h1",      attribute: null }
 * @param {string} raw
 * @returns {{ selector: string, attribute: string|null }}
 */
function parseSelectorSpec(raw) {
  const atIdx = raw.lastIndexOf('@');
  if (atIdx > 0) {
    return { selector: raw.slice(0, atIdx), attribute: raw.slice(atIdx + 1) };
  }
  return { selector: raw, attribute: null };
}

/**
 * @param {{ url: string, selectors: Record<string, string>, max_results?: number }} params
 */
export async function scrapeStructuredHandler({ url, selectors, max_results }) {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = load(html);
    const results = {};
    const matchCounts = {};

    for (const [fieldName, rawSelector] of Object.entries(selectors)) {
      try {
        const { selector, attribute } = parseSelectorSpec(rawSelector);
        let elements = $(selector);
        const domCount = elements.length;
        matchCounts[fieldName] = domCount;

        if (domCount === 0) {
          results[fieldName] = null;
        } else {
          // Apply max_results cap if specified
          if (max_results != null && max_results > 0 && domCount > max_results) {
            elements = elements.slice(0, max_results);
          }

          const extract = (el) => {
            if (attribute) {
              return $(el).attr(attribute) ?? null;
            }
            return $(el).text().trim();
          };

          if (elements.length === 1) {
            results[fieldName] = extract(elements.get(0));
          } else {
            results[fieldName] = elements.map((_, el) => extract(el)).get();
          }
        }
      } catch (selectorError) {
        results[fieldName] = {
          error: `Invalid selector: ${rawSelector}`,
          message: selectorError.message
        };
        matchCounts[fieldName] = 0;
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          data: results,
          selectors_used: selectors,
          elements_found: matchCounts,
          url: response.url
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Failed to scrape structured data: ${error.message}` }],
      isError: true
    };
  }
}
