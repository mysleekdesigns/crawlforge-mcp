/**
 * scrape_structured — Extract structured data using CSS selectors.
 * Extracted from server.js inline handler.
 */

import { load } from 'cheerio';
import { fetchWithTimeout } from './_fetch.js';

/**
 * @param {{ url: string, selectors: Record<string, string> }} params
 */
export async function scrapeStructuredHandler({ url, selectors }) {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = load(html);
    const results = {};

    for (const [fieldName, selector] of Object.entries(selectors)) {
      try {
        const elements = $(selector);
        if (elements.length === 0) {
          results[fieldName] = null;
        } else if (elements.length === 1) {
          results[fieldName] = elements.text().trim();
        } else {
          results[fieldName] = elements.map((_, el) => $(el).text().trim()).get();
        }
      } catch (selectorError) {
        results[fieldName] = {
          error: `Invalid selector: ${selector}`,
          message: selectorError.message
        };
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          data: results,
          selectors_used: selectors,
          elements_found: Object.keys(results).length,
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
