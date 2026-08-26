/**
 * reddit_search tool
 *
 * Searches Reddit posts and comments, or reads a full comment thread.
 *
 * reddit.com hard-blocks non-browser clients (403 on fetch, stealth browsers
 * included — the block is IP/TLS-reputation based), so this tool never touches
 * reddit.com. It queries the two community-run Reddit archives instead:
 *
 * - Arctic Shift (https://arctic-shift.photon-reddit.com) — near-real-time
 *   ingestion, comment trees, richer endpoints. Constraint from its API docs:
 *   keyword search (`query`/`body`) only works when scoped to a subreddit,
 *   author, or post — NOT across all of Reddit.
 * - PullPush (https://api.pullpush.io) — Pushshift-compatible, supports
 *   cross-subreddit full-text search, but has known post-2023 archive gaps
 *   and recurring outages.
 *
 * Routing: scoped searches go to Arctic Shift (fresher) with PullPush as an
 * error-only fallback; unscoped keyword searches can only go to PullPush.
 * Both services are free and need no credentials.
 *
 * Optional official-API path: if the user sets REDDIT_CLIENT_ID and
 * REDDIT_CLIENT_SECRET (their own Reddit app), posts/thread requests can read
 * Reddit's official Data API (live scores, complete comment trees) on their own
 * free quota, preferred in `auto` mode with the archives as fallback. Absent
 * those vars — the default — this tool never touches reddit.com. Comment
 * full-text search and date-range filters always use the archives (the official
 * API supports neither). See adapters/redditOfficialApi.js and
 * docs/reddit-access-and-oauth.md.
 */

import { z } from 'zod';
import {
  normalizePost,
  normalizeComment,
  normalizeTreeNodes,
  stripIdPrefix,
  stripNamePrefix,
} from './redditNormalize.js';
import { RedditOfficialApiAdapter } from './adapters/redditOfficialApi.js';
import { SearchProviderFactory } from './adapters/searchProviderFactory.js';

const ARCTIC_SHIFT_BASE = 'https://arctic-shift.photon-reddit.com';
const PULLPUSH_BASE = 'https://api.pullpush.io';

/**
 * Identify ourselves. Verified live: Arctic Shift throttles UA-less clients
 * into a shared bucket (422 "Timeout. Maybe slow down a bit" while curl got
 * 200 for the same URL); with a descriptive UA it answers instantly.
 */
const USER_AGENT = 'CrawlForge-MCP/5.2.1 (+https://www.crawlforge.dev)';

const RedditSearchSchema = z.object({
  query: z.string().min(1).optional(),
  subreddit: z.string().min(1).optional(),
  author: z.string().min(1).optional(),
  mode: z.enum(['posts', 'comments', 'thread']).optional().default('posts'),
  link_id: z.string().min(1).optional(), // post ID — required for thread mode
  after: z.string().min(1).optional(),
  before: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional().default(25),
  sort: z.enum(['asc', 'desc']).optional().default('desc'),
  source: z.enum(['auto', 'arctic_shift', 'pullpush', 'reddit_api', 'web_discovery']).optional().default('auto'),
});

/**
 * PullPush (Pushshift schema) wants epoch seconds for after/before. Pass
 * through epoch and offset forms ("7d"); convert ISO dates. Arctic Shift
 * accepts all of these natively, so this is only used on the PullPush path.
 */
function toEpochSeconds(value) {
  if (/^\d+$/.test(value) || /^\d+[a-z]+$/i.test(value)) return value;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error(`Unparseable date "${value}" — use ISO 8601, epoch seconds, or an offset like "7d"`);
  }
  return String(Math.floor(ms / 1000));
}

export class RedditSearchTool {
  constructor(options = {}) {
    // Overridable for tests / self-hosted mirrors.
    this.arcticBaseUrl = options.arcticBaseUrl || ARCTIC_SHIFT_BASE;
    this.pullpushBaseUrl = options.pullpushBaseUrl || PULLPUSH_BASE;
    // Community services with no SLA — generous but bounded.
    this.timeoutMs = options.timeoutMs ?? (Number(process.env.REDDIT_SEARCH_TIMEOUT_MS) || 30000);
    // Pause before the single retry of a transient throttle response.
    this.retryDelayMs = options.retryDelayMs ?? 3000;

    // Optional official-API path. When the user supplies THEIR OWN Reddit app
    // credentials, reddit_search can read Reddit's own API (live, authoritative)
    // instead of the archives. Absent (the default), the tool is unchanged.
    this.redditClientId = options.redditClientId || process.env.REDDIT_CLIENT_ID || null;
    this.redditClientSecret = options.redditClientSecret || process.env.REDDIT_CLIENT_SECRET || null;
    this.officialConfigured = Boolean(this.redditClientId && this.redditClientSecret);
    // Lazily constructed on first official-path use; overridable for tests.
    this._officialAdapter = options.officialAdapter || null;

    // Web discovery serves the one shape no archive can: a keyword search
    // across all of Reddit. Arctic Shift requires a subreddit or author scope,
    // and PullPush stopped serving automated clients in August 2026.
    this.searchAdapter = options.searchAdapter || null;
    this.searchApiKey = options.searchApiKey || null;
  }

