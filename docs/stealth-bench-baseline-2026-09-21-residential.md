# CrawlForge stealth benchmark

Mode: walls + detectors. Produced by `scripts/stealth-bench.mjs` against the matrix in section 2 of `docs/STEALTH_REVIEW_2026-09.md`.

## Environment

- Run: 2026-09-21T22:04:22.516Z (UTC), CrawlForge 6.7.0, commit `34583bd`
- Host: darwin arm64 25.6.0, 32 cores, 512 GB
- Network: unclassified (free tier) — AS7922 Comcast Cable Communications, LLC, Miami, Florida, United States (73.46.18.x)
- Browsers: chromium 151.0.7922.34, camoufox 135.0.1-beta.24
- Playwright 1.62.1, camoufox npm 0.1.19

## Bot walls

| Target | Vendor | Plain fetch | Chromium stealth | Camoufox |
| --- | --- | --- | --- | --- |
| nowsecure.nl | Cloudflare, interactive challenge | Blocked | Blocked | Blocked |
| indeed.com/cmp/Burger-King/reviews | Cloudflare Turnstile | Blocked | Blocked | Pass |
| quora.com | Cloudflare (login wall embeds Turnstile) | Blocked | Blocked | Blocked |
| harrods.com | Akamai | Blocked | Blocked | Pass |
| g2.com | DataDome | Blocked | Blocked | Blocked |
| stackoverflow.com/questions | Cloudflare | Blocked | Pass | Pass |
| leboncoin.fr | DataDome | Blocked | Blocked | Blocked |
| producthunt.com | Cloudflare | Pass | n/a | n/a |
| lesswrong.com | Vercel checkpoint | Pass | n/a | n/a |
| zalando.co.uk | Akamai | Pass | n/a | n/a |
| carvana.com | client-rendered shell | Pass | n/a | n/a |
| trustpilot.com | DataDome | skipped (robots) | skipped (robots) | skipped (robots) |

### Detail

- nowsecure / Plain fetch: **Blocked** — cloudflare — a Cloudflare challenge script on a 43-character page
- nowsecure / Chromium stealth: **Blocked** — cloudflare — a Cloudflare challenge script on a 43-character page (also at 15000ms)
- nowsecure / Camoufox: **Blocked** — cloudflare — a Cloudflare challenge script on a 43-character page (also at 15000ms)
- indeed / Plain fetch: **Blocked** — cloudflare — a Cloudflare challenge script on a 0-character page
- indeed / Chromium stealth: **Blocked** — cloudflare — title "Just a moment..."
- indeed / Camoufox: **Pass** — "Working at Burger King: 42,786 Reviews | Indeed.com", 11551 chars of text
- quora / Plain fetch: **Blocked** — cloudflare — title "Just a moment..."
- quora / Chromium stealth: **Blocked** — cloudflare — a Cloudflare challenge script on a 397-character page
- quora / Camoufox: **Blocked** — cloudflare — a Cloudflare challenge script on a 397-character page
- harrods / Plain fetch: **Blocked** — akamai — title "Access Denied"
- harrods / Chromium stealth: **Blocked** — akamai — title "Access Denied"
- harrods / Camoufox: **Pass** — "The World’s Leading Luxury Department Store | Harrods US", 4096 chars of text
- g2 / Plain fetch: **Blocked** — datadome — a DataDome captcha frame on a 43-character page
- g2 / Chromium stealth: **Blocked** — datadome — a DataDome captcha frame on a 0-character page
- g2 / Camoufox: **Blocked** — datadome — a DataDome captcha frame on a 0-character page
- stackoverflow / Plain fetch: **Blocked** — cloudflare — title "Just a moment..."
- stackoverflow / Chromium stealth: **Pass** — "Newest Questions - Stack Overflow", 9051 chars of text
- stackoverflow / Camoufox: **Pass** — "Newest Questions - Stack Overflow", 9509 chars of text
- leboncoin / Plain fetch: **Blocked** — datadome — a DataDome captcha frame on a 43-character page
- leboncoin / Chromium stealth: **Blocked** — datadome — a DataDome captcha frame on a 0-character page
- leboncoin / Camoufox: **Blocked** — datadome — a DataDome captcha frame on a 0-character page
- producthunt / Plain fetch: **Pass** — "Product Hunt – The best new products in tech.", 10927 chars of text
- producthunt / Chromium stealth: **n/a** — not run — the plain fetch was not blocked
- producthunt / Camoufox: **n/a** — not run — the plain fetch was not blocked
- lesswrong / Plain fetch: **Pass** — "LessWrong", 12177 chars of text
- lesswrong / Chromium stealth: **n/a** — not run — the plain fetch was not blocked
- lesswrong / Camoufox: **n/a** — not run — the plain fetch was not blocked
- zalando / Plain fetch: **Pass** — "Shop Shoes, Fashion & Accessories Online | Zalando UK", 3050 chars of text
- zalando / Chromium stealth: **n/a** — not run — the plain fetch was not blocked
- zalando / Camoufox: **n/a** — not run — the plain fetch was not blocked
- carvana / Plain fetch: **Pass** — "Carvana | Buy & Finance Used Cars Online | At Home Delivery", 4797 chars of text
- carvana / Chromium stealth: **n/a** — not run — the plain fetch was not blocked
- carvana / Camoufox: **n/a** — not run — the plain fetch was not blocked
- trustpilot / Plain fetch: **skipped (robots)** — robots.txt on www.trustpilot.com disallows this path for CrawlForge. Pass respect_robots: false to fetch it anyway — that override is recorded against your API key and is your decision to make.
- trustpilot / Chromium stealth: **skipped (robots)** — robots.txt on www.trustpilot.com disallows this path for CrawlForge. Pass respect_robots: false to fetch it anyway — that override is recorded against your API key and is your decision to make.
- trustpilot / Camoufox: **skipped (robots)** — robots.txt on www.trustpilot.com disallows this path for CrawlForge. Pass respect_robots: false to fetch it anyway — that override is recorded against your API key and is your decision to make.

