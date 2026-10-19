/**
 * Brave Search API Adapter
 *
 * Creator Mode's direct search backend when BRAVE_SEARCH_API_KEY is set,
 * replacing Google Custom Search, which Google discontinues on 2027-01-01.
 * Production users never reach this: their searches go through the CrawlForge
 * API, which runs the same Brave mapping server-side
 * (crawlforge-website src/lib/search/providers/brave.ts).
 *
 * Takes the Custom Search parameters SearchWebTool sends and returns Custom
 * Search's response shape, so the rest of the pipeline is unchanged.
 *
 * Checked against the live API on 2026-10-19:
 * - `count` is at most 20, and `offset` is a PAGE index from 0 to 9. A caller's
 *   `start` need not fall on a page boundary, so `bravePage` picks a page size
 *   whose page holds the whole window, and the extra results are sliced off.
 * - `search_lang` and `country` are validated: `zh`, `pt` and `EN` are a 422
 *   where `zh-hans`, `pt-br` and `en` pass. Common forms are normalised, and a
 *   locale still refused is retried once without it.
 * - `description` carries `<strong>` highlighting; there is no total count.
 */

const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const MAX_COUNT = 20;
const MAX_PAGE = 9;
/** Custom Search's depth, which search_web documents: nothing past the 100th result. */
const MAX_RESULTS = 100;
const TIMEOUT_MS = 15000;

const FRESHNESS = { d1: 'pd', w1: 'pw', m1: 'pm', y1: 'py' };

const LANGUAGE_ALIASES = {
  zh: 'zh-hans', 'zh-cn': 'zh-hans', 'zh-sg': 'zh-hans',
  'zh-tw': 'zh-hant', 'zh-hk': 'zh-hant',
  pt: 'pt-br',
};
const REGIONAL_LANGUAGES = new Set(['zh-hans', 'zh-hant', 'pt-br', 'pt-pt', 'en-gb']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** `lang_en`, `lang_zh-CN`, `pt` → the code Brave validates; undefined to send none. */
export function braveLanguage(lr) {
  const code = String(lr ?? '').replace(/^lang_/, '').trim().toLowerCase();
  if (!code) return undefined;
  if (LANGUAGE_ALIASES[code]) return LANGUAGE_ALIASES[code];
  if (REGIONAL_LANGUAGES.has(code)) return code;
  return code.split('-')[0];
}

/**
 * The Brave page that holds results `first` to `first + wanted - 1` (zero-based):
 * the smallest page size whose page contains the whole window. Every window of
 * up to 10 within the first 100 results fits one; a wider one that fits none
 * gets the 20-result page holding `first`, and so only part of the window.
 */
export function bravePage(first, wanted) {
  for (let count = wanted; count <= MAX_COUNT; count++) {
    const page = Math.floor(first / count);
    if (page <= MAX_PAGE && Math.floor((first + wanted - 1) / count) === page) {
      return { count, page };
    }
  }
  return { count: MAX_COUNT, page: Math.floor(first / MAX_COUNT) };
}

/** Brave's highlighted HTML as the plain text Custom Search puts in `snippet`. */
export function plainText(html) {
  return String(html ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
      }
      return ENTITIES[name.toLowerCase()] ?? entity;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function toItem(result) {
  if (!result?.url) return [];
  const pagemap = {};
  if (result.thumbnail?.src) pagemap.cse_thumbnail = [{ src: result.thumbnail.src }];
  if (result.page_age) pagemap.metatags = [{ 'article:published_time': result.page_age }];

  let displayLink = result.meta_url?.hostname;
  if (!displayLink) {
    try { displayLink = new URL(result.url).hostname; } catch { displayLink = ''; }
  }
  return [{
    title: plainText(result.title),
    link: result.url,
    snippet: plainText(result.description),
    displayLink,
    formattedUrl: result.url,
    htmlTitle: result.title ?? '',
    htmlSnippet: result.description ?? '',
    ...(Object.keys(pagemap).length > 0 ? { pagemap } : {}),
  }];
}

export class BraveSearchAdapter {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error('Brave Search API key is required');
    }
    this.apiKey = apiKey;
  }

  /**
   * @param {Object} params - Custom Search parameters, as SearchWebTool sends them
   *   (query, num, start, lr, safe, dateRestrict, cr)
   * @returns {Promise<Object>} Custom Search-shaped results, plus `provider: 'brave'`
   */
  async search(params) {
    const startedAt = Date.now();
    const first = Math.max(0, (params.start || 1) - 1);
    const wanted = Math.min(Math.max(1, params.num || 10), MAX_COUNT, MAX_RESULTS - first);
    if (wanted <= 0) return this.toResult([], startedAt);
    const { count, page } = bravePage(first, wanted);

    const base = new URLSearchParams({
      q: params.query,
      count: String(count),
      safesearch: params.safe === 'active' ? 'strict' : 'off',
    });
    if (page > 0) base.append('offset', String(page));
    if (FRESHNESS[params.dateRestrict]) base.append('freshness', FRESHNESS[params.dateRestrict]);

    const localized = new URLSearchParams(base);
    const language = braveLanguage(params.lr);
    const country = String(params.cr ?? '').replace(/^country/, '').trim().toUpperCase();
    if (language) localized.append('search_lang', language);
    if (/^[A-Z]{2}$/.test(country)) localized.append('country', country);

    let response = await this.send(localized);
    if (response.status === 422 && localized.toString() !== base.toString()) {
      response = await this.send(base);
    }

    if (!response.ok) {
      let detail = response.statusText;
      try { detail = (await response.json())?.error?.detail || detail; } catch { /* no body */ }
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'Invalid Brave Search API key'
          : response.status === 429
            ? 'Brave Search API rate limit or credit balance reached. Try again later.'
            : `Brave Search failed with status ${response.status}: ${detail}`
      );
    }

    const data = await response.json();
    const skip = first - page * count;
    return this.toResult((data?.web?.results ?? []).slice(skip, skip + wanted).flatMap(toItem), startedAt);
  }

  async send(params) {
    try {
      return await fetch(`${ENDPOINT}?${params.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json', 'X-Subscription-Token': this.apiKey },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(`Network error connecting to Brave Search API: ${error.message}`);
    }
  }

  toResult(items, startedAt) {
    return {
      items,
      searchInformation: { totalResults: null, searchTime: (Date.now() - startedAt) / 1000 },
      queries: {},
      context: {},
      provider: 'brave',
    };
  }
}

export default BraveSearchAdapter;
