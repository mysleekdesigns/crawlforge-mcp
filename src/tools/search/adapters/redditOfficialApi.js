/**
 * Reddit Official Data API adapter (app-only OAuth)
 *
 * The optional, fully ToS-compliant live path for reddit_search. When a user
 * supplies THEIR OWN Reddit app credentials (REDDIT_CLIENT_ID /
 * REDDIT_CLIENT_SECRET), reddit_search can read Reddit's own API directly
 * instead of a community archive — giving live scores, complete comment trees,
 * and up-to-the-minute listings, on the user's own 100-QPM free quota.
 *
 * Auth: "Application Only OAuth" (client_credentials grant). This needs only a
 * client id + secret from a Reddit "script" or "web app" registered at
 * https://www.reddit.com/prefs/apps — no Reddit username/password, because we
 * only read public data. The token endpoint (www.reddit.com/api/v1/access_token)
 * is the OAuth server and is NOT behind Reddit's anti-scraper wall; all data
 * calls then go to https://oauth.reddit.com with the bearer token.
 *
 * Deliberate scope: the official API can serve `posts` search/listings and
 * `thread` reads. It has NO comment full-text search (that was Pushshift's
 * superpower), and its listings/search cannot filter by an arbitrary date
 * range — only coarse `t` buckets. Those two cases are surfaced as errors so
 * the caller falls back to the archives, which do support them.
 */

import { normalizePost, normalizeTreeNodes, stripIdPrefix, stripNamePrefix } from '../redditNormalize.js';

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API_BASE = 'https://oauth.reddit.com';

/** Reddit requires a descriptive, unique User-Agent; generic ones are throttled. */
const DEFAULT_USER_AGENT = 'CrawlForge-MCP/5.1.0 (+https://www.crawlforge.dev)';

/** Our sort is asc/desc by post date; Reddit listings/search only go newest-first. */
const REDDIT_SORT = 'new';

export class RedditOfficialApiAdapter {
  constructor(clientId, clientSecret, options = {}) {
    if (!clientId || !clientSecret) {
      throw new Error('Reddit API credentials are required (client id + secret).');
    }
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.userAgent = options.userAgent || process.env.REDDIT_USER_AGENT || DEFAULT_USER_AGENT;
    this.tokenUrl = options.tokenUrl || TOKEN_URL;
    this.apiBaseUrl = options.apiBaseUrl || API_BASE;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.authHeader = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    // Cached app-only token: { value, expiresAt(ms epoch) }.
    this._token = null;
  }