### Deltas vs the 2026-09-21 review

- leboncoin / Chromium stealth: review recorded **Pass**, this run **Blocked**

## Detectors

### chromium 151.0.7922.34 — self-probes

| Check | Result | Expected | Actual | Detail |
| --- | --- | --- | --- | --- |
| navigator-webdriver | fail | false | undefined (property deleted) | 'webdriver' in navigator: false |
| useragentdata-brands | fail | a "Google Chrome" brand and no "HeadlessChrome" brand | headless brand: HeadlessChrome; no "Google Chrome" brand | brands: Not=A?Brand 99, HeadlessChrome 151, Chromium 151 |
| worker-useragent | pass | worker matches the main thread | Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 |  |
| worker-platform | fail | worker matches the main thread | worker "MacIntel" vs main "Win32" |  |
| worker-hardware-concurrency | fail | worker matches the main thread | worker "32" vs main "8" |  |
| worker-languages | fail | worker matches the main thread | worker "en-US" vs main "en-US, en" |  |
| webrtc-host-candidates | pass | no ICE candidate with a raw IP address | 2 candidates, 0 with a raw address | candidate:269978172 1 udp 2113937151 a513d1a7-539c-47fe-a140-a1dc8356c6f0.local 59282 typ host generation 0 ufrag HRNG network-cost 999 \| candidate:1364982121 1 udp 2113939711 40a7c554-24f0-48fe-ba96-165d59341468.local 52365 typ host generation 0 ufrag HRNG network-cost 999 |
| ua-version-vs-binary | pass | Chrome 151 | UA Chrome 151, binary 151.0.7922.34 | Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 |
| persona-os-vs-host | fail | UA claims macos | UA claims windows, host is macos | Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 |
| headless-markers | fail | no "Headless" substring in main UA, worker UA or userAgentData | "Headless" in userAgentData | userAgentData: Not=A?Brand, HeadlessChrome, Chromium Windows |

### camoufox 135.0.1-beta.24 — self-probes

| Check | Result | Expected | Actual | Detail |
| --- | --- | --- | --- | --- |
| navigator-webdriver | pass | false | false | 'webdriver' in navigator: true |
| useragentdata-brands | skip | a "Google Chrome" brand and no "HeadlessChrome" brand | not applicable | Firefox exposes no navigator.userAgentData |
| worker-useragent | pass | worker matches the main thread | Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0 |  |
| worker-platform | pass | worker matches the main thread | Win32 |  |
| worker-hardware-concurrency | pass | worker matches the main thread | 16 |  |
| worker-languages | fail | worker matches the main thread | worker "en-US, en" vs main "en-US" |  |
| webrtc-host-candidates | pass | no ICE candidate with a raw IP address | WebRTC unavailable | RTCPeerConnection is not defined |
| ua-version-vs-binary | pass | Firefox 135 | UA Firefox 135, binary 135.0.1-beta.24 | Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0 |
| persona-os-vs-host | fail | UA claims macos | UA claims windows, host is macos | Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0 |
| headless-markers | pass | no "Headless" substring in main UA, worker UA or userAgentData | none | main-thread userAgent, worker userAgent |

### chromium 151.0.7922.34 — bot.sannysoft.com

| Check | Result | Expected | Actual | Detail |
| --- | --- | --- | --- | --- |
| sannysoft:red-rows | fail | no failed rows | 2 of 34 classified rows failed | failed: Permissions (New), navigator.javaEnabled |

### chromium 151.0.7922.34 — bot-detector.rebrowser.net

