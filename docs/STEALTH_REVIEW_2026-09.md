# CrawlForge stealth, agent browsing and blocked-site extraction: review and plan

Date: 2026-09-21. Reviewed at v6.7.0 (commit `4f8b3ea`). Findings and a phased plan.

**Status:** Phase 0 (benchmark harness) and Phase 1 (contained correctness fixes) shipped on 2026-09-21; each phase records its own completion and measurements in section 6. Everything from Phase 2 on is unimplemented, and Phases 2, 3, 6 and 7 still need the decisions in section 7. The findings in section 3 describe v6.7.0 as reviewed — where Phase 1 changed one, its checklist says so.

## 1. Summary

Every current source agrees that Cloudflare is passed by a stack, not a trick: a residential exit IP first, an engine-level fingerprint second, human-paced input third. Cloudflare scores the IP and the TLS/HTTP2 handshake before any JavaScript runs, so no browser-side patch helps from a datacenter address.

The live benchmark below confirms the shape of that consensus for CrawlForge specifically:

- Camoufox is the only engine CrawlForge ships that clears Cloudflare managed challenges and Akamai on real sites (Indeed, Harrods). Chromium stealth failed both.
- Neither engine clears DataDome (g2.com, leboncoin ad pages) or an interactive Turnstile that never self-resolves (nowsecure.nl).
- Both engines leak the real host machine to fingerprint scanners. Chromium leaks `HeadlessChrome`, macOS, SwiftShader and 32 cores through Web Workers, plus the real IPv6 address through WebRTC. Camoufox leaks an Apple M1 GPU and a Mac CSS platform hint while claiming Windows.
- The `agent` tool never uses a browser. On the Indeed test it dropped the challenged seed page, answered from search snippets, and got the answer wrong.
- The verdict layer reports a false block on pages that legitimately embed a Turnstile widget (Quora rendered fine and was reported as blocked).

The gaps are structural (routing, persistence, proxies, agent escalation) rather than flag-level. The plan in section 6 is ordered so that each phase is measurable with the harness from Phase 0.

## 2. Benchmark

### 2.1 Method

- Server: local `server.js` at v6.7.0 in creator mode, called through the MCP tools `scrape`, `stealth_mode` and `agent` exactly as a client would.
- Host: macOS (Apple Silicon), Playwright 1.62.1, Chromium 151.0.7922.34, npm `camoufox` 0.1.19 driving Firefox 135.0.1 beta.24.
- Network: Comcast residential IP in Miami (AS7922), no proxy. This is the best case. The hosted instance runs from a datacenter and will score worse on every Cloudflare, DataDome and Akamai target.
- One run per cell. `wait_for` was 6 s on bot walls (15 s on the nowsecure retry) and 6 to 10 s on detector pages. No behavioural interaction was performed, so behavioural scores were not measured.
- "Pass" means the tool returned `success:true` with the real page title and body. "Blocked" is the tool's own verdict.

### 2.2 Bot walls

| Target | Vendor | Plain fetch | Chromium stealth | Camoufox |
| --- | --- | --- | --- | --- |
| nowsecure.nl | Cloudflare, interactive challenge | Blocked | Blocked | Blocked (also at 15 s) |
| indeed.com/cmp/Burger-King/reviews | Cloudflare Turnstile | Blocked (403) | Blocked ("Additional Verification Required") | **Pass** (full reviews page) |
| quora.com | Cloudflare (login wall embeds Turnstile) | Blocked (403) | Rendered, reported blocked (false positive) | Rendered, reported blocked (false positive) |
| harrods.com | Akamai | Blocked (403 Access Denied) | Blocked (403) | **Pass** |
| g2.com | DataDome | Blocked (403) | Blocked | Blocked |
| stackoverflow.com/questions | Cloudflare | Blocked ("Just a moment") | **Pass** | **Pass** |
| leboncoin.fr | DataDome | Blocked (403) | **Pass** | Blocked (403) |
| producthunt.com | Cloudflare | Pass | not run | not run |
| lesswrong.com | Vercel checkpoint | Pass | not run | not run |
| zalando.co.uk | Akamai | Pass | not run | not run |
| carvana.com | client-rendered shell | Pass (metadata only) | not run | not run |
| trustpilot.com | DataDome | Skipped: robots.txt disallows CrawlForge | skipped | skipped |

Notes:

- The plain fetch identifies itself honestly as `CrawlForge/<version>` over Node's TLS stack, by design. Every wall treats it as a bot, so the escalation stage does all the work on protected sites.
- Quora: both engines rendered the real login page. The verdict layer flagged it because a Cloudflare challenge script marker appeared on a short page. That is a real page that embeds Turnstile, not an interstitial.
- nowsecure.nl: the interstitial's title is `nowsecure.nl`, which is not a known challenge title, so the challenge wait-out is skipped and the block verdict fires on the script marker. Even with a 15 s wait Camoufox did not pass it, so it is most likely an interactive Turnstile that needs a click.
- leboncoin: Chromium passed the homepage and Camoufox did not, the reverse of Indeed and Harrods. One run each, so treat this as "vendor-dependent", not as a ranking.

### 2.3 Detector pages

