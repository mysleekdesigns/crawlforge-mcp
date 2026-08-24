# Reddit access in 2026 — why the archives, and the optional official-API path

**Status:** decision + prototype (unreleased). Not yet version-bumped or published.
**Scope:** the `reddit_search` tool (`src/tools/search/redditSearch.js`).
**Date:** 2026-08-24.

This doc records (1) why `reddit_search` reads community archives instead of
`reddit.com`, (2) the research on whether that block can be worked around, and
(3) the optional official-API passthrough added as a prototype behind two env
vars. It leaves the default behavior of the tool unchanged.

---

## 1. Why reddit.com can't be scraped directly

Reddit's block on `reddit.com` is **layered**, which is why neither a plain
fetch nor a datacenter-hosted stealth browser gets through:

1. **IP reputation** — datacenter IP ranges (where servers live) are `403`'d on
   sight. This is the layer that also defeats CrawlForge's own `stealth_mode` /
   `deep_research` against Reddit today.
2. **TLS / JA3–JA4 fingerprinting** — evaluated at the TLS handshake, *before*
   any HTTP request. A non-browser TLS stack is flagged even from a clean IP.
3. **JavaScript challenge** — a direct request to `www.reddit.com` returns
   **HTTP 200 with a JS-challenge interstitial, not real content**; you must
   execute the JS in a real browser to get the page.
4. **Anonymous `.json` is being shut down** — Reddit announced the end of
   unauthenticated access to the `.json` URL suffix; anonymous `.json` now
   returns `403`. The old cheap trick is dead (confirmed in multiple mid-2026
   threads).

"Getting around it" therefore means defeating all four layers at once, or going
through a sanctioned door.

## 2. The realistic paths (2026), and why we default to archives

| Path | Live? | Cost | ToS posture | Verdict for a free, no-config MCP tool |
|------|-------|------|-------------|----------------------------------------|
| **A. Official Reddit Data API (OAuth)** | Yes | Free ≤100 QPM (non-commercial); $0.24/1K + manual approval for commercial | Compliant | Best *live* path, but per-user credentials + registration burden; a shared CrawlForge key = "commercial use" = contract |
| **B. Anti-bot bypass on reddit.com** (residential proxy + JS render + TLS spoof, together) | Yes | ~$1.30–1.50 / 1K records, or proxy bandwidth | Gray area | Works but costs money and is a ToS gray area; not a default |
| **C. Community archives** — Arctic Shift + PullPush (+ Academic Torrents dumps) | Near-real-time / snapshots | Free, no creds | Clean (never touches reddit.com) | **Current default.** Correct choice for zero-config |
| **D. Unified third-party APIs** (SocialCrawl, etc.) | Yes | Paid credits | Same as any 3rd-party scrape | Adds a middleman; no clear win over A/C |
| **E. Real-browser session** (Claude-in-Chrome / Playwright MCP) | Yes | — | User's own session | Not server-side/automated; doesn't scale |

**Ground truth on Path A's approval queue (r/redditdev, Feb–Jul 2026):** devs
report month-long silences and generic auto-rejections even for tiny
non-commercial apps. A *script-type app for personal read-only use* still
self-serves in minutes; anything beyond that is gated.

**Conclusion:** the archive approach (Path C) is the right **default** — free,
credential-free, and clear of both the anti-bot wall and the approval
gauntlet. The one additive, compliant enhancement is letting a user opt into
**Path A with their own credentials**, exactly as `serp_rank` lets a user bring
their own DataForSEO login.

## 3. The prototype: optional official-API passthrough

When (and only when) the user sets **both** `REDDIT_CLIENT_ID` and
`REDDIT_CLIENT_SECRET`, `reddit_search` can read Reddit's official Data API
directly. Absent them, the tool is byte-for-byte unchanged.

### What it adds
- **Live, authoritative data** — real vote scores and complete comment trees,
  not archive snapshots — on the user's **own free 100-QPM quota** (no
  CrawlForge credits, no reddit.com scraping).