| Check | Result | Expected | Actual | Detail |
| --- | --- | --- | --- | --- |
| rebrowser:dummyFn | skip | row reports no detection | not triggered | this probe only fires when the client calls into it, and the harness does not |
| rebrowser:sourceUrlLeak | skip | row reports no detection | not triggered | this probe only fires when the client calls into it, and the harness does not |
| rebrowser:mainWorldExecution | skip | row reports no detection | not triggered | this probe only fires when the client calls into it, and the harness does not |
| rebrowser:runtimeEnableLeak | pass | row reports no detection | green | No leak detected. |
| rebrowser:exposeFunctionLeak | skip | row reports no detection | not triggered | this probe only fires when the client calls into it, and the harness does not |
| rebrowser:navigatorWebdriver | fail | row reports no detection | red | This property shouldn't be undefined. You might have it deleted manually. typeof navigator.webdriver = undefined |
| rebrowser:viewport | pass | row reports no detection | green | Viewport is different from default values used in automation libraries. { "width": 1920, "height": 968 } |
| rebrowser:pwInitScripts | pass | row reports no detection | green | No window.__pwInitScripts detected. |
| rebrowser:useragent | fail | row reports no detection | red | Google Chrome is not presented in navigator.userAgentData. You might be using Google Chrome for Testing which is a red flag. Try to specify executablePath and use Google Chrome (stable channel). { "useragentVersionItems": [ { "brand": "Chromium", "version": "151.0.7922.34" } ] } |
| rebrowser:bypassCsp | pass | row reports no detection | green | Content Security Policy (CSP) is enabled, it's expected behavior. |

### chromium 151.0.7922.34 — CreepJS

| Check | Result | Expected | Actual | Detail |
| --- | --- | --- | --- | --- |
| creepjs:worker-vs-main | fail | worker userAgent, platform and cores match the main thread | 3 of 3 fields differ | userAgent: worker "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.7922.34 Safari/537.36" vs main "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36" \| platform: worker "MacIntel" vs main "Linux x86_64" \| cores: worker "32" vs main "16" |
| creepjs:headless-score | pass | 0% | 0% |  |

### chromium 151.0.7922.34 — browserscan.net/bot-detection

| Check | Result | Expected | Actual | Detail |
| --- | --- | --- | --- | --- |
| browserscan:verdict | pass | no abnormal check | 18 "Normal" markers, none abnormal |  |
| browserscan:headless-brand | fail | no HeadlessChrome brand | HeadlessChrome shown on the page |  |

### chromium 151.0.7922.34 — bot.incolumitas.com

| Check | Result | Expected | Actual | Detail |
| --- | --- | --- | --- | --- |
| incolumitas:failed-tests | fail | no FAILed test | 3 of 34 tests FAILed | overrideTest, overflowTest, inconsistentWebWorkerNavigatorPropery |

### camoufox 135.0.1-beta.24 — bot.sannysoft.com

| Check | Result | Expected | Actual | Detail |
| --- | --- | --- | --- | --- |
| sannysoft:red-rows | fail | no failed rows | 2 of 34 classified rows failed | failed: Chrome (New), navigator.javaEnabled |

### camoufox 135.0.1-beta.24 — bot-detector.rebrowser.net

| Check | Result | Expected | Actual | Detail |
| --- | --- | --- | --- | --- |
| rebrowser:dummyFn | skip | row reports no detection | not triggered | this probe only fires when the client calls into it, and the harness does not |
| rebrowser:sourceUrlLeak | skip | row reports no detection | not triggered | this probe only fires when the client calls into it, and the harness does not |
| rebrowser:mainWorldExecution | skip | row reports no detection | not triggered | this probe only fires when the client calls into it, and the harness does not |
| rebrowser:runtimeEnableLeak | pass | row reports no detection | green | No leak detected. |
| rebrowser:exposeFunctionLeak | skip | row reports no detection | not triggered | this probe only fires when the client calls into it, and the harness does not |
| rebrowser:navigatorWebdriver | pass | row reports no detection | green | No webdriver presented. |
| rebrowser:viewport | pass | row reports no detection | green | Viewport is different from default values used in automation libraries. { "width": 2190, "height": 1129 } |
| rebrowser:pwInitScripts | pass | row reports no detection | green | No window.__pwInitScripts detected. |
| rebrowser:bypassCsp | pass | row reports no detection | green | Content Security Policy (CSP) is enabled, it's expected behavior. |
| rebrowser:useragent | skip | row reports no detection | not read | row not found on the page — parser needs updating |

### camoufox 135.0.1-beta.24 — CreepJS

| Check | Result | Expected | Actual | Detail |
| --- | --- | --- | --- | --- |
| creepjs:worker-vs-main | pass | worker userAgent, platform and cores match the main thread | all compared fields match | no differences |
| creepjs:headless-score | pass | 0% | 0% |  |

### camoufox 135.0.1-beta.24 — browserscan.net/bot-detection

| Check | Result | Expected | Actual | Detail |
| --- | --- | --- | --- | --- |
| browserscan:verdict | pass | no abnormal check | 19 "Normal" markers, none abnormal |  |
| browserscan:headless-brand | skip | no HeadlessChrome brand | not applicable | Firefox exposes no navigator.userAgentData |

### camoufox 135.0.1-beta.24 — bot.incolumitas.com

| Check | Result | Expected | Actual | Detail |
| --- | --- | --- | --- | --- |
| incolumitas:failed-tests | fail | no FAILed test | 3 of 32 tests FAILed | inconsistentWebWorkerNavigatorPropery, inconsistentServiceWorkerNavigatorPropery, webDriverAdvanced |

## Summary

- Walls: 17 Blocked, 8 Pass, 8 n/a, 3 skipped (robots)
- Detector checks: 24 pass, 17 fail, 11 skip

