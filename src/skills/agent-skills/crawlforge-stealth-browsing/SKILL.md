---
name: crawlforge-stealth-browsing
description: "Bypasses bot detection and geo-restrictions with CrawlForge's stealth_mode and localization tools. Use when a site returns 403 or 429, CAPTCHAs, 'please enable JavaScript', or empty content, or is protected by Cloudflare, DataDome, or PerimeterX, or when the user needs region-specific pricing, geo-blocked content, or a specific locale, timezone, or currency. stealth_mode runs a stealth browser (engine auto by default: camoufox/Firefox for advanced fingerprinting, playwright/Chromium when pinned for speed) and can screenshot; localization emulates a country and language. Explains when to escalate from a normal scrape to stealth, and why a hard block needs a residential proxy."
metadata:
  version: 5.6.6
  source: crawlforge-mcp-server
---

# CrawlForge Stealth Browsing

Get past bot-detection systems and geo-blocks. Use `stealth_mode` when a normal
scrape is blocked, and `localization` when you need region-specific content,
pricing, or locale emulation.

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

Operations: `configure`, `enable`, `disable`, `create_context`, `create_page`,
`get_stats`, `cleanup`. `stealthConfig.level` is `basic` / `medium` (default) /
`advanced`. Always run `cleanup` when done to release the browser.

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

Server-wide, set `CRAWLFORGE_STEALTH_PROXIES` (comma-separated proxy URLs): the
`scrape` escalation stage, `stealth_mode`, `browser_session`,
`scrape_with_actions` and the `deep_research` retry use it when no proxy is
passed on the call. (`agent` does not browse yet, so it is not a reader.) Per call, pass
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

Emulate a country/language/timezone/currency for region-specific content and
geo-blocked pages.

```json
{
  "tool": "localization",
  "params": { "operation": "configure_country", "countryCode": "DE", "language": "de", "currency": "EUR" }
}
```

Operations: `configure_country`, `localize_search`, `localize_browser`,
`generate_timezone_spoof`, `handle_geo_blocking`, `auto_detect`, `get_stats`,
`get_supported_countries`. `countryCode` is ISO 3166-1 alpha-2; `currency` is
ISO 4217. Supports proxy routing and GPS geolocation emulation.

CLI: `crawlforge localize https://shop.example.com --locale en-GB --country GB --currency GBP`.

## stealth_mode vs localization

- **Blocked / bot-detected** → `stealth_mode`.
- **Wrong region / language / currency, but not blocked** → `localization`.
- **Geo-blocked AND bot-protected** → `localization` to set region context, then
  `stealth_mode` for the actual fetch.

## Cost note

`stealth_mode` = 5 credits per call (screenshots add a small extra cost);
`localization` = 2 credits. Try the cheaper `scrape` (2 credits) first and only
escalate to stealth when you see the block signals above.
