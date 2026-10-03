---
name: crawlforge-stealth-browsing
description: "Bypasses bot detection with CrawlForge's stealth_mode tool and looks up a country's locale settings with localization. Use when a site returns 403 or 429, CAPTCHAs, 'please enable JavaScript', or empty content, or is protected by Cloudflare, DataDome, or PerimeterX, or when the user needs a page in a specific locale, language, or timezone. stealth_mode runs a stealth browser (engine auto by default: camoufox/Firefox for advanced fingerprinting, playwright/Chromium when pinned for speed) and can screenshot; localization returns a country's Accept-Language, timezone and currency for you to pass to fetch_url or stealth_mode - it applies nothing itself and uses no proxy. Explains when to escalate from a normal scrape to stealth, and why a hard block needs a residential proxy."
metadata:
  version: 5.6.6
  source: crawlforge-mcp-server
---

# CrawlForge Stealth Browsing

Get past bot-detection systems, and request pages in a given locale. Use
`stealth_mode` when a normal scrape is blocked, and `localization` to look up
the locale values (Accept-Language, timezone, currency) of a country, which you
then pass to `fetch_url` or `stealth_mode` yourself.

## When to escalate to stealth_mode

Escalate from a normal `scrape` / `fetch_url` (see crawlforge-web-scraping) when:

- The site returns **403 or 429** on a regular fetch.
- You get a **CAPTCHA** or a "please enable JavaScript" interstitial.
- Content comes back **empty** or only a shell (JS-rendered SPA).
- The site uses **Cloudflare, DataDome, PerimeterX**, or similar protection.

`stealth_mode` drives a real browser with randomized fingerprints, human
behavior simulation, and WebRTC/canvas/WebGL spoofing.

When you already know the site blocks, `scrape` with `escalate: true` does both
steps in one call: the plain fetch first, then the same stealth browser only if
that fetch is walled. Projected at 7, charged 2 when the plain fetch worked.
Still never reach for `stealth_mode` first.

## stealth_mode (cost: 5)

`stealth_mode` is operation-based. Typical flow: create a context, then create a
page that navigates to the target URL.

```json
{
  "tool": "stealth_mode",
  "params": {
    "operation": "create_context",
    "stealthConfig": { "level": "advanced", "simulateHumanBehavior": true }
  }
}
```

Then use the returned `contextId`:

```json
{
  "tool": "stealth_mode",
  "params": { "operation": "create_page", "contextId": "<id-from-create_context>", "urlToTest": "https://protected-site.com" }
}
```

Operations: `scrape`, `configure`, `create_context`, `create_page`,
`get_stats`, `cleanup`. `stealthConfig.level` is `basic` / `medium` (default) /
`advanced`. Always run `cleanup` when done to release the browser.

`stealthConfig` applies to the call it is passed on and is not remembered.
`configure` only validates a `stealthConfig` and returns it with the defaults
filled in; it stores nothing, so pass `stealthConfig` again on each `scrape` or
`create_context` call that should use it. Whatever the browser did not take
from it (on `camoufox`: `customUserAgent`, `customViewport`, a `locale` that
differs from the one the browser was launched with) is named in the result's
`warnings`.

### Engine: auto, playwright, camoufox

- `engine:"auto"` (default) — Camoufox when its binary is installed, Chromium
  with a warning when it is not. Leave it alone unless you have a reason.
- `engine:"camoufox"` — Firefox-based with native anti-detection (no patches).
  The only engine that cleared Cloudflare Turnstile (indeed.com) and Akamai
  (harrods.com) in the 2026-09-21 benchmark. Pin it to require that engine: it
  errors rather than falling back. Costs roughly +0.8 s and +400 MB per call
  against Chromium.
- `engine:"playwright"` — Chromium with stealth patches. Pin it for speed on
  sites that need rendering rather than evasion.

`stealth_mode` also accepts `"chromium"` as a synonym for `"playwright"`.
`browser_session` takes the same `engine` on `operation:"open"` and
`scrape_with_actions` takes it as `browserOptions.engine` — both only with
`stealth: true`, and both default to `"auto"`. `scrape`'s `escalate_engine` is
the one parameter that does not accept `"chromium"`; say `"playwright"` there.

The result always names the engine that ran (`stealth.engine` on `scrape`,
`engine` elsewhere), and an `auto` run that fell back to Chromium says so in
`warnings[]` — read that rather than assuming you got Camoufox.

Neither engine defeats DataDome or an interactive Turnstile. If both are
blocked, the address is usually the problem, not the browser.

Full decision table: [engine selection](references/engine-selection.md).

### Proxies

