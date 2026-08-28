/**
 * Regression lock for the stealth fingerprint's OS coherence and its WebRTC
 * "public" IP.
 *
 * A sweep of stealth_mode observed one fingerprint reporting navigator.platform
 * Win32 behind a Windows user agent while mediaDevices listed a FaceTime HD
 * Camera, and webRTC.publicIP set to 192.168.1.117 — an address that cannot be
 * a public one. Both are cheap detection signals for a tool whose whole purpose
 * is not being detected.
 *
 * tests/unit/fingerprintCoherence.test.js owns the locale persona side
 * (timezone/geolocation/Accept-Language) and the sec-ch-ua version pairing. This
 * file covers what that one does not: the OS agreement measured at the sample
 * size the fix was signed off on, and — the part a coherence fix can silently
 * break — that fingerprints still VARY. Collapsing every fingerprint onto one OS
 * would satisfy every coherence assertion and be a worse signal than the
 * mismatch it replaced.
 *
 * The device/font tables below are copied deliberately rather than imported, so
 * a wrong entry in StealthBrowserManager fails here instead of being restated.
 *
 * Run: node --test --test-force-exit tests/unit/stealthFingerprintCoherence.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { StealthBrowserManager } from '../../src/core/StealthBrowserManager.js';

// The item's verify clause is stated over 20 fingerprints.
const SAMPLES = 20;
// Variation needs a larger draw: linux is 10% of the distribution, so 20 samples
// can legitimately miss it.
const VARIATION_SAMPLES = 300;

const PLATFORM_FOR_OS = { windows: 'Win32', macos: 'MacIntel', linux: 'Linux x86_64' };

// Exact device labels each OS may emit. A label outside its OS's set is a
// mismatch — no regex ambiguity between "Integrated Camera (04f2:b6d9)"
// (Windows) and "Integrated Camera: Integrated C" (Linux).
const DEVICE_LABELS_FOR_OS = {
  windows: [
    'HD Pro Webcam C920 (046d:082d)', 'Integrated Camera (04f2:b6d9)',
    'Microphone (Realtek(R) Audio)', 'Microphone Array (Intel® Smart Sound Technology)',
    'Speakers (Realtek(R) Audio)', 'Headphones (Realtek(R) Audio)'
  ],
  macos: [
    'FaceTime HD Camera', 'FaceTime HD Camera (Built-in)',
    'MacBook Pro Microphone', 'External Microphone',
    'MacBook Pro Speakers', 'External Headphones'
  ],
  linux: [
    'Integrated Camera: Integrated C', 'USB2.0 HD UVC WebCam',
    'Built-in Audio Analog Stereo', 'Monitor of Built-in Audio Analog Stereo',
    'HDMI / DisplayPort'
  ]
};

// Fonts each OS ships that the other two do not.
const OS_EXCLUSIVE_FONTS = {
  windows: ['Segoe UI', 'Calibri', 'Consolas', 'Cambria', 'Candara'],
  macos: ['SF Pro Display', 'Helvetica Neue', 'Menlo', 'Avenir', 'Optima'],
  linux: ['Ubuntu', 'DejaVu Sans', 'Liberation Sans', 'Noto Sans', 'Source Sans Pro']
};

/** The OS a site infers from the user agent — the one signal it always sees. */
function osFromUserAgent(ua) {
  if (/Macintosh|Mac OS X/.test(ua)) return 'macos';
  if (/X11|Linux/.test(ua)) return 'linux';
  return 'windows';
}

/** True only for a globally routable unicast IPv4 address. */
function isPublicIPv4(ip) {
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return false;        // this-network, RFC1918, loopback
  if (a === 169 && b === 254) return false;                   // link-local
  if (a === 172 && b >= 16 && b <= 31) return false;          // RFC1918
  if (a === 192 && b === 168) return false;                   // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return false;         // CGNAT
  if (a >= 224) return false;                                 // multicast + reserved
  return true;
}

