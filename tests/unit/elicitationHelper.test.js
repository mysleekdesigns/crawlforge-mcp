/**
 * ElicitationHelper — capability gate, era guard, and the fail-open contract.
 * Run: node --test tests/unit/elicitationHelper.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { ElicitationHelper } from '../../src/core/ElicitationHelper.js';

const withClient = (request, caps = { elicitation: { form: {} } }, negotiated = '2025-11-25') =>
  new ElicitationHelper({
    mcpServer: {
      server: {
        request,
        getClientCapabilities: () => caps,
        getNegotiatedProtocolVersion: () => negotiated,
      },
    },
  });

const accept = (content) => async () => ({ action: 'accept', content });

describe('ElicitationHelper.supported', () => {
  test('false when the server cannot send requests', () => {
    assert.equal(new ElicitationHelper({ mcpServer: { server: {} } }).supported, false);
  });
  test('false when client did not advertise elicitation capability', () => {
    assert.equal(withClient(accept({}), {}).supported, false);
  });
  test('true when the client advertises elicitation.form', () => {
    assert.equal(withClient(accept({})).supported, true);
  });
  test('true for a bare `elicitation: {}` — the pre-mode 2025 meaning is form', () => {
    assert.equal(withClient(accept({}), { elicitation: {} }).supported, true);
  });
  test('false when the client advertises ONLY url elicitation', () => {
    assert.equal(withClient(accept({}), { elicitation: { url: {} } }).supported, false);
  });
  test('true when url and form are both advertised', () => {
    assert.equal(withClient(accept({}), { elicitation: { url: {}, form: {} } }).supported, true);
  });
  test('false on a 2026-07-28-era connection — no server-to-client channel exists there', () => {
    assert.equal(withClient(accept({}), { elicitation: { form: {} } }, '2026-07-28').supported, false);
  });
  test('true when the server exposes no version accessor at all', () => {
    const h = new ElicitationHelper({
      mcpServer: { server: { request: accept({}), getClientCapabilities: () => ({ elicitation: { form: {} } }) } },
    });
    assert.equal(h.supported, true);
  });
});

describe('ElicitationHelper.confirm', () => {
  test('unsupported client fails open (proceeds)', async () => {
    const h = new ElicitationHelper({ mcpServer: { server: {} } });
    assert.equal(await h.confirm('proceed?'), true);
  });
  test('accept + confirmed:true proceeds', async () => {
    assert.equal(await withClient(accept({ confirmed: true })).confirm('proceed?'), true);
  });
  test('decline cancels', async () => {
    assert.equal(await withClient(async () => ({ action: 'decline' })).confirm('proceed?'), false);
  });
  test('cancel cancels', async () => {
    assert.equal(await withClient(async () => ({ action: 'cancel' })).confirm('proceed?'), false);
  });
  test('accept but confirmed:false cancels', async () => {
    assert.equal(await withClient(accept({ confirmed: false })).confirm('proceed?'), false);
  });
  test('request throwing fails open', async () => {
    const h = withClient(async () => { throw new Error('boom'); });
    assert.equal(await h.confirm('proceed?'), true);
  });

  test('a bare-`elicitation` client is actually asked, not skipped', async () => {
    let sent = null;
    const h = withClient(async (req) => { sent = req; return { action: 'accept', content: { confirmed: true } }; }, { elicitation: {} });

    assert.equal(await h.confirm('Proceed?', { urls: 60 }), true);
    assert.equal(sent.method, 'elicitation/create');
    assert.equal(sent.params.mode, 'form');
    assert.equal(sent.params.message, 'Proceed?\n\n  urls: 60');
    assert.deepEqual(sent.params.requestedSchema.required, ['confirmed']);
  });

  test('a url-only client is never asked and proceeds', async () => {
    let called = false;
    const h = withClient(async () => { called = true; return { action: 'decline' }; }, { elicitation: { url: {} } });

    assert.equal(await h.confirm('proceed?'), true);
    assert.equal(called, false);
  });

  test('a 2026-era connection proceeds without sending anything', async () => {
    let called = false;
    const h = withClient(async () => { called = true; return { action: 'decline' }; }, { elicitation: { form: {} } }, '2026-07-28');

    assert.equal(await h.confirm('proceed?'), true);
    assert.equal(called, false);
  });
});

describe('ElicitationHelper.requestString', () => {
  test('returns provided value on accept', async () => {
    assert.equal(await withClient(accept({ value: 'hello' })).requestString('give value'), 'hello');
  });
  test('returns default on decline', async () => {
    const h = withClient(async () => ({ action: 'decline' }));
    assert.equal(await h.requestString('give value', { defaultValue: 'def' }), 'def');
  });
  test('a non-string answer is rejected, not passed through', async () => {
    const h = withClient(accept({ value: { not: 'a string' } }));
    assert.equal(await h.requestString('give value', { defaultValue: 'def' }), 'def');
  });
});
