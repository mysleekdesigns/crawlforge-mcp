/**
 * Unit tests: scrape_with_actions formAutoFill honours each field's `type`.
 * Run: node --test --test-force-exit tests/unit/tools/advanced/formAutoFillFieldTypes.test.js
 *
 * R24 (2026-10-03): every field was typed into as text whatever its `type`.
 * Typing into a radio, a checkbox or a <select> throws nothing and changes
 * nothing, so httpbin's form was posted without them and the result said
 * failedActions: 0. Whether a control ends up checked is only answerable by a
 * real DOM, so the form cases run in real Chromium against a local fixture that
 * echoes the POST, and skip when the browser binary is missing — the same shape
 * as tests/unit/core/actionExecutorRefs.test.js.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { ScrapeWithActionsTool } = await import('../../../../src/tools/advanced/ScrapeWithActionsTool.js');
const { ActionExecutor } = await import('../../../../src/core/ActionExecutor.js');

let browser = null;
try {
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
} catch {
  browser = null; // no browser binary available — the real-form suite skips
}

// The controls of httpbin.org/forms/post, plus a <select> and a pre-checked box.
const FORM = `<html><head><title>Order</title></head><body>
<form method="post" action="/echo">
  <input name="custname">
  <input type="radio" name="size" value="small">
  <input type="radio" name="size" value="medium">
  <input type="radio" name="size" value="large">
  <input type="checkbox" name="topping" value="bacon">
  <input type="checkbox" name="topping" value="cheese">
  <input type="checkbox" name="topping" value="onion">
  <input type="checkbox" id="gift" name="gift" value="yes" checked>
  <select name="delivery"><option value="">--</option><option value="1130">11:30</option><option value="1200">12:00</option></select>
  <input type="file" name="receipt">
  <button>Submit order</button>
</form></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/robots.txt') {
    res.setHeader('content-type', 'text/plain');
    res.end('User-agent: *\nAllow: /\n');
    return;
  }
  res.setHeader('content-type', 'text/html');
  if (req.url !== '/echo') {
    res.end(FORM);
    return;
  }
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => res.end(`<html><head><title>Echo</title></head><body><p id="echo">${body}</p></body></html>`));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

const executor = new ActionExecutor({ enableLogging: false, enableScreenshotOnError: false });
if (browser) {
  // The only seam replaced: where a page comes from.
  executor.browserProcessor.initializePage = async () => browser.newPage();
}
const tool = new ScrapeWithActionsTool({ actionExecutor: executor, enableLogging: false });

after(async () => {
  if (browser) await browser.close();
  server.close();
  await executor.destroy().catch(() => {});
  await executor.browserProcessor.localizationManager?.cleanup().catch(() => {});
});

function submit(fields) {
  return tool.execute({
    url: `${BASE}/form`,
    actions: [{ type: 'wait', duration: 10 }],
    formats: ['text'],
    captureScreenshots: false,
    screenshotOnError: false,
    browserOptions: { timeout: 10000 },
    formAutoFill: { fields, submitSelector: 'form button', waitAfterSubmit: 200 }
  });
}

describe('formAutoFill builds the action each field type needs', () => {
  test('text types, select selects, checkbox and radio check, anything else is handed to check to refuse', () => {
    const chain = tool.insertFormAutoFillActions([{ type: 'wait', duration: 10 }], {
      fields: [
        { selector: '#a', value: 'x', type: 'text', waitAfter: 0 },
        { selector: '#b', value: 'y', type: 'select', waitAfter: 0 },
        { selector: '#c', value: 'true', type: 'checkbox', waitAfter: 0 },
        { selector: '#d', value: 'z', type: 'radio', waitAfter: 0 },
        { selector: '#e', value: '/etc/hosts', type: 'file', waitAfter: 0 }
      ]
    });
    assert.deepEqual(
      chain.slice(0, 5).map(({ type, selector, text, value, fieldType }) => ({ type, selector, text, value, fieldType })),
      [
        { type: 'type', selector: '#a', text: 'x', value: undefined, fieldType: undefined },
        { type: 'select', selector: '#b', text: undefined, value: 'y', fieldType: undefined },
        { type: 'check', selector: '#c', text: undefined, value: 'true', fieldType: 'checkbox' },
        { type: 'check', selector: '#d', text: undefined, value: 'z', fieldType: 'radio' },
        { type: 'check', selector: '#e', text: undefined, value: '/etc/hosts', fieldType: 'file' }
      ]
    );
  });
});

describe('formAutoFill against a real form', { skip: !browser && 'Chromium not installed' }, () => {
  test('radio, checkbox and select reach the posted form, and the counts agree', async () => {
    const result = await submit([
      { selector: 'input[name="custname"]', value: 'Ada' },
      // A group selector: the member is chosen by its value attribute.
      { selector: 'input[name="size"]', value: 'medium', type: 'radio' },
      { selector: 'input[name="topping"]', value: 'cheese', type: 'checkbox' },
      // A selector naming one input checks that input.
      { selector: 'input[name="topping"][value="onion"]', value: 'true', type: 'checkbox' },
      // ... and "false" unchecks it.
      { selector: '#gift', value: 'false', type: 'checkbox' },
      { selector: 'select[name="delivery"]', value: '1200', type: 'select' }
    ]);

    assert.equal(result.success, true, result.error);
    assert.equal(result.failedActions, 0, JSON.stringify(result.actionResults.filter((r) => !r.success)));
    const posted = new URLSearchParams(result.content.text.trim());
    assert.equal(posted.get('custname'), 'Ada');
    assert.equal(posted.get('size'), 'medium');
    assert.deepEqual(posted.getAll('topping'), ['cheese', 'onion']);
    assert.equal(posted.has('gift'), false, 'value "false" unchecks a checked box');
    assert.equal(posted.get('delivery'), '1200');

    // 1 caller action + 6 fills + 6 waitAfter + submit click + wait after submit.
    assert.equal(result.totalActions, 15);
    assert.equal(result.actionsExecuted, result.totalActions);
    assert.equal(result.successfulActions + result.failedActions, result.totalActions);
  });

  test('an unsupported field type fails its action instead of being typed as text', async () => {
    const result = await submit([
      { selector: 'input[name="custname"]', value: 'Ada' },
      { selector: 'input[name="receipt"]', value: '/etc/hosts', type: 'file' }
    ]);

    assert.equal(result.failedActions, 1);
    const failed = result.actionResults.find((r) => !r.success);
    assert.equal(failed.type, 'check');
    assert.match(failed.error, /field type "file" is not supported/);
  });

  test('a radio value no member of the group carries fails its action', async () => {
    const result = await submit([{ selector: 'input[name="size"]', value: 'huge', type: 'radio' }]);

    assert.equal(result.failedActions, 1);
    assert.equal(result.actionResults.find((r) => !r.success).type, 'check');
    assert.equal(new URLSearchParams(result.content.text.trim()).has('size'), false);
  });
});