/** Every OS-bound field of one fingerprint, checked against the UA's OS. */
function osMismatches(fp) {
  const os = osFromUserAgent(fp.userAgent);
  const problems = [];

  if (fp.hardware.platform !== PLATFORM_FOR_OS[os]) {
    problems.push(`platform ${fp.hardware.platform} on a ${os} user agent`);
  }
  for (const device of fp.mediaDevices) {
    if (!DEVICE_LABELS_FOR_OS[os].includes(device.label)) {
      problems.push(`device label "${device.label}" is not a ${os} device`);
    }
  }
  for (const [otherOS, fonts] of Object.entries(OS_EXCLUSIVE_FONTS)) {
    if (otherOS === os) continue;
    for (const font of fonts) {
      if (fp.fonts.includes(font)) problems.push(`${otherOS} font "${font}" on ${os}`);
    }
  }
  return problems;
}

let manager;

before(() => {
  manager = new StealthBrowserManager();
});

after(async () => {
  // The context pool starts an idle timer in the constructor.
  await manager.contexts.destroy?.();
});

describe('stealth fingerprint OS coherence and WebRTC IP', () => {
  test(`${SAMPLES} fingerprints agree with their user agent's OS`, () => {
    const failures = [];
    for (let i = 0; i < SAMPLES; i++) {
      const fp = manager.generateAdvancedFingerprint({ locale: 'en-US', useRandomUserAgent: true });
      for (const problem of osMismatches(fp)) {
        failures.push(`sample ${i}: ${problem}`);
      }
    }
    assert.deepEqual(failures, [], `${failures.length} OS mismatches over ${SAMPLES} fingerprints`);
  });

  test(`${SAMPLES} fingerprints carry a routable webRTC.publicIP`, () => {
    const failures = [];
    for (let i = 0; i < SAMPLES; i++) {
      const fp = manager.generateAdvancedFingerprint({ locale: 'en-US', useRandomUserAgent: true });
      // Omitting the field is acceptable; claiming a private address is not.
      if (fp.webRTC.publicIP !== undefined && !isPublicIPv4(fp.webRTC.publicIP)) {
        failures.push(`sample ${i}: publicIP ${fp.webRTC.publicIP} is not routable`);
      }
      // The counterpart: local candidates are supposed to be private, so a
      // "fix" that made every address public is not a fix.
      for (const local of fp.webRTC.localIPs ?? []) {
        if (isPublicIPv4(local)) failures.push(`sample ${i}: local candidate ${local} is public`);
      }
    }
    assert.deepEqual(failures, [], `${failures.length} implausible WebRTC addresses over ${SAMPLES} fingerprints`);
  });

  test('coherence does not collapse the fingerprint into one identity', () => {
    const seen = { os: new Set(), userAgent: new Set(), publicIP: new Set(), viewport: new Set() };
    for (let i = 0; i < VARIATION_SAMPLES; i++) {
      const fp = manager.generateAdvancedFingerprint({ locale: 'en-US', useRandomUserAgent: true });
      seen.os.add(osFromUserAgent(fp.userAgent));
      seen.userAgent.add(fp.userAgent);
      seen.publicIP.add(fp.webRTC.publicIP);
      seen.viewport.add(`${fp.viewport.width}x${fp.viewport.height}`);
    }

    assert.deepEqual(
      [...seen.os].sort(),
      ['linux', 'macos', 'windows'],
      'all three operating systems should still be drawn'
    );
    assert.ok(seen.userAgent.size >= 8, `only ${seen.userAgent.size} distinct user agents`);
    assert.ok(seen.viewport.size >= 3, `only ${seen.viewport.size} distinct viewports`);
    assert.ok(
      seen.publicIP.size >= VARIATION_SAMPLES * 0.9,
      `only ${seen.publicIP.size} distinct public IPs over ${VARIATION_SAMPLES} fingerprints`
    );
  });

  test('a pinned user agent drags every OS-bound field with it', () => {
    const uaForOS = {
      macos: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    };

    for (const [os, ua] of Object.entries(uaForOS)) {
      for (let i = 0; i < 20; i++) {
        const fp = manager.generateAdvancedFingerprint({ customUserAgent: ua, locale: 'en-US' });
        assert.equal(fp.userAgent, ua);
        assert.equal(fp.hardware.platform, PLATFORM_FOR_OS[os]);
        assert.deepEqual(osMismatches(fp), [], `pinned ${os} user agent produced a mismatch`);
      }
    }
  });
});
