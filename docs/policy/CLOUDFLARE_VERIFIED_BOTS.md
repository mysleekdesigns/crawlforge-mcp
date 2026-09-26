# Cloudflare verified bots: registration prerequisites and crawl-side review

Stealth review Phase 6, items 1 and 4 ([`STEALTH_REVIEW_2026-09.md`](../STEALTH_REVIEW_2026-09.md)). Written 2026-09-26.

**Nothing here has been submitted to Cloudflare.** The application is the owner's to make, and it is blocked on the website change in step 1 below. This repo does not touch crawlforge-website, Vercel or the Cloudflare dashboard.

Sources read on 2026-09-26: Cloudflare's [Web Bot Auth reference](https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/) and its [Verified bots](https://developers.cloudflare.com/bots/concepts/bot/verified-bots/) page. Anything not checked against a source that day is marked **not checked**.

## Where things stand

- **The key directory is live.** `https://www.crawlforge.dev/.well-known/http-message-signatures-directory` answered 200 with `Content-Type: application/http-message-signatures-directory+json`, `Cache-Control: public, max-age=86400`, and one Ed25519 key, kid `WNp5-QxDvkyOegclqd03Dc8E-yk6aHonCZWNimy_TLE` (the key in [`KEY_ROTATION.md`](./KEY_ROTATION.md)).
- **The directory response is not signed.** It carries no `Signature` or `Signature-Input` header, with or without `Accept: application/http-message-signatures-directory+json`. Cloudflare's registration requires both, so an application made today would fail validation.
- **Outbound requests are signed** when `CRAWLFORGE_SIGNING_KEY` is set: every fetch that goes through `preflightFetch` in `src/utils/robotsGate.js`. Production signing was verified end to end on 2026-08-27 (the log in `KEY_ROTATION.md`). The browser paths are deliberately unsigned (see item 2, declined, in the review).

## Item 1: what registration needs

### Step 1. Sign the directory response (blocking)

Cloudflare asks for one signature **per key in the directory**, so that nobody can mirror the directory and register on our behalf. Each response must carry:

| Header / parameter | Requirement |
| --- | --- |
| `Content-Type` | `application/http-message-signatures-directory+json` (already true) |
| `Signature` | RFC 9421 signature over the chosen components |
| `Signature-Input` → `tag` | `http-message-signatures-directory` (not `web-bot-auth`, which is the tag our *requests* carry) |
| `Signature-Input` → `keyid` | the JWK thumbprint of that key (RFC 8037 §A.3), the same value as the directory's `kid` |
| `Signature-Input` → `created` | Unix time the response was sent |
| `Signature-Input` → `expires` | Unix time after which Cloudflare should stop trying to verify it |
| Component `"@authority";req` | the `Host` of the request being answered, taken from the request (`req` parameter) |

Cloudflare's own example also carries `alg="ed25519"` and a `nonce`. Its requirements table does not list either as mandatory.

