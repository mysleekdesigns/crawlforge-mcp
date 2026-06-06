/**
 * extract_metadata — Extract page metadata (title, description, OG tags, etc.).
 * Extracted from server.js inline handler.
 * B1: Parse JSON-LD and microdata; stronger title fallback chain (og:title → <title> → h1).
 */

import { load } from 'cheerio';
import { fetchWithTimeout } from './_fetch.js';

/**
 * Parse all JSON-LD blocks from the document.
 * @param {import('cheerio').CheerioAPI} $
 * @returns {Array}
 */
function parseJsonLd($) {
  const results = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).html();
      if (raw) results.push(JSON.parse(raw));
    } catch {
      // Skip invalid blocks
    }
  });
  return results;
}

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
 * @param {{ url: string }} params
 */
export async function extractMetadataHandler({ url }) {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = load(html);

    // Stronger title fallback: og:title → <title> → h1
    const title =
      $('meta[property="og:title"]').attr('content') ||
      $('title').text().trim() ||
      $('h1').first().text().trim() ||
      '';

    const description =
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') || '';
    const keywords = $('meta[name="keywords"]').attr('content') || '';
    const canonical = $('link[rel="canonical"]').attr('href') || '';

    const ogTags = {};
    $('meta[property^="og:"]').each((_, el) => {
      const property = $(el).attr('property');
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

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
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
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Failed to extract metadata: ${error.message}` }],
      isError: true
    };
  }
}
