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
- **Anti-detection approach:** identity (user agent, platform, language list, core count) set through CDP where a Worker sees it too; canvas, WebGL, audio and font metrics spoofed from init scripts; WebRTC, pointer/hover and automation flags set at launch; human behaviour simulation
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

`blockWebRTC` defaults to true. On Chromium it now sets
`--webrtc-ip-handling-policy=disable_non_proxied_udp`, the switch that decides
which local addresses WebRTC may offer, so only the address the proxy already
exposes is on the table; the five `--disable-webrtc-*` flags it replaces only
turned off hardware codecs and never stopped an ICE candidate carrying the
host's real address. Behind a proxy with geoip, `blockWebRTC: false`
is the stealthier setting on Camoufox: it then reports the proxy's exit IP
through WebRTC, which agrees with the address the site already sees, whereas a
browser with WebRTC switched off is itself unusual.

## What each engine spoofs

The two engines are not the same tool with different binaries, and they are
configured differently on purpose.

`playwright` splits the work in two. Everything a Web Worker can also be asked —
user agent, platform, `navigator.languages`/`Accept-Language` and
`hardwareConcurrency` — is set through CDP (`Emulation.setUserAgentOverride`,
`Emulation.setHardwareConcurrencyOverride`), which the renderer applies to every
execution context it creates, so a worker answers what the document answers and
there is no wrapper for a detector to bypass. Canvas, WebGL, audio and font
metrics are still init scripts running in the main world: that is visible to
anything comparing property descriptors or `Function.prototype.toString`, and
WebGL's unmasked vendor and renderer still leak in a worker. See the measured
coverage table in `StealthBrowserManager.applyAdvancedStealthConfigurations`.

Two details of that identity are worth naming, because the obvious version of
each is the tell. `navigator.webdriver` reports `false` rather than being
deleted — every real Chrome has the property and answers false, so a missing one
is itself a marker — and `navigator.userAgentData` is given the real Chrome
brand list, with no `HeadlessChrome` brand in it.

Stealth pages do not intercept requests. The `page.route('**/*')` handler is
gone, and with it the advanced level's habit of dropping about a third of
images, fonts and stylesheets at random: a page that renders without the
resources it asked for does not look like a browser reading it, and routing
every request through a Node round trip adds latency no network explains.

`camoufox` spoofs inside the browser, below the JavaScript layer, so there is no
seam to find. CrawlForge therefore injects **nothing** into a Camoufox context
and overrides neither its User-Agent nor its headers: doing so put a Chrome
User-Agent and Chromium's `sec-ch-ua` client hints on a Gecko engine, which a
detector can act on from the request headers alone. The locale moves for the same
reason, but it is not discarded: Playwright's Firefox locale override reaches the
main thread only, so a Camoufox page reported `navigator.languages` of
`["en-US"]` while its own Worker reported `["en-US", "en"]`. Camoufox sets
language, Accept-Language and `Intl` together in its own engine, where a worker
reads the same answer as the document — so `stealthConfig.locale` is handed to
the **launcher** instead of to the context. Like the proxy, that fixes it for the
life of the browser: a later call asking for a different locale gets the launched
one until `cleanup()`. With a proxy, `geoip` decides it from the exit IP and the
caller's locale is not sent at all, because a persona naming a country the
address contradicts is worse than no persona.

**The persona's OS is the host's**, on both engines, and is the one field in the
fingerprint that is observed rather than drawn. The GPU strings, the font list,
the CSS platform hints and the TCP/IP fingerprint all belong to the machine
whatever the User-Agent claims, so a Mac announcing Windows beside an Apple GPU
hands a detector a cleaner signal than not spoofing at all. Camoufox is passed
that `os` explicitly, because left to itself it picks one of Windows/macOS/Linux
at random — **but camoufox npm 0.1.19 does not honour it**: measured on
2026-09-21, ten launches asking for `macos` on a Mac produced a Mac persona
about one time in three, the market-share draw. The client forwards the option
to `fingerprint-generator`, whose key is `operatingSystems`, so it is dropped.
The call is kept because it is the documented API and costs nothing; until the
client is updated (Phase 2 of the stealth review), a Camoufox persona's OS is
still a lottery and `persona-os-vs-host` stays in the benchmark's known-failing
list for that engine. On Chromium it is deterministic.
The Chrome major in the Chromium User-Agent is read from the installed
binary — playwright-core's `browsers.json`, corrected from the browser once it
is running — rather than drawn from a list, so the version
`navigator.userAgentData` reports is the version that is actually running.

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

The steps below are also scripted. `npm run bench:stealth` drives both engines
and the plain fetch against a fixed target list and the detector pages, and
prints the pass/blocked matrix with its network context in the header — see
[docs/stealth-bench.md](./stealth-bench.md). Use it in preference to running
this by hand; the manual procedure remains here for a target the harness does
not cover.

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
