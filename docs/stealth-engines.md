# Stealth Browser Engines

CrawlForge drives two browser engines: Chromium with stealth patches, and
Camoufox (Firefox). Every stealth entry point takes an engine, and every one of
them now defaults to **`auto`** — prefer Camoufox, fall back to Chromium with a
visible warning when the Camoufox binary is not installed.

| Entry point | How the engine is chosen | Accepted values |
|---|---|---|
| `scrape` with `escalate: true` | `escalate_engine` | `auto` (default) · `playwright` · `camoufox` |
| `stealth_mode` | `engine` | `auto` (default) · `chromium` · `playwright` · `camoufox` |
| `browser_session` | `engine`, on `open`, with `stealth: true` | `auto` (default) · `chromium` · `playwright` · `camoufox` |
| `scrape_with_actions` | `browserOptions.engine`, with `stealth: true` | `auto` (default) · `chromium` · `playwright` · `camoufox` |
| `deep_research` blocked-source retry | `RESEARCH_STEALTH_ENGINE` | `auto` (default) · `camoufox` · `chromium` |

`browser_session` and `scrape_with_actions` refuse an engine without
`stealth: true`: their non-stealth path is always the standard Chromium pool,
and silently accepting `camoufox` there would promise an engine that never ran.

Naming an engine explicitly behaves exactly as it always has: `camoufox` fails
at launch with its install instruction rather than degrading silently, and
`playwright` / `chromium` go straight to the Chromium manager.

**Which engine actually ran** is in the result, never inferred from what you
asked for. `scrape` reports it as `stealth.engine` (resolved — `camoufox` or
`chromium`, never `auto`); `browser_session` echoes `engine` on every operation;
`stealth_mode` and `scrape_with_actions` report it on the result too. When
`auto` falls back, a line lands in `warnings[]` naming the reason (one line,
wrapped here):

```
Stealth engine fell back to chromium: camoufox is not installed
(npm install camoufox). Camoufox passes bot walls this Chromium does not;
install it to use it.
```

An installed Camoufox that fails to load reports that load error in place of the
middle clause.

The default moved because of a measurement, not a preference. On 2026-09-21,
against real bot walls from a residential IP, Camoufox was the only engine that
cleared Cloudflare Turnstile on indeed.com and Akamai on harrods.com; Chromium
stealth was blocked on both. Neither engine cleared DataDome (g2.com)
or an interactive Turnstile that never self-resolves (nowsecure.nl), and on
leboncoin.fr the result inverted — Chromium passed where Camoufox did not. One
run per cell, so read that as vendor-dependent rather than a ranking. The full
matrix is in section 2.2 of
[`STEALTH_REVIEW_2026-09.md`](./STEALTH_REVIEW_2026-09.md); reproduce it with
[the harness](./stealth-bench.md).

## What `auto` costs

Camoufox is the slower, heavier engine, and `auto` pays that on every stealth
call that is not explicitly pinned to Chromium. Measured on this project's
development machine (Apple Silicon Mac) on 2026-09-21 — launch, then a context
and a page on `about:blank`, with browser-process RSS:

| Engine | Launch | + context and page | Total | RSS |
|---|---|---|---|---|
| Chromium | 95 ms | 53 ms | 148 ms | 253 MB |
| Camoufox | 513 ms | 433 ms | 946 ms | 667 MB |

So `auto` costs roughly **+0.8 s and +400 MB per stealth call** against Chromium
— about 2.6x the memory. That is one run of each engine on one machine, not a
benchmark: treat it as the order of magnitude, and pin `engine: "playwright"`
when a target is known not to need Camoufox and the throughput matters.

### Pinning `auto` for a whole deployment

`CRAWLFORGE_STEALTH_ENGINE=chromium` (or `playwright`) makes `auto` resolve to
Chromium everywhere on that server. Unset, or set to anything unrecognised, it
keeps preferring Camoufox. A caller naming an engine on the call always wins.

