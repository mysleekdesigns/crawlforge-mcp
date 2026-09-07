/**
 * ElicitationHelper — the multi-round-trip confirmation contract (Phase 4.4).
 *
 * `confirm()` no longer sends anything and no longer awaits. It reads any answer
 * off the SDK's per-request context and otherwise hands back an `input_required`
 * result for the tool to RETURN. What is pinned here is the behaviour that is
 * easy to lose: the capability gate (dropping it turns a nicety into a failed
 * call), asking at most once, and reading capabilities from the 2026-era
 * envelope where there is no connected server instance to ask.
 *
 * Run: node --test tests/unit/elicitationHelper.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { isInputRequiredResult, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';
import { ElicitationHelper } from '../../src/core/ElicitationHelper.js';
import { requestContext } from '../../src/server/requestContext.js';

const FORM = { elicitation: { form: {} } };

/** A helper whose (2025-era) serving instance declares `caps`. */
const withCaps = (caps = FORM, request = async () => ({ action: 'accept', content: { confirmed: true } }), negotiated = '2025-11-25') =>
  new ElicitationHelper({
    mcpServer: {
      server: { request, getClientCapabilities: () => caps, getNegotiatedProtocolVersion: () => negotiated },
    },
  });

/** The ctx a 2026-era request arrives with: capabilities in the _meta envelope. */
const modernCtx = (caps = FORM, inputResponses) => ({
  mcpReq: { envelope: { [CLIENT_CAPABILITIES_META_KEY]: caps }, ...(inputResponses ? { inputResponses } : {}) },
});

/** The ctx of a retry carrying an answer for `key`. */
const answeredCtx = (key, response, caps = FORM) => ({
  mcpReq: { envelope: { [CLIENT_CAPABILITIES_META_KEY]: caps }, inputResponses: { [key]: response } },
});

describe('ElicitationHelper.supported', () => {
  test('false when the client declared no elicitation capability', () => {
    assert.equal(withCaps({}).supported(), false);
  });
  test('true when the client advertises elicitation.form', () => {
    assert.equal(withCaps(FORM).supported(), true);
  });
  test('true for a bare `elicitation: {}` — the pre-mode 2025 meaning is form', () => {
    assert.equal(withCaps({ elicitation: {} }).supported(), true);
  });
  test('false when the client advertises ONLY url elicitation', () => {
    assert.equal(withCaps({ elicitation: { url: {} } }).supported(), false);
  });
  test('true when url and form are both advertised', () => {
    assert.equal(withCaps({ elicitation: { url: {}, form: {} } }).supported(), true);
  });
  test('false when there is no server and no ctx to read capabilities from', () => {
    assert.equal(new ElicitationHelper({ mcpServer: null }).supported(), false);
  });

  // The 2026-07-28 regression this phase exists to fix. The old helper reported
  // `supported === false` for every modern connection and skipped every prompt.
  test('reads capabilities from the 2026-era _meta envelope, with no connected instance', () => {
    const h = new ElicitationHelper({ mcpServer: null });
    assert.equal(h.supported(modernCtx(FORM)), true);
    assert.equal(h.supported(modernCtx({})), false);
  });
  test('the envelope wins over the serving instance when both are present', () => {
    assert.equal(withCaps({}).supported(modernCtx(FORM)), true);
  });
});

describe('ElicitationHelper.confirm — asking', () => {
  test('an unaskable client proceeds rather than failing the call', () => {
    const gate = withCaps({}).confirm(undefined, 'k', 'proceed?');
    assert.deepEqual(gate, { status: 'proceed' });
  });

  test('a url-only client is never asked and proceeds', () => {
    assert.equal(withCaps({ elicitation: { url: {} } }).confirm(undefined, 'k', 'proceed?').status, 'proceed');
  });

  test('an askable client gets an input_required result keyed by the gate key', () => {
    const gate = withCaps(FORM).confirm(undefined, 'crawl_deep:large', 'Proceed?', { urls: 60 });

    assert.equal(gate.status, 'ask');
    assert.ok(isInputRequiredResult(gate.result), 'the SDK must recognise what we hand back');
    const req = gate.result.inputRequests['crawl_deep:large'];
    assert.equal(req.method, 'elicitation/create');
    assert.equal(req.params.mode, 'form');
    assert.equal(req.params.message, 'Proceed?\n\n  urls: 60', 'details render under the message');
    assert.deepEqual(req.params.requestedSchema.required, ['confirmed']);
  });

  test('a message with no details carries no blank detail block', () => {
    const gate = withCaps(FORM).confirm(undefined, 'k', 'Proceed?');
    assert.equal(gate.result.inputRequests.k.params.message, 'Proceed?');
  });

  test('a 2026-era request is asked — the era guard that skipped it is gone', () => {
    const h = new ElicitationHelper({ mcpServer: null });
    assert.equal(h.confirm(modernCtx(FORM), 'k', 'Proceed?').status, 'ask');
  });
});

