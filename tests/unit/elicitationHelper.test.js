/**
 * ElicitationHelper — capability gate, era guard, and the fail-open contract.
 * Run: node --test tests/unit/elicitationHelper.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { ElicitationHelper } from '../../src/core/ElicitationHelper.js';
import { requestContext } from '../../src/server/requestContext.js';

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

// ── Serving-instance resolution (the HTTP fix) ────────────────────────────────
//
// server.js builds ONE helper against the top-level template McpServer, but
// neither HTTP leg serves from it: the 2025-era path connects a clone per
// session and the modern leg builds one per request. The template is never
// connected, so reading capabilities or the negotiated version off it returned
// undefined and every HTTP session silently proceeded unasked. The transport
// now stamps the serving clone on the request context; the helper reads it
// from there and falls back to the injected instance (stdio).

const fakeServer = (request, caps, negotiated) => ({
  server: {
    request,
    getClientCapabilities: () => caps,
    getNegotiatedProtocolVersion: () => negotiated,
  },
});

describe('ElicitationHelper serving-instance resolution', () => {
  test('falls back to the injected instance when nothing is stamped (stdio)', async () => {
    let sentOn = null;
    const injected = fakeServer(async () => { sentOn = 'injected'; return { action: 'accept', content: { confirmed: true } }; },
      { elicitation: {} }, '2025-11-25');
    const h = new ElicitationHelper({ mcpServer: injected });

    assert.equal(h.supported, true);
    assert.equal(await h.confirm('proceed?'), true);
    assert.equal(sentOn, 'injected');
  });

  test('prefers the serving instance from the request context over the injected one', async () => {
    let sentOn = null;
    // The template as server.js has it over HTTP: never connected, so no
    // negotiated version and no client capabilities.
    const template = fakeServer(async () => { sentOn = 'template'; return { action: 'decline' }; }, undefined, undefined);
    const sessionClone = fakeServer(async () => { sentOn = 'clone'; return { action: 'accept', content: { confirmed: true } }; },
      { elicitation: {} }, '2025-11-25');

    const h = new ElicitationHelper({ mcpServer: template });
    assert.equal(h.supported, false, 'the template alone can never elicit — the pre-fix behaviour');

    await requestContext.run({ servingServer: sessionClone, servingEra: 'legacy' }, async () => {
      assert.equal(h.supported, true);
      assert.equal(await h.confirm('proceed?'), true);
    });
    assert.equal(sentOn, 'clone', 'the prompt went to the connected clone, not the template');
  });

  test('a 2025-era session clone declaring a bare `elicitation: {}` is supported', () => {
    const template = fakeServer(async () => ({ action: 'decline' }), undefined, undefined);
    const sessionClone = fakeServer(async () => ({ action: 'accept', content: { confirmed: true } }),
      { elicitation: {} }, '2025-11-25');
    const h = new ElicitationHelper({ mcpServer: template });

    requestContext.run({ servingServer: sessionClone, servingEra: 'legacy' }, () => {
      assert.equal(h.supported, true);
    });
  });

  test('a modern-era serving instance is unsupported and proceeds without sending', async () => {
    let called = false;
    const template = fakeServer(async () => ({ action: 'decline' }), undefined, undefined);
    const modernClone = fakeServer(async () => { called = true; return { action: 'decline' }; },
      { elicitation: { form: {} } }, '2026-07-28');
    const h = new ElicitationHelper({ mcpServer: template });

    await requestContext.run({ servingServer: modernClone, servingEra: 'modern' }, async () => {
      assert.equal(h.supported, false, 'the 2026 era has no server-to-client request channel');
      assert.equal(await h.confirm('proceed?'), true, 'fail-open: the operation proceeds unasked');
    });
    assert.equal(called, false, 'nothing was sent');
  });

  test('a serving instance that cannot send fails open rather than failing the call', async () => {
    const injected = fakeServer(async () => ({ action: 'accept', content: { confirmed: true } }), { elicitation: {} }, '2025-11-25');
    const h = new ElicitationHelper({ mcpServer: injected });

    await requestContext.run({ servingServer: { server: {} } }, async () => {
      assert.equal(h.supported, false);
      assert.equal(await h.confirm('proceed?'), true);
    });
  });
});

describe('ElicitationHelper relatedRequestId', () => {
  test('rides the in-flight request when the context knows its id', async () => {
    let opts = 'unset';
    const clone = fakeServer(async (_req, o) => { opts = o; return { action: 'accept', content: { confirmed: true } }; },
      { elicitation: {} }, '2025-11-25');
    const h = new ElicitationHelper({ mcpServer: null });

    await requestContext.run({ servingServer: clone, servingEra: 'legacy', servingRequestId: 17 }, () => h.confirm('proceed?'));
    assert.deepEqual(opts, { relatedRequestId: 17 }, 'the prompt is tied to the tools/call stream');
  });

  test('sends with no options when no id is known — stdio is byte-identical', async () => {
    let opts = 'unset';
    const injected = fakeServer(async (_req, o) => { opts = o; return { action: 'accept', content: { confirmed: true } }; },
      { elicitation: {} }, '2025-11-25');
    const h = new ElicitationHelper({ mcpServer: injected });

    await h.confirm('proceed?');
    assert.equal(opts, undefined);
  });
});