  /** Fetch (or reuse) an app-only bearer token. Refreshed a minute before expiry. */
  async #getToken(force = false) {
    if (!force && this._token && Date.now() < this._token.expiresAt) {
      return this._token.value;
    }
    let response;
    try {
      response = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.userAgent,
        },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw new Error(`Reddit token request timed out after ${this.timeoutMs}ms`);
      }
      throw new Error(`Reddit token network error: ${error.message}`);
    }
    if (!response.ok) {
      // 401 here means the client id/secret are wrong or the app was revoked.
      const hint = response.status === 401
        ? ' — check REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET (and that the app is a "script" or "web app")'
        : '';
      throw new Error(`Reddit OAuth failed: HTTP ${response.status} ${response.statusText}${hint}`);
    }
    const data = await response.json();
    if (!data.access_token) throw new Error('Reddit OAuth returned no access_token');
    const ttlMs = (Number(data.expires_in) || 3600) * 1000;
    this._token = { value: data.access_token, expiresAt: Date.now() + ttlMs - 60000 };
    return this._token.value;
  }

  /** Authenticated GET against oauth.reddit.com, with one token-refresh retry on 401. */
  async #get(path, queryParams) {
    const url = `${this.apiBaseUrl}${path}?${new URLSearchParams({ raw_json: '1', ...queryParams })}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.#getToken(attempt > 0); // force refresh on the retry
      let response;
      try {
        response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, 'User-Agent': this.userAgent },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
          throw new Error(`Reddit API request timed out after ${this.timeoutMs}ms`);
        }
        throw new Error(`Reddit API network error: ${error.message}`);
      }
      if (response.status === 401 && attempt === 0) continue; // stale token → refresh + retry once
      if (response.status === 429) {
        const reset = response.headers?.get?.('x-ratelimit-reset');
        throw new Error(`Reddit API rate limited (429)${reset ? `, retry in ${reset}s` : ''} — you are over your app's 100 QPM quota`);
      }
      if (!response.ok) {
        throw new Error(`Reddit API HTTP ${response.status} ${response.statusText}`);
      }
      return response.json();
    }
    // Unreachable in practice: the loop returns or throws on each path.
    throw new Error('Reddit API authorization failed after token refresh');
  }

  /** Data is authoritative and live — say so, and drop the archive caveats. */
  #notes() {
    return [
      'Data from the official Reddit Data API (oauth.reddit.com) via your configured Reddit app credentials — live and authoritative (real scores, complete comment trees).',
      'Consumes your Reddit app\'s own 100 QPM free-tier quota, not CrawlForge credits.',
    ];
  }

  /**
   * Search/list posts. Mirrors the archive path's contract; validation of the
   * required-scope rules happens in redditSearch.js before we get here.
   */
  async searchPosts(v, { subreddit, author }) {
    // The official API cannot honor an arbitrary date range (only coarse `t`
    // buckets). Reject so `auto` mode falls back to the archives, which can.
    if (v.after || v.before) {
      throw new Error('official Reddit API cannot filter by date range — unset after/before, or use source:"arctic_shift"/"pullpush"');
    }
    const sr = stripNamePrefix(subreddit);
    const au = stripNamePrefix(author);
    const limit = String(v.limit);

    let path;
    let query;
    if (v.query) {
      const q = au ? `author:${au} ${v.query}` : v.query;
      if (sr) {
        path = `/r/${encodeURIComponent(sr)}/search`;
        query = { q, restrict_sr: 'true', sort: REDDIT_SORT, type: 'link', limit };
      } else {
        path = '/search';
        query = { q, sort: REDDIT_SORT, type: 'link', limit };
      }
    } else if (au && !sr) {
      path = `/user/${encodeURIComponent(au)}/submitted`;
      query = { sort: REDDIT_SORT, limit };
    } else if (sr && au) {
      path = `/r/${encodeURIComponent(sr)}/search`;
      query = { q: `author:${au}`, restrict_sr: 'true', sort: REDDIT_SORT, type: 'link', limit };
    } else {
      path = `/r/${encodeURIComponent(sr)}/new`;
      query = { limit };
    }

    const data = await this.#get(path, query);
    const children = Array.isArray(data?.data?.children) ? data.data.children : [];
    let results = children
      .filter((c) => c?.kind === 't3' && c.data)
      .map((c) => normalizePost(c.data));
    // Reddit only returns newest-first; approximate ascending by reversing the page.
    if (v.sort === 'asc') results = results.reverse();

    return {
      source: 'reddit_api', mode: 'posts',
      query: v.query ?? null, subreddit: sr ?? null, author: au ?? null,
      count: results.length, results,
      after_cursor: data?.data?.after ?? null,
      notes: this.#notes(), checkedAt: new Date().toISOString(),
    };
  }

  /** Read a post plus its nested comment tree from the official API. */
  async getThread(v) {
    const id = stripIdPrefix(v.link_id);
    const data = await this.#get(`/comments/${encodeURIComponent(id)}`, { limit: String(v.limit) });
    // Reddit returns [postListing, commentsListing].
    const postChild = data?.[0]?.data?.children?.[0];
    const post = postChild?.data ? normalizePost(postChild.data) : null;
    const comments = normalizeTreeNodes(data?.[1]?.data?.children);
    return {
      source: 'reddit_api', mode: 'thread', link_id: id,
      post, comments, comment_count: comments.length,
      notes: this.#notes(), checkedAt: new Date().toISOString(),
    };
  }
}

export default RedditOfficialApiAdapter;