Set it when you know which side of this your egress sits on, because **which
engine wins depends on the exit IP**:

| Exit IP | indeed.com | quora.com | harrods.com |
| --- | --- | --- | --- |
| Residential (2026-09-21) | Camoufox only | — | Camoufox only |
| Datacenter, AS14618 (2026-09-22, twice) | **Chromium only** | **Chromium only** | both |

From that datacenter address Camoufox won no wall Chromium lost, so it was
paying the latency and memory above for nothing — which is why the hosted
CrawlForge instance sets this to `chromium`. On a residential connection the
opposite holds, which is why the shipped default still prefers Camoufox.

Pinning the Camoufox binary to a version with a coherent persona did **not**
change any of those wall outcomes, so this is about the engine and the IP, not
about the fingerprint.

On Linux, Camoufox runs **virtual-headless** (Xvfb) rather than true headless,
because a true-headless Firefox is itself a signal. That needs an X virtual
framebuffer present in the image; macOS and Windows hosts are unaffected.

## `deep_research` stealth extraction fallback (v4.6.6)

`deep_research` automatically retries blocked sources through a real browser. When the normal fetch/extract path returns no usable content (HTTP 403, JS-wall, empty body), `ResearchOrchestrator` renders the page in a fingerprinted browser and re-extracts from the rendered HTML. It is bounded (`RESEARCH_MAX_STEALTH_RETRIES`, default 8, plus a per-page timeout) and lazy (the browser stack loads only when a source is actually blocked).

Engine selection is via `RESEARCH_STEALTH_ENGINE`:

- `auto` (default) — prefer Camoufox, fall back to Chromium stealth, then plain fetch.
- `camoufox` — force Camoufox (surfaces an error if unavailable).
- `chromium` — force the Chromium stealth manager.

> The Chromium engine has two names, and one parameter still takes only the
> older one. This environment variable, `stealth_mode`, `browser_session` and
> `scrape_with_actions` all accept `chromium` (with `playwright` as a synonym);
> `scrape`'s `escalate_engine` accepts **`playwright`** alone and rejects
> `chromium`. Use `auto` and the question does not arise.

Disable entirely with `RESEARCH_STEALTH_FALLBACK=false`.

**One-time setup for Camoufox** (the engine that cleared Cloudflare Turnstile and Akamai in the 2026-09-21 run where Chromium stealth did not — neither cleared DataDome): install the optional dependency and fetch its Firefox binary:

```bash
npm install camoufox      # optional dependency; already declared in optionalDependencies
npx camoufox fetch        # one-time ~130 MB Firefox binary download
```