- Automatic upgrade in `auto` mode: when configured, supported requests try the
  official API **first**, then fall back to Arctic Shift / PullPush.

### Deliberate limits (these fall back to the archives)
- **No comment full-text search.** Reddit's API can't search comment bodies
  (that was Pushshift's superpower). `mode:"comments"` always uses the archives.
- **No date-range filter.** Reddit search/listings only expose coarse `t`
  buckets, not arbitrary `after`/`before`. A dated query is rejected on the
  official path so `auto` mode falls through to the archives (which honor dates).
- **Ascending sort** is approximated by reversing the returned page (Reddit only
  serves newest-first).

### Design
- `src/tools/search/redditNormalize.js` — shared normalizers (`normalizePost`,
  `normalizeComment`, `normalizeTreeNodes`, …), reused by both paths so the
  output schema is identical regardless of source. Arctic Shift already mirrors
  Reddit's `/comments` tree shape, so thread normalization is shared for free.
- `src/tools/search/adapters/redditOfficialApi.js` — app-only OAuth
  (`client_credentials` grant → bearer token, cached in memory until ~60s before
  expiry) + calls to `https://oauth.reddit.com`. Mirrors the
  `adapters/dataforseoSearch.js` pattern.
- `redditSearch.js` — reads the env vars, adds `reddit_api` to the `source`
  enum, and routes: `reddit_api` first in `auto` when it can serve the request
  (posts/thread), archives otherwise and as fallback.

### Endpoint mapping (official path)
| Request | Endpoint on `oauth.reddit.com` |
|---------|-------------------------------|
| `thread` (by `link_id`) | `GET /comments/{id}` → post + nested tree |
| `posts` + `query` + `subreddit` | `GET /r/{sr}/search?restrict_sr=true&q=…&type=link` |
| `posts` + `query` (+ `author`) | `GET /search?q=[author:x ]…&type=link` |
| `posts`, no query, `author` only | `GET /user/{author}/submitted` |
| `posts`, no query, `subreddit` | `GET /r/{sr}/new` |

## 4. Setup

1. Sign in to Reddit → https://www.reddit.com/prefs/apps → **create an app**.
2. Type **script**; redirect URI `http://localhost:8080` (required, unused).
3. Copy the **client id** (under the app name) and **secret**.
4. Set in your environment / `.env`:
   ```bash
   REDDIT_CLIENT_ID=your_client_id
   REDDIT_CLIENT_SECRET=your_client_secret
   # Optional; Reddit prefers a descriptive UA. Default is CrawlForge-MCP/…:
   REDDIT_USER_AGENT="CrawlForge-MCP/5.1.0 (by /u/yourname)"
   ```
5. Reconnect the MCP server. `reddit_search` now uses the official API first for
   posts/thread; everything else is unchanged. Force it with
   `source:"reddit_api"`, or force an archive with
   `source:"arctic_shift"`/`"pullpush"`.

## 5. Open questions before shipping (need a maintainer decision)

- **Credit cost.** Should the official path stay at 2 credits (it's the user's
  own quota/key, like `serp_rank` costing 5 even though DataForSEO bills
  separately)? Current prototype leaves it at **2**, unchanged.
- **Password grant.** App-only (`client_credentials`) covers all public reads.
  Reading a specific user's *private* data (the redditdev use case) would need
  the OAuth `password`/redirect flow — out of scope here; add only if asked.
- **Website credit parity.** If cost changes, the crawlforge-website
  `TOOL_CREDIT_COSTS` must match (this repo is hands-off on the website).
- **Docs sweep + version bump + publish** — not done; this is a prototype.

## 6. Primary sources
- Scrapfly — *How to Scrape Reddit … in 2026* (asp + render_js + residential recipe)
- SocialCrawl — *Reddit API in 2026: Pricing, Rate Limits & What Works*
- Thunderbit — *How to Scrape Reddit with Python: 4 Methods*
- Scrapfly — *JA3/JA4 TLS Fingerprinting Guide*
- r/redditdev thread `1r13hbv` and r/ClaudeAI thread `1utab6f` (read via `reddit_search`)
