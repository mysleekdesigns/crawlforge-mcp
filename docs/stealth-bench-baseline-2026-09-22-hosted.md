# CrawlForge stealth benchmark

Mode: walls + detectors. Produced by `scripts/stealth-bench.mjs` against the matrix in section 2 of `docs/STEALTH_REVIEW_2026-09.md`.

> Captured from the Render shell on the hosted instance, 2026-09-22, by pasting
> the harness's stdout. `commit: unknown` because `.git/` is excluded from the
> build context — the image has no repository to read a SHA from. The image was
> built from `main` at `6cbc959`.

## Environment

- Run: 2026-09-22T14:11:57.434Z (UTC), CrawlForge 6.7.0, commit `unknown`
- Host: linux x64 6.8.0-1051-aws, 8 cores, 31 GB
- Network: unclassified (free tier) — AS14618 Amazon.com, Inc., Ashburn, Virginia, United States (74.220.49.x)
- Browsers: chromium 153.0.8010.52, camoufox 152.0.4-beta.30
- Playwright 1.62.1, camoufox npm 0.1.19

## Bot walls

| Target | Vendor | Plain fetch | Chromium stealth | Camoufox |
| --- | --- | --- | --- | --- |
| nowsecure.nl | Cloudflare, interactive challenge | Blocked | Blocked | Blocked |
| indeed.com/cmp/Burger-King/reviews | Cloudflare Turnstile | Blocked | Pass | Blocked |
| quora.com | Cloudflare (login wall embeds Turnstile) | Blocked | Pass | Blocked |
| harrods.com | Akamai | Blocked | Pass | Pass |
| g2.com | DataDome | Blocked | Blocked | Blocked |
| stackoverflow.com/questions | Cloudflare | Blocked | Pass | Pass |
| leboncoin.fr | DataDome | Blocked | error | Blocked |
| producthunt.com | Cloudflare | Blocked | Blocked | Blocked |
| lesswrong.com | Vercel checkpoint | Pass | n/a | n/a |
| zalando.co.uk | Akamai | Pass | n/a | n/a |
| carvana.com | client-rendered shell | Blocked | Blocked | Blocked |
| trustpilot.com | DataDome | skipped (robots) | skipped (robots) | skipped (robots) |

### Detail

- nowsecure / Plain fetch: **Blocked** — cloudflare — title "Just a moment..."
- nowsecure / Chromium stealth: **Blocked** — cloudflare — a Cloudflare challenge script on a 43-character page (also at 15000ms)
- nowsecure / Camoufox: **Blocked** — cloudflare — a Cloudflare challenge script on a 43-character page (also at 15000ms)
- indeed / Plain fetch: **Blocked** — cloudflare — a Cloudflare challenge script on a 0-character page
- indeed / Chromium stealth: **Pass** — "Working at Burger King: 42,788 Reviews | Indeed.com", 11559 chars of text
- indeed / Camoufox: **Blocked** — cloudflare — title "Just a moment..."
- quora / Plain fetch: **Blocked** — cloudflare — title "Just a moment..."
- quora / Chromium stealth: **Pass** — "Quora - A place to share knowledge and better understand the world", 397 chars of text
- quora / Camoufox: **Blocked** — cloudflare — title "Just a moment..."
- harrods / Plain fetch: **Blocked** — akamai — title "Access Denied"
- harrods / Chromium stealth: **Pass** — "The World's Leading Luxury Department Store | Harrods US", 4096 chars of text
- harrods / Camoufox: **Pass** — "The World's Leading Luxury Department Store | Harrods US", 4096 chars of text
- g2 / Plain fetch: **Blocked** — datadome — a DataDome captcha frame on a 43-character page
- g2 / Chromium stealth: **Blocked** — datadome — a DataDome captcha frame on a 0-character page
- g2 / Camoufox: **Blocked** — datadome — a DataDome captcha frame on a 0-character page
- stackoverflow / Plain fetch: **Blocked** — cloudflare — title "Just a moment..."
- stackoverflow / Chromium stealth: **Pass** — "Newest Questions - Stack Overflow", 9365 chars of text
- stackoverflow / Camoufox: **Pass** — "Newest Questions - Stack Overflow", 8862 chars of text
- leboncoin / Plain fetch: **Blocked** — datadome — a DataDome captcha frame on a 43-character page
- leboncoin / Chromium stealth: **error** — chromium scrape of https://www.leboncoin.fr exceeded the 66000ms cap
- leboncoin / Camoufox: **Blocked** — datadome — a DataDome captcha frame on a 0-character page
- producthunt / Plain fetch: **Blocked** — cloudflare — title "Just a moment..."
- producthunt / Chromium stealth: **Blocked** — cloudflare — title "Just a moment..."
- producthunt / Camoufox: **Blocked** — cloudflare — title "Just a moment..."
- lesswrong / Plain fetch: **Pass** — "LessWrong", 12786 chars of text
- zalando / Plain fetch: **Pass** — "Shop Shoes, Fashion & Accessories Online | Zalando UK", 3050 chars of text
- carvana / Plain fetch: **Blocked** — cloudflare — title "Just a moment..."
- carvana / Chromium stealth: **Blocked** — cloudflare — title "Just a moment..."
- carvana / Camoufox: **Blocked** — cloudflare — title "Just a moment..."
- trustpilot / all: **skipped (robots)** — robots.txt on www.trustpilot.com disallows this path for CrawlForge.

