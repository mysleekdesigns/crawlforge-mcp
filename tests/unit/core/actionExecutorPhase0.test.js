/**
 * Unit tests: ActionExecutor Phase 0 correctness fixes
 * (ACTIONS_EMBEDDED_STATE_FIX_PLAN.md — 0.1, 0.2, 0.3 executor half, 0.5).
 * Run: node --test --test-force-exit tests/unit/core/actionExecutorPhase0.test.js
 *
 * No browser. The page-launch seam (executor.initializePage) is replaced the
 * way tests/unit/tools/advanced/scrapeWithActions.test.js replaces it, and the
 * per-action dispatch (executeActionByType) or the page's locator is faked
 * depending on what the test needs to observe.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ActionExecutor } from '../../../src/core/ActionExecutor.js';

const URL = 'https://example.com/';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makePage({ locator } = {}) {
  return {
    content: async () => '<html></html>',
    url: () => URL,
    close: async () => {},
    context: () => ({ close: async () => {} }),
    screenshot: async () => Buffer.from('png'),
    locator: locator || (() => { throw new Error('page.locator not faked for this test'); })
  };
}

async function withExecutor(fn, options = {}) {
  const executor = new ActionExecutor({
    enableLogging: false,
    enableScreenshotOnError: false,
    defaultTimeout: 500,
    actionDelay: 0,
    ...options
  });
  executor.initializePage = async () => makePage(options.page);
  // A chain retry re-navigates to the starting URL; nothing to load here.
  executor.navigateToUrl = async () => {};
  try {
    return await fn(executor);
  } finally {
    await executor.destroy().catch(() => {});
    // BrowserProcessor eagerly builds a LocalizationManager whose health-check
    // timers destroy() doesn't clear — see tests/unit/phase3-leaks.test.js.
    await executor.browserProcessor.localizationManager?.cleanup().catch(() => {});
  }
}

describe('0.1 — every attempt of a retried chain is reported', () => {
  test('retryChain:1, first run fails, second succeeds → attempt 2 with both runs in attempts[]', async () => {
    await withExecutor(async (executor) => {
      executor.delay = async () => {}; // skip the 1 s backoff between attempts
      let calls = 0;
      executor.executeActionByType = async () => {
        if (++calls === 1) throw new Error('first run fails');
        return { clicked: true };
      };

      const result = await executor.executeActionChain(URL, {
        actions: [{ type: 'click', selector: '#go', retries: 0 }],
        retryChain: 1
      });

      assert.equal(result.success, true);
      assert.equal(result.attempt, 2);
      assert.equal(result.attempts.length, 2);

      assert.equal(result.attempts[0].attempt, 1);
      assert.equal(result.attempts[0].success, false);
      assert.match(result.attempts[0].error, /first run fails/);
      assert.equal(result.attempts[0].results.length, 1, 'attempt 1 keeps its per-action results');
      assert.equal(result.attempts[0].results[0].success, false);

      assert.equal(result.attempts[1].attempt, 2);
      assert.equal(result.attempts[1].success, true);
      assert.equal(result.attempts[1].error, undefined);
      assert.deepEqual(result.attempts[1].results, result.results, 'results is the last attempt\'s');
      assert.equal(result.results[0].success, true);
    });
  });

  test('a single-attempt success reports attempt 1 and one entry', async () => {
    await withExecutor(async (executor) => {
      executor.executeActionByType = async () => ({ ok: true });

      const result = await executor.executeActionChain(URL, {
        actions: [{ type: 'click', selector: '#go' }]
      });

      assert.equal(result.success, true);
      assert.equal(result.attempt, 1);
      assert.equal(result.attempts.length, 1);
      assert.equal(result.attempts[0].success, true);
      assert.deepEqual(result.attempts[0].results, result.results);
    });
  });

  test('a chain that fails on its only attempt reports it on the failure path too', async () => {
    await withExecutor(async (executor) => {
      executor.executeActionByType = async () => { throw new Error('no such element'); };

      const result = await executor.executeActionChain(URL, {
        actions: [{ type: 'click', selector: '#go', retries: 0 }]
      });

      assert.equal(result.success, false);
      assert.equal(result.attempt, 1);
      assert.equal(result.attempts.length, 1);
      assert.equal(result.attempts[0].success, false);
      assert.match(result.attempts[0].error, /no such element/);
      assert.deepEqual(result.attempts[0].results, result.results);
    });
  });
});

describe('0.2 — chain.timeout reaches the actions', () => {
  test('applied as the default for actions without one, and as a ceiling for those with one', async () => {
    await withExecutor(async (executor) => {
      const seen = [];
      executor.executeActionByType = async (page, action) => {
        seen.push(executor.actionTimeout(action));
        return {};
      };

      const result = await executor.executeActionChain(URL, {
        timeout: 20000,
        actions: [
          { type: 'click', selector: '#none' },
          { type: 'click', selector: '#above', timeout: 50000 },
          { type: 'click', selector: '#below', timeout: 5000 }
        ]
      });

      assert.equal(result.success, true, result.error);
      assert.deepEqual(seen, [20000, 20000, 5000]);
    });
  });
});

describe('0.3 — chainConfig.screenshotOnError overrides the constructor default', () => {
  async function failingChain(executor, chain) {
    let captured = 0;
    executor.captureScreenshot = async () => { captured++; return { data: 'AAAA', format: 'png' }; };
    executor.executeActionByType = async () => { throw new Error('boom'); };
    const result = await executor.executeActionChain(URL, {
      actions: [{ type: 'click', selector: '#go', retries: 0 }],
      ...chain
    });
    assert.equal(result.success, false);
    return { captured, result };
  }

  test('screenshotOnError:false suppresses the error screenshot when the constructor default is true', async () => {
    await withExecutor(async (executor) => {
      const { captured, result } = await failingChain(executor, { screenshotOnError: false });
      assert.equal(captured, 0);
      assert.deepEqual(result.screenshots, []);
    }, { enableScreenshotOnError: true });
  });

  test('without the key the constructor default still applies', async () => {
    await withExecutor(async (executor) => {
      const { captured, result } = await failingChain(executor, {});
      assert.equal(captured, 1);
      assert.equal(result.screenshots.length, 1);
      assert.equal(result.screenshots[0].error, true);
    }, { enableScreenshotOnError: true });
  });

  test('screenshotOnError:true captures when the constructor default is false', async () => {
    await withExecutor(async (executor) => {
      const { captured } = await failingChain(executor, { screenshotOnError: true });
      assert.equal(captured, 1);
    }, { enableScreenshotOnError: false });
  });
});

describe('0.5 — error-recovery budget', () => {
  test('a wait that times out ends within its timeout + 1 s: no recovery runs', async () => {
    const waits = [];
    const locator = () => ({
      first: () => ({
        waitFor: async ({ timeout }) => {
          waits.push(timeout);
          await sleep(timeout);
          throw new Error('Timeout ' + timeout + 'ms exceeded waiting for #never-appears');
        }
      })
    });

    await withExecutor(async (executor) => {
      assert.equal(executor.errorRecoveryStrategies.has('wait'), false, 'wait registers no strategies');

      const started = Date.now();
      const result = await executor.executeActionChain(URL, {
        timeout: 1000,
        actions: [{ type: 'wait', selector: '#never-appears', timeout: 300 }]
      });
      const elapsed = Date.now() - started;

      assert.equal(result.success, false);
      assert.match(result.results[0].error, /never-appears/);
      assert.equal(result.results[0].recovered, undefined);
      assert.deepEqual(waits, [300], 'exactly one wait, no second window');
      assert.ok(elapsed < 300 + 1000, 'ended in ' + elapsed + 'ms');
    }, { page: { locator } });
  });

  test('a failing click\'s recovery never runs past ~3 s in total', async () => {
    const clicks = [];
    let scrolled = false;
    const page = makePage({
      locator: () => ({
        first: () => ({
          click: async ({ timeout }) => {
            clicks.push(timeout);
            await sleep(timeout);
            throw new Error('click timeout');
          },
          scrollIntoViewIfNeeded: async () => { scrolled = true; }
        })
      })
    });

    await withExecutor(async (executor) => {
      const started = Date.now();
      const recovery = await executor.attemptErrorRecovery(
        page, { type: 'click', selector: '#x', retries: 2 }, new Error('x'), {}
      );
      const elapsed = Date.now() - started;

      assert.equal(recovery.success, false);
      // waitAndRetry: 1 s pause, then a click with what is left of the 3 s.
      assert.equal(clicks.length, 1);
      assert.ok(clicks[0] > 1800 && clicks[0] <= 2000, 'click got the remaining budget, got ' + clicks[0]);
      assert.equal(scrolled, false, 'scrollIntoView must not start once the budget is spent');
      assert.ok(elapsed >= 2900 && elapsed < 3600, 'recovery took ' + elapsed + 'ms');
    }, { defaultTimeout: 10000 });
  });

  test('an element that matches nothing gets no recovery at all', async () => {
    let strategyRan = false;
    const page = { locator: () => ({ first: () => ({ count: async () => 0 }) }) };
    await withExecutor(async (executor) => {
      executor.errorRecoveryStrategies.set('click', [
        { name: 'a', recover: async () => { strategyRan = true; return { success: true, data: {} }; } }
      ]);
      const started = Date.now();
      const recovery = await executor.attemptErrorRecovery(
        page, { type: 'click', selector: '#missing', retries: 2 }, new Error('x'), {}
      );
      assert.equal(recovery.success, false);
      assert.equal(strategyRan, false, 'no strategy can help a missing element');
      assert.ok(Date.now() - started < 200, 'and it costs nothing');
    });
  });

  test('strategies share one deadline and recoveryTimeout hands out what is left of it', async () => {
    await withExecutor(async (executor) => {
      const deadlines = [];
      executor.errorRecoveryStrategies.set('click', [
        { name: 'a', recover: async (p, a, e, c, deadline) => { deadlines.push(deadline); throw new Error('no'); } },
        { name: 'b', recover: async (p, a, e, c, deadline) => { deadlines.push(deadline); throw new Error('no'); } }
      ]);
      const before = Date.now();
      await executor.attemptErrorRecovery({}, { type: 'click', selector: '#x', retries: 2 }, new Error('x'), {});
      assert.equal(deadlines.length, 2);
      assert.equal(deadlines[0], deadlines[1], 'one deadline for the whole recovery');
      assert.ok(deadlines[0] - before >= 3000 && deadlines[0] - before < 3100, '3 s budget');

      const now = Date.now();
      const left = executor.recoveryTimeout({}, now + 700);
      assert.ok(left > 600 && left <= 700, 'remaining budget, got ' + left);
      assert.equal(executor.recoveryTimeout({ timeout: 200 }, now + 700), 200, 'never above the action timeout');
      assert.equal(executor.recoveryTimeout({}, now - 5), 1, 'floored at 1: 0 would mean no timeout');
      assert.equal(executor.recoveryTimeout({}), 3000, 'no deadline → the whole budget');
    }, { defaultTimeout: 10000 });
  });
});
