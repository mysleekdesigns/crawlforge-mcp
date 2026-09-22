# Stealth Engine Selection

`stealth_mode` picks a browser engine with an `engine` parameter;
`browser_session` takes the same `engine` on `operation:"open"`,
`scrape_with_actions` takes it as `browserOptions.engine` (both only with
`stealth: true`), and `scrape` calls the same choice `escalate_engine`. All of
them default to `auto`.

## auto (default)

- Camoufox when its binary is installed; Chromium otherwise, with the reason in
  the result's `warnings[]`, so a machine that never ran `npx camoufox fetch`
  still works. The result names the engine that ran — `stealth.engine` on
  `scrape`, `engine` on the others — so check it instead of assuming.
- Naming an engine explicitly turns the fallback off: `camoufox` fails with its
  install instruction instead of degrading, and `playwright` / `chromium` go
  straight to Chromium.
- `chromium` and `playwright` are the same engine. Everything accepts both
  spellings except `scrape`'s `escalate_engine`, which takes only `playwright`.

## playwright

- Chromium-based with stealth patches applied.
- Reports `navigator.webdriver` as `false` (not deleted — a missing property is
  itself a marker), and sets the User-Agent, platform, languages and core count
  through CDP, so a Web Worker answers the same as the page.
- Lower resource usage, faster startup.
- Good for most sites with basic bot detection.

## camoufox

- Firefox-based with **native** anti-detection (no runtime patches — uses
  Firefox's genuine properties).
- Scores higher on CreepJS and the other detector pages than patched Chromium,
  and was the only engine to clear Cloudflare Turnstile (indeed.com) and Akamai
  (harrods.com) in the 2026-09-21 benchmark.
- Heavier: measured once each on an Apple Silicon Mac, 946 ms and 667 MB to
  launch a browser, a context and a blank page, against Chromium's 148 ms and
  253 MB.
- Install with `npm install camoufox`, then `npx camoufox fetch` for the binary.
- It does not defeat DataDome or an interactive Turnstile; in the same run
  Chromium passed leboncoin.fr where Camoufox did not. One run per cell.

## Decision table

| Scenario | Recommended engine |
|----------|--------------------|
| You do not know whether the site blocks | auto |
| General JS-rendered sites | playwright |
| Speed-critical or high-volume scraping | playwright |
| Cloudflare Turnstile pages, Akamai | camoufox |
| Detector-score-sensitive work (CreepJS) | camoufox |
| Sites with PerimeterX | camoufox |
| Sites with DataDome | either — neither cleared it; try a residential proxy |

## stealthConfig levels

| Level | Behavior |
|-------|----------|
| `basic` | Minimal fingerprint masking; lowest overhead. |
| `medium` (default) | Balanced fingerprint randomization + header spoofing. |
| `advanced` | Full anti-detection: human-behavior simulation, canvas/WebGL/audio/font/hardware spoofing, WebRTC blocking, timezone spoofing. |

## Key stealthConfig fields

- `randomizeFingerprint`, `hideWebDriver`, `blockWebRTC`, `spoofTimezone`,
  `randomizeHeaders`, `useRandomUserAgent`, `simulateHumanBehavior`.
- `customUserAgent`, `customViewport {width,height}`, `locale`, `timezone`.
- `proxyRotation { enabled, proxies[], rotationInterval }` — your own proxies,
  per call. Server-wide, `CRAWLFORGE_STEALTH_PROXIES` (comma-separated URLs of
  the same form) covers the paths with no caller to ask: the `scrape` escalation
  stage, `stealth_mode`, `browser_session`, `scrape_with_actions`, the
  `deep_research` retry and the `agent` tool's automatic stealth retry. A call's
  own `proxyRotation` always wins. CrawlForge supplies no proxies, and a datacenter
  proxy does not help — Cloudflare scores the ASN before it serves a challenge.
  Unrelated to the `PROXY_ROTATION_*` variables, which belong to `localization`.
- `antiDetection { cloudflareBypass, recaptchaHandling, hideAutomation,
  spoofMediaDevices, spoofBatteryAPI }`.
- `fingerprinting { canvasNoise, webglSpoofing, audioContextSpoofing,
  fontSpoofing, hardwareSpoofing }`.

On `camoufox`, `customUserAgent` and `customViewport` are not applied: that engine
brings its own Firefox identity, and overriding it from here put a Chrome identity
on a Gecko engine. `locale` is applied, but at browser launch rather than per
call — Camoufox sets language, Accept-Language and `Intl` below the JS layer,
where a Worker matches the document — so the first locale a Camoufox browser is
launched with holds until the browser is cleaned up, and behind a proxy the exit
IP decides it instead. The persona's OS is the host's and is not configurable
(on Camoufox that is a request its current client does not honour).

## Environment

There is no global engine override — the engine is a per-call parameter. Two
things come close, and neither is global:

```bash
export RESEARCH_STEALTH_ENGINE=camoufox     # deep_research's blocked-source retry only
crawlforge stealth <url> --engine camoufox  # the CLI, which defaults to chromium and has no auto
```

The one server-level stealth variable is `CRAWLFORGE_STEALTH_PROXIES` (above).

## Sandboxing note

Stealth Chromium runs with `--no-sandbox` (a deliberate fingerprint-spoofing
trade-off). It no longer runs with `--disable-web-security`, which a page could
read in one line; the non-stealth render browser still does. Camoufox (Firefox)
is the alternative when the `--no-sandbox` trade-off is unacceptable.