Without the binary, `deep_research` silently falls back to Chromium stealth, then to plain fetch. Hard IP-reputation blocks (e.g. Reddit's edge 403) resist headless stealth from any IP and need residential proxies, which CrawlForge does not supply — see [Proxies](#proxies) for how to point it at your own.



## Available Engines

### `playwright`

- **Browser:** Chromium
- **Anti-detection approach:** identity (user agent, platform, language list, core count) set through CDP where a Worker sees it too; canvas, WebGL, audio and font metrics spoofed from init scripts; WebRTC, pointer/hover and automation flags set at launch; human behaviour simulation
- **When to use:** Pin it when the target does not wall you and the per-call cost matters — a sixth of Camoufox's startup and under 40% of its memory (see [What `auto` costs](#what-auto-costs)). It is also not strictly worse against every vendor: it passed leboncoin.fr where Camoufox did not.
- **Limitations:** Blocked on Cloudflare Turnstile (indeed.com) and on Akamai (harrods.com) in the 2026-09-21 run. Advanced bot-detection services that inspect Chrome DevTools Protocol artifacts can identify automation markers even with stealth patches applied.

```json
{ "operation": "create_context", "engine": "playwright", "stealthConfig": { "level": "advanced" } }
```

### `camoufox`

- **Browser:** Firefox
- **Anti-detection approach:** Patches browser internals at the C++ / Rust level — automation markers are removed before they reach JavaScript, not masked after the fact.
- **When to use:** Whenever a site walls you — which is why `auto` reaches for it first. It scores higher than patched Chromium on CreepJS and the other detector pages because it exposes neither `navigator.webdriver` nor CDP artifacts, and it was the only engine to clear Cloudflare Turnstile (indeed.com) and Akamai (harrods.com) in the 2026-09-21 run.
- **License:** MIT (see [github.com/daijro/camoufox](https://github.com/daijro/camoufox))
- **Installation:** `npm install camoufox` (optional peer dependency)
- **Limitations:** ~6x Chromium's startup and ~2.6x its memory. It does not defeat DataDome (blocked on g2.com, and blocked on leboncoin.fr where Chromium passed) or an interactive Turnstile. Fewer Playwright plugins support Firefox.
- **Persona version is pinned to the installed binary.** `camoufox@0.1.19` rewrites persona version tokens with a non-global regex, so the rewrite reaches `rv:` and stops while `Firefox/` keeps whatever browserforge drew — on the installed 135 binary, 4 of 8 launches announced a Firefox that was not the one running, which is a one-line detection. CrawlForge generates the persona at the binary's own major instead, making that rewrite a no-op (8/8). If the installed binary is a version browserforge has no data for, the pin stands down and Camoufox generates as before rather than guessing. **This is also why the binary is not simply upgraded:** upstream is on 152, outside that data, where *every* UA self-contradicts. See [STEALTH_REVIEW_2026-09.md](STEALTH_REVIEW_2026-09.md).
- **Persona OS follows the host where the data exists.** The same generation step passes `operatingSystems`, the key `camoufox@0.1.19` gets wrong (it sends `os`, which the generator ignores), so a host no longer ships a persona from a different operating system. On macOS this closes it completely. **On Linux it does not:** browserforge has no Firefox 135 + Linux persona and throws when asked, so the adapter falls back to a version-only pin and the persona claims Windows. A coherent version on an incoherent OS is the honest state there, and it is why `persona-os-vs-host` is still baselined for CI.

```json
{ "operation": "create_context", "engine": "camoufox", "stealthConfig": { "level": "advanced" } }
```

## Proxies

**CrawlForge supplies no proxies.** There is no proxy pool behind the service and
no plan to add one. Both settings below are bring-your-own: you point the server
at a provider you pay for, and the traffic goes out from your account's exit IPs.

### A datacenter proxy does not help

Cloudflare scores the IP, its ASN and the TLS/HTTP2 handshake **before** it
serves a JavaScript challenge, so a datacenter address is refused whatever the
fingerprint says — and no browser-side patch runs early enough to compensate.
Renting a VPS or a cheap datacenter proxy changes the address without changing
the class of address, which is the part being scored.

The indicative numbers come from humanbrowser's 12-method test (May 2026). It is
vendor-run, so read it as an order of magnitude and not as an independent
measurement — but the shape matches everything else published in 2026:

| Setup | Cloudflare pass rate |
|---|---|
| VPS plus any stealth plugin | 0–10% |
| Residential IP alone | ~35% |
| Residential IP plus a patched fingerprint | ~70% on Pro, ~25% on Enterprise |

So the engine work on this page is the second term of a product whose first term
is the address. A residential or mobile exit IP is what makes the rest of it
worth anything; without one, `auto` mostly buys you a slower block.

Sources, as listed in section 8 of
[`STEALTH_REVIEW_2026-09.md`](./STEALTH_REVIEW_2026-09.md):

- humanbrowser.cloud — "Playwright Cloudflare bypass 2026" (the 12-method test)
  and "Cloudflare Turnstile bypass 2026".
- Cloudflare's own changelog and blog on bot scoring and signed agents:
  [blog.cloudflare.com/signed-agents](https://blog.cloudflare.com/signed-agents)
  and [blog.cloudflare.com/kitesurf](https://blog.cloudflare.com/kitesurf).

### Supplying your own

Two places, with the narrower one winning:

1. **Per call**, on `stealthConfig.proxyRotation` — full control, including the
   rotation interval.
2. **Server-level**, `CRAWLFORGE_STEALTH_PROXIES`: a comma-separated list of the
   same proxy URLs. It is used by the escalation stage behind
   `scrape: { escalate: true }`, the `deep_research` blocked-source retry, the
   `agent`, and `browser_session` — every path where there is no caller to pass
   a proxy — and only when the caller passes none. A caller-supplied
   `proxyRotation` always wins.

```bash
export CRAWLFORGE_STEALTH_PROXIES="http://user:p%40ssword@gw.provider.net:8080,http://user:p%40ssword@gw2.provider.net:8080"
```

Per call, the same URLs go on `stealthConfig.proxyRotation`. Credentials belong
in the URL, percent-encoded if the password contains `@`, `:` or `/`:

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

### Not the `PROXY_ROTATION_*` variables

`CRAWLFORGE_STEALTH_PROXIES` is unrelated to the `PROXY_ROTATION_ENABLED` /
`PROXY_ROTATION_INTERVAL` / `PROXY_ROTATION_STRATEGY` family in
`src/constants/config.js`. Those live under `localization.proxy` and belong to
the `localization` tool, whose job is to *be* in a country — the proxy is how a
German price list is fetched from a German address, and rotation there is about
spreading load across a pool.

The stealth variable answers a different question: what exit IP a **blocked**
page is retried from. It is one list, applied at the browser context, and it
exists because the escalation stage and `deep_research` have no caller to ask.
(The `agent` tool has no browsing path of its own yet — that is Phase 3 — so it
is not among the readers today.) Setting one does nothing for the other; they are read by
different code paths and can point at different providers.

**Camoufox and geoip.** Given a proxy — from either source — Camoufox is
launched with `geoip`, so it derives its longitude, latitude, timezone, country
and locale from the proxy's exit IP instead of from a persona picked here — the
one thing that makes a proxied browser coherent. That lookup runs once, at launch, which has two
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

Leave it on `auto` unless one of these applies.

| Scenario | Engine | Why |
|----------|--------|-----|
| You do not know whether the site walls you | `auto` | Camoufox when it is installed, Chromium with a warning when it is not |
| Cloudflare Turnstile, Akamai | `camoufox` | The only engine that cleared indeed.com and harrods.com on 2026-09-21 |
| Detector-page scores (CreepJS, incolumitas) | `camoufox` | Worker identity consistent with the main thread; no CDP artifacts |
| High-volume batch work on sites that do not block | `playwright` | ~6x faster to start and ~2.6x lighter |
| A DataDome site | either, and expect to fail | Neither engine cleared g2.com; Chromium passed leboncoin.fr where Camoufox did not |
| A datacenter host with no proxy | either, and expect to fail | The address is scored before the browser runs — see [Proxies](#proxies) |

Every row above that names a result is one run from a residential IP on
2026-09-21. Re-measure with [the harness](./stealth-bench.md) before treating a
cell as settled.

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

`auto` falls back. If the `camoufox` package or its Firefox binary is missing,
the call runs on Chromium, puts the reason in the result's `warnings[]` and
reports `chromium` as the engine that ran — so a host that never ran
`npx camoufox fetch` degrades to the old behaviour rather than failing, but
never silently.

Naming `camoufox` explicitly does not fall back. The tool returns a clear error
with installation instructions instead, because a caller who asked for that
engine asked for its capability, and quietly substituting a weaker one turns a
fixable setup problem into an unexplained block.

## Licensing

| Engine | License |
|--------|---------|
| playwright | Apache-2.0 |
| camoufox (JS API) | MIT |
| camoufox (Firefox patches) | MPL-2.0 |

There are no AGPL-licensed components in the Camoufox distribution chain as of 2026-05. Always verify the license of the specific version you install: `npm info camoufox license`.
