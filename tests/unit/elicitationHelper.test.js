/**
 * ElicitationHelper (v4.8 fix) — uses server.elicitInput() + client capability,
 * parses the ElicitResult `action` field, fail-open when unsupported.
 * Run: node --test tests/unit/elicitationHelper.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { ElicitationHelper } from '../../src/core/ElicitationHelper.js';

const withClient = (elicitInput, caps = { elicitation: {} }) =>
  new ElicitationHelper({ mcpServer: { server: { elicitInput, getClientCapabilities: () => caps } } });

describe('ElicitationHelper.supported', () => {
  test('false when server lacks elicitInput', () => {
    assert.equal(new ElicitationHelper({ mcpServer: { server: {} } }).supported, false);
  });
  test('false when client did not advertise elicitation capability', () => {
    const h = withClient(async () => ({ action: 'accept' }), {});
    assert.equal(h.supported, false);
  });
  test('true when method + capability present', () => {
    assert.equal(withClient(async () => ({ action: 'accept' })).supported, true);
  });
});

describe('ElicitationHelper.confirm', () => {
  test('unsupported client fails open (proceeds)', async () => {
    const h = new ElicitationHelper({ mcpServer: { server: {} } });
    assert.equal(await h.confirm('proceed?'), true);
  });
  test('accept + confirmed:true proceeds', async () => {
    const h = withClient(async () => ({ action: 'accept', content: { confirmed: true } }));
    assert.equal(await h.confirm('proceed?'), true);
  });
  test('decline cancels', async () => {
    const h = withClient(async () => ({ action: 'decline' }));
    assert.equal(await h.confirm('proceed?'), false);
  });
  test('cancel cancels', async () => {
    const h = withClient(async () => ({ action: 'cancel' }));
    assert.equal(await h.confirm('proceed?'), false);
  });
  test('accept but confirmed:false cancels', async () => {
    const h = withClient(async () => ({ action: 'accept', content: { confirmed: false } }));
    assert.equal(await h.confirm('proceed?'), false);
  });
  test('elicitInput throwing fails open', async () => {
    const h = withClient(async () => { throw new Error('boom'); });
    assert.equal(await h.confirm('proceed?'), true);
  });
});

describe('ElicitationHelper.requestString', () => {
  test('returns provided value on accept', async () => {
    const h = withClient(async () => ({ action: 'accept', content: { value: 'hello' } }));
    assert.equal(await h.requestString('give value'), 'hello');
  });
  test('returns default on decline', async () => {
    const h = withClient(async () => ({ action: 'decline' }));
    assert.equal(await h.requestString('give value', { defaultValue: 'def' }), 'def');
  });
});
