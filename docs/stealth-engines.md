# Stealth Browser Engines

CrawlForge supports two browser engines for the `stealth_mode` tool.

## `deep_research` stealth extraction fallback (v4.6.6)

`deep_research` automatically retries blocked sources through a real browser. When the normal fetch/extract path returns no usable content (HTTP 403, JS-wall, empty body), `ResearchOrchestrator` renders the page in a fingerprinted browser and re-extracts from the rendered HTML. It is bounded (`RESEARCH_MAX_STEALTH_RETRIES`, default 8, plus a per-page timeout) and lazy (the browser stack loads only when a source is actually blocked).

Engine selection is via `RESEARCH_STEALTH_ENGINE`:

- `auto` (default) — prefer Camoufox, fall back to Chromium stealth, then plain fetch.
- `camoufox` — force Camoufox (surfaces an error if unavailable).
- `chromium` — force the Chromium stealth manager.

> The Chromium engine has two names, and they are not interchangeable. This
> environment variable takes `chromium`; the `stealth_mode` and `scrape` tool
> parameters (`engine`, `escalate_engine`) call the same engine **`playwright`**
> and reject `chromium`. Anything user-facing uses the tool spelling.

Disable entirely with `RESEARCH_STEALTH_FALLBACK=false`.

**One-time setup for Camoufox** (the engine that actually clears Cloudflare/DataDome — headless Chromium cannot): install the optional dependency and fetch its Firefox binary:

```bash
npm install camoufox      # optional dependency; already declared in optionalDependencies
npx camoufox fetch        # one-time ~130 MB Firefox binary download
```

Without the binary, `deep_research` silently falls back to Chromium stealth, then to plain fetch. Hard IP-reputation blocks (e.g. Reddit's edge 403) resist headless stealth from any IP and need residential proxies, which CrawlForge does not supply — see [Proxies](#proxies) for how to point it at your own.



## Available Engines

### `playwright` (default)

- **Browser:** Chromium
- **Anti-detection approach:** JavaScript-level fingerprint spoofing (canvas noise, WebGL, WebRTC, user-agent rotation, human behavior simulation)
- **When to use:** The default choice for the vast majority of sites. Fast, well-tested, and excellent Playwright ecosystem support.
- **Limitations:** Advanced bot-detection services that inspect Chrome DevTools Protocol artifacts can sometimes identify automation markers even with stealth patches applied.

```json
{ "operation": "create_context", "engine": "playwright", "stealthConfig": { "level": "advanced" } }
```

### `camoufox`

- **Browser:** Firefox
- **Anti-detection approach:** Patches browser internals at the C++ / Rust level — automation markers are removed before they reach JavaScript, not masked after the fact.
- **When to use:** When `playwright` is detected and blocked. Camoufox scores significantly higher on CreepJS and Datadome because it does not expose `navigator.webdriver` or CDP artifacts.
- **License:** MIT (see [github.com/daijro/camoufox](https://github.com/daijro/camoufox))
- **Installation:** `npm install camoufox` (optional peer dependency)
- **Limitations:** Slower startup than Chromium; fewer Playwright plugins support Firefox.

```json
{ "operation": "create_context", "engine": "camoufox", "stealthConfig": { "level": "advanced" } }
```

## Proxies

Cloudflare scores the IP and its ASN **before** it serves a JavaScript challenge,
so a datacenter address is refused whatever the fingerprint says. No amount of
stealth substitutes for an exit IP with a residential reputation.

Proxies are supplied per call, on `stealthConfig.proxyRotation`, as ordinary
proxy URLs. Credentials belong in the URL, percent-encoded if the password
contains `@`, `:` or `/`:

```json
{
  "operation": "scrape",
  "url": "https://example.com",
  "engine": "camoufox",
  "stealthConfig": {
    "proxyRotation": {
      "enabled": true,
      "proxies": ["http://user:p%40ssword@gw.provider.net:8080"],
      "rotationInterval": 300000
    }
  }
}
```

- `http`, `https`, `socks4` and `socks5` are accepted; a bare `host:port` is
  read as `http://host:port`. A malformed entry is an error, never a silently
  unproxied request.
- The proxy is applied to the browser **context**, so both engines authenticate.
- `rotationInterval` is the minimum time on one proxy; the list advances on the
  next context created after it elapses, starting from the first entry.
- `get_stats` reports the proxy in use with its credentials stripped.

**Camoufox and geoip.** Given a proxy, Camoufox is launched with `geoip`, so it
derives its longitude, latitude, timezone, country and locale from the proxy's
exit IP instead of from a persona picked here — the one thing that makes a
proxied browser coherent. That lookup runs once, at launch, which has two
consequences: the first ever call downloads MaxMind's city database (~60 MB)
into Camoufox's install directory, and a Camoufox browser stays on the proxy it
was launched with for its lifetime. A rotation reaches it after `cleanup()`.
Rotating underneath it would leave the first proxy's city behind the second
proxy's address, which is a worse signal than not rotating at all.

`blockWebRTC` defaults to true. Behind a proxy with geoip, `blockWebRTC: false`
is the stealthier setting on Camoufox: it then reports the proxy's exit IP
through WebRTC, which agrees with the address the site already sees, whereas a
browser with WebRTC switched off is itself unusual.

## What each engine spoofs

The two engines are not the same tool with different binaries, and they are
configured differently on purpose.

`playwright` spoofs from JavaScript: init scripts run before page scripts and
redefine `navigator`, canvas, WebGL, audio and font metrics. This is visible to
anything that compares property descriptors or `Function.prototype.toString`,
and it does not reach a Web Worker — a worker reports the machine's real
platform, core count and GPU. See the measured coverage table in
`StealthBrowserManager.applyAdvancedStealthConfigurations`.

`camoufox` spoofs inside the browser, below the JavaScript layer, so there is no
seam to find. CrawlForge therefore injects **nothing** into a Camoufox context
and overrides neither its User-Agent nor its headers: doing so put a Chrome
User-Agent and Chromium's `sec-ch-ua` client hints on a Gecko engine, which a
detector can act on from the request headers alone.

## Engine Selection Criteria

| Scenario | Recommended Engine |
|----------|-------------------|
| General web scraping | `playwright` |
| Cloudflare challenge pages | `playwright` (advanced level) |
| Datadome-protected sites | `camoufox` |
| CreepJS score > 90% needed | `camoufox` |
| High-volume batch scraping | `playwright` (lower overhead) |
| JS-fingerprinted sites (PerimeterX, Kasada) | `camoufox` |

## Benchmark Methodology

To compare engines on a given target, run the following steps with a clean browser profile (incognito, no extensions):

1. **bot.sannysoft.com** — Navigate with each engine; count red indicators. Fewer red = better.
2. **nowsecure.nl** — Check for "You are not a bot" message.
3. **abrahamjuliot.github.io/creepjs/** — Compare trust score percentage. Higher = better.
4. **Datadome test page** — Verify the challenge modal is not triggered.

All tests must be run on a fresh context with no cached state. Results are network- and IP-dependent; use a residential proxy for representative results.

## Graceful Fallback

If `engine: "camoufox"` is requested but the `camoufox` npm package is not installed, the tool returns a clear error message with installation instructions. CrawlForge does not automatically fall back to `playwright` when `camoufox` is explicitly requested, to avoid silent capability degradation.

## Licensing

| Engine | License |
|--------|---------|
| playwright | Apache-2.0 |
| camoufox (JS API) | MIT |
| camoufox (Firefox patches) | MPL-2.0 |

There are no AGPL-licensed components in the Camoufox distribution chain as of 2026-05. Always verify the license of the specific version you install: `npm info camoufox license`.
