/**
 * Regression tests for Phase 0.1/0.2 — one outbound identity.
 *
 * Run: node --test tests/unit/fetchIdentityCoverage.test.js
 *
 * Nine tools used to hardcode nine different User-Agents, and a site that
 * serves different markup to different clients then served each tool a
 * different page: a Zillow listing returned 41 `address` elements to
 * scrape_structured and 9 to track_changes purely because their UAs differed.
 * The fix is `src/utils/fetchIdentity.js` everywhere, so the two tests below
 * are (a) a static scan that no file reintroduces a UA literal, and (b) a live
 * check that the paths which disagreed now send the same bytes.
 *
 * The allowlist stays short on purpose. An allowlist that grows silently is
 * how this regression comes back — a new entry means a new outbound identity,
 * so add one only for a genuine browser-emulation path and say why.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CRAWLFORGE_USER_AGENT } from '../../src/utils/fetchIdentity.js';
import { _resetRobotsGate } from '../../src/utils/robotsGate.js';
import { _resetHostRateLimiter } from '../../src/utils/hostRateLimiter.js';
import { fetchWithTimeout } from '../../src/tools/basic/_fetch.js';
import { fetchContent } from '../../src/tools/tracking/trackChanges/differ.js';
import { ScrapeTemplateTool } from '../../src/tools/templates/ScrapeTemplateTool.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ── static scan ─────────────────────────────────────────────────────────────

/**
 * Files allowed to contain a User-Agent literal. These emulate a real browser
 * on purpose — that is the feature, not an identity leak:
 *   StealthBrowserManager — the fingerprint pools stealth_mode picks from.
 *   LocalizationManager   — generateUserAgent's per-country browser UA table.
 *
 * Three files people expect to see here need no entry and must not get one,
 * because none of them spells out a UA: ActionExecutor.js passes through
 * `browserOptions.userAgent`, cli/commands/localize.js calls
 * `mgr.generateUserAgent(...)`, and fetchIdentity.js builds the canonical
 * identity from the package version. A literal appearing in any of them is a
 * real regression. The second test fails on any entry that has stopped being
 * necessary, which is what keeps this list from growing silently.
 */
const ALLOWED = new Set([
  'src/core/StealthBrowserManager.js',
  'src/core/LocalizationManager.js',
]);

const PATTERNS = [
  // A string literal assigned to the header: 'User-Agent': 'Something/1.0'
  /['"]User-Agent['"]\s*:\s*['"`]/g,
  // A string literal assigned to an identity: userAgent = 'Something/1.0'
  // (the negative lookahead skips an empty default, e.g. `userAgent = ''`)
  /\buserAgent\s*[:=]\s*(['"`])(?!\1)/g,
  // A browser UA literal anywhere, whatever it is assigned to.
  /['"`][^'"`\n]*Mozilla\/[^'"`\n]*['"`]/g,
];

/**
 * True when the match sits inside an enclosing string literal rather than in
 * code — generateLLMsTxt emits `headers={"User-Agent": "MyBot/1.0"}` as advice
 * text in the llms.txt it writes, which is prose about someone else's crawler.
 * An odd number of quotes before it on the line means we are inside one.
 */
function insideStringLiteral(line, column) {
  const before = line.slice(0, column);
  const singles = (before.match(/'/g) || []).length;
  const doubles = (before.match(/"/g) || []).length;
  return singles % 2 === 1 || doubles % 2 === 1;
}

function jsFiles(dir) {
  return fs
    .readdirSync(path.join(ROOT, dir), { recursive: true })
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(dir, f));
}

function uaLiterals(relPath) {
  const lines = fs.readFileSync(path.join(ROOT, relPath), 'utf8').split('\n');
  const found = [];
  lines.forEach((line, i) => {
    for (const pattern of PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(line)) !== null) {
        if (!insideStringLiteral(line, match.index)) {
          found.push(`${relPath}:${i + 1}  ${line.trim()}`);
        }
      }
    }
  });
  return found;
}

describe('fetchIdentity coverage', () => {
  test('no hardcoded User-Agent literals outside the browser paths', () => {
    const offenders = jsFiles('src')
      .filter((f) => !ALLOWED.has(f))
      .flatMap(uaLiterals);

    assert.deepEqual(
      offenders,
      [],
      'Hardcoded User-Agent literals found. Use identityHeaders() / resolveUserAgent() ' +
        `from src/utils/fetchIdentity.js instead:\n  ${offenders.join('\n  ')}`
    );
  });

  test('every allowlist entry is still needed', () => {
    for (const rel of ALLOWED) {
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `allowlisted file is gone: ${rel}`);
      assert.ok(
        uaLiterals(rel).length > 0,
        `${rel} no longer contains a User-Agent literal — drop it from ALLOWED rather ` +
          'than leaving a standing exemption for a file that does not need one.'
      );
    }
  });
});

// ── the 0.2 regression: one page, one identity ──────────────────────────────

describe('every fetching path sends the same identity', () => {
  let originalFetch;
  let seen;

  beforeEach(() => {
    seen = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      seen.push({ url: String(url), headers: options.headers || {} });
      if (String(url).endsWith('/robots.txt')) {
        return new Response('', { status: 200, headers: { 'content-type': 'text/plain' } });
      }
      return new Response('<html><body><h1>hi</h1></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    };
    _resetRobotsGate();
    _resetHostRateLimiter();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetRobotsGate();
    _resetHostRateLimiter();
  });

  /** The UA sent for the page itself, ignoring the robots.txt lookup. */
  function pageUserAgent() {
    const page = seen.find((r) => !r.url.endsWith('/robots.txt'));
    assert.ok(page, `no page request was made (saw: ${seen.map((r) => r.url).join(', ')})`);
    return page.headers['User-Agent'];
  }

  test('the basic fetch path sends the canonical identity', async () => {
    await fetchWithTimeout('https://basic.example.com/page');
    assert.equal(pageUserAgent(), CRAWLFORGE_USER_AGENT);
  });

  test('track_changes sends the canonical identity', async () => {
    await fetchContent('https://tracker.example.com/page');
    assert.equal(pageUserAgent(), CRAWLFORGE_USER_AGENT);
  });

  test('scrape_template sends the canonical identity', async () => {
    const tool = new ScrapeTemplateTool();
    const template = tool.registry.list()[0].id;
    // The extractor may reject this stub markup; the request is what matters.
    await tool.execute({ template, url: 'https://template.example.com/page' }).catch(() => {});
    assert.equal(pageUserAgent(), CRAWLFORGE_USER_AGENT);
  });

  test('a per-request userAgent override wins over the canonical identity', async () => {
    await fetchContent('https://tracker.example.com/page', { userAgent: 'AcmeBot/2.0 (+https://acme.test)' });
    assert.equal(pageUserAgent(), 'AcmeBot/2.0 (+https://acme.test)');
  });
});