| Detector | Chromium stealth | Camoufox |
| --- | --- | --- |
| bot.sannysoft.com | All rows pass. UA claims Chrome 150 on a Chromium 151 binary. | All Firefox-appropriate rows pass. WebGL reports "Apple M1, or similar" under a Windows UA. |
| bot-detector.rebrowser.net | `runtimeEnableLeak` green. `navigatorWebdriver` **red** (property deleted, should be `false`). `useragent` **red** (brand is "Chromium 151", no "Google Chrome" brand, flagged as Chrome for Testing). | All green. |
| CreepJS | Worker scope reports `HeadlessChrome/151`, Macintosh, macOS 26.6.2 arm64, SwiftShader GPU, 32 cores and 32 GB, while the main thread claims Windows 10, NVIDIA RTX 3070, 8 cores, 4 GB. `userAgentData` exposes `HeadlessChrome 151`. WebRTC exposes the real IPv6 address in host and STUN candidates despite `blockWebRTC` defaulting to true. Fonts "Like undefined". | WebRTC blocked. Headless checks 0%. Worker consistent with main thread. Fonts "Like Windows 11". GPU "Apple M1" and CSS platform hint `-apple-system: Mac` under a Windows persona. Firefox 135 is 18 months old. |
| browserscan.net/bot-detection | All checks "Normal", but `userAgentData.brands` contains `HeadlessChrome 151`. | All "Normal". `hardwareConcurrency` 32. |
| bot.incolumitas.com | `overrideTest` FAIL, `overflowTest` FAIL, `inconsistentWebWorkerNavigatorPropery` FAIL. Worker says MacIntel with 32 cores. TCP/IP fingerprint says macOS under a Windows UA. | `inconsistentWebWorkerNavigatorPropery` FAIL and `inconsistentServiceWorkerNavigatorPropery` FAIL (worker languages `en-US, en` vs main `en-US`), `webDriverAdvanced` FAIL. TCP/IP fingerprint says macOS under a Windows UA. |

Notes:

- Playwright 1.62.1 launched by CrawlForge does not trip the `Runtime.enable` leak on rebrowser. That is version-coupled and must be re-checked on every Playwright bump.
- The TCP/IP fingerprint is set by the host kernel, not the browser. Only a proxy hides it. On the hosted Linux instance, both engines will additionally show a Linux TCP fingerprint and the Chromium worker will say `X11; Linux`.
- The Chromium user-agent pool contains four Chrome versions on one binary, so three of four personas mis-state the version that `userAgentData` reports.
- Neither engine passes its persona OS from the host: the Chromium pool is Windows-only, and the Camoufox adapter does not pass an `os` option, so both claimed Windows on a Mac.

### 2.4 Agent run

Prompt: the overall Indeed star rating for Burger King and the number of reviews it is based on. Seed URL: the Indeed reviews page that Camoufox can fetch.

Result: `urls_fetched: 3`, `steps: 0`, every evidence item `snippet: true`. Answer: "3.3 out of 5 stars, based on 3.3 reviews." The correct figure on the page Camoufox rendered was 58,941 reviews. The agent's ACT stage runs only the plain fetch, the challenged seed was dropped, and the answer was synthesised from search snippets.

## 3. Findings in the code

All verified against v6.7.0 during this review.

