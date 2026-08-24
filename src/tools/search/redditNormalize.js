/**
 * Shared Reddit result normalizers.
 *
 * Both the community-archive path (redditSearch.js) and the official Reddit
 * Data API adapter (adapters/redditOfficialApi.js) reduce raw Reddit post,
 * comment, and comment-tree objects to one stable output shape. Keeping the
 * normalizers here lets both reuse them without a circular import.
 *
 * All three sources (Arctic Shift, PullPush, and Reddit's own API) store the
 * same raw Reddit object fields, and Arctic Shift deliberately mirrors Reddit's
 * `/comments` tree shape — so a single set of normalizers covers all of them.
 */

/** Cap selftext/body length so a 100-result payload stays LLM-friendly. */
export const TEXT_MAX = 2000;

/** "t3_abc123" / "t1_abc123" → "abc123" (all backends accept bare IDs). */
export function stripIdPrefix(id) {
  return String(id).replace(/^t[13]_/, '');
}

/** "r/Foo" → "Foo", "u/bar" → "bar". */
export function stripNamePrefix(name) {
  return name == null ? name : String(name).replace(/^[ru]\//, '');
}

export function truncate(text) {
  if (typeof text !== 'string' || text.length <= TEXT_MAX) {
    return { text: text ?? null, truncated: false };
  }
  return { text: text.slice(0, TEXT_MAX), truncated: true };
}

export function toIso(epochSeconds) {
  return typeof epochSeconds === 'number'
    ? new Date(epochSeconds * 1000).toISOString()
    : null;
}

/** Raw Reddit post object → the stable subset that matters. */
export function normalizePost(raw) {
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

export function normalizeComment(raw) {
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
 * Reddit-API-style comment tree → nested {..comment, replies:[...]} shape.
 * Nodes look like {kind:"t1", data:{...comment, replies:{data:{children:[...]}}}}
 * and {kind:"more", data:{count, children:[ids]}} for collapsed branches.
 * Both Arctic Shift's /api/comments/tree and Reddit's /comments/{id} use this.
 */
export function normalizeTreeNodes(nodes) {
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