### Deltas vs the 2026-09-21 residential review

- indeed / Chromium stealth: review **Blocked**, this run **Pass**
- indeed / Camoufox: review **Pass**, this run **Blocked**
- quora / Chromium stealth: review **Blocked**, this run **Pass**
- harrods / Chromium stealth: review **Blocked**, this run **Pass**
- leboncoin / Chromium stealth: review **Pass**, this run **error**
- producthunt / Plain fetch: review **Pass**, this run **Blocked**
- carvana / Plain fetch: review **Pass**, this run **Blocked**

## Detectors

### chromium 153.0.8010.52 — self-probes

| Check | Result | Detail |
| --- | --- | --- |
| navigator-webdriver | pass | false |
| useragentdata-brands | pass | Google Chrome present, no headless brand |
| worker-useragent | pass | matches main thread |
| worker-platform | pass | Linux x86_64 |
| worker-hardware-concurrency | pass | 8 |
| worker-languages | **fail** | worker "en-US, en" vs main "en-US" |
| webrtc-host-candidates | pass | no candidates gathered |
| ua-version-vs-binary | pass | UA Chrome 153, binary 153.0.8010.52 |
| persona-os-vs-host | pass | UA claims linux, host is linux |
| headless-markers | pass | none |

### camoufox 152.0.4-beta.30 — self-probes

| Check | Result | Detail |
| --- | --- | --- |
| navigator-webdriver | pass | false |
| useragentdata-brands | skip | Firefox exposes no navigator.userAgentData |
| worker-useragent | pass | matches main thread |
| worker-platform | pass | MacIntel |
| worker-hardware-concurrency | pass | 10 |
| worker-languages | pass | en-US, en |
| webrtc-host-candidates | pass | RTCPeerConnection is not defined |
| ua-version-vs-binary | pass | UA Firefox 152, binary 152.0.4-beta.30 |
| persona-os-vs-host | **fail** | UA claims macos, host is linux |
| headless-markers | pass | none |

Full UA on camoufox: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/147.0`

### Third-party detector pages

| Page | Engine | Result |
| --- | --- | --- |
| bot.sannysoft.com | chromium | **fail** — 2 of 34 rows: Permissions (New), navigator.javaEnabled |
| bot-detector.rebrowser.net | chromium | pass — 0 failing of 10 (5 skipped, probe not triggered) |
| CreepJS | chromium | **fail** — worker UA `HeadlessChrome/153` vs main `Chrome/153`; headless-score 0% |
| browserscan.net | chromium | pass — 18 Normal markers, none abnormal |
| bot.incolumitas.com | chromium | **fail** — 2 of 34: inconsistentWebWorkerNavigatorPropery, WEBDRIVER |
| bot.sannysoft.com | camoufox | **fail** — 2 of 14 rows: Chrome (New), navigator.javaEnabled |
| bot-detector.rebrowser.net | camoufox | pass — 0 failing of 10 |
| CreepJS | camoufox | **fail** — headless-score 6%; worker-vs-main all match |
| browserscan.net | camoufox | pass — 19 Normal markers, none abnormal |
| bot.incolumitas.com | camoufox | **fail** — 1 of 11: webDriverAdvanced |

## Summary

- Walls: 20 Blocked, 8 Pass, 1 error, 4 n/a, 3 skipped (robots)
- Detector checks: 32 pass, 8 fail, 12 skip