1. **The agent never browses.** `src/core/AgentOrchestrator.js` ACT uses `fetchAndParse` only. A challenge, 403 or timeout substitutes a search snippet. It never calls the stealth escalation stage that `scrape` already has, and never uses `browser_session`.
2. **Camoufox is default nowhere.** `scrape.escalate_engine` and `stealth_mode.engine` default to `playwright`. `browser_session` and `scrape_with_actions` have no engine parameter; `stealth: true` always goes through the Chromium manager via `BrowserProcessor`. Only the `deep_research` fallback prefers Camoufox.
3. **Camoufox binary is stale and runs true headless.** Firefox 135.0.1 beta.24 is installed; upstream is on 146 prereleases. The npm client supports `headless: 'virtual'` (Xvfb) which the adapter does not use; Camoufox in Docker is reported to fail Turnstile consistently (daijro/camoufox issue #574).
4. **No session persistence.** No `launchPersistentContext`, no `storageState`, no reuse of a solved `cf_clearance`. Every stealth context starts cold.
5. **Turnstile is only waited on.** `bypassCloudflareChallenge` waits up to 30 s for interstitial text to disappear and moves the mouse. `_waitOutChallenge` only triggers on a known challenge title, then waits 8 s for the title to change. Nothing clicks the managed-challenge checkbox, which sits in a closed shadow root that vanilla Playwright cannot reach.
6. **Verdict false positive.** `detectChallengePage` treats a challenge script marker on a short page as a block. A short real page that embeds a Turnstile widget (Quora's login wall) is reported as blocked even though the browser rendered it.
7. **Proxies are per call only.** `stealthConfig.proxyRotation` works since 6.7.0, but there is no server-level proxy setting. The escalation stage, the `deep_research` fallback and the agent run proxyless unless a caller passes one.
8. **Persona is not tied to the host or the binary.** Chromium UA pool is Windows-only with four Chrome versions on one binary. The Camoufox adapter passes no `os`. Both engines therefore contradict the real GPU, CSS platform hints and TCP/IP fingerprint.
9. **Chromium spoofing stops at the main thread.** Workers report the real `HeadlessChrome` UA, platform, GPU and core count. `blockWebRTC` does not stop the real IPv6 from appearing in ICE candidates. `navigator.webdriver` is deleted rather than set to `false`. `userAgentData` still carries the `HeadlessChrome` brand.
10. **Every stealth page intercepts every request** through `page.route('**/*')` and, at some levels, aborts about a third of images and fonts at random. Interception and missing resources are both timeable anomalies.
11. **Web Bot Auth signs HTTP fetches only.** `src/utils/webBotAuth.js` deliberately does not sign browser navigations, and CrawlForge is not in Cloudflare's signed-agents or verified-bots directory.

## 4. What the web says works in 2026

- **IP first.** Cloudflare ML model v9 weights JA4, HTTP/2 frame order and behaviour more heavily, and anomaly detection pins flagged sessions to a bot score of 2. Datacenter ASNs are scored before the challenge is served. (humanbrowser, May 2026; Cloudflare changelog)
- **Indicative pass rates** from humanbrowser's 12-method test (May 2026, vendor-run): VPS plus any stealth plugin 0 to 10%; residential IP alone about 35%; residential plus patched fingerprint about 70% on Pro and 25% on Enterprise; residential plus mobile fingerprint plus humanised input about 95% and 75%.
- **Camoufox** is the consistent best open-source performer against Cloudflare in the Web Scraping Club's 2026 benchmark (99% on Harrods managed challenge). More-patched forks were not better: one stealth fork was blocked 100% on DataDome where stock Camoufox passed. Hybrid pattern: browser acquires cookies, then an impersonating HTTP client does bulk requests.
- **Patchright** closes Playwright's `Runtime.enable` leak with isolated contexts, disables the Console API, fixes default-argument leaks and can reach closed shadow roots. Chromium only. Init scripts are injected through routes and are timing-detectable.
- **Turnstile mechanics.** The token is bound to the environment and IP that generated it, so tokens bought from 2captcha or CapSolver are rejected on strict sites. The checkbox lives in a closed shadow DOM. The EzSolver trick (inject a second widget with the same sitekey into the open DOM and read the callback) only extracts a token from an environment that already passes. The Camoufox maintainer closed "Turnstile solver" as not planned (issue #584).
- **Automation is a separate axis from fingerprint** (liarjs, July and August 2026). Three-quarters of headless blocks in the Bamberg crawl fire on HTTP headers alone. Results against rebrowser and sannysoft are version-coupled; keep them in a CI matrix.
- **Cloud browsers** (browser-use benchmark, March 2026, 71 sites): headless Chromium on a datacenter IP 2%, headful 50%; Browser Use 81%, Anchor 77%, Kernel 67%, Steel 47%, Browserbase 42%. Most providers are stock Chromium plus a residential proxy plus a captcha extension.
- **Legitimacy lane.** Cloudflare's Web Bot Auth and signed-agents programme accept applications through the dashboard Bot Submission Form. Cloudflare's own Browser Rendering and the new Kitesurf browser send signed requests and receive a bot score of 1. Sites must opt in, so coverage is small but growing.
- **Node TLS impersonation.** Apify's `impit` is a fetch-compatible npm client with Chrome and Firefox TLS profiles, HTTP/3 and proxy support; Crawlee uses it as its HTTP client. `got-scraping` is the older alternative with three profiles.

## 5. What not to do

- FlareSolverr or Byparr sidecars: stock Chromium on the same IP problem.
- Paid Turnstile token solvers: tokens are environment-bound and rejected on strict sites.
- More-patched Camoufox forks: measured worse than stock.
- Copying launch flags from other projects without checking the binary with `strings`: three of Scrapling's flags are silent no-ops on Chromium 151.
- Deleting the JS spoofing layer wholesale before the harness exists: it was tuned against real detectors and needs a measurement first.

## 6. Phased plan

Each phase has a checklist and a verification gate. Phases 1 to 3 can run in parallel after Phase 0. Phase 4 onward should wait for Phase 2, because the click and the persistence only help when the environment already scores as human.

### Phase 0: Repeatable benchmark harness

**Completed:** 2026-09-21 — except the hosted-instance run, which cannot be made from a developer machine and stays open below.

Goal: turn section 2 into a script that runs in minutes, so every later phase is measured instead of assumed.

- [x] Add a benchmark script (for example `scripts/stealth-bench.mjs`) that drives `StealthBrowserManager` and the plain fetch against a fixed target list and prints the pass/blocked matrix from section 2.2.
- [x] Encode the detector assertions from section 2.3 as pass/fail checks: rebrowser rows, CreepJS worker vs main-thread consistency, WebRTC candidate leak, `userAgentData` brands, sannysoft red rows.
  - Ten self-probes (`scripts/lib/stealth-bench/detectors.js`) run our own in-page checks on a neutral origin and are what CI gates on; five third-party page parsers (`detector-pages.js`) read the detector sites themselves. All five read. The rebrowser and CreepJS parsers both skipped on the first run and were fixed against the live pages: rebrowser states each verdict as an emoji at the head of the row's *name* cell rather than as a class or a background colour, and CreepJS puts every value on the line *after* its label, so a same-line `label: value` regex read nothing from it. rebrowser's four call-me probes (`dummyFn`, `sourceUrlLeak`, `mainWorldExecution`, `exposeFunctionLeak`) only fire when the client calls into them, so they are reported as `skip — not triggered` rather than counted as passes.
- [x] Record host OS, IP type (via bot.incolumitas.com's IP API), engine, browser version and Playwright version in the output header.
- [x] Run it on a residential connection and keep the output in `docs/` as the baseline. → [`stealth-bench-baseline-2026-09-21-residential.md`](./stealth-bench-baseline-2026-09-21-residential.md) (Comcast AS7922, Miami).
- [ ] Run it on the hosted instance and keep that output in `docs/` as the second baseline. **Unmeasured, and deliberately not inferred.** The whole point of the second run is the exit IP, so it has to be produced on the hosted instance itself: `npm run bench:stealth -- --out docs/stealth-bench-baseline-<date>-hosted.md`. Until it exists, every datacenter claim in this document is prediction, not measurement — and Phase 2's verification gate depends on it.
- [x] Wire a reduced version (detector pages only, no third-party bot walls) into CI so a Playwright or Camoufox bump that reopens `Runtime.enable` or a worker leak fails the build.

Verify: the script reproduces the section 2 matrix within one run's noise, and CI fails when `navigator.webdriver` is forced to `true`.

- [x] **Matrix reproduced, within one run's noise — and the noise is real.** Eleven of the twelve rows of 2.2 came back as the hand run recorded them, including the ones that carry the argument: Harrods passes on Camoufox and nowhere else, stackoverflow passes on both engines, trustpilot is skipped by robots.txt, and Quora is still the finding-6 false positive (both engines rendered the real 397-character login page and the verdict layer called it blocked). **leboncoin/Chromium is the exception**: it passed on the first run of the day, exactly as 2.2 records, and was Blocked on a second run an hour later from the same IP. Two runs, two answers, no code change between them — which is the clearest possible argument for having built the harness, and a standing warning against reading any single DataDome cell as a result. The committed baseline is the second run.
- [x] **Negative control passes.** `--self-check` forces `navigator.webdriver` to `true` and exits 0 only because the harness reported it as a failure, on both engines. It runs as its own CI step.

The detector assertions reproduce 2.3 closely. rebrowser on Chromium is `runtimeEnableLeak` green, `navigatorWebdriver` red, `useragent` red — the three rows the review named, in the states it named. rebrowser on Camoufox is green throughout. CreepJS worker-vs-main fails on Chromium across all three compared fields (worker `HeadlessChrome/151`, `MacIntel`, 32 cores against a main thread claiming Linux, Chrome 150, 16 cores) and passes on Camoufox. incolumitas returns the same three FAILs per engine that 2.3 lists.

Three of this document's own claims did not survive contact with the harness, and are corrected here rather than left to mislead Phase 1:

1. **The Chromium UA pool is not Windows-only** (finding 8). Four consecutive runs drew both Windows and Linux personas, and claimed Chrome 149 on one run and Chrome 150 on the next, on the same 151 binary. The pool is randomised per run, which also makes `persona-os-vs-host` intermittent rather than constant — and means a single observation of the persona proves nothing.
2. **The spoofed user agent does reach Web Workers** (finding 9). The `worker-useragent` self-probe passes on both engines. What leaks is everything else about the worker — `platform` reports the real `MacIntel`, `hardwareConcurrency` the real core count — and CreepJS still shows the worker's *own* UA as `HeadlessChrome/151`. So the conclusion stands and the mechanism is narrower than "workers report the real UA": Playwright's `userAgent` option reaches the worker, and nothing else about the identity does.
3. **WebRTC host candidates are clean.** Chromium returns mDNS `.local` candidates only, no raw address. The real-IP leak CreepJS showed came through a STUN server; the harness check deliberately uses none, so it stays deterministic in CI. **A STUN-backed check is still missing, and the IPv6 leak in finding 9 is therefore neither confirmed nor refuted by this run.**

Also new, and not in section 2.3: Camoufox's user agent contradicts itself, advertising `rv:135.0` and `Firefox/151.0` in the same string. Worth folding into the Phase 1 persona work.

### Phase 1: Contained correctness fixes surfaced by the benchmark

**Completed:** 2026-09-21 — every checklist item shipped; three of the four verification clauses met, the fourth measured and reduced rather than closed (below).

Goal: close the leaks and false verdicts that need no architectural change.

- [x] Verdict: do not report a block when the document has a real title, real body text and only a widget marker. Distinguish "page embeds Turnstile" from "page is an interstitial". Re-test on quora.com.
- [x] Challenge wait-out: trigger `_waitOutChallenge` on the script marker as well as the known titles, so custom-titled interstitials (nowsecure.nl) get their wait before the verdict.
- [x] Chromium UA pool: derive the Chrome version from the installed binary (Scrapling reads Playwright's `browsers.json`) so the UA never mis-states the version that `userAgentData` reports.
- [x] Persona OS: pick the persona from the host OS for both engines (pass `os` to Camoufox; add macOS and Linux personas to the Chromium pool), so GPU strings, CSS platform hints and the TCP/IP fingerprint stop contradicting the UA.
- [x] `navigator.webdriver`: report `false`, do not delete the property.
- [x] `userAgentData`: remove the `HeadlessChrome` brand and add the "Google Chrome" brand, or pin `executablePath` to a stable Chrome channel and re-measure on rebrowser.
- [x] WebRTC: replace the five `--disable-webrtc-*` flags with `--webrtc-ip-handling-policy=disable_non_proxied_udp` (verified present in Chromium 151) and re-check CreepJS for the real IPv6.
- [x] Apply the four agreed Tier 1 flag changes from the earlier Scrapling review (drop the stealth-driver flags from args and `ignoreDefaultArgs`, remove `--disable-web-security`, add hover and pointer blink settings).
- [x] Workers: move UA, platform and hardware identity from init scripts to context-level options (Playwright applies `userAgent` and locale through CDP emulation to workers) and re-check CreepJS and incolumitas worker consistency. If that is not enough, this becomes the Tier 2 `--lang` and `--user-agent` launch-flag work.
- [x] Reconsider `page.route('**/*')`: limit interception to levels that need it and stop the random image and font aborts.

Verify: Phase 0 harness shows rebrowser all green on Chromium, CreepJS worker identity matching the main thread, no WebRTC candidate with a real address, and quora.com reported as a pass.

- [x] **rebrowser all green on Chromium.** Every row it reports now passes — `navigatorWebdriver` green ("No webdriver presented"), `useragent` no longer reports a detection, plus `runtimeEnableLeak`, `viewport`, `pwInitScripts` and `bypassCsp`. Five rows read `skip`: they are the probes that only fire when a client calls into them, which the harness does not. Before the phase, measured on a clean HEAD worktree the same afternoon, `navigatorWebdriver` was red ("This property shouldn't be undefined. You might have it deleted manually") and `useragent` was red ("Google Chrome is not presented in navigator.userAgentData … Chrome for Testing"). The last red needed one fix the review had not predicted: `Object.getOwnPropertyNames(navigator)` returned `["connection","plugins","mimeTypes","getBattery"]`, because the spoofs were defined on the navigator instance rather than on `Navigator.prototype` where a real Chrome has them. It now returns `[]`.
- [x] **No WebRTC candidate with a real address.** Chromium gathers mDNS `.local` host candidates only; Camoufox has no `RTCPeerConnection` at all. The five `--disable-webrtc-*` flags that never governed IP exposure are gone. The finding-9 IPv6 leak was seen through a STUN server, which the harness deliberately does not use, so it remains neither confirmed nor refuted — unchanged from Phase 0 and still worth a STUN-backed check.
- [x] **quora.com is a pass**, on both engines, with the real title and its 397 characters of body text. The cause was not what the plan assumed: the page carries exactly one `cf-chl-` token and it is `cf-chl-widget-gaztz_response`, the hidden input **Turnstile names itself**, so a bare `cf-chl-` test — ours and upstream's — matches every widget embed there is. The refinement now clears the widget's own markers and keeps the bootstrap (`_cf_chl_opt`, `window._cf_chl`, `cf_chl_rc_`), and `looksLikeInterstitial` gives a custom-titled wall its wait before any verdict. nowsecure.nl is still Blocked on both engines, which is the honest answer for an interactive Turnstile: Phase 5's work, not this one's.
- [ ] **CreepJS worker identity: reduced from three mismatched fields to one, not closed.** Platform and core count now match the main thread (they were `MacIntel`/32 against `Win32`/4 before). The worker's own `userAgent` still reads `HeadlessChrome/151.0.7922.34`. The identity is applied with `Emulation.setUserAgentOverride` + `setHardwareConcurrencyOverride`, which the renderer passes to the dedicated workers a frame starts — the harness's own worker probes all pass — but CreepJS reads a scope nothing applies an override to: playwright-core attaches only `Runtime.*`/`Inspector.*` to `worker` targets and detaches from every other target type, which includes `shared_worker`, and `Emulation` is not available on a worker session. Closing it means blocking SharedWorker (a tell of its own) or attaching to those targets ourselves; neither is a contained fix, so it is named here and left for a later phase.

Also measured, and worth carrying forward rather than rediscovering:

- **`hardwareConcurrency` and `deviceMemory` are now observed, not drawn.** There is no CDP override that reaches a worker, so a spoofed document beside a truthful worker was the contradiction being scored. The host's real values are reported in both, and the processor persona is chosen to match. On a machine with an unusual core count that is itself a signal — but a consistent one, which is the trade this review argues for throughout.
- **incolumitas swapped one FAIL for another, deliberately.** `inconsistentWebWorkerNavigatorPropery` is now OK. `WEBDRIVER` now FAILs — it is an fpscanner-era test that flags any browser where `navigator.webdriver` is not `undefined`, which is every real Chrome since 89; intoli's own `webDriver` and `webDriverAdvanced` rows both read OK. Satisfying it again would mean deleting the property, which is exactly what rebrowser marks red. `overrideTest` and `overflowTest` still FAIL and predate this phase.
- **sannysoft's two red rows (`Permissions (New)`, `navigator.javaEnabled`) predate this phase** — identical on the clean HEAD worktree. The likely cause of the first is that `navigator.permissions.query` is replaced with a plain function on the `Permissions` instance and resolves a `{ state }` object rather than a `PermissionStatus`; `navigator.mediaDevices.enumerateDevices` has the same shape. Neither is on the Phase 1 checklist; both are one level below the navigator fix that closed rebrowser.
- **Camoufox does not honour its own `os` option** (npm 0.1.19). Ten launches asking for `macos` on a Mac gave a Mac persona about one time in three — the market-share draw. The client forwards `{ screen, os }` to `fingerprint-generator`, whose key is `operatingSystems`, so it is dropped. We pass it anyway (documented API, inert, correct the moment upstream fixes it) and `persona-os-vs-host` stays in `ci-baseline.json` for Camoufox alone; on Chromium it is deterministic. Phase 2 owns the Camoufox client and should carry this.

### Phase 2: Engine routing and proxy plumbing

Goal: make the engine that actually passes Cloudflare the one that runs, and give every stealth path an exit IP that can pass.

- [x] Default `scrape.escalate_engine` and `stealth_mode.engine` to Camoufox when the binary is installed, falling back to Chromium with a warning when it is not. — shipped as the engine name `'auto'`, reusing the semantic `deep_research` already had (`RESEARCH_STEALTH_ENGINE`, `ResearchOrchestrator.js:144`) so one vocabulary covers every stealth entry point. `resolveStealthEngine(requested)` in `StealthBrowserManager.js` is the single resolver; it returns `{engine, fallbackWarning}` and every caller pushes that warning into its own result, so a Camoufox→Chromium downgrade is never silent. Naming an engine explicitly still pins it exactly; `'playwright'` remains the tool layer's public name for Chromium.
- [x] Add an `engine` parameter to `browser_session` and `scrape_with_actions`, routed through `BrowserProcessor` to the Camoufox adapter. — `BrowserProcessor` now carries the resolved engine to both `launchStealthBrowser` and `createStealthContext` (passing it to only one relaunches on the default underneath), and stamps `page.__crawlforgeEngine`. That stamp also gates the extra-stealth init script, which hands the page a `window.chrome` object and a Chrome-shaped navigator — a tell no real Firefox has, so it is now Chromium-only.
- [ ] Update the Camoufox binary to a current Firefox build; evaluate Apify's `camoufox-js` client as the maintained JS path if the current npm package lags. — **not deliverable as written; deliberately left unchecked.** Upgrading makes things worse, measured: `camoufox@0.1.19` rewrites persona version tokens with `data.replace(/(?<!\d)(1[0-9]{2})(\.0)(?!\d)/, ...)` — no `/g`, so the rewrite reaches `rv:` and stops, and `Firefox/` keeps whatever browserforge drew. Its bundled header-generator data knows Firefox {135, 136, 142, 146, 147, 149, 150, 151}; upstream Camoufox is on 152.0.4-beta.30, which is outside that set, so on a current binary *every* generated UA self-contradicts. The npm package lags exactly as this item anticipated, so the maintained-client evaluation is the live half — see Track: camoufox-js below. Mitigated meanwhile by the version pin (next item but one).
- [x] Use `headless: 'virtual'` on Linux hosts and document the Xvfb dependency in the Docker image (Ubuntu 22.04 base, per the Camoufox Docker notes). — `StealthBrowserManager.js:480`. This also required fixing the adapter's `config.headless !== false`, which silently collapsed the string `'virtual'` to `true` — plain headless, the one mode `'virtual'` exists to avoid. The image moved to `node:22-bookworm-slim`; see Docker findings below.
- [x] Add a server-level proxy setting (`CRAWLFORGE_STEALTH_PROXIES`, same URL format as `proxyRotation`) consumed by the escalation stage, the `deep_research` fallback, the agent, and `browser_session` when the caller passes none. — `serverStealthProxies()` in `constants/config.js`, consumed in `resolveProxy()` (the one choke point for every path through `StealthBrowserManager`) and wired separately into `ResearchOrchestrator`, which launches Camoufox directly and bypasses the manager. A proxy passed on the call always wins. Kept deliberately separate from the existing `PROXY_ROTATION_*` family, which belongs to localization. **Partial against the item as written:** the readers today are the escalation stage, `stealth_mode`, `browser_session`, `scrape_with_actions` and the `deep_research` fallback. The `agent` is listed above but has no browsing path of its own — `AgentOrchestrator.js` contains no stealth or browser call at all — so it cannot read a proxy yet. It becomes a reader in Phase 3, which is the phase that gives it an escalation path.
- [x] Enable Camoufox `geoip` whenever a proxy is present so timezone, locale and geolocation follow the exit IP. — **already shipped in Phase 1**, not rebuilt: `StealthBrowserManager.js:508` does `geoip: !!proxy` and the adapter forwards it. Verified still correct now that a server-level proxy can be the thing supplying that proxy.
- [x] Document that CrawlForge supplies no proxies and that a datacenter proxy does not help; link the humanbrowser and Cloudflare sources. — `README.md`, `docs/stealth-engines.md`, and both agent skills.
- [x] **Added in this phase:** pin the Camoufox persona to the installed binary's Firefox major, so the UA's `rv:` and `Firefox/` tokens agree. Not on the original list; it became load-bearing the moment `'auto'` made Camoufox the default, because the defect below was riding on the default path.

Verify: with a residential proxy configured, the Phase 0 harness on the hosted instance matches the residential baseline on Indeed and Harrods; without one it reports the datacenter result honestly.

- [ ] **Hosted verification outstanding.** Phase 2 is implemented and locally verified, *not* hosted-verified. The gate above needs the Phase 0 baseline from the hosted instance, which cannot be produced from a dev machine.

      **Blocked on a deploy, not on effort.** Attempted 2026-09-22 in the Render shell and it failed with `MODULE_NOT_FOUND`: the production image copies only `node_modules`, `package*.json`, `server.js` and `src/`, so `scripts/` — the harness itself — was never in it. Fixing it took two changes, not one: a `COPY` in the production stage, **and** a negation in `.dockerignore`, which excluded `scripts/` from the build context entirely — so the first attempt failed at build time with `"/app/scripts": not found`, because the file was missing from the builder stage too. Only `stealth-bench.mjs` and `lib/stealth-bench/` are un-excluded; the rest of `scripts/` stays out of the image. Verified by building the context and listing it, rather than by another deploy. The sequence is: merge to `main` → Render auto-deploys → *then* run, in the service shell:

      cd /app && node scripts/stealth-bench.mjs

      The report goes to stdout whether or not `--out` is passed. Note that this deploy also ships Phase 2's `'auto'` default to production, so it is a release decision, not a formality.

#### The UA mismatch, measured

`camoufox@0.1.19` pins `rv:` to the installed binary and lets browserforge pick `Firefox/` independently. They agree only by coincidence:

| Binary | Persona source | UA tokens agree |
|---|---|---|
| 135 (installed) | camoufox's own generation | **4 / 8** |
| 135 (installed) | pinned to the binary's major | **8 / 8** |
| 152 (current upstream) | camoufox's own generation | **0 / 8** — 152 is outside browserforge's data |

Method: `launchOptions({headless:true})` sampled repeatedly, reading the UA out of the returned config; the pinned rows generate the persona with `FingerprintGenerator({browsers:[{name:'firefox',minVersion:M,maxVersion:M}]})` and pass it in. Confirmed on a real launch through `StealthBrowserManager` → `createStealthContext` → `createStealthPage`: `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0`.

`rv:` disagreeing with `Firefox/` is a one-line detection, and it was live at HEAD before this phase — `'auto'` is what promoted it from an opt-in path to the default one. The pin is in `CamoufoxAdapter._pinnedFingerprint()`; it returns `null` and falls back to camoufox's own persona whenever it cannot produce a matching one, and it verifies the tokens rather than assuming them. Locked by `tests/unit/stealthCamoufoxIdentity.test.js`.

The pin fixes the symptom on the installed binary. It cannot fix 152, whose version has no browserforge data at all — that needs a current client, which is what the `camoufox-js` evaluation is for.

**Why Phase 0 did not catch this.** The harness already had the right probe — `ua-version-vs-binary` — but it samples a single launch, and the defect was a coin flip, so the probe passed roughly half the time and was green on the run that produced the baseline. A check that samples once cannot see a 50% fault; it can only be lucky. It is deterministic now that the persona is pinned, and the lesson generalises to the rest of the self-probes: any of them that draw from a randomised persona are one-sample checks on a distribution, and a single green row from one is weaker evidence than it looks.

#### Docker findings

The published image could never have run Camoufox, for two independent reasons, both measured 2026-09-21:

- **musl vs glibc.** `camoufox-bin` declares `PT_INTERP /lib/ld-linux-aarch64.so.1` (measured on arm64; `/lib64/ld-linux-x86-64.so.2` on x86_64) and needs versioned `GLIBC_2.17`…`GLIBC_2.28` symbols. The `node:20-alpine` base cannot load it at all. Base moved to `node:22-bookworm-slim` (glibc 2.36); upstream's own notes say Ubuntu 22.04 / glibc 2.35.
- **A silent optional-dependency drop.** `camoufox` is optional, and its transitive `language-tags@2.1.0` declares `engines.node >=22`. npm does not warn when an optional dependency's subtree fails an engine check — it drops the subtree. With this repo's own lockfile: `node:20-bookworm-slim` → 508 packages, **no `node_modules/camoufox`**; `node:22-bookworm-slim` → installed. The image built "successfully" with no Camoufox in it and nothing in the log.

`package.json` still declares `engines.node >=20.16.0` — a deliberate decision, not an oversight. Node 20 users get Chromium through `'auto'` and now see the fallback warning saying why, which is what makes the gap visible rather than silent. Bumping to `>=22` is breaking and belongs to a release decision, not this phase.

#### Track: camoufox-js

Item 184's escape hatch is now the live path. What a maintained client would have to fix, in priority order: the non-global version rewrite above; the dropped `os` option (Phase 1's `persona-os-vs-host`, still open — the client sends `os`, the generator's key is `operatingSystems`); and `CAMOUFOX_INSTALL_DIR`, which only `camoufox-js` supports and which the Dockerfile currently works around by pinning `HOME`. Not started; needs its own decision.

### Phase 3: Agent browsing

Goal: the `agent` tool reaches pages that block the plain fetch instead of substituting snippets.

- [ ] In ACT, on a challenge, 403 or empty-shell verdict, retry the URL through the same escalation stage `scrape` uses, capped by the existing step, URL and wall-clock limits.
- [ ] Prefer escalation for seed URLs the user named explicitly; keep snippet fallback only for discovered URLs.
- [ ] Charge the escalation surcharge only when it runs, mirroring `scrape`.
- [ ] Mark evidence with `via: "stealth"` so provenance shows which fetch path produced it.
- [ ] Later: let the agent drive `browser_session` for flows that need a click or a scroll, reusing the snapshot-and-act refs from 6.6.

Verify: the Indeed prompt from section 2.4 returns the review count from the rendered page, with `snippet: false` for the seed.

### Phase 4: Session persistence

Goal: a challenge solved once is not solved again for its lifetime.

- [ ] Per-host cookie jar keyed on host, proxy exit and user agent; store `cf_clearance`, `__cf_bm` and DataDome cookies with their expiry.
- [ ] Reuse the jar on the next stealth context for the same key; discard on a new block verdict.
- [ ] Persistent profile pool for Chromium (`launchPersistentContext` with a real `userDataDir`), matching Scrapling and the practitioner reports.
- [ ] Bound disk use and TTL; never persist across different proxy exits.

Verify: second stealth call to a Cloudflare site within the clearance TTL returns without the interstitial and with no challenge round-trip in the network log.

### Phase 5: Challenge interaction

Goal: pass managed and interactive Turnstile challenges that do not self-resolve.

- [ ] Detect the challenge type from the interstitial (`cType` non-interactive, managed, interactive), as Scrapling does.
- [ ] For managed and interactive: locate the `challenges.cloudflare.com` iframe, click a fixed offset inside its bounding box, then wait for the title change and `domcontentloaded`.
- [ ] For an embedded widget in the page body: needs closed-shadow-root access. Run the patchright spike (does `addInitScript` still land where the 13 init scripts expect it) and adopt patchright only if the spike passes and Phase 0 stays green.
- [ ] Keep the honest failure: if the challenge does not pass, the verdict still names the vendor and the next step.

Verify: nowsecure.nl passes from a residential IP; the harness reports no regression on the detector pages after the patchright change.

### Phase 6: Legitimacy lane

Goal: pass without a challenge on sites that accept verified agents, with zero detection risk.

- [ ] Apply for Cloudflare's signed-agents directory through the dashboard Bot Submission Form using the existing Web Bot Auth key and the published key directory on crawlforge.dev.
- [ ] Extend request signing to browser navigations via context-level extra headers, keeping the identity headers on both fetch paths.
- [ ] Track which target hosts accept signed agents and skip escalation on them.
- [ ] Review the verified-bots policy for the crawl side (`crawl_deep`, `map_site`) and apply if it fits.

Verify: a signed navigation to a Cloudflare zone that has opted in returns the page with no interstitial and a bot score visible as verified in Radar.

### Phase 7 (decision required): browser-impersonated HTTP rung

Goal: pass TLS-and-header-only walls without a browser, at roughly a hundredth of the cost.

- [ ] Evaluate `impit` as an optional client between the plain fetch and the browser.
- [ ] Resolve the policy conflict first: it only works by presenting a Chrome or Firefox TLS profile and UA, which contradicts the honest `CrawlForge/<version>` identity (ground rule G4). Options are: never, opt-in per call with the override recorded against the API key like `respect_robots: false`, or only behind a signed-agent header.
- [ ] If adopted, use it for the hybrid pattern: browser acquires cookies, `impit` does bulk requests with the jar from Phase 4.

Verify: a TLS-only wall (one that blocks the plain fetch but serves curl-impersonate) passes without launching a browser.

## 7. Decisions needed from the owner

1. ~~Greenlight Phase 0 and Phase 1 as a unit (contained, measurable, no product change).~~ **Done — both shipped 2026-09-21.** One product-visible change did come out of Phase 1, and it is not a no-op: on Camoufox the caller's `locale` is now applied at browser launch rather than per context, so it is fixed for that browser's lifetime (and a proxy's `geoip` overrides it).
2. Whether Camoufox becomes the default escalation engine (Phase 2), given its slower startup and larger memory footprint.
3. Whether to add a server-level proxy setting and document bring-your-own residential proxies (Phase 2).
4. Whether the agent may spend escalation credits automatically (Phase 3).
5. Whether to apply to Cloudflare's signed-agents directory (Phase 6). This publicly identifies CrawlForge traffic.
6. The `impit` policy question (Phase 7).

## 8. Sources

- humanbrowser.cloud: Playwright Cloudflare bypass 2026 (12-method test) and Cloudflare Turnstile bypass 2026
- scrapewise.ai: Playwright stealth 2026, Patchright vs Camoufox vs noDriver
- The Web Scraping Club wiki: Camoufox entry (2026 benchmark, forks, Docker)
- liarjs.dev: Automation tells are orthogonal (Runtime.enable, isolated worlds, 2026-08 update)
- npmjs.com/package/patchright (README: patches, closed shadow roots, routes)
- github.com/apify/impit (Node and Python benchmarks, September 2026)
- browser-use.com/posts/stealth-benchmark (cloud browser stealth benchmark, March 2026)
- blog.cloudflare.com/signed-agents and blog.cloudflare.com/kitesurf
- github.com/daijro/camoufox issues #574 (Docker Turnstile) and #584 (solver not planned)
- Reddit r/Playwright thread 1r4p8ga and r/webscraping thread 1s81ob1 (via the Arctic Shift archive)
- Detector pages used: bot.sannysoft.com, bot-detector.rebrowser.net, abrahamjuliot.github.io/creepjs, browserscan.net/bot-detection, bot.incolumitas.com
