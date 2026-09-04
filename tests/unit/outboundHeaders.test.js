/**
 * Unit tests: the headers an HTTP page fetch carries.
 *
 * Run: node --test tests/unit/outboundHeaders.test.js
 *
 * R14 (2026-09-03): amazon-product answered with Amazon's captcha interstitial
 * on two locales while curl with the identical User-Agent got the product
 * page. Bisected header by header: with this identity ANY Accept-Language
 * (`*`, en-US, de-DE, a full browser list) draws the captcha and NO
 * Accept-Language gets the page. Node's fetch adds `Accept-Language: *` when
 * none is set and cannot leave it out, so the gate sends the header EMPTY,
 * which Amazon treats as absent. The identity is unchanged.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { outboundHeaders } from '../../src/utils/robotsGate.js';
import { CRAWLFORGE_USER_AGENT } from '../../src/utils/fetchIdentity.js';

describe('outboundHeaders', () => {
  test('carries the honest identity and an empty Accept-Language', () => {
    const h = outboundHeaders();
    assert.equal(h['User-Agent'], CRAWLFORGE_USER_AGENT);
    // Present and empty — not absent, or fetch fills in `*`.
    assert.ok(Object.prototype.hasOwnProperty.call(h, 'Accept-Language'));
    assert.equal(h['Accept-Language'], '');
  });

  test('a caller user agent still wins, the language header stays empty', () => {
    const h = outboundHeaders('AcmeBot/2.0');
    assert.equal(h['User-Agent'], 'AcmeBot/2.0');
    assert.equal(h['Accept-Language'], '');
  });

  test('the signature headers ride along untouched', () => {
    const h = outboundHeaders(undefined, { Signature: 'sig=:abc:', 'Signature-Input': 'sig=()' });
    assert.equal(h.Signature, 'sig=:abc:');
    assert.equal(h['Signature-Input'], 'sig=()');
    assert.equal(h['Accept-Language'], '');
  });
});
