/**
 * Regression tests for flattenBodyText in _fetchAndParse.js.
 *
 * Run: node --test tests/unit/fetchAndParse-text-structure.test.js
 *
 * Defect (2026-08-20 round-4 live retest): fetchAndParse flattened the body
 * with $('body').text().replace(/\s+/g, ' '), joining adjacent elements with
 * no separator. On a Hacker-News-style front page every rank/title/points
 * cell welded into one string ("1.Story title329 points…"), so the agent
 * tool's LLM synthesis could not name the #1 story despite fetching the page
 * successfully. flattenBodyText must keep one line per block element while
 * leaving the caller's $ tree unmodified.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { flattenBodyText } from '../../src/tools/extract/_fetchAndParse.js';

const HN_LIKE_HTML = `<html><body><table>
  <tr class="athing"><td><span class="rank">1.</span></td>
    <td><span class="titleline"><a href="https://a.example">First story title</a></span></td></tr>
  <tr><td class="subtext"><span class="score">329 points</span> by alice</td></tr>
  <tr class="athing"><td><span class="rank">2.</span></td>
    <td><span class="titleline"><a href="https://b.example">Second story title</a></span></td></tr>
  <tr><td class="subtext"><span class="score">715 points</span> by bob</td></tr>
</table></body></html>`;

test('block elements become separate lines instead of welding together', () => {
  const text = flattenBodyText(load(HN_LIKE_HTML));
  const lines = text.split('\n');

  // The old behavior produced "1.First story title329 points by alice…" on
  // one line; ranks/titles and their scores must now sit on their own rows.
  assert.match(lines[0], /^1\. First story title$/);
  assert.match(lines[1], /^329 points by alice$/);
  assert.match(lines[2], /^2\. Second story title$/);
  assert.match(lines[3], /^715 points by bob$/);
  assert.doesNotMatch(text, /title\d/); // no title welded straight into a score
});

test('table cells in one row are space-separated, not welded', () => {
  const text = flattenBodyText(load(
    '<body><table><tr><td>Cell A</td><td>Cell B</td></tr></table></body>'
  ));
  assert.equal(text, 'Cell A Cell B');
});

test('br, list items and paragraphs produce line breaks; blank runs collapse', () => {
  const text = flattenBodyText(load(
    '<body><p>Para one</p>\n\n  <p>line a<br>line b</p><ul><li>item 1</li><li>item 2</li></ul></body>'
  ));
  assert.equal(text, 'Para one\nline a\nline b\nitem 1\nitem 2');
});

test('horizontal whitespace (tabs, NBSP) collapses to single spaces within a line', () => {
  const text = flattenBodyText(load(
    '<body><p>a\t\tb&nbsp;&nbsp;c</p></body>'
  ));
  assert.equal(text, 'a b c');
});

test('the caller\'s $ tree is not mutated', () => {
  const $ = load('<body><div id="x">one</div><div id="y">two</div></body>');
  const before = $.html();
  flattenBodyText($);
  assert.equal($.html(), before);
});
