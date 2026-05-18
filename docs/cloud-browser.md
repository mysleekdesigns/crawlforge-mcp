# Cloud Browser Backend

CrawlForge supports pluggable browser backends via the `CRAWLFORGE_BROWSER_BACKEND` environment variable.

## Backends

### `local` (default)

Uses a local Playwright Chromium installation. No additional setup required.

```bash
CRAWLFORGE_BROWSER_BACKEND=local  # or omit (local is the default)
```

### `browserbase`

Routes Playwright over Chrome DevTools Protocol (CDP) to a [BrowserBase](https://browserbase.com) cloud browser session. This gives you:

- Residential IP addresses
- Automatic CAPTCHA solving
- Built-in session recording
- No local browser process overhead

#### Setup

1. Sign up at [browserbase.com](https://browserbase.com) and get your API key.
2. Set environment variables:

```bash
CRAWLFORGE_BROWSER_BACKEND=browserbase
BROWSERBASE_API_KEY=your_api_key_here
BROWSERBASE_PROJECT_ID=your_project_id  # optional
```

3. Use `stealth_mode` as normal — requests are automatically routed through BrowserBase.

#### Graceful fallback

If `CRAWLFORGE_BROWSER_BACKEND=browserbase` is set but:
- `BROWSERBASE_API_KEY` is missing — CrawlForge logs a warning and falls back to local Playwright.
- BrowserBase session creation fails (network error, quota exceeded) — the error is surfaced to the caller; no silent fallback occurs for operational errors.

## Backend Interface

The backend system is implemented in `src/core/StealthBrowserManager.js` via the `BrowserBackend` abstract class. To add a custom backend (e.g. Browserless, Bright Data):

```javascript
import { BrowserBackend } from './src/core/StealthBrowserManager.js';

class MyCustomBackend extends BrowserBackend {
  name() { return 'my-backend'; }
  isConfigured() { return Boolean(process.env.MY_BACKEND_KEY); }
  async connect(config) {
    const { chromium } = await import('playwright');
    return chromium.connectOverCDP(myEndpoint, { timeout: 30000 });
  }
  async disconnect() { /* cleanup */ }
}
```

## Cost Considerations

BrowserBase charges per session-minute. Complex scraping workflows (multi-step actions, long waits) will consume more session time than simple fetches. Use `CRAWLFORGE_BROWSER_BACKEND=local` for development and testing; switch to `browserbase` for production deployments where residential IPs are required.

## Compatibility

The cloud backend works with:
- `stealth_mode` — full support
- `scrape_with_actions` — supported via page handle
- `extract_content` — supported when `requiresJavaScript: true`

The cloud backend is **not** used for:
- `fetch_url`, `extract_text`, `extract_links` — these use plain `fetch()`, not Playwright
- `batch_scrape` — uses `fetch()` internally
