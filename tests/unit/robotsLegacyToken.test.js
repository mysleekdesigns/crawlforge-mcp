/**
 * Unifying the crawler identity on the `CrawlForge` product token silently
 * un-blocked every site owner who had already written `User-agent:
 * CrawlForge-Bot` into their robots.txt. G7 says a block we were given is a
 * block we keep, so both tokens are consulted and a disallow from either wins.
 *
 * These tests hold that behaviour, and — as importantly — hold the line that it
 * does not over-block: a file naming some unrelated bot must still allow us.
 *
 * Same SSRF setup as robotsGate.test.js: the checker blocks loopback by
 * default, so ALLOWED_DOMAINS is set before the first transitive import.
 *
 * Run: node --test tests/unit/robotsLegacyToken.test.js --test-force-exit
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { RobotsChecker } = await import('../../src/utils/robotsChecker.js');
const { CRAWLFORGE_USER_AGENT } = await import('../../src/utils/fetchIdentity.js');

const servers = [];

/** Serve one robots.txt body; every other path is a 200. */
async function hostServing(robotsBody) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(req.url === '/robots.txt' ? robotsBody : 'ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

after(() => servers.forEach((s) => s.close()));

describe('robots.txt — the retired CrawlForge-Bot token still blocks', () => {
  test('a disallow addressed to CrawlForge-Bot is honoured', async () => {
    const base = await hostServing('User-agent: CrawlForge-Bot\nDisallow: /private\n');
    const checker = new RobotsChecker(CRAWLFORGE_USER_AGENT);

    assert.equal(await checker.canFetch(`${base}/private/x`), false,
      'a rule written against the old token must still block us');
    assert.equal(await checker.canFetch(`${base}/public/x`), true,
      'and must not block anything it did not name');
  });

  test('a disallow addressed to the current token is honoured', async () => {
    const base = await hostServing('User-agent: CrawlForge\nDisallow: /private\n');
    const checker = new RobotsChecker(CRAWLFORGE_USER_AGENT);
    assert.equal(await checker.canFetch(`${base}/private/x`), false);
    assert.equal(await checker.canFetch(`${base}/public/x`), true);
  });

  test('a wildcard disallow is honoured', async () => {
    const base = await hostServing('User-agent: *\nDisallow: /private\n');
    const checker = new RobotsChecker(CRAWLFORGE_USER_AGENT);
    assert.equal(await checker.canFetch(`${base}/private/x`), false);
  });

  test('a rule aimed at an unrelated bot does not block us', async () => {
    const base = await hostServing('User-agent: SomeOtherBot\nDisallow: /private\n');
    const checker = new RobotsChecker(CRAWLFORGE_USER_AGENT);
    assert.equal(await checker.canFetch(`${base}/private/x`), true,
      'consulting a second token must not turn into blanket over-blocking');
  });
});
