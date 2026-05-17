/**
 * extract_metadata — Extract page metadata (title, description, OG tags, etc.).
 * Extracted from server.js inline handler.
 */

import { load } from 'cheerio';
import { fetchWithTimeout } from './_fetch.js';

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

    const title = $('title').text().trim() || $('h1').first().text().trim();
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
