---
paths:
  - "src/tools/search/**"
---

# Search tools

## serp_rank (DataForSEO)

- Reports where a target domain ranks in Google's real organic results for a keyword — the SERP position Google Custom Search / `search_web` cannot give. Never fabricates a rank.
- Backed by the DataForSEO Google Organic SERP API (Live Advanced, `POST /v3/serp/google/organic/live/advanced`, HTTP Basic auth); adapter in `adapters/dataforseoSearch.js`.
- Credentials: `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD`, billed to the user's own DataForSEO account (~US$0.002 per 10 results of `depth`: $0.004 at the default `depth:20`, $0.02 at `depth:100`), separate from CrawlForge credits.
- Unconfigured: returns `{ configured:false }` and charges 0 credits. Configured: 5 credits.

## reddit_search (community archives)

- reddit.com 403-blocks all direct access (fetch, browser UA, stealth — IP/TLS-reputation based), so by default this tool never touches reddit.com. It queries Arctic Shift (`arctic-shift.photon-reddit.com`, near-real-time, comment trees) and PullPush (`api.pullpush.io`, Pushshift-compatible).
- Arctic Shift's keyword search requires a subreddit or author scope (HTTP 400 without one). A scoped search queries it directly; an unscoped post search discovers posts with a site-restricted web search, then reads them from the archive by ID (`source:"web_discovery"`).
- PullPush stopped serving automated clients in August 2026 (429 on every UA; Cloudflare 403 from some IPs). It is never tried automatically; `source:"pullpush"` still reaches it.
- An unscoped comment search has no backend and returns a scope-required error.
- Modes: `posts` (default), `comments`, `thread` (post plus nested comment tree by `link_id`). Free, no Reddit credentials. Cost: 5, the same web search `search_web` spends. `REDDIT_SEARCH_TIMEOUT_MS` overrides the 30s default.
- Optional official-API path (`adapters/redditOfficialApi.js`): with the user's own `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`, `auto` tries `oauth.reddit.com` first for posts and thread (app-only OAuth), then the archives; `source:"reddit_api"` forces it. Comment search and date ranges always use the archives. Unset (the default), nothing reaches reddit.com. Same 5 credits. Reddit stopped issuing new credentials without an approval ticket on 2025-11-11; see `docs/reddit-access-and-oauth.md`.