  /** The web-search adapter used to discover posts, built once on first use. */
  #search() {
    if (!this.searchAdapter) {
      this.searchAdapter = SearchProviderFactory.createAdapter(this.searchApiKey);
    }
    return this.searchAdapter;
  }

  /** The official-API adapter, built once from the configured credentials. */
  #official() {
    if (!this._officialAdapter) {
      this._officialAdapter = new RedditOfficialApiAdapter(
        this.redditClientId,
        this.redditClientSecret,
        { timeoutMs: this.timeoutMs },
      );
    }
    return this._officialAdapter;
  }

  async execute(params) {
    const v = RedditSearchSchema.parse(params);

    // Cross-field validation zod can't express per-mode.
    if (v.mode === 'thread') {
      if (!v.link_id) throw new Error('thread mode requires link_id (the post ID, e.g. "1twm1zh" or "t3_1twm1zh")');
    } else if (!v.query && !v.subreddit && !v.author && !(v.mode === 'comments' && v.link_id)) {
      throw new Error(`${v.mode} mode requires at least one of: query, subreddit, author${v.mode === 'comments' ? ', link_id' : ''}`);
    }

    const subreddit = stripNamePrefix(v.subreddit);
    const author = stripNamePrefix(v.author);
    // Arctic Shift keyword search must be scoped (its documented constraint).
    const scoped = Boolean(subreddit || author || (v.mode === 'comments' && v.link_id));
    const arcticPossible = v.mode === 'thread' || !v.query || scoped;
    // The official API serves posts search/listings and thread reads. It has no
    // comment full-text search, so `comments` mode always uses the archives.
    const officialPossible = this.officialConfigured && (v.mode === 'thread' || v.mode === 'posts');

    // A Reddit-wide keyword search for posts can be discovered through a web
    // search and then read out of the archive by ID.
    const discoveryPossible = v.mode === 'posts' && Boolean(v.query) && !subreddit && !author;

    let order; // backends to try, in order
    if (v.source === 'web_discovery') {
      if (!discoveryPossible) {
        throw new Error('web_discovery only serves unscoped keyword searches in posts mode — it finds posts through a web search and then reads them from the archive');
      }
      order = ['web_discovery'];
    } else if (v.source === 'reddit_api') {
      if (!this.officialConfigured) {
        throw new Error('source:"reddit_api" needs Reddit app credentials — set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET (create a "script" app at https://www.reddit.com/prefs/apps)');
      }
      if (v.mode === 'comments') {
        throw new Error('the official Reddit API has no comment full-text search — use comments mode with source:"arctic_shift"/"pullpush", or read a whole thread with mode:"thread"');
      }
      order = ['reddit_api'];
    } else if (v.source === 'arctic_shift') {
      if (!arcticPossible) {
        throw new Error('Arctic Shift cannot keyword-search across all of Reddit — add a subreddit or author scope, or use source:"pullpush"');
      }
      order = ['arctic_shift'];
    } else if (v.source === 'pullpush') {
      if (v.mode === 'thread') throw new Error('thread mode requires Arctic Shift (source:"pullpush" only supports posts/comments search)');
      order = ['pullpush'];
    } else {
      // auto: prefer the user's own official API (live, authoritative) when it
      // can serve this request, then fall back to the community archives.
      // PullPush is no longer tried automatically: every request now returns
      // 429 "This website does not provide free scraping resources for agents",
      // or a Cloudflare 403 challenge. It stays available on explicit request.
      const archives = v.mode === 'thread' ? ['arctic_shift']
        : arcticPossible ? ['arctic_shift']
        : discoveryPossible ? ['web_discovery']
        : [];
      order = officialPossible ? ['reddit_api', ...archives] : archives;
    }

    if (order.length === 0) {
      // Unscoped comment search was PullPush-only, and PullPush no longer
      // serves automated clients. Web discovery identifies posts, not comments.
      throw new Error(
        `An unscoped keyword search of ${v.mode} has no available backend: Arctic Shift requires a subreddit or author scope, and PullPush no longer serves automated clients. Add a subreddit or author filter, or search mode:"posts", which finds posts through a web search and reads them from the archive.`
      );
    }

    const errors = [];
    for (const source of order) {
      try {
        let result;
        if (source === 'reddit_api') {
          result = v.mode === 'thread'
            ? await this.#official().getThread(v)
            : await this.#official().searchPosts(v, { subreddit, author });
        } else if (source === 'web_discovery') {
          result = await this.#searchWebDiscovery(v);
        } else if (source === 'arctic_shift') {
          result = await this.#searchArcticShift(v, { subreddit, author });
        } else {
          result = await this.#searchPullPush(v, { subreddit, author });
        }
        if (errors.length > 0) result.fallback_used = `primary source failed (${errors[0]}), fell back to ${source}`;
        return result;
      } catch (error) {
        errors.push(`${source}: ${error.message}`);
      }
    }
    // Arctic Shift requires a scope (verified live: HTTP 400 without one), so an
    // unscoped query that got this far has exhausted its only route.
    const hint = order.includes('web_discovery')
      ? ' Tip: add a subreddit or author filter to search the Arctic Shift archive directly.'
      : '';
    throw new Error(`All Reddit sources failed — ${errors.join('; ')}.${hint}`);
  }

  /**
   * Reddit-wide keyword search, in two steps: find matching posts with a
   * site-restricted web search, then read those posts out of the Arctic Shift
   * archive by ID. Arctic Shift cannot keyword-search across all of Reddit and
   * reddit.com blocks scrapers, so discovery has to come from somewhere else —
   * but what comes back are real archive rows, the same shape a scoped search
   * returns, not scraped search-engine snippets.
   */
  async #searchWebDiscovery(v) {
    let found;
    try {
      found = await this.#search().search({
        query: `site:reddit.com ${v.query}`,
        num: Math.min(Math.max(v.limit, 1), 10), // one call caps at 10 results
        start: 1,
      });
    } catch (error) {
      throw new Error(`web search failed: ${error.message}`);
    }

    // /r/<sub>/comments/<id>/<slug> is the only Reddit URL shape naming a post.
    const ids = [];
    for (const item of found?.items ?? []) {
      const id = /\/comments\/([a-z0-9]+)/i.exec(item?.link ?? item?.url ?? '')?.[1];
      if (id && !ids.includes(id)) ids.push(id);
    }

    const notes = [
      'Reddit-wide keyword search: posts were found with a site-restricted web search, then read from the Arctic Shift archive by ID.',
      'Results are ordered by web-search relevance, not by score or date.',
      'Arctic Shift cannot keyword-search across all of Reddit, and PullPush no longer serves automated clients — scope the search to a subreddit or author to query the archive directly.',
    ];
    if (v.after || v.before) {
      // Silently dropping a date filter would return results the caller
      // believes were filtered.
      notes.push('after/before were NOT applied: discovery runs through a web search, which cannot filter by post date. Scope the search to a subreddit or author to use date filters.');
    }

    if (ids.length === 0) {
      return {
        source: 'web_discovery', mode: 'posts',
        query: v.query ?? null, subreddit: null, author: null,
        count: 0, results: [],
        notes, checkedAt: new Date().toISOString(),
      };
    }

    const data = await this.#get(`${this.arcticBaseUrl}/api/posts/ids`, {
      ids: ids.slice(0, v.limit).join(','),
    });
    const rows = Array.isArray(data.data) ? data.data : [];
    // Restore the web-search ordering; the archive answers in its own order.
    const byId = new Map(rows.map(row => [stripIdPrefix(String(row.id ?? '')), row]));
    const ordered = ids.map(id => byId.get(id)).filter(Boolean);

    return {
      source: 'web_discovery', mode: 'posts',
      query: v.query ?? null, subreddit: null, author: null,
      count: ordered.length, results: ordered.map(normalizePost),
      discovered: ids.length,
      notes, checkedAt: new Date().toISOString(),
    };
  }

  async #searchArcticShift(v, { subreddit, author }) {
    const notes = [
      'Data from the Arctic Shift community archive (arctic-shift.photon-reddit.com), not reddit.com (which blocks scrapers).',
      'Scores and comment counts of content less than ~36h old may read 0/1 — the archive captures content the moment it is posted.',
    ];

    if (v.mode === 'thread') {
      const id = stripIdPrefix(v.link_id);
      const postData = await this.#get(`${this.arcticBaseUrl}/api/posts/ids`, { ids: id });
      const post = postData.data?.[0] ? normalizePost(postData.data[0]) : null;
      const treeData = await this.#get(`${this.arcticBaseUrl}/api/comments/tree`, {
        link_id: `t3_${id}`,
        limit: String(v.limit),
      });
      const comments = normalizeTreeNodes(treeData.data);
      return {
        source: 'arctic_shift', mode: 'thread', link_id: id,
        post, comments, comment_count: comments.length,
        notes, checkedAt: new Date().toISOString(),
      };
    }

    const query = {
      limit: String(v.limit),
      sort: v.sort,
      ...(subreddit && { subreddit }),
      ...(author && { author }),
      ...(v.after && { after: v.after }),
      ...(v.before && { before: v.before }),
    };
    let path;
    if (v.mode === 'posts') {
      path = '/api/posts/search';
      if (v.query) query.query = v.query; // searches title + selftext
    } else {
      path = '/api/comments/search';
      if (v.query) query.body = v.query;
      if (v.link_id) query.link_id = stripIdPrefix(v.link_id);
    }
    const data = await this.#get(`${this.arcticBaseUrl}${path}`, query);
    const rows = Array.isArray(data.data) ? data.data : [];
    const results = v.mode === 'posts' ? rows.map(normalizePost) : rows.map(normalizeComment);
    return {
      source: 'arctic_shift', mode: v.mode,
      query: v.query ?? null, subreddit: subreddit ?? null, author: author ?? null,
      count: results.length, results,
      notes, checkedAt: new Date().toISOString(),
    };
  }

  async #searchPullPush(v, { subreddit, author }) {
    if (v.mode === 'thread') throw new Error('thread mode is Arctic Shift only');
    const notes = [
      'Data from the PullPush community archive (api.pullpush.io), not reddit.com (which blocks scrapers).',
      'PullPush has known gaps in its post-2023 archive — an empty result does not prove the content does not exist.',
    ];
    const query = {
      size: String(v.limit),
      sort: v.sort,
      sort_type: 'created_utc',
      ...(v.query && { q: v.query }),
      ...(subreddit && { subreddit }),
      ...(author && { author }),
      ...(v.after && { after: toEpochSeconds(v.after) }),
      ...(v.before && { before: toEpochSeconds(v.before) }),
    };
    if (v.mode === 'comments' && v.link_id) query.link_id = stripIdPrefix(v.link_id);
    const path = v.mode === 'posts' ? '/reddit/search/submission/' : '/reddit/search/comment/';
    const data = await this.#get(`${this.pullpushBaseUrl}${path}`, query);
    if (data.error) throw new Error(`PullPush error: ${data.error}`);
    const rows = Array.isArray(data.data) ? data.data : [];
    const results = v.mode === 'posts' ? rows.map(normalizePost) : rows.map(normalizeComment);
    return {
      source: 'pullpush', mode: v.mode,
      query: v.query ?? null, subreddit: subreddit ?? null, author: author ?? null,
      count: results.length, results,
      notes, checkedAt: new Date().toISOString(),
    };
  }

  /**
   * GET with one bounded retry: both archives shed load transiently (PullPush
   * 429s at ~15 req/min; Arctic Shift answers 422 "Timeout. Maybe slow down a
   * bit" under per-IP pressure — observed live) and usually recover in seconds.
   */
  async #get(base, queryParams) {
    const url = `${base}?${new URLSearchParams(queryParams)}`;
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
      try {
        return await this.#getOnce(url);
      } catch (error) {
        lastError = error;
        if (!error.retryable) throw error;
      }
    }
    throw lastError;
  }

  async #getOnce(url) {
    let response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw new Error(`request timed out after ${this.timeoutMs}ms`);
      }
      throw new Error(`network error: ${error.message}`);
    }
    if (response.status === 429) {
      const reset = response.headers?.get?.('x-ratelimit-reset');
      // PullPush's 429 body states its actual policy ("does not provide free
      // scraping resources for agents...") — pass that through verbatim.
      let detail = '';
      try { detail = (await response.json())?.error ?? ''; } catch { /* no body */ }
      throw Object.assign(
        new Error(`rate limited (429)${reset ? `, retry in ${reset}s` : ''}${detail ? ` — ${detail}` : ''}`),
        { retryable: true },
      );
    }
    if (!response.ok) {
      // Both archives put the real reason in the body (e.g. Arctic Shift's
      // throttle/parameter complaints) — surface it, bounded.
      let detail = '';
      try {
        const body = await response.text();
        let msg = body.slice(0, 200);
        try { msg = JSON.parse(body)?.error || msg; } catch { /* non-JSON body — use it raw */ }
        detail = msg ? `: ${msg}` : '';
      } catch { /* unreadable body — status alone will have to do */ }
      throw Object.assign(
        new Error(`HTTP ${response.status} ${response.statusText}${detail}`),
        { retryable: response.status === 422 && /timeout|slow down/i.test(detail) },
      );
    }
    return response.json();
  }
}

export default RedditSearchTool;
