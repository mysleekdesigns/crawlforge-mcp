/**
 * Regression lock: the stealth fingerprint's extra headers never make a
 * cross-origin request preflighted.
 *
 * Chromium stealth contexts send fingerprint.headers on EVERY request
 * (extraHTTPHeaders + page.setExtraHTTPHeaders). Accept, Cache-Control and
 * Upgrade-Insecure-Requests among them turned each CORS-mode fetch into a
 * preflighted one. challenges.cloudflare.com answers the OPTIONS with no
 * Access-Control-Allow-Origin, so Turnstile's api.js was blocked and the
 * interstitial said "Incompatible browser extension or network configuration"
 * (R24, scrapingcourse.com/cloudflare-challenge, 2026-10-03).
 *
 * The rule, from the Fetch standard as Chromium implements it: a header is
 * harmless to CORS when its name is forbidden (the CORS check never counts it)
 * or it is safelisted with a safelisted value. The tables below are written
 * out here, not imported from the manager.
 *
 * Run: node --test --test-force-exit tests/unit/stealthHeadersCors.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { StealthBrowserManager } from '../../src/core/StealthBrowserManager.js';

// https://fetch.spec.whatwg.org/#forbidden-request-header
const FORBIDDEN = new Set([
  'accept-charset', 'accept-encoding', 'access-control-request-headers',
  'access-control-request-method', 'connection', 'content-length', 'cookie',
  'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive', 'origin', 'referer',
  'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via'
]);
const isForbidden = (name) => FORBIDDEN.has(name) || name.startsWith('sec-') || name.startsWith('proxy-');

// https://fetch.spec.whatwg.org/#cors-safelisted-request-header, plus the
// client hints Chromium safelists (services/network/public/cpp/cors/cors.cc).
const LANGUAGE_VALUE = /^[0-9A-Za-z *,\-.;=]*$/;
function isSafelisted(name, value) {
  if (Buffer.byteLength(value) > 128) return false;
  if (name === 'accept-language' || name === 'content-language') return LANGUAGE_VALUE.test(value);
  if (name === 'accept') return !/[\x00-\x08\x0A-\x1F"():<>?@[\\\]{}\x7F]/.test(value);
  return ['save-data', 'device-memory', 'dpr', 'downlink', 'ect', 'rtt', 'viewport-width', 'width'].includes(name);
}

let manager;

before(() => {
  manager = new StealthBrowserManager();
});

after(async () => {
  // The context pool starts an idle timer in the constructor.
  await manager.contexts.destroy?.();
});

describe('stealth extra headers and CORS', () => {
  test('every header is forbidden or safelisted, on every persona and OS', () => {
    const locales = [undefined, 'en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-ES', 'ja-JP'];
    for (let i = 0; i < 500; i++) {
      const fp = manager.generateAdvancedFingerprint({
        locale: locales[i % locales.length],
        useRandomUserAgent: true
      });
      for (const [rawName, value] of Object.entries(fp.headers)) {
        const name = rawName.toLowerCase();
        assert.ok(
          isForbidden(name) || isSafelisted(name, String(value)),
          `${rawName}: ${value} would preflight every cross-origin CORS request`
        );
      }
    }
  });

  test('the per-request headers Chromium computes itself are not forced', () => {
    for (let i = 0; i < 50; i++) {
      const names = Object.keys(manager.generateAdvancedFingerprint({ useRandomUserAgent: true }).headers)
        .map((name) => name.toLowerCase());
      for (const name of ['accept', 'cache-control', 'upgrade-insecure-requests']) {
        assert.ok(!names.includes(name), `${name} is forced onto every request`);
      }
    }
  });
});
