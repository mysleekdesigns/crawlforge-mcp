/**
 * map_site scope and search relevance (R21, 2026-09-09).
 *
 * map_site("https://www.nps.gov/yell/", search:"fees", max_urls:200) returned
 * 200 alphabetical URLs of the site-wide sitemap — all Abraham Lincoln
 * Birthplace pages — and ranked every one of them 0.19. The seed's path is a
 * scope, and the search's terms must count against the URL itself.
 *
 * Run: node --test tests/unit/mapSiteScope.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scopePathOf, searchScore } from '../../src/tools/crawl/mapSite.js';

describe('scopePathOf', () => {
  test('a directory seed scopes to itself, a page seed to its directory', () => {
    assert.equal(scopePathOf('https://www.nps.gov/yell/'), '/yell/');
    assert.equal(scopePathOf('https://www.nps.gov/yell/planyourvisit/fees.htm'), '/yell/planyourvisit/');
    assert.equal(scopePathOf('https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/'), '/courses/6-006-introduction-to-algorithms-spring-2020/');
  });

  test('the site root scopes to nothing', () => {
    assert.equal(scopePathOf('https://www.eff.org/'), null);
    assert.equal(scopePathOf('https://www.eff.org'), null);
    assert.equal(scopePathOf('not a url'), null);
  });
});

describe('searchScore', () => {
  test('counts the search terms the URL path carries', () => {
    assert.equal(searchScore('https://www.nps.gov/yell/planyourvisit/fees.htm', 'fees'), 1);
    assert.equal(searchScore('https://www.nps.gov/yell/planyourvisit/fees.htm', 'entrance fees passes'), 1);
    assert.equal(searchScore('https://www.nps.gov/yell/planyourvisit/fees-passes.htm', 'entrance fees passes'), 2);
    assert.equal(searchScore('https://www.nps.gov/abli/citizen-science.htm', 'fees'), 0);
  });

  test('decodes the path and ignores case', () => {
    assert.equal(searchScore('https://ocw.mit.edu/search/?q=Algorithms%20Intro', 'algorithms'), 1);
    assert.equal(searchScore('https://example.com/A/B', ''), 0);
  });
});
