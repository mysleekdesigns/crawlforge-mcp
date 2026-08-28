/**
 * scrape_structured — Extract structured data using CSS selectors.
 * Extracted from server.js inline handler.
 * B1: Support attribute extraction (selector@attr), add max_results,
 *     fix elements_found to report real per-field DOM match counts.
 * 3.2: Optional row_selector returns row-aligned records instead of the
 *     default parallel arrays, which are matched independently per field.
 */

import { load } from 'cheerio';
import { fetchWithTimeout } from './_fetch.js';

// Matches a trailing "@attr" suffix (e.g. "@href", "@data-id") — the attribute
// name must look like a real attribute, not the "@" of a CSS attribute-value
// selector such as a[href*="@"].
const ATTR_SUFFIX_RE = /@[A-Za-z_:][\w:.-]*$/;

/**
 * Parse a selector string that may include an attribute suffix: "css@attr"
 * e.g. "a.link@href" -> { selector: "a.link", attribute: "href" }
 *      "img@src"      -> { selector: "img",    attribute: "src" }
 *      "h1"           -> { selector: "h1",      attribute: null }
 *      'a[href*="@"]'  -> { selector: 'a[href*="@"]', attribute: null }
 * @param {string} raw
 * @returns {{ selector: string, attribute: string|null }}
 */
function parseSelectorSpec(raw) {
  const match = ATTR_SUFFIX_RE.exec(raw);
  // Only treat it as an attribute suffix if it isn't inside brackets/quotes,
  // i.e. the selector portion before it has balanced [ ] and quotes.
  if (match && match.index > 0) {
    const selectorPart = raw.slice(0, match.index);
    const openBrackets = (selectorPart.match(/\[/g) || []).length;
    const closeBrackets = (selectorPart.match(/\]/g) || []).length;
    const quoteCount = (selectorPart.match(/["']/g) || []).length;
    if (openBrackets === closeBrackets && quoteCount % 2 === 0) {
      return { selector: selectorPart, attribute: raw.slice(match.index + 1) };
    }
  }
  return { selector: raw, attribute: null };
}

/**
 * Row-aligned extraction: every field is matched *inside* each row element, so
 * record N of the output is row N of the page. A field a row lacks is null
 * rather than borrowed from a neighbouring row, which is what the default
 * parallel-array output does — there each field is matched independently across
 * the whole document and the arrays are not row-aligned.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @param {{ row_selector: string, selectors: Record<string, string>, max_results?: number }} params
 * @returns {{ records: object[], rowsFound: number, matchCounts: Record<string, number> }}
 */
function extractRows($, { row_selector, selectors, max_results }) {
  const allRows = $(row_selector);
  // In row mode max_results caps rows, not per-field matches.
  const rows = (max_results != null && max_results > 0)
    ? allRows.slice(0, max_results)
    : allRows;

  const specs = Object.entries(selectors).map(([field, raw]) => [field, raw, parseSelectorSpec(raw)]);
  const matchCounts = Object.fromEntries(specs.map(([field]) => [field, 0]));

  const records = rows.toArray().map((rowEl) => {
    const $row = $(rowEl);
    const record = {};
    for (const [field, raw, { selector, attribute }] of specs) {
      try {
        // A field selector may name the row element itself (row "tr.athing",
        // field "tr@id"); .find() searches descendants only.
        const el = $row.is(selector) ? $row : $row.find(selector).first();
        if (el.length === 0) {
          record[field] = null;
          continue;
        }
        record[field] = attribute ? (el.attr(attribute) ?? null) : el.text().trim();
        matchCounts[field] += 1;
      } catch (selectorError) {
        record[field] = {
          error: `Invalid selector: ${raw}`,
          message: selectorError.message
        };
      }
    }
    return record;
  });

  return { records, rowsFound: allRows.length, matchCounts };
}

/**
 * @param {{ url: string, selectors: Record<string, string>, row_selector?: string,
 *   max_results?: number, user_agent?: string, respect_robots?: boolean }} params
 */
export async function scrapeStructuredHandler({ url, selectors, row_selector, max_results, user_agent, respect_robots }) {
  try {
    const response = await fetchWithTimeout(url, {
      userAgent: user_agent,
      respectRobots: respect_robots,
      tool: 'scrape_structured'
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = load(html);

    if (row_selector) {
      const { records, rowsFound, matchCounts } = extractRows($, { row_selector, selectors, max_results });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            data: records,
            selectors_used: selectors,
            row_selector,
            rows_found: rowsFound,
            elements_found: matchCounts,
            url: response.url
          }, null, 2)
        }]
      };
    }

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
            // cheerio's .map().get() drops null/undefined results, which would
            // desynchronize this array from elements_found and from parallel
            // fields. Build it from toArray() instead so length always matches.
            results[fieldName] = elements.toArray().map(extract);
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