describe('ElicitationHelper.confirm — reading the answer back', () => {
  test('accept + confirmed:true proceeds', () => {
    const ctx = answeredCtx('k', { action: 'accept', content: { confirmed: true } });
    assert.deepEqual(withCaps(FORM).confirm(ctx, 'k', 'proceed?'), { status: 'proceed' });
  });
  test('decline cancels', () => {
    const ctx = answeredCtx('k', { action: 'decline' });
    assert.deepEqual(withCaps(FORM).confirm(ctx, 'k', 'proceed?'), { status: 'cancelled' });
  });
  test('cancel cancels', () => {
    const ctx = answeredCtx('k', { action: 'cancel' });
    assert.deepEqual(withCaps(FORM).confirm(ctx, 'k', 'proceed?'), { status: 'cancelled' });
  });
  test('accept but confirmed:false cancels', () => {
    const ctx = answeredCtx('k', { action: 'accept', content: { confirmed: false } });
    assert.deepEqual(withCaps(FORM).confirm(ctx, 'k', 'proceed?'), { status: 'cancelled' });
  });
  test('accept with no content cancels — silence is not consent', () => {
    const ctx = answeredCtx('k', { action: 'accept' });
    assert.deepEqual(withCaps(FORM).confirm(ctx, 'k', 'proceed?'), { status: 'cancelled' });
  });

  test('a retry whose answer did not survive proceeds instead of asking again', () => {
    // `inputResponses` is present (so we already asked) but carries nothing for
    // this key — a dropped entry, or a response of another kind. Re-asking would
    // burn the shim's rounds and end in a failed call.
    const ctx = { mcpReq: { envelope: { [CLIENT_CAPABILITIES_META_KEY]: FORM }, inputResponses: { other: { action: 'accept' } } } };
    assert.deepEqual(withCaps(FORM).confirm(ctx, 'k', 'proceed?'), { status: 'proceed' });
  });

  test('answers are read per key, so two gates in one tool do not cross', () => {
    const ctx = answeredCtx('a', { action: 'decline' });
    assert.equal(withCaps(FORM).confirm(ctx, 'a', 'x').status, 'cancelled');
    assert.equal(withCaps(FORM).confirm(ctx, 'b', 'x').status, 'proceed', 'b was already asked in this round');
  });
});

// ── Serving-instance resolution (the 2025-era HTTP fix) ───────────────────────
//
// server.js builds ONE helper against the top-level template McpServer, but
// neither HTTP leg serves from it: the 2025-era path connects a clone per
// session. The template is never connected, so reading capabilities off it
// returned undefined and every HTTP session silently proceeded unasked.

describe('ElicitationHelper serving-instance resolution', () => {
  const fake = (caps) => ({ server: { request: async () => ({}), getClientCapabilities: () => caps, getNegotiatedProtocolVersion: () => '2025-11-25' } });

  test('falls back to the injected instance when nothing is stamped (stdio)', () => {
    assert.equal(new ElicitationHelper({ mcpServer: fake({ elicitation: {} }) }).supported(), true);
  });

  test('prefers the stamped serving clone over the injected template', () => {
    const h = new ElicitationHelper({ mcpServer: fake(undefined) });
    assert.equal(h.supported(), false, 'the unconnected template alone can never elicit');

    requestContext.run({ servingServer: fake({ elicitation: {} }), servingEra: 'legacy' }, () => {
      assert.equal(h.supported(), true);
      assert.equal(h.confirm(undefined, 'k', 'proceed?').status, 'ask');
    });
  });

  test('a serving instance with no capability accessor fails open', () => {
    const h = new ElicitationHelper({ mcpServer: fake({ elicitation: {} }) });
    requestContext.run({ servingServer: { server: {} } }, () => {
      assert.equal(h.supported(), false);
      assert.equal(h.confirm(undefined, 'k', 'proceed?').status, 'proceed');
    });
  });
});

// ── requestString: still the 2025-era inline form, still called by nothing ────
describe('ElicitationHelper.requestString', () => {
  test('returns provided value on accept', async () => {
    assert.equal(await withCaps(FORM, async () => ({ action: 'accept', content: { value: 'hello' } })).requestString('give value'), 'hello');
  });
  test('returns default on decline', async () => {
    const h = withCaps(FORM, async () => ({ action: 'decline' }));
    assert.equal(await h.requestString('give value', { defaultValue: 'def' }), 'def');
  });
  test('a non-string answer is rejected, not passed through', async () => {
    const h = withCaps(FORM, async () => ({ action: 'accept', content: { value: { not: 'a string' } } }));
    assert.equal(await h.requestString('give value', { defaultValue: 'def' }), 'def');
  });
  test('an unaskable client returns the default without sending', async () => {
    let called = false;
    const h = withCaps({}, async () => { called = true; return { action: 'accept', content: { value: 'x' } }; });
    assert.equal(await h.requestString('give value', { defaultValue: 'def' }), 'def');
    assert.equal(called, false);
  });
  test('a 2026-era connection returns the default — there is no inline channel there', async () => {
    let called = false;
    const h = withCaps(FORM, async () => { called = true; return { action: 'accept', content: { value: 'x' } }; }, '2026-07-28');
    assert.equal(await h.requestString('give value', { defaultValue: 'def' }), 'def');
    assert.equal(called, false);
  });
  test('a throwing request returns the default rather than failing', async () => {
    const h = withCaps(FORM, async () => { throw new Error('boom'); });
    assert.equal(await h.requestString('give value', { defaultValue: 'def' }), 'def');
  });
});