The `req` parameter is correct **here and nowhere else**. On a *request* signature Cloudflare rejects `req` outright, so the website implementation must not be copied back into `src/utils/webBotAuth.js`, and vice versa. Cloudflare publishes an [`http-signature-directory`](https://crates.io/crates/http-signature-directory) CLI for checking a directory before applying.

### Step 2. What the website would have to change

- The route that serves `/.well-known/http-message-signatures-directory` must add the two headers above to every response, one signature per key in `keys`. During a rotation, when two keys are published, both must sign.
- `created` and `expires` bind each signature to a time, so a signer must hold a private key when the response is produced. That conflicts with the rule in `KEY_ROTATION.md` that the **private half lives only on Render** and the website holds only `WEB_BOT_AUTH_PUBLIC_KEYS`. The ways round it, none evaluated beyond this list:
  1. Put the private key on Vercel as well. Simplest, and doubles where the secret lives.
  2. Sign offline with a bounded `expires` and serve the headers statically, then re-sign before they expire. The private key stays on Render, but a missed re-sign breaks verification.
  3. Have the website forward the directory request to the server on Render, which already holds the key. This adds a dependency on the MCP server being up.
- Check the result with Cloudflare's CLI before submitting.

This is the owner's decision and the owner's change. The website is outside this repo's scope.

### Step 3. The owner submits the form and waits

1. Cloudflare dashboard → **Manage Account** → **Configurations** → **Bot Submission Form** ([direct link](https://dash.cloudflare.com/?to=/:account/configurations/verified-bots)).
2. **Verification Method:** Request Signature.
3. **Validation Instructions:** the directory URL, `https://www.crawlforge.dev/.well-known/http-message-signatures-directory`. User-Agent patterns are optional; ours is `CrawlForge/<version> (+https://crawlforge.dev)`.
4. Declare the category and behaviours honestly (see item 4). Cloudflare says it may re-assign a category when public documentation and observed traffic disagree with the form.

Cloudflare then reviews the application. The lead time is not published. An approved bot appears in [Radar's bots and agents directory](https://radar.cloudflare.com/verified-bots), which is where the Phase 6 verification gate reads the verified status.

**Apply only after the three open points in item 4 below are settled.** Cloudflare removes a bot from the allowlist when the policy is breached. Verified status also names CrawlForge publicly, which is decision 5 in the review.

### Experimental: `Forwarded: for="<operator>"`

Cloudflare labels each verified bot **Direct** (one operator) or **Intermediary** (a service that many end users drive). CrawlForge is an intermediary: every call is a different customer's. For that case Cloudflare is experimenting with RFC 7239's `Forwarded` header, `Forwarded: for="<operator>"`, optionally with `;use="<content-use>"`, so a site owner's preference can follow the party responsible for a request through the intermediary. The docs call it an experiment. Nothing in CrawlForge sends it, and adopting it would need its own decision.

### Risk: blocking by category (not checked this session)

**Not checked on 2026-09-26.** Verification could make things worse on some zones. Cloudflare's Verified bots page lists **Search**, **Agent** and **Training** as managed presets that site owners "can act on across all plans". It also says: "Historically, Verified bots have been excluded in default bot configurations across all plans. Now, all customers have the option to configure AI bot policies." That page does not say whether a new zone blocks an AI category **by default**, and it does not say which category Cloudflare would assign CrawlForge. If a default block applies to that category, a plain fetch that passes today as an unknown bot could be blocked once it is identified. Read Cloudflare's [Block AI Bots](https://developers.cloudflare.com/bots/additional-configurations/block-ai-bots/) documentation before applying.

## Item 4: verified-bots policy review for `crawl_deep` and `map_site`

Cloudflare's two bars for a verified bot:

1. **Honest self-identification**: a Web Bot Auth signature, a published IP list with a stable User-Agent, or reverse DNS.
2. **Non-abusive behaviour**: "it obeys `robots.txt` and crawl directives, maintains reasonable request rates, and has not been observed evading website owner preferences or attacking sites."

Among the breaches it names: IPs that are not used solely by the verified service, a disclosed purpose the traffic does not match, and "an AI Crawler that does not respect the crawl-delay directive".

| Requirement | `crawl_deep` | `map_site` |
| --- | --- | --- |
| Honest User-Agent | Yes: `CrawlForge/<version> (+https://crawlforge.dev)` from `identityHeaders()` | Yes, through `preflightFetch` |
| Web Bot Auth signature | **No, for page fetches.** `BFSCrawler.fetchPage` (`src/core/crawlers/BFSCrawler.js`) builds its headers from `identityHeaders()` and calls `safeFetch` directly, never `signRequestHeaders`. Only a session's initial request (`_sessionContext.js`, through `preflightFetch`) is signed. | Yes: page fetches (`fetchWithTimeout`) and sitemap fetches (`sitemapParser.js`) both go through `preflightFetch` |
| `robots.txt` | Enforced by `robotsPreflight` before each page | Enforced by `preflightFetch` |
| `respect_robots: false` | Accepted, warned about and audited; the page fetch is unsigned | Accepted, warned about and audited, **and still signed** |
| `Crawl-delay` | Honoured: `throttleHost` with the robots delay, on top of the per-domain limiter | Honoured: `preflightFetch` → `throttleHost` |
| Request rate | Per-domain limiter at 10 req/s by default | Shared per-host limiter, 10 req/s and 100 req/min by default |
| IP validation | Not possible on the hosted instance: it exits from a shared AWS range (AS14618, Render). IPs "not solely used by the Verified service" are a named breach, so Web Bot Auth is the only method available. | Same |

**Verdict: it does not fit yet.** On `robots.txt` and `Crawl-delay`, both tools meet the bar. Three things stand in the way, and each is the owner's call:

1. **`crawl_deep` does not sign its pages.** After registration, a crawl would arrive mostly unverified. The fix is small (have `BFSCrawler.fetchPage` add `signRequestHeaders(url)`), but it is code and this phase's scope was documentation only.
2. **Signed traffic can ignore `robots.txt`.** `preflightFetch` signs every request it lets through, including one the caller let past `robots.txt` with `respect_robots: false`. Once CrawlForge is verified, that signature would put its verified identity on traffic that set aside the site's `robots.txt`, which is the first thing the policy requires. The likely fix is to not sign a request whose robots decision was overridden (`decision.overridden`). That is a behaviour change, and it needs a decision.
3. **Escalation after a signed block.** This is not about these two tools but about the product. When a signed fetch is walled, `scrape` with `escalate: true` and the agent's automatic retry try the host again in a stealth browser, with a browser User-Agent and no signature. The host memory recorded in Phase 6 sends a repeat call there first, and `stealth_mode` starts there. The policy asks that a verified bot "has not been observed evading website owner preferences". Whether Cloudflare counts a wall followed by a stealth render as evasion is **our reading of the policy text, not a Cloudflare ruling**. It is still the main question to settle before applying, because a breach removes the bot from the allowlist.

Also worth doing before an application, and outside this repo: a public page for the crawler. The User-Agent currently points at the homepage. The page would give the product token, how to opt out in `robots.txt`, the key directory, the rate limits and a contact. Cloudflare decides categories partly from public documentation.

For the form, the behaviours Cloudflare lists that match what customers use CrawlForge for are **Search** (building RAG or search indexes, the usual `crawl_deep` and `map_site` use), **Data Collection** (price and competitor monitoring) and **Agent** (`scrape` and `agent` acting for one user). A bot can declare more than one.
