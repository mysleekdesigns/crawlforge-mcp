/**
 * extract_metadata — Extract page metadata (title, description, OG tags, etc.).
 * Extracted from server.js inline handler.
 * B1: Parse JSON-LD and microdata; stronger title fallback chain (og:title → <title> → h1).
 * 3.3: json_ld_types promotes JSON-LD from a raw dump to a filtered extraction path.
 */

import { load } from 'cheerio';
import { fetchWithTimeout } from './_fetch.js';
import { parseJsonLd, filterJsonLdByType } from '../../utils/jsonLd.js';

/**
 * Parse microdata items (elements with itemscope).
 * @param {import('cheerio').CheerioAPI} $
 * @returns {Array}
 */
function parseMicrodata($) {
  const results = [];
  $('[itemscope]').each((_, el) => {
    const $el = $(el);
    const item = {
      type: $el.attr('itemtype') || null,
      properties: {}
    };
    $el.find('[itemprop]').each((_, prop) => {
      const $prop = $(prop);
      const name = $prop.attr('itemprop');
      if (!name) return;
      const tag = ($prop.get(0).tagName || '').toLowerCase();
      let value;
      if (tag === 'meta') value = $prop.attr('content');
      else if (tag === 'a' || tag === 'link') value = $prop.attr('href');
      else if (tag === 'img') value = $prop.attr('src');
      else if (tag === 'time') value = $prop.attr('datetime') || $prop.text().trim();
      else value = $prop.text().trim();
      if (value) {
        if (!item.properties[name]) item.properties[name] = [];
        item.properties[name].push(value);
      }
    });
    results.push(item);
  });
  return results;
}

/**
 * @param {{ url: string, user_agent?: string, respect_robots?: boolean,
 *   json_ld_types?: string[] }} params
 */
export async function extractMetadataHandler({ url, user_agent, respect_robots, json_ld_types }) {
  try {
    const response = await fetchWithTimeout(url, {
      userAgent: user_agent,
      respectRobots: respect_robots,
      tool: 'extract_metadata'
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = load(html);

    // Stronger title fallback: og:title → <title> → h1
    // 'head > title' (not bare 'title') so inline <svg><title> elements are not matched
    const title =
      $('meta[property="og:title"]').attr('content') ||
      $('head > title').first().text().trim() ||
      $('h1').first().text().trim() ||
      '';

    const description =
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') || '';
    const keywords = $('meta[name="keywords"]').attr('content') || '';
    const canonical = $('link[rel="canonical"]').attr('href') || '';

    const ogTags = {};
    // Some sites (e.g. MDN) emit OG tags with name= instead of the standard property=
    $('meta[property^="og:"], meta[name^="og:"]').each((_, el) => {
      const property = $(el).attr('property') || $(el).attr('name');
      const content = $(el).attr('content');
      if (property && content) ogTags[property.replace('og:', '')] = content;
    });

    const twitterTags = {};
    $('meta[name^="twitter:"]').each((_, el) => {
      const name = $(el).attr('name');
      const content = $(el).attr('content');
      if (name && content) twitterTags[name.replace('twitter:', '')] = content;
    });

    const author = $('meta[name="author"]').attr('content') || '';
    const robots = $('meta[name="robots"]').attr('content') || '';
    const viewport = $('meta[name="viewport"]').attr('content') || '';
    const charset =
      $('meta[charset]').attr('charset') ||
      $('meta[http-equiv="Content-Type"]').attr('content') || '';

    const jsonLd = parseJsonLd($);
    const microdata = parseMicrodata($);

    const result = {
      title,
      description,
      keywords: keywords.split(',').map(k => k.trim()).filter(Boolean),
      canonical_url: canonical,
      author,
      robots,
      viewport,
      charset,
      og_tags: ogTags,
      twitter_tags: twitterTags,
      json_ld: jsonLd,
      microdata,
      url: response.url
    };

    // With a type filter, json_ld carries only the matching nodes — returning
    // the raw dump as well would double the payload on the large pages that
    // make filtering worth asking for.
    if (json_ld_types?.length) {
      const { items, counts } = filterJsonLdByType(jsonLd, json_ld_types);
      result.json_ld = items;
      result.json_ld_type_counts = counts;
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Failed to extract metadata: ${error.message}` }],
      isError: true
    };
  }
}
