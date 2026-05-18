# CrawlForge Stealth Mode Guide

## When to Use stealth_mode

Use `stealth_mode` when a site returns bot-detection errors, 403 responses, CAPTCHAs, or JavaScript-rendered content that `fetch_url` and `extract_content` cannot access.

Signs you need stealth mode:
- Site returns 403 or 429 on regular fetch
- Content is empty or shows "please enable JavaScript"
- Site uses Cloudflare, DataDome, PerimeterX, or similar bot protection

## Engines

### playwright (default)
- Chromium-based with stealth patches
- Masks webdriver fingerprints, User-Agent, navigator properties
- Good for most sites with basic bot detection
- Lower resource usage

### camoufox
- Firefox-based with native anti-detection
- No patches applied — uses Firefox's native properties
- Scores higher on CreepJS and DataDome than patched Chromium
- Use for sites with advanced fingerprinting (financial, e-commerce)

## MCP Tool Usage

```json
// Basic stealth scrape
{
  "tool": "stealth_mode",
  "params": {
    "url": "https://protected-site.com",
    "engine": "playwright"
  }
}

// Advanced: Camoufox engine with screenshot
{
  "tool": "stealth_mode",
  "params": {
    "url": "https://heavily-protected-site.com",
    "engine": "camoufox",
    "wait_for": 3000,
    "screenshot": true
  }
}
```

## CLI Usage

```bash
# Default engine (playwright)
crawlforge stealth https://protected-site.com

# Camoufox for advanced bot detection bypass
crawlforge stealth https://protected-site.com --engine camoufox

# Wait for JS-heavy page to render, capture screenshot
crawlforge stealth https://spa-site.com --wait 3000 --screenshot

# Output as JSON
crawlforge stealth https://example.com --json
```

## Engine Selection Guide

| Scenario | Recommended Engine |
|----------|-------------------|
| General JS-rendered sites | playwright |
| Cloudflare-protected sites | camoufox |
| Sites with DataDome | camoufox |
| Sites with PerimeterX | camoufox |
| Financial/trading sites | camoufox |
| Speed-critical scraping | playwright |
| Basic bot detection bypass | playwright |

## Environment Variable

Force engine globally:
```bash
export CRAWLFORGE_STEALTH_ENGINE=camoufox
```

## Combining with Other Tools

After extracting raw HTML via stealth_mode, pipe to analyze_content or extract_structured:
```json
// Step 1: get HTML via stealth
{ "tool": "stealth_mode", "params": { "url": "https://example.com" } }

// Step 2: extract structured data from the result
{ "tool": "extract_structured", "params": { "url": "https://example.com", "schema": {...} } }
```

## Credits
- `stealth_mode`: 5 credits per call
- Additional costs for screenshots (1 extra credit per screenshot)
