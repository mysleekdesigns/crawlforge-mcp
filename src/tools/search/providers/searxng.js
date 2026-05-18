/**
 * SearXNG Search Provider
 *
 * Executes searches against a self-hosted SearXNG instance via its JSON API.
 * Instance URL is read from the CRAWLFORGE_SEARXNG_URL environment variable.
 *
 * SearXNG JSON API reference:
 *   https://docs.searxng.org/dev/search_api.html
 *
 * Result shape is normalised to match the CrawlForge/Google adapter format so
 * the rest of the search pipeline (ranking, deduplication, caching) is unaffected.
 */

/**
 * Map a single SearXNG result object to the internal item shape used throughout
 * the search pipeline.
 *
 * SearXNG field → internal field
 *   title       → title
 *   url         → link, displayLink, formattedUrl
 *   content     → snippet, htmlSnippet
 *   (all others) → ignored / defaulted
 *
 * @param {Object} result - Raw SearXNG result entry
 * @returns {Object} Normalised item
 */
export function normalizeSearxngResult(result) {
  const url = result.url || '';
  let displayLink = '';
  try {
    displayLink = new URL(url).hostname;
  } catch {
    displayLink = url;
  }

  return {
    title: result.title || '',
    link: url,
    snippet: result.content || '',
    displayLink,
    formattedUrl: url,
    htmlSnippet: result.content || '',
    pagemap: {},
    metadata: {
      mime: null,
      fileFormat: null,
      cacheId: null
    }
  };
}

/**
 * Fetch search results from a SearXNG instance.
 *
 * @param {Object} opts
 * @param {string}  opts.query       - Search query string
 * @param {number}  [opts.limit=10]  - Maximum number of results to return
 * @param {number}  [opts.page=1]    - Page number (1-based)
 * @param {boolean} [opts.safeSearch=true] - Whether safe search is enabled
 * @param {string}  [opts.language='en']   - Language code (e.g. 'en', 'de')
 * @param {string}  [opts.instanceUrl]     - Override for CRAWLFORGE_SEARXNG_URL
 * @returns {Promise<Object>} Results in the internal adapter format
 *   { items: Array, searchInformation: { totalResults, searchTime }, queries: {}, context: {} }
 */
export async function searchViaSearxng(opts = {}) {
  const instanceUrl = opts.instanceUrl || process.env.CRAWLFORGE_SEARXNG_URL;

  if (!instanceUrl) {
    throw new Error(
      "provider 'searxng' requires CRAWLFORGE_SEARXNG_URL in environment"
    );
  }

  const {
    query,
    limit = 10,
    page = 1,
    safeSearch = true,
    language = 'en'
  } = opts;

  // SearXNG safesearch: 0=off, 1=moderate, 2=strict
  const safesearch = safeSearch ? 1 : 0;

  const url = new URL('/search', instanceUrl);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('pageno', String(page));
  url.searchParams.set('safesearch', String(safesearch));
  url.searchParams.set('language', language);

  let response;
  try {
    response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' }
    });
  } catch (err) {
    throw new Error(`SearXNG request failed: ${err.message}`);
  }

  if (!response.ok) {
    throw new Error(
      `SearXNG returned HTTP ${response.status}: ${response.statusText}`
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('SearXNG returned invalid JSON');
  }

  const rawResults = Array.isArray(data.results) ? data.results : [];
  const items = rawResults.slice(0, limit).map(normalizeSearxngResult);

  return {
    items,
    searchInformation: {
      totalResults: String(rawResults.length),
      searchTime: data.answers ? 0 : 0
    },
    queries: {},
    context: {}
  };
}
