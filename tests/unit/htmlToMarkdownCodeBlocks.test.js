/**
 * Live sweep 2026-10-20, 2.2: code blocks come out as fenced blocks.
 *
 * Sphinx (docs.python.org) highlights code as a <pre> of <span>s with no
 * <code>, which Turndown escaped as prose (`\# this is...`, `spam \= 1`).
 * MDN's code-example header put a stray `js` line before each fence.
 * Fixtures are condensed from live captures of both pages.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { htmlToMarkdown, normalizeCodeBlocks } from '../../src/utils/htmlToMarkdown.js';
import { readabilityToMarkdown } from '../../src/tools/basic/extractText.js';
import { extractMainContent } from '../../src/tools/scrape/_mainContent.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const PYTHON = readFileSync(path.join(fixtures, 'python-docs-introduction.html'), 'utf8');
const MDN = readFileSync(path.join(fixtures, 'mdn-array-map.html'), 'utf8');
const PYTHON_URL = 'https://docs.python.org/3/tutorial/introduction.html';
const MDN_URL = 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map';

function assertPythonFenced(md) {
  assert.ok(
    md.includes('```python3\n# this is the first comment\nspam = 1  # and this is the second comment\n'),
    `expected a python3 fence, got:\n${md}`
  );
  assert.ok(md.includes('```python3\n>>> 2 + 2\n4\n>>> 50 - 5*6\n20\n'), md);
  // Prose keeps Markdown escaping (`[\>>>](...)` in a link is correct); the
  // escaped code lines must not appear anywhere.
  assert.doesNotMatch(md, /\\# this is|spam \\=|^\\>>>/m);
}

function assertMdnFenced(md) {
  assert.ok(md.includes('```js\nmap(callbackFn)\nmap(callbackFn, thisArg)\n```'), `got:\n${md}`);
  assert.ok(md.includes('```js\nconst numbers = [1, 4, 9];\nconst roots = numbers.map((num) => Math.sqrt(num));'), md);
  assert.ok(md.includes('```js\nconst array = [1, 4, 9, 16];'), md);
  assert.ok(!md.split('\n').some(line => line.trim() === 'js'), `stray js label line in:\n${md}`);
}

test('docs.python.org: htmlToMarkdown fences Sphinx highlight blocks with the language', () => {
  assertPythonFenced(htmlToMarkdown(PYTHON));
});

test('docs.python.org: extract_text markdown (Readability path) keeps fences and language', () => {
  assertPythonFenced(readabilityToMarkdown(PYTHON, PYTHON_URL));
});

test('MDN: htmlToMarkdown drops the language-label header and fences with js', () => {
  assertMdnFenced(htmlToMarkdown(MDN));
});

test('MDN: extract_text markdown (Readability path) drops the label and fences with js', () => {
  assertMdnFenced(readabilityToMarkdown(MDN, MDN_URL));
});

test('a <pre> without <code> is fenced, not escaped, even after its classes are gone', () => {
  const md = htmlToMarkdown('<p>x</p><pre><span>a = 1</span> <span># b</span>\n<span>*c*</span></pre>');
  assert.equal(md, 'x\n\n```\na = 1 # b\n*c*\n```');
});

test('backticks in the code lengthen the fence; <br> becomes a newline', () => {
  const md = htmlToMarkdown('<pre><code class="language-md">```js<br>x</code></pre>');
  assert.equal(md, '````md\n```js\nx\n````');
});

test('normalizeCodeBlocks leaves HTML without <pre> untouched', () => {
  const html = '<p>no code here</p>';
  assert.equal(normalizeCodeBlocks(html), html);
});

test('main-content path (scrape, batch_scrape, crawl_deep) keeps the language and drops the MDN label', () => {
  assertMdnFenced(htmlToMarkdown(extractMainContent(MDN, MDN_URL).html));
  assertPythonFenced(htmlToMarkdown(extractMainContent(PYTHON, PYTHON_URL).html));
});
