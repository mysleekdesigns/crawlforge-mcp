/**
 * Regression lock: a stealth click on camoufox does not stack two humanizers.
 *
 * camoufox launched with `humanize` animates every page.mouse.move itself, at
 * ~1-2 s a call whatever the distance (measured 2026-09-29 on a loopback
 * page: 10 px took 950 ms, across the window 2.2 s). simulateClick drew its
 * own 11-101-point path on top, so the Ecosia "Accept all" click spent 12-20 s
 * in mouse moves and hit the action backstop. The button disappearing on
 * click was not the cause — nothing re-queries it — but the fake below
 * removes it anyway, so a re-query would hang the test.
 *
 * The fake page stands in for camoufox: a Firefox browser whose moves cost
 * MOVE_MS each. Real camoufox is too heavy for the unit suite.
 *
 * Run: node --test --test-force-exit tests/unit/humanBehaviorSimulatorClick.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { HumanBehaviorSimulator } from '../../src/utils/HumanBehaviorSimulator.js';

const MOVE_MS = 300;

function fakePage({ browserName = 'firefox', moveMs = MOVE_MS, browser = true } = {}) {
  const calls = { moves: 0, waitForSelector: [], clicks: [] };
  let removed = false;
  const page = {
    calls,
    context: () => ({
      browser: () => (browser ? { browserType: () => ({ name: () => browserName }) } : null)
    }),
    waitForSelector: async (selector, options) => {
      calls.waitForSelector.push({ selector, options });
      // The button removed itself on the first click: a re-query would never resolve.
      if (removed) return new Promise(() => {});
      return { boundingBox: async () => ({ x: 1500, y: 880, width: 190, height: 40 }) };
    },
    mouse: {
      move: async () => {
        calls.moves++;
        await new Promise(resolve => setTimeout(resolve, moveMs));
      },
      click: async (x, y, options) => {
        calls.clicks.push({ x, y, options });
        removed = true;
      }
    }
  };
  return page;
}

describe('HumanBehaviorSimulator.simulateClick', () => {
  test('a browser that humanizes the cursor gets one move, not a path', async () => {
    const simulator = new HumanBehaviorSimulator();
    const page = fakePage();

    const start = Date.now();
    await simulator.simulateClick(page, '#accept', { button: 'left', clickCount: 1 });
    const elapsed = Date.now() - start;

    assert.equal(page.calls.moves, 1);
    assert.equal(page.calls.clicks.length, 1);
    assert.equal(page.calls.waitForSelector.length, 1, 'the removed button is never re-queried');
    // One MOVE_MS move plus the hover and click delays (at most ~650 ms).
    // The path this replaced was at least 11 moves: 3.3 s here, 12-20 s live.
    assert.ok(elapsed < 1500, 'click took ' + elapsed + 'ms');
  });

  test('a browser that does not humanize still gets the drawn path', async () => {
    const simulator = new HumanBehaviorSimulator();
    const page = fakePage({ browserName: 'chromium', moveMs: 0 });

    await simulator.simulateClick(page, '#accept');

    assert.ok(page.calls.moves > 1, 'moves: ' + page.calls.moves);
    assert.equal(page.calls.clicks.length, 1);
  });

  test('a page with no browser (persistent context) is treated as not humanized', async () => {
    const simulator = new HumanBehaviorSimulator();
    const page = fakePage({ browser: false, moveMs: 0 });

    await simulator.simulateClick(page, '#accept');

    assert.ok(page.calls.moves > 1, 'moves: ' + page.calls.moves);
  });

  test('timeout bounds the element wait and is not passed to mouse.click', async () => {
    const simulator = new HumanBehaviorSimulator();
    const page = fakePage({ moveMs: 0 });

    await simulator.simulateClick(page, '#accept', { button: 'left', timeout: 4000 });

    assert.deepEqual(page.calls.waitForSelector[0].options, { timeout: 4000 });
    assert.deepEqual(page.calls.clicks[0].options, { button: 'left' });
  });
});
