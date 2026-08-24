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
 */

import { z } from 'zod';

const ARCTIC_SHIFT_BASE = 'https://arctic-shift.photon-reddit.com';
const PULLPUSH_BASE = 'https://api.pullpush.io';

/**
 * Identify ourselves. Verified live: Arctic Shift throttles UA-less clients
 * into a shared bucket (422 "Timeout. Maybe slow down a bit" while curl got
 * 200 for the same URL); with a descriptive UA it answers instantly.
 */
const USER_AGENT = 'CrawlForge-MCP/5.1.0 (+https://www.crawlforge.dev)';

/** Cap selftext/body length so a 100-result payload stays LLM-friendly. */
const TEXT_MAX = 2000;

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
  source: z.enum(['auto', 'arctic_shift', 'pullpush']).optional().default('auto'),
});

/** "t3_abc123" / "t1_abc123" → "abc123" (both archives accept bare IDs). */
function stripIdPrefix(id) {
  return String(id).replace(/^t[13]_/, '');
}

/** "r/Foo" → "Foo", "u/bar" → "bar" (Arctic Shift ignores prefixes; PullPush doesn't). */
function stripNamePrefix(name) {
  return name == null ? name : String(name).replace(/^[ru]\//, '');
}

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

function truncate(text) {
  if (typeof text !== 'string' || text.length <= TEXT_MAX) {
    return { text: text ?? null, truncated: false };
  }
  return { text: text.slice(0, TEXT_MAX), truncated: true };
}

function toIso(epochSeconds) {
  return typeof epochSeconds === 'number'
    ? new Date(epochSeconds * 1000).toISOString()
    : null;
}

/** Both archives store raw Reddit post objects — reduce to the fields that matter. */
function normalizePost(raw) {
  const { text: selftext, truncated } = truncate(raw.selftext);
  return {
    id: raw.id ?? null,
    title: raw.title ?? null,
    author: raw.author ?? null,
    subreddit: raw.subreddit ?? null,
    created_utc: raw.created_utc ?? null,
    created_iso: toIso(raw.created_utc),
    score: raw.score ?? null,
    num_comments: raw.num_comments ?? null,
    upvote_ratio: raw.upvote_ratio ?? null,
    flair: raw.link_flair_text ?? null,
    over_18: raw.over_18 ?? null,
    selftext,
    selftext_truncated: truncated,
    url: raw.url ?? null,
    permalink: raw.permalink ? `https://www.reddit.com${raw.permalink}` : null,
  };
}

function normalizeComment(raw) {
  const { text: body, truncated } = truncate(raw.body);
  return {
    id: raw.id ?? null,
    author: raw.author ?? null,
    subreddit: raw.subreddit ?? null,
    created_utc: raw.created_utc ?? null,
    created_iso: toIso(raw.created_utc),
    score: raw.score ?? null,
    body,
    body_truncated: truncated,
    link_id: raw.link_id ? stripIdPrefix(raw.link_id) : null,
    parent_id: raw.parent_id ?? null,
    permalink: raw.permalink ? `https://www.reddit.com${raw.permalink}` : null,
  };
}

/**
 * Arctic Shift's /api/comments/tree returns Reddit-API-style nodes:
 * {kind:"t1", data:{...comment, replies:{kind:"Listing", data:{children:[...]}}}}
 * and {kind:"more", data:{count, children:[ids]}} for collapsed branches.
 * Flatten to a nested {..comment, replies:[...]} shape.
 */
function normalizeTreeNodes(nodes) {
  if (!Array.isArray(nodes)) return [];
  return nodes.map((node) => {
    if (node?.kind === 'more') {
      return { more_count: node.data?.count ?? null, more_ids: node.data?.children ?? [] };
    }
    const data = node?.data ?? {};
    const children = data.replies?.data?.children;
    return { ...normalizeComment(data), replies: normalizeTreeNodes(children) };
  });
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

    let order; // backends to try, in order
    if (v.source === 'arctic_shift') {
      if (!arcticPossible) {
        throw new Error('Arctic Shift cannot keyword-search across all of Reddit — add a subreddit or author scope, or use source:"pullpush"');
      }
      order = ['arctic_shift'];
    } else if (v.source === 'pullpush') {
      if (v.mode === 'thread') throw new Error('thread mode requires Arctic Shift (source:"pullpush" only supports posts/comments search)');
      order = ['pullpush'];
    } else {
      order = v.mode === 'thread' ? ['arctic_shift']
        : arcticPossible ? ['arctic_shift', 'pullpush']
        : ['pullpush'];
    }

    const errors = [];
    for (const source of order) {
      try {
        const result = source === 'arctic_shift'
          ? await this.#searchArcticShift(v, { subreddit, author })
          : await this.#searchPullPush(v, { subreddit, author });
        if (errors.length > 0) result.fallback_used = `primary source failed (${errors[0]}), fell back to ${source}`;
        return result;
      } catch (error) {
        errors.push(`${source}: ${error.message}`);
      }
    }
    // Unscoped keyword searches have no Arctic Shift fallback (it requires a
    // scope — verified live: HTTP 400 without one), so point at the fix.
    const hint = order.length === 1 && order[0] === 'pullpush' && v.source === 'auto'
      ? ' Tip: add a subreddit or author filter to route to the more reliable Arctic Shift archive.'
      : '';
    throw new Error(`All Reddit archive sources failed — ${errors.join('; ')}.${hint}`);
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
