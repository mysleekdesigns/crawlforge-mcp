/**
 * scrape_structured — Extract structured data using CSS selectors.
 * Extracted from server.js inline handler.
 * B1: Support attribute extraction (selector@attr), add max_results,
 *     fix elements_found to report real per-field DOM match counts.
 * 3.2: Optional row_selector returns row-aligned records instead of the
 *     default parallel arrays, which are matched independently per field.
 * 6.4: A field may be an object {selector, multiple}; multiple:true returns
 *     every match as an array (inside a row it otherwise keeps only the first).
 *     @href and @src values are resolved to absolute URLs against the page URL.
 */

import { load } from 'cheerio';
import { fetchWithTimeout } from './_fetch.js';
import { elementText } from '../../utils/elementText.js';

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
export function parseSelectorSpec(raw) {
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
 * A field is either a selector string ("css" or "css@attr") or an object
 * { selector: "css@attr", multiple?: boolean }.
 * @param {string|{ selector: string, multiple?: boolean }} field
 * @returns {{ raw: string, selector: string, attribute: string|null, multiple: boolean }}
 */
export function parseFieldSpec(field) {
  const raw = typeof field === 'string' ? field : field?.selector;
  if (typeof raw !== 'string' || raw === '') {
    throw new Error('a field must be a selector string or an object with a selector string');
  }
  return { raw, ...parseSelectorSpec(raw), multiple: typeof field === 'object' && field.multiple === true };
}

// Attributes holding a URL, resolved against the page URL so a relative
// "/item?id=1" comes back usable.
const URL_ATTRIBUTES = new Set(['href', 'src']);

/**
 * The value of one matched element: its text, or the named attribute (null
 * when absent), with href/src made absolute against `baseUrl`.
 */
function extractValue($, el, attribute, baseUrl) {
  if (!attribute) return elementText($, el);
  const value = $(el).attr(attribute);
  if (value == null) return null;
  if (URL_ATTRIBUTES.has(attribute.toLowerCase()) && baseUrl) {
    try {
      return new URL(value.trim(), baseUrl).href;
    } catch {
      return value;
    }
  }
  return value;
}

/**
 * Row-aligned extraction: every field is matched *inside* each row element, so
 * record N of the output is row N of the page. A field a row lacks is null
 * rather than borrowed from a neighbouring row, which is what the default
 * parallel-array output does — there each field is matched independently across
 * the whole document and the arrays are not row-aligned.
 *
 * A field with multiple:true is an array of every match inside the row ([] when
 * the row has none); otherwise it is the first match.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @param {{ row_selector: string, selectors: Record<string, string|object>, max_results?: number, baseUrl?: string }} params
 * @returns {{ records: object[], rowsFound: number, matchCounts: Record<string, number> }}
 */
function extractRows($, { row_selector, selectors, max_results, baseUrl }) {
  const allRows = $(row_selector);
  // In row mode max_results caps rows, not per-field matches.
  const rows = (max_results != null && max_results > 0)
    ? allRows.slice(0, max_results)
    : allRows;

  const specs = Object.entries(selectors).map(([field, spec]) => [field, spec]);
  const matchCounts = Object.fromEntries(specs.map(([field]) => [field, 0]));

  const records = rows.toArray().map((rowEl) => {
    const $row = $(rowEl);
    const record = {};
    for (const [field, spec] of specs) {
      try {
        const { selector, attribute, multiple } = parseFieldSpec(spec);
        // A field selector may name the row element itself (row "tr.athing",
        // field "tr@id"); .find() searches descendants only.
        const matches = $row.is(selector) ? $row : $row.find(selector);
        if (multiple) {
          record[field] = matches.toArray().map((el) => extractValue($, el, attribute, baseUrl));
          if (matches.length > 0) matchCounts[field] += 1;
          continue;
        }
        if (matches.length === 0) {
          record[field] = null;
          continue;
        }
        record[field] = extractValue($, matches.get(0), attribute, baseUrl);
        matchCounts[field] += 1;
      } catch (selectorError) {
        record[field] = {
          error: `Invalid selector: ${typeof spec === 'string' ? spec : spec?.selector}`,
          message: selectorError.message
        };
      }
    }
    return record;
  });

  return { records, rowsFound: allRows.length, matchCounts };
}

/**
 * @param {{ url: string, selectors: Record<string, string|{ selector: string, multiple?: boolean }>, row_selector?: string,
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
      const { records, rowsFound, matchCounts } = extractRows($, { row_selector, selectors, max_results, baseUrl: response.url || url });
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

    const baseUrl = response.url || url;
    for (const [fieldName, rawSelector] of Object.entries(selectors)) {
      try {
        const { selector, attribute, multiple } = parseFieldSpec(rawSelector);
        let elements = $(selector);
        const domCount = elements.length;
        matchCounts[fieldName] = domCount;

        if (domCount === 0) {
          results[fieldName] = multiple ? [] : null;
        } else {
          // Apply max_results cap if specified
          if (max_results != null && max_results > 0 && domCount > max_results) {
            elements = elements.slice(0, max_results);
          }

          const extract = (el) => extractValue($, el, attribute, baseUrl);

          // multiple:true always answers with an array, even for one match.
          if (elements.length === 1 && !multiple) {
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
          error: `Invalid selector: ${typeof rawSelector === 'string' ? rawSelector : rawSelector?.selector}`,
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
