/**
 * R25 Phase 4 (output quality), three markdown defects:
 *
 * - browser_session `read` converted the raw DOM with no base URL, so Hacker
 *   News /newest came back with "item?id=…" links nobody could follow.
 * - Readability hands back Hacker News' rows as a <tbody> with no <table>.
 *   An HTML parser drops row and cell tags outside a table, so every story's
 *   cells ran into the next ("…39 comments2.") in scrape_with_actions on /show.
 * - batch_scrape converted the whole <main>, so Wikipedia's Web_scraping page
 *   opened with its language list and menus, and "Web scraping - Wikipedia"
 *   was prepended above the "Web scraping" H1.
 *
 * Fixtures are condensed real captures from 2026-10-19 (see their headers).
 *
 * Run: node --test --test-force-exit tests/unit/r25-phase4-b.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';

import { htmlToMarkdown, wrapOrphanRows } from '../../src/utils/htmlToMarkdown.js';
import { generateFormats } from '../../src/tools/advanced/batchScrape/worker.js';
import { BrowserSessionTool } from '../../src/tools/advanced/BrowserSessionTool.js';
import { BrowserSessionStore } from '../../src/core/browser/SessionStore.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

describe('Hacker News rows Readability left without their <table>', () => {
  const md = htmlToMarkdown(fixture('hn-show-readability.html'));

  test('each story starts its own line, with its subtext on the next', () => {
    const lines = md.split('\n');
    for (const [n, title] of [[1, 'RoadRash'], [2, 'I built a task system'], [3, 'KiviDB']]) {
      const i = lines.findIndex((line) => line.startsWith(`${n}. `));
      assert.ok(i >= 0, `story ${n} starts a line:\n${md}`);
      assert.ok(lines[i].includes(title), `story ${n}'s line carries its title`);
      assert.match(lines[i + 1], /^\d+ points by /, `story ${n}'s subtext is its own line`);
    }
    assert.doesNotMatch(md, /comments?\]\([^)]*\)\d+\./, 'no story runs into the next');
    assert.match(md, /^\[More\]\(https:\/\/news\.ycombinator\.com\/show\?p=2\)$/m);
  });

  test('a header row that lost its table still renders as a pipe table', () => {
    const out = htmlToMarkdown(
      '<div><thead><tr><th>Plan</th><th>Price</th></tr></thead>' +
      '<tbody><tr><td>Free</td><td>$0</td></tr><tr><td>Pro</td><td>$19</td></tr></tbody></div>'
    );
    assert.match(out, /\| Plan \| Price \|\n\| --- \| --- \|\n\| Free \| \$0 \|\n\| Pro \| \$19 \|/);
  });

  test('a document with no orphan rows is passed through untouched', () => {
    const html = '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>';
    assert.equal(wrapOrphanRows(html), html);
    assert.match(htmlToMarkdown(html), /\| A \| B \|\n\| --- \| --- \|\n\| 1 \| 2 \|/);
  });
});

describe('browser_session read resolves the page\'s relative links', () => {
  // Condensed from Hacker News /newest: every story, user and item link is relative.
  const PAGE = `<html><head><title>New Links | Hacker News</title></head><body><center><table id="hnmain"><tr><td>
<table><tr class="athing submission" id="50158900"><td class="title"><span class="rank">1.</span></td>
<td class="title"><span class="titleline"><a href="item?id=50158900">Ask HN: How do you test scrapers?</a></span></td></tr>
<tr><td colspan="2"></td><td class="subtext"><span class="subline"><span class="score">1 point</span> by
<a href="user?id=someone" class="hnuser">someone</a> <span class="age"><a href="item?id=50158900">1 minute ago</a></span>
| <a href="hide?id=50158900&amp;goto=newest">hide</a> | <a href="#top">top</a></span></td></tr></table>
</td></tr></table></center></body></html>`;
  const URL_ = 'https://news.ycombinator.com/newest';

  test('markdown links are absolute; in-page anchors stay as written', async () => {
    const store = new BrowserSessionStore();
    const tool = new BrowserSessionTool({
      store,
      // Only the page read is stubbed: the read gate and the extractor are not
      // what this is about, and the whole-page markdown does not use them.
      actionExecutor: { readGated: (page, options, read) => read(), browserProcessor: { releaseStealthPage: async () => {} } },
      extractContentTool: { execute: async () => ({ content: {}, title: 'New Links | Hacker News' }) },
      enableLogging: false
    });
    const session = store.create({
      ownerId: tool.ownerId(),
      page: {
        url: () => URL_,
        content: async () => PAGE,
        context: () => ({ close: async () => {} }),
        async close() {}
      },
      releasePage: async () => {},
      url: URL_
    });
    try {
      const read = await tool.execute({ operation: 'read', session_id: session.id, formats: ['markdown'] });
      const md = read.content.markdown;
      assert.match(md, /\[Ask HN: How do you test scrapers\?\]\(https:\/\/news\.ycombinator\.com\/item\?id=50158900\)/);
      assert.match(md, /\(https:\/\/news\.ycombinator\.com\/user\?id=someone\)/);
      assert.match(md, /\[top\]\(#top\)/);
      assert.doesNotMatch(md, /\]\((item|user|hide)\?/, 'no relative link survives');
    } finally {
      await store.destroy();
    }
  });
});

describe('batch_scrape markdown is the main content, under one H1', () => {
  const md = (html, url) => generateFormats(load(html), html, ['markdown'], url).markdown;

  test('Wikipedia Web_scraping: a single H1, then the article; no language list or menus', () => {
    const out = md(fixture('wikipedia/web-scraping-main.html'), 'https://en.wikipedia.org/wiki/Web_scraping');
    assert.ok(out.startsWith('# Web scraping\n'), out.slice(0, 200));
    assert.equal((out.match(/^# /gm) || []).length, 1, 'exactly one H1');
    assert.doesNotMatch(out, /Web scraping - Wikipedia/);
    for (const chrome of ['Deutsch', 'Català', '22 languages', 'Toggle the table of contents', 'View history']) {
      assert.ok(!out.includes(chrome), `"${chrome}" is page chrome, not content`);
    }
    assert.match(out, /\*\*Web scraping\*\*, \*\*web harvesting\*\*/);
    assert.match(out, /^## History$/m);
  });

  test('a <title> that is the H1 plus " - Site" is not prepended again', () => {
    const page = (title) => `<html><head><title>${title}</title></head><body><main><h1>Release notes</h1>
<p>Version 2 ships a faster parser, a smaller bundle and a new plugin API for every caller.</p></main></body></html>`;
    for (const title of ['Release notes - Acme', 'Release notes | Acme', 'Release notes — Acme']) {
      const out = md(page(title), 'https://acme.example/notes');
      assert.equal((out.match(/^# /gm) || []).length, 1, `${title}: ${out}`);
      assert.ok(out.startsWith('# Release notes\n'), out);
    }
    // A <title> that only starts with the H1's words names something else.
    const other = md(page('Release notes archive'), 'https://acme.example/notes');
    assert.ok(other.startsWith('# Release notes archive\n'), other);
  });
});
