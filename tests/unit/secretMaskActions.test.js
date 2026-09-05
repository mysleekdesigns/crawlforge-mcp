/**
 * Phase 0.5 — typed action text never leaves the process in clear
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= CACHE_ENABLE_DISK=false node --test tests/unit/secretMaskActions.test.js
 *
 * The leading `CRAWLFORGE_CREATOR_SECRET=` unsets the secret loaded from .env
 * so creator mode stays OFF; in creator mode reportUsage is a no-op and the
 * end-to-end test below would prove nothing.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { maskSecrets } from '../../src/utils/secretMask.js';

const MASK = '[REDACTED]';

describe('maskSecrets typed action text', () => {
  const input = {
    url: 'https://example.com/login',
    actions: [
      { type: 'type', selector: '#password', text: 'hunter2' },
      { type: 'fill', selector: '#email', value: 'alice@example.com' },
      { type: 'press', key: 'Enter' },
      { type: 'click', selector: '#go' },
      { type: 'wait', ms: 500 }
    ]
  };

  test('type/fill text and value are gone; selectors, keys and other actions untouched', () => {
    const result = maskSecrets(input);
    const json = JSON.stringify(result);
    assert.ok(!json.includes('hunter2'), 'typed password should be redacted');
    assert.ok(!json.includes('alice@example.com'), 'filled value should be redacted');
    assert.equal(result.url, 'https://example.com/login');
    assert.deepEqual(result.actions[0], { type: 'type', selector: '#password', text: MASK });
    assert.deepEqual(result.actions[1], { type: 'fill', selector: '#email', value: MASK });
    assert.deepEqual(result.actions[2], { type: 'press', key: 'Enter' });
    assert.deepEqual(result.actions[3], { type: 'click', selector: '#go' });
    assert.deepEqual(result.actions[4], { type: 'wait', ms: 500 });
  });

  test('does not mutate input', () => {
    maskSecrets(input);
    assert.equal(input.actions[0].text, 'hunter2');
    assert.equal(input.actions[1].value, 'alice@example.com');
  });

  test('action type match is case-insensitive', () => {
    const result = maskSecrets({ actions: [{ type: 'Type', selector: '#p', text: 'hunter2' }] });
    assert.equal(result.actions[0].text, MASK);
  });

  test('a wait action keeps its text (it is a wait-for-text condition, not typed input)', () => {
    const result = maskSecrets({ actions: [{ type: 'wait', text: 'Welcome back' }] });
    assert.equal(result.actions[0].text, 'Welcome back');
  });

  test('actions arrays are masked anywhere in the tree', () => {
    const result = maskSecrets({ params: { actions: [{ type: 'type', selector: '#p', text: 'hunter2' }] } });
    assert.equal(result.params.actions[0].text, MASK);
  });

  test('login and credentials objects are masked whole', () => {
    const result = maskSecrets({
      login: { user: 'alice', pass: 'hunter2' },
      credentials: { username: 'alice', password: 'hunter2' }
    });
    assert.equal(result.login, MASK);
    assert.equal(result.credentials, MASK);
  });

  test('formAutoFill is masked whole in both shapes', () => {
    const structured = maskSecrets({ formAutoFill: { fields: [{ selector: '#password', value: 'hunter2' }] } });
    const flat = maskSecrets({ formAutoFill: { '#password': 'hunter2' } });
    assert.equal(structured.formAutoFill, MASK);
    assert.equal(flat.formAutoFill, MASK);
  });
});

// ─── end-to-end: the reportUsage payload ─────────────────────────────────────

describe('reportUsage payload', () => {
  test('a password typed into a form never appears in the usage report body', async (t) => {
    const mod = await import('../../src/core/AuthManager.js');
    const authManager = mod.default;
    if (authManager.isCreatorMode()) {
      t.skip('Creator mode is active — run with CRAWLFORGE_CREATOR_SECRET= to disable');
      return;
    }

    // Point config + pending-usage at a temp dir so a failed report never touches ~/.crawlforge.
    const tempHome = path.join(os.tmpdir(), `crawlforge-mask-test-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempHome, { recursive: true });
    authManager.configPath = path.join(tempHome, '.crawlforge', 'config.json');
    authManager.pendingUsagePath = path.join(tempHome, '.crawlforge', 'pending-usage.json');
    authManager.config = { apiKey: 'test-api-key', userId: 'mask-test-user', email: 'test@example.com' };

    const originalFetch = globalThis.fetch;
    let body = '';
    globalThis.fetch = async (url, init) => {
      body = String(init?.body ?? '');
      return { ok: true, status: 200 };
    };

    try {
      await authManager.reportUsage('scrape_with_actions', 5, {
        url: 'https://example.com/login',
        actions: [{ type: 'type', selector: '#password', text: 'hunter2' }]
      });
    } finally {
      globalThis.fetch = originalFetch;
      await fs.rm(tempHome, { recursive: true, force: true });
    }

    assert.ok(body.length > 0, 'a usage report should have been sent');
    assert.ok(!body.includes('hunter2'), 'typed password must not reach the backend');
    assert.ok(body.includes('#password'), 'the selector is still reported');
    assert.ok(body.includes('"tool":"scrape_with_actions"'));
  });
});
