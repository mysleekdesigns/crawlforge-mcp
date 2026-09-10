/**
 * redditHosts — reddit.com is never fetched.
 *
 * reddit.com refuses every non-browser client (403, and the stealth browsers
 * too — the block is IP/TLS-reputation based), so a scrape or fetch_url
 * against it always fails and leaves the caller guessing. Reddit is served by
 * reddit_search, which reads the same posts and comments from the Arctic
 * Shift community archive (PullPush second). A reddit.com target is therefore
 * refused before any network work, with the reddit_search call that gets the
 * same data spelled out — derived from the URL where the URL says enough.
 *
 * Runs inside the pre-fetch gate (robotsGate.js), so every fetching tool and
 * both browser paths get it without knowing. Not overridable: respect_robots
 * is about robots.txt, and fetching reddit.com fails whatever the caller sends.
 *
 * Mirrors the website's `src/lib/tools/reddit-hosts.ts` — same rule, same
 * message — so a reddit.com URL is answered identically on both surfaces.
 */

export class UseRedditSearchError extends Error {
  constructor(url) {
    const call = redditSearchCallFor(url);
    const nextStep = Object.keys(call).length
      ? `reddit_search(${JSON.stringify(call)})`
      : 'reddit_search with a query, subreddit or author — or mode "thread" with a post\'s link_id';
    super(
      `${hostOf(url)} is not fetched: reddit.com refuses every non-browser client, stealth browsers included, ` +
      `so this call would fail. Reddit is served by reddit_search (5 credits), which reads the same posts ` +
      `and comments from the Arctic Shift community archive. Next step: ${nextStep}`
    );
    this.name = 'UseRedditSearchError';
    this.code = 'USE_REDDIT_SEARCH';
    this.url = url;
    this.redditSearchCall = call;
  }
}

/** The hostname of a URL, lowercased, or null if it will not parse. */
function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

/**
 * True for reddit.com and its subdomains (www, old, new, np, sh …) and for the
 * bare redd.it short-link host. The media hosts (i.redd.it, v.redd.it,
 * preview.redd.it) serve files to any client and are left alone.
 * @param {string} url
 */
export function isRedditUrl(url) {
  const host = hostOf(url);
  if (!host) return false;
  return host === 'reddit.com' || host.endsWith('.reddit.com') || host === 'redd.it';
}

/**
 * The reddit_search call that answers a reddit.com URL, or {} when the URL
 * names nothing reddit_search can be pointed at (the front page, a wiki, a
 * settings page).
 *
 *   /r/{sub}/comments/{id}/…, /comments/{id}, /gallery/{id}, redd.it/{id}
 *                                        → mode "thread", link_id
 *   /r/{sub}/search?q=…                  → query scoped to the subreddit
 *   /search?q=…                          → an unscoped query
 *   /r/{sub}[/new|/top|…]                → the subreddit's posts
 *   /user/{name} or /u/{name}[/comments] → the author's posts (or comments)
 *   ?type=comment                        → mode "comments"
 * @param {string} url
 * @returns {{ mode?: string, query?: string, subreddit?: string, author?: string, link_id?: string }}
 */
export function redditSearchCallFor(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return {};
  }
  const segments = parsed.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });

  if (parsed.hostname.toLowerCase() === 'redd.it') {
    return segments[0] ? { mode: 'thread', link_id: segments[0] } : {};
  }

  // A post's id follows "comments" or "gallery" wherever it sits in the path;
  // a permalink to one comment still reads as its thread.
  const idAt = segments.findIndex((segment) => segment === 'comments' || segment === 'gallery');
  if (idAt !== -1 && segments[idAt + 1]) {
    return { mode: 'thread', link_id: segments[idAt + 1] };
  }

  const call = {};
  if (segments[0] === 'r' && segments[1]) call.subreddit = segments[1];
  if ((segments[0] === 'user' || segments[0] === 'u') && segments[1]) {
    call.author = segments[1];
    if (segments[2] === 'comments') call.mode = 'comments';
  }
  const query = parsed.searchParams.get('q')?.trim();
  if (query) call.query = query;
  if (parsed.searchParams.get('type') === 'comment') call.mode = 'comments';
  return call;
}

/**
 * Throw UseRedditSearchError for a reddit.com target. Call before any network
 * work — the point is that reddit.com never gets a request, not even for its
 * robots.txt.
 * @param {string} url
 */
export function assertNotRedditUrl(url) {
  if (isRedditUrl(url)) throw new UseRedditSearchError(url);
}
