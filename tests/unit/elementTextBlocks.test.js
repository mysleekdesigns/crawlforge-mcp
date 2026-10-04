/**
 * elementText reads a matched element one line per block (R24 Phase 3
 * follow-up). cheerio's .text() welded "<h2>Title</h2><p>Body</p>" into
 * "TitleBody" for scrape_structured and scrape_with_actions selectors; the
 * table path keeps one line per row, cells joined by " | ".
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { elementText } from '../../src/utils/elementText.js';

function textOf(html, selector) {
  const $ = cheerio.load(html);
  return elementText($, $(selector).get(0));
}

describe('elementText — blocks inside a matched element', () => {
  test('paragraphs and a heading are separate lines', () => {
    const html = '<div id="a"><h2>July 2023</h2><p>If you collected</p><p>the second one</p></div>';
    assert.equal(textOf(html, '#a'), 'July 2023\nIf you collected\nthe second one');
  });

  test('list items are separate lines', () => {
    const html = '<ul id="l"><li>One</li><li>Two</li><li>Three</li></ul>';
    assert.equal(textOf(html, '#l'), 'One\nTwo\nThree');
  });

  test('<br> is a line break and inline text is not welded to a following block', () => {
    const html = '<div id="b">July 2023<br>Second line<p>If you collected</p></div>';
    assert.equal(textOf(html, '#b'), 'July 2023\nSecond line\nIf you collected');
  });

  test('inline elements stay on one line and source whitespace collapses', () => {
    const html = '<p id="p">Price:\n   <strong>$10</strong> <em>today</em></p>';
    assert.equal(textOf(html, '#p'), 'Price: $10 today');
  });

  test('a cell with blocks inside stays on its row, its blocks joined by a space', () => {
    const html = '<table><tr id="r"><td><p>Alpha</p><p>Beta</p></td><td>Gamma<br>Delta</td></tr></table>';
    assert.equal(textOf(html, '#r'), 'Alpha Beta | Gamma Delta');
  });

  test('a wrapper keeps its own blocks as lines around the table rows', () => {
    const html = '<section id="w"><h3>Title</h3><p>Intro</p>'
      + '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'
      + '<ul><li>Note one</li><li>Note two</li></ul></section>';
    assert.equal(textOf(html, '#w'), 'Title\nIntro\nA | B\n1 | 2\nNote one\nNote two');
  });

  test('cell markup is never re-parsed in the wrapper path', () => {
    const html = '<div id="w"><table><tr><td>&lt;b&gt;x&lt;/b&gt;</td><td>y</td></tr></table></div>';
    assert.equal(textOf(html, '#w'), '<b>x</b> | y');
  });
});
