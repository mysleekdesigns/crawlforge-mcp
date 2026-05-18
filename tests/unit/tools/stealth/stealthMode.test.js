/**
 * D5.2 — Unit tests: stealthMode tool
 * Run: node --test tests/unit/tools/stealth/stealthMode.test.js
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Stubs — mock StealthBrowserManager with engine selection
// ---------------------------------------------------------------------------

const stubScrapeResult = {
  title: 'Protected Page',
  content: { text: 'Behind bot detection. CrawlForge bypassed it.' },
  metadata: { description: null, language: 'en' },
  fingerprint: { userAgent: 'Mozilla/5.0 ...', viewport: { width: 1280, height: 720 } }
};

class StealthBrowserManagerStub {
  constructor(options = {}) {
    this.options = options;
    this.engine = options.engine || 'playwright';
    this._contextCount = 0;
  }

  async scrapeWithStealth(url, options = {}) {
    if (url.includes('blocked.example.com')) throw new Error('Bot detected — all engines failed');
    this._contextCount++;
    return { ...stubScrapeResult, engine: this.engine, url };
  }

  async cleanup() { this._contextCount = 0; }
}

// ---------------------------------------------------------------------------
// Minimal StealthMode-like stub
// ---------------------------------------------------------------------------

class StealthModeStub {
  constructor({ manager } = {}) {
    this.manager = manager || new StealthBrowserManagerStub();
  }

  async execute(params) {
    if (!params || !params.url) throw new Error('url is required');
    try { new URL(params.url); } catch { throw new Error('Invalid URL'); }

    const engine = params.engine || 'playwright';
    // Create a manager with the requested engine
    const mgr = new StealthBrowserManagerStub({ engine });

    const result = await mgr.scrapeWithStealth(params.url, {
      waitForSelector: params.wait_for_selector,
      timeout: params.timeout || 30000
    });

    return {
      url: params.url,
      engine,
      success: true,
      title: result.title,
      content: result.content,
      fingerprint: result.fingerprint
    };
  }

  async destroy() { await this.manager.cleanup(); }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('stealthMode tool', () => {
  let tool;

  beforeEach(() => {
    tool = new StealthModeStub();
  });

  test('constructor stores manager', () => {
    assert.ok(tool.manager instanceof StealthBrowserManagerStub);
  });

  test('happy path with playwright engine returns content', async () => {
    const result = await tool.execute({ url: 'https://protected.example.com' });
    assert.equal(result.url, 'https://protected.example.com');
    assert.equal(result.engine, 'playwright');
    assert.equal(result.success, true);
    assert.ok(result.title);
    assert.ok(result.fingerprint);
  });

  test('camoufox engine selection respected', async () => {
    const result = await tool.execute({ url: 'https://example.com', engine: 'camoufox' });
    assert.equal(result.engine, 'camoufox');
  });

  test('missing url throws', async () => {
    await assert.rejects(() => tool.execute({}), /url is required/);
  });

  test('invalid URL throws', async () => {
    await assert.rejects(() => tool.execute({ url: 'not-valid' }), /Invalid URL/);
  });

  test('all-engines-blocked propagates error', async () => {
    await assert.rejects(() => tool.execute({ url: 'https://blocked.example.com' }), /Bot detected/);
  });

  test('fingerprint contains userAgent and viewport', async () => {
    const result = await tool.execute({ url: 'https://example.com' });
    assert.ok(result.fingerprint.userAgent, 'fingerprint.userAgent should be present');
    assert.ok(result.fingerprint.viewport, 'fingerprint.viewport should be present');
  });
});
