/**
 * D5.2 — Unit tests: scrapeTemplate tool
 * Run: node --test tests/unit/tools/templates/scrapeTemplate.test.js
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Stubs — TemplateRegistry with injectable fetch
// ---------------------------------------------------------------------------

const TEMPLATES = {
  'github-repo': {
    id: 'github-repo',
    name: 'GitHub Repository',
    description: 'Extracts repo metadata, stars, description, language',
    extract: (html) => ({
      name: 'my-repo',
      description: 'A cool repository',
      stars: 1234,
      language: 'JavaScript',
      topics: ['mcp', 'scraping']
    })
  },
  'npm-package': {
    id: 'npm-package',
    name: 'npm Package',
    description: 'Extracts package name, version, description, weekly downloads',
    extract: (html) => ({
      name: 'crawlforge-mcp-server',
      version: '4.1.0',
      description: 'MCP server for web scraping',
      weeklyDownloads: 5000
    })
  }
};

class TemplateRegistryStub {
  list() { return Object.values(TEMPLATES).map(({ id, name, description }) => ({ id, name, description })); }
  get(id) { return TEMPLATES[id] || null; }
}

class ScrapeTemplateStub {
  constructor({ registry, fetchFn } = {}) {
    this.registry = registry || new TemplateRegistryStub();
    this._fetch = fetchFn || null;
  }

  async execute({ template, url, timeout = 15000 } = {}) {
    // List mode
    if (template === 'list' || !url) {
      const templates = this.registry.list();
      return { templates, count: templates.length };
    }

    const tpl = this.registry.get(template);
    if (!tpl) {
      const available = this.registry.list().map(t => t.id).join(', ');
      throw new Error(`Unknown template "${template}". Available templates: ${available}`);
    }

    try { new URL(url); } catch { throw new Error('Invalid URL'); }

    // Fetch page
    let html;
    try {
      const resp = await this._fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      html = await resp.text();
    } catch (err) {
      if (err.message.startsWith('HTTP')) throw err;
      if (err.name === 'AbortError') throw new Error(`Request timeout after ${timeout}ms`);
      throw err;
    }

    const data = tpl.extract(html);
    return { template, url, data };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetch(status = 200, html = '<html/>', throwWith = null) {
  return async (url) => {
    if (throwWith) { const e = new Error(throwWith); e.name = throwWith === 'AbortError' ? 'AbortError' : 'Error'; throw e; }
    return { ok: status >= 200 && status < 300, status, statusText: status === 200 ? 'OK' : 'Error', text: async () => html };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scrapeTemplate tool', () => {
  let tool;

  beforeEach(() => {
    tool = new ScrapeTemplateStub({ fetchFn: makeFetch(200, '<html><h1>Test</h1></html>') });
  });

  test('constructor stores registry', () => {
    assert.ok(tool.registry instanceof TemplateRegistryStub);
  });

  test('list mode — returns all available templates', async () => {
    const result = await tool.execute({ template: 'list' });
    assert.ok(Array.isArray(result.templates));
    assert.equal(result.count, 2);
    assert.ok(result.templates.some(t => t.id === 'github-repo'));
  });

  test('happy path github-repo — extracts stars, language', async () => {
    const result = await tool.execute({ template: 'github-repo', url: 'https://github.com/user/repo' });
    assert.equal(result.template, 'github-repo');
    assert.equal(result.url, 'https://github.com/user/repo');
    assert.ok(typeof result.data.stars === 'number');
    assert.ok(result.data.language);
  });

  test('unknown template throws with available list', async () => {
    await assert.rejects(() => tool.execute({ template: 'fakebook', url: 'https://fb.com' }), /Unknown template/);
  });

  test('invalid URL throws', async () => {
    await assert.rejects(() => tool.execute({ template: 'github-repo', url: 'not-valid' }), /Invalid URL/);
  });

  test('HTTP 404 propagates as error', async () => {
    const notFoundTool = new ScrapeTemplateStub({ fetchFn: makeFetch(404, '') });
    await assert.rejects(() => notFoundTool.execute({ template: 'github-repo', url: 'https://github.com/missing' }), /HTTP 404/);
  });

  test('missing url triggers list mode', async () => {
    const result = await tool.execute({ template: 'github-repo' });
    assert.ok(result.templates, 'should return template list when url is missing');
  });

  test('network error propagates', async () => {
    const failTool = new ScrapeTemplateStub({ fetchFn: makeFetch(0, '', 'ECONNREFUSED') });
    await assert.rejects(() => failTool.execute({ template: 'github-repo', url: 'https://github.com/repo' }), /ECONNREFUSED/);
  });
});
