/**
 * Unit tests: CircuitBreaker (real module, no mocks)
 * Run: node --test tests/unit/circuitBreaker.test.js
 *
 * Regression coverage for the Phase 2 fix in src/utils/CircuitBreaker.js:
 * the constructor used to assign the caller-supplied onSuccess/onFailure/
 * onStateChange callbacks directly onto `this.onSuccess`/`this.onFailure`/
 * `this.onStateChange`, shadowing the prototype methods of the same name
 * that execute()/onFailure()/transitionTo() call internally
 * (`this.onSuccess(serviceId, duration)` etc). When no callback was
 * supplied (the common case — options default to null), those calls threw
 * `TypeError: this.onSuccess is not a function`. The fix stores the
 * callbacks under distinct `*Callback` properties instead.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker, CircuitBreakerOpenError } from '../../src/utils/CircuitBreaker.js';

let activeBreakers = [];
afterEach(() => {
  for (const b of activeBreakers) b.destroy();
  activeBreakers = [];
});

function makeBreaker(options) {
  const b = new CircuitBreaker(options);
  activeBreakers.push(b);
  return b;
}

describe('CircuitBreaker.execute() — success/failure paths without callbacks', () => {
  test('a successful operation resolves without throwing TypeError', async () => {
    const breaker = makeBreaker({ threshold: 5 });
    const result = await breaker.execute('svc-a', async () => 'ok');
    assert.equal(result, 'ok');
  });

  test('a failing operation rejects with the original error, not a TypeError', async () => {
    const breaker = makeBreaker({ threshold: 5 });
    await assert.rejects(
      () => breaker.execute('svc-b', async () => { throw new Error('boom'); }),
      (err) => {
        assert.equal(err.message, 'boom');
        assert.notEqual(err.name, 'TypeError');
        return true;
      }
    );
  });

  test('metrics are recorded after both a success and a failure', async () => {
    const breaker = makeBreaker({ threshold: 5 });
    await breaker.execute('svc-c', async () => 'ok');
    await assert.rejects(() => breaker.execute('svc-c', async () => { throw new Error('fail'); }));

    const metrics = breaker.getServiceMetrics('svc-c');
    assert.equal(metrics.successes, 1);
    assert.equal(metrics.failures, 1);
  });
});

describe('CircuitBreaker.execute() — success/failure paths with callbacks supplied', () => {
  test('onSuccess/onFailure/onStateChange callbacks fire with expected args', async () => {
    const successCalls = [];
    const failureCalls = [];
    const stateChanges = [];
    const breaker = makeBreaker({
      threshold: 1,
      resetTimeout: 20,
      onSuccess: (serviceId, duration) => successCalls.push({ serviceId, duration }),
      onFailure: (serviceId, error, duration) => failureCalls.push({ serviceId, error, duration }),
      onStateChange: (serviceId, oldState, newState) => stateChanges.push({ serviceId, oldState, newState })
    });

    await breaker.execute('svc-d', async () => 'ok');
    assert.equal(successCalls.length, 1);
    assert.equal(successCalls[0].serviceId, 'svc-d');

    await assert.rejects(() => breaker.execute('svc-d', async () => { throw new Error('e1'); }));
    assert.equal(failureCalls.length, 1);
    assert.equal(failureCalls[0].error.message, 'e1');

    // threshold:1 -> the single failure above must have tripped the circuit open.
    assert.ok(stateChanges.some(s => s.newState === 'OPEN'));
  });
});

describe('CircuitBreaker — trips to OPEN after threshold failures', () => {
  test('rejects with CircuitBreakerOpenError once the failure threshold is reached', async () => {
    const breaker = makeBreaker({ threshold: 2, resetTimeout: 60000 });

    await assert.rejects(() => breaker.execute('svc-e', async () => { throw new Error('e1'); }));
    await assert.rejects(() => breaker.execute('svc-e', async () => { throw new Error('e2'); }));

    // Circuit should now be OPEN; further calls must reject immediately
    // (operation never runs) with a CircuitBreakerOpenError.
    let ran = false;
    await assert.rejects(
      () => breaker.execute('svc-e', async () => { ran = true; return 'should not run'; }),
      (err) => {
        assert.ok(err instanceof CircuitBreakerOpenError);
        assert.match(err.message, /Circuit breaker is OPEN/);
        return true;
      }
    );
    assert.equal(ran, false, 'operation must not execute while circuit is OPEN');
    assert.equal(breaker.getCircuit('svc-e').state, 'OPEN');
  });
});

describe('CircuitBreaker — half-open recovery', () => {
  test('after resetTimeout elapses, a successful call transitions HALF_OPEN -> CLOSED', async () => {
    const breaker = makeBreaker({ threshold: 1, resetTimeout: 20, halfOpenMaxCalls: 1 });

    await assert.rejects(() => breaker.execute('svc-f', async () => { throw new Error('e1'); }));
    assert.equal(breaker.getCircuit('svc-f').state, 'OPEN');

    // Wait past resetTimeout so the next execute() sees nextAttempt in the past.
    await new Promise((resolve) => setTimeout(resolve, 30));

    const result = await breaker.execute('svc-f', async () => 'recovered');
    assert.equal(result, 'recovered');
    assert.equal(breaker.getCircuit('svc-f').state, 'CLOSED', 'a successful half-open call must close the circuit');
  });

  test('a failure during HALF_OPEN immediately reopens the circuit', async () => {
    const breaker = makeBreaker({ threshold: 1, resetTimeout: 20, halfOpenMaxCalls: 2 });

    await assert.rejects(() => breaker.execute('svc-g', async () => { throw new Error('e1'); }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    await assert.rejects(() => breaker.execute('svc-g', async () => { throw new Error('still failing'); }));
    assert.equal(breaker.getCircuit('svc-g').state, 'OPEN', 'a half-open failure must reopen the circuit, not stay half-open');
  });

  test('HALF_OPEN call budget is enforced (halfOpenMaxCalls)', async () => {
    const breaker = makeBreaker({ threshold: 1, resetTimeout: 20, halfOpenMaxCalls: 1 });

    await assert.rejects(() => breaker.execute('svc-h', async () => { throw new Error('e1'); }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    // First half-open call is allowed to run (and, per this test, blocks briefly
    // so a second call arrives while still HALF_OPEN and over budget).
    const first = breaker.execute('svc-h', async () => {
      await new Promise((r) => setTimeout(r, 20));
      return 'first';
    });

    // Second call arrives immediately — halfOpenCalls is already at the cap.
    await assert.rejects(
      () => breaker.execute('svc-h', async () => 'second'),
      (err) => {
        assert.ok(err instanceof CircuitBreakerOpenError);
        assert.match(err.message, /HALF_OPEN limit exceeded/);
        return true;
      }
    );

    assert.equal(await first, 'first');
  });
});
