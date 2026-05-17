/**
 * extract_text — Extract clean text content from HTML.
 * Extracted from server.js inline handler.
 */

import { load } from 'cheerio';
import { fetchWithTimeout } from './_fetch.js';

/**
 * @param {{ url: string, remove_scripts?: boolean, remove_styles?: boolean }} params
 */
export async function extractTextHandler({ url, remove_scripts, remove_styles }) {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = load(html);

    if (remove_scripts !== false) $('script').remove();
    if (remove_styles !== false) $('style').remove();

    $('nav, header, footer, aside, .advertisement, .ad, .sidebar').remove();

    const text = $('body').text().replace(/\s+/g, ' ').trim();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          text,
          word_count: text.split(/\s+/).filter(w => w.length > 0).length,
          char_count: text.length,
          url: response.url
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Failed to extract text: ${error.message}` }],
      isError: true
    };
  }
}
