# CrawlForge stealth benchmark — hosted, Camoufox pinned to 135

Second hosted run. Identical to `stealth-bench-baseline-2026-09-22-hosted.md`
except the Camoufox binary, which is pinned to 135.0.1-beta.24 instead of the
152.0.4-beta.30 that `camoufox fetch` had installed. The exit IP, host and
Chromium build are unchanged, so the two runs isolate the binary.

## Environment

- Run: 2026-09-22T19:09:08.851Z (UTC), CrawlForge 6.7.0, commit `unknown`
- Host: linux x64 7.0.0-1009-aws, 8 cores, 31 GB (the EC2 host, not the 2 GB container)
- Network: unclassified (free tier) — AS14618 Amazon.com, Inc., Ashburn, Virginia, United States (74.220.49.x)
- Browsers: chromium 153.0.8010.52, camoufox **135.0.1-beta.24**
- Playwright 1.62.1, camoufox npm 0.1.19

## Bot walls

| Target | Vendor | Plain fetch | Chromium stealth | Camoufox |
| --- | --- | --- | --- | --- |
| nowsecure.nl | Cloudflare, interactive challenge | Blocked | Blocked | Blocked |
| indeed.com/cmp/Burger-King/reviews | Cloudflare Turnstile | Blocked | **Pass** | Blocked |
| quora.com | Cloudflare (login wall embeds Turnstile) | Blocked | **Pass** | Blocked |
| harrods.com | Akamai | Blocked | Pass | Pass |
| g2.com | DataDome | Blocked | Blocked | Blocked |
| stackoverflow.com/questions | Cloudflare | Blocked | Pass | Pass |
| leboncoin.fr | DataDome | Blocked | Blocked | Blocked |
| producthunt.com | Cloudflare | Blocked | Blocked | Blocked |
| lesswrong.com | Vercel checkpoint | Pass | n/a | n/a |
| zalando.co.uk | Akamai | Pass | n/a | n/a |
| carvana.com | client-rendered shell | Blocked | Blocked | Blocked |
| trustpilot.com | DataDome | skipped (robots) | skipped (robots) | skipped (robots) |

### What changed against the unpinned hosted run

**Nothing, on the walls.** Every cell is identical. The only wall difference in
the whole file is leboncoin's Chromium row, which errored on a 66 s timeout last
time and is a clean Blocked now — a timeout becoming a verdict, not a change in
behaviour.

## Detectors

### camoufox 135.0.1-beta.24 — self-probes

| Check | Result | Detail |
| --- | --- | --- |
| navigator-webdriver | pass | false |
| useragentdata-brands | skip | Firefox exposes no navigator.userAgentData |
| worker-useragent | pass | matches main thread |
| worker-platform | pass | MacIntel |
| worker-hardware-concurrency | pass | 8 |
| worker-languages | pass | en-US, en |
| webrtc-host-candidates | pass | RTCPeerConnection is not defined |
| ua-version-vs-binary | pass | UA Firefox 135, binary 135.0.1-beta.24 |
| persona-os-vs-host | **fail** | UA claims macos, host is linux |
| headless-markers | pass | none |

Full UA: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:135.0) Gecko/20100101 Firefox/135.0`

`rv:135.0` and `Firefox/135.0` now **agree** — the pin worked and
`_pinnedFingerprint()` engaged rather than standing down.

### chromium 153.0.8010.52 — self-probes

Unchanged from the previous run: `worker-languages` still fails (worker
`en-US, en` vs main `en-US`); everything else passes.

### Third-party detector pages

| Page | Engine | Result | vs unpinned run |
| --- | --- | --- | --- |
| bot.sannysoft.com | chromium | fail — Permissions (New), navigator.javaEnabled | same |
| bot-detector.rebrowser.net | chromium | pass — 0 failing | same |
| CreepJS | chromium | fail — worker UA `HeadlessChrome/153`; headless-score 0% | same |
| browserscan.net | chromium | pass — 18 Normal | same |
| bot.incolumitas.com | chromium | fail — inconsistentWebWorkerNavigatorPropery, WEBDRIVER | same |
| bot.sannysoft.com | camoufox | fail — Chrome (New), navigator.javaEnabled | same |
| bot-detector.rebrowser.net | camoufox | pass — 0 failing | same |
| CreepJS | camoufox | **pass** — worker-vs-main all match, headless-score **0%** | **improved from 6%** |
| browserscan.net | camoufox | pass — 19 Normal | same |
| bot.incolumitas.com | camoufox | fail — webDriverAdvanced | same |

## Summary

- Walls: 21 Blocked, 8 Pass, 4 n/a, 3 skipped (robots)
- Detector checks: 33 pass, 7 fail, 12 skip (was 32/8/12)

## Conclusion

The pin did what it was supposed to do at the fingerprint layer — coherent UA,
CreepJS headless-score 6% → 0% — and **changed no wall outcome at all**. The
152 binary was therefore not what was costing Camoufox indeed.com and
quora.com.

Caveat, and it is a real one: the persona is still not fully coherent.
`persona-os-vs-host` fails — the UA claims macOS on a Linux host — which is
Phase 1's documented finding that `camoufox@0.1.19` drops its own `os` option.
So this run narrows the cause without closing it: the version incoherence is
gone, the OS incoherence is not.
