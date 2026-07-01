/**
 * DataForSEO SERP Adapter
 *
 * Talks to the DataForSEO Google Organic SERP API to obtain REAL organic
 * ranking positions (rank_group / rank_absolute) — the data that Google Custom
 * Search (used by search_web) cannot provide. Used by the serp_rank tool.
 *
 * Auth: HTTP Basic (login:password) from DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD.
 * Get credentials at: https://app.dataforseo.com/api-access
 *
 * Endpoint (Live Advanced, synchronous — one request, one response):
 *   POST https://api.dataforseo.com/v3/serp/google/organic/live/advanced
 *
 * Cost: ~US$0.002 per 100 results (depth) on Live Advanced. For high-volume
 * scheduled tracking, DataForSEO's task-based "Standard" queue (task_post →
 * tasks_ready → task_get) is cheaper; swap the endpoint + poll if cost matters.
 */

export class DataForSEOSearchAdapter {
  constructor(login, password, options = {}) {
    if (!login || !password) {
      throw new Error('DataForSEO credentials are required (login + password).');
    }

    this.login = login;
    this.password = password;
    this.apiBaseUrl = options.apiBaseUrl || 'https://api.dataforseo.com';
    // Live Advanced is synchronous and usually answers in a few seconds; cap it
    // so a hung connection can't wedge the tool. Overridable for tests/self-host.
    this.timeoutMs = options.timeoutMs ?? 30000;
    // HTTP Basic auth header, computed once.
    this.authHeader = 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64');
  }

  /**
   * Run one Google organic SERP lookup and return normalized organic results.
   * @param {Object} params - Lookup parameters
   * @param {string} params.keyword - The search query to rank for (required)
   * @param {string} [params.locationName='United States'] - Human location name
   * @param {number} [params.locationCode] - Numeric DataForSEO location code (overrides locationName)
   * @param {string} [params.languageCode='en'] - Language code
   * @param {('desktop'|'mobile')} [params.device='desktop'] - Device to emulate
   * @param {number} [params.depth=100] - How many results to scan (100 = one page of cost)
   * @returns {Promise<{items: Array<Object>, meta: Object}>} Normalized organic results + metadata
   */
  async search(params) {
    const {
      keyword,
      locationName = 'United States',
      locationCode,
      languageCode = 'en',
      device = 'desktop',
      depth = 100,
    } = params;

    if (!keyword) {
      throw new Error('keyword is required for a SERP lookup');
    }

    // DataForSEO accepts an ARRAY of task objects; we send exactly one.
    const task = {
      keyword,
      language_code: languageCode,
      device,
      depth,
    };
    if (locationCode != null) {
      task.location_code = locationCode;
    } else {
      task.location_name = locationName;
    }

    let response;
    try {
      response = await fetch(`${this.apiBaseUrl}/v3/serp/google/organic/live/advanced`, {
        method: 'POST',
        headers: {
          'Authorization': this.authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([task]),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      // Timeout (AbortError) or network / DNS / fetch failure — surface clearly.
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw new Error(`DataForSEO request timed out after ${this.timeoutMs}ms`);
      }
      throw new Error(`Network error connecting to DataForSEO: ${error.message}`);
    }

    if (!response.ok) {
      // HTTP-level failure (auth, funds, rate limit, server error).
      let detail = `${response.status} ${response.statusText}`;
      if (response.status === 401) {
        detail = 'Invalid DataForSEO credentials (check DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD).';
      } else if (response.status === 402) {
        detail = 'DataForSEO account has insufficient funds. Top up at https://app.dataforseo.com/';
      } else if (response.status === 429) {
        detail = 'DataForSEO rate limit exceeded. Slow down or raise your plan limits.';
      }
      throw new Error(`DataForSEO request failed: ${detail}`);
    }

    const data = await response.json();

    // DataForSEO returns HTTP 200 even for logical errors — 20000 means OK.
    if (!data || data.status_code !== 20000) {
      throw new Error(
        `DataForSEO error ${data?.status_code ?? 'unknown'}: ${data?.status_message ?? 'no message'}`,
      );
    }

    const task0 = Array.isArray(data.tasks) ? data.tasks[0] : undefined;
    if (!task0 || task0.status_code !== 20000) {
      throw new Error(
        `DataForSEO task error ${task0?.status_code ?? 'unknown'}: ${task0?.status_message ?? 'no result returned'}`,
      );
    }

    const result0 = Array.isArray(task0.result) ? task0.result[0] : undefined;
    const rawItems = result0 && Array.isArray(result0.items) ? result0.items : [];

    // Keep only true organic results and normalize to a small, stable shape.
    // rank_group  = position within the organic results (the "rank" most people mean)
    // rank_absolute = position across ALL SERP elements (ads, snippets, packs, …)
    const items = rawItems
      .filter((it) => it && it.type === 'organic')
      .map((it) => ({
        position: it.rank_group ?? null,
        rankAbsolute: it.rank_absolute ?? null,
        domain: (it.domain || '').toLowerCase(),
        url: it.url || null,
        title: it.title || null,
        snippet: it.description || null,
      }));

    return {
      items,
      meta: {
        keyword,
        location: locationCode != null ? locationCode : locationName,
        languageCode,
        device,
        depth,
        organicCount: items.length,
        seResultsCount: result0?.se_results_count ?? null,
        checkUrl: result0?.check_url ?? null, // Google URL to eyeball the real SERP
        cost: data.cost ?? task0.cost ?? null, // USD charged by DataForSEO for this call
      },
    };
  }
}

export default DataForSEOSearchAdapter;