A block that survives both engines is usually the IP, not the fingerprint:
Cloudflare scores the address and its ASN before it serves a challenge, so a
datacenter proxy changes the address without changing the class of address being
scored. Route through your own residential proxy — CrawlForge supplies none.

A self-hosted server can instead hand every stealth session to Browserbase:
set `CRAWLFORGE_BROWSER_BACKEND=browserbase` and `BROWSERBASE_API_KEY` (see
`docs/cloud-browser.md`). That account supplies the residential exit and any
CAPTCHA solving on its own terms; CrawlForge itself never solves a challenge —
a challenge page is reported as blocked.

Server-wide, set `CRAWLFORGE_STEALTH_PROXIES` (comma-separated proxy URLs): the
`scrape` escalation stage, `stealth_mode`, `browser_session`,
`scrape_with_actions`, the `deep_research` retry and the `agent` tool's automatic
stealth retry use it when no proxy is passed on the call. Per call, pass
`stealthConfig.proxyRotation`, which always wins:

```json
{
  "tool": "stealth_mode",
  "params": {
    "operation": "scrape", "url": "https://protected-site.com", "engine": "camoufox",
    "stealthConfig": {
      "proxyRotation": { "enabled": true, "proxies": ["http://user:p%40ss@gw.provider.net:8080"] }
    }
  }
}
```

Credentials go in the URL, percent-encoded if the password contains `@`, `:` or
`/`. `http`, `https`, `socks4` and `socks5` are accepted. With a proxy, camoufox
derives its timezone, locale and geolocation from the exit IP, so the browser
agrees with the address the site sees — that lookup happens at launch, so a
camoufox browser keeps one proxy until `cleanup`.

### CLI

```bash
crawlforge stealth https://protected-site.com
crawlforge stealth https://protected-site.com --engine camoufox --wait 3000 --screenshot
```

The CLI exposes a one-shot form (`--engine`, `--wait <ms>`, `--screenshot`).
`--engine` takes `chromium` (the default here — the CLI has no `auto`) or
`camoufox`, so name `camoufox` on the command line when you want it.

## localization (cost: 2)

Look up a country's locale settings: language, `Accept-Language` header,
timezone, currency, search domain, date and number formats. It **returns
values and applies none**. No later `fetch_url`, `scrape` or `stealth_mode` call
picks them up, and it routes nothing through a proxy, so it does not change the
IP a site sees and cannot lift a geo-block on its own.

```json
{
  "tool": "localization",
  "params": { "operation": "configure_country", "countryCode": "DE", "language": "de", "currency": "EUR" }
}
```

Operations: `configure_country`, `localize_search`, `localize_browser`,
`generate_timezone_spoof`, `handle_geo_blocking`, `auto_detect`, `get_stats`,
`get_supported_countries`. `countryCode` is ISO 3166-1 alpha-2 (either case);
`currency` is ISO 4217. `localize_search` is the one operation that makes a
request: it runs `search_web` for `searchParams.query` in the country and its
language. `localize_browser` returns Playwright-style context options,
`generate_timezone_spoof` returns a JavaScript snippet, and
`handle_geo_blocking` classifies a response you supply — none of them launches,
injects or fetches anything.

Pass the returned values to the tool that makes the request:

```json
{
  "tool": "fetch_url",
  "params": { "url": "https://shop.example.com", "headers": { "Accept-Language": "de-DE,de;q=0.9,en;q=0.8" } }
}
```

```json
{
  "tool": "stealth_mode",
  "params": {
    "operation": "scrape",
    "url": "https://shop.example.com",
    "stealthConfig": { "locale": "de-DE", "timezone": "Europe/Berlin" }
  }
}
```

`search_web` takes `localization: { countryCode, language }`. `scrape` has no
locale parameter.

CLI: `crawlforge localize https://shop.example.com --locale en-GB --country GB --currency GBP`
fetches the URL with that country's `Accept-Language` header (nothing else is
sent; the currency is only reported).

## stealth_mode vs localization

- **Blocked / bot-detected** → `stealth_mode`.
- **Wrong language shown, but not blocked** → `localization` for the country's
  `Accept-Language`, then `fetch_url` with it in `headers`.
- **Wrong language AND bot-protected** → `stealth_mode` with
  `stealthConfig.locale` / `stealthConfig.timezone` (look the values up with
  `localization` if you do not know them).
- **Geo-blocked by IP** → only an exit IP in that region helps: your own proxy
  on `stealthConfig.proxyRotation`. Neither tool supplies one.

## Cost note

`stealth_mode` = 5 credits per call (screenshots add a small extra cost);
`localization` = 2 credits. Try the cheaper `scrape` (2 credits) first and only
escalate to stealth when you see the block signals above.
