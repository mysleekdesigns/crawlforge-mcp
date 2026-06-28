---
name: crawlforge-stealth-browsing
description: "Bypasses bot detection and geo-restrictions with CrawlForge's stealth_mode and localization tools. Use when a site returns 403 or 429, CAPTCHAs, 'please enable JavaScript', or empty content, or is protected by Cloudflare, DataDome, or PerimeterX, or when the user needs region-specific pricing, geo-blocked content, or a specific locale, timezone, or currency. stealth_mode runs a stealth browser (playwright by default, camoufox for advanced fingerprinting) and can screenshot; localization emulates a country and language. Explains when to escalate from a normal scrape to stealth."
metadata:
  version: 4.8.0
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

## stealth_mode (cost: 5)

`stealth_mode` is operation-based. Typical flow: create a context, then create a
page that navigates to the target URL.

```json
{
  "tool": "stealth_mode",
  "params": {
    "operation": "create_context",
    "stealthConfig": { "level": "advanced", "simulateHumanBehavior": true },
    "engine": "playwright"
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

### Engine: playwright vs camoufox

- `engine:"playwright"` (default) — Chromium with stealth patches. Fast, good
  for most basic bot detection.
- `engine:"camoufox"` — Firefox-based with native anti-detection (no patches).
  Scores higher against DataDome / Cloudflare / PerimeterX and on CreepJS. Use
  for heavily protected, financial, or e-commerce sites.

Full decision table: [engine selection](references/engine-selection.md).

### CLI

```bash
crawlforge stealth https://protected-site.com
crawlforge stealth https://protected-site.com --engine camoufox --wait 3000 --screenshot
```

The CLI exposes a one-shot form (`--engine`, `--wait <ms>`, `--screenshot`).
Force the engine globally with `export CRAWLFORGE_STEALTH_ENGINE=camoufox`.

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
