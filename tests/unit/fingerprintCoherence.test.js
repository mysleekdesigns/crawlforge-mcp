/**
 * Property test: a stealth fingerprint must not contradict itself.
 *
 * One pre-Phase-1 fingerprint claimed timezone Asia/Tokyo, a geolocation in
 * Beijing, Accept-Language en-us, navigator.platform Win32, macOS device labels
 * (FaceTime HD Camera) and a WebRTC "public" IP of 192.168.1.22. Every one of
 * those pairs is a stronger detection signal than not spoofing at all, so the
 * OS and the locale persona are now drawn once per fingerprint and threaded
 * through every generator.
 *
 * The checks below use tables independent of the manager's own (an IANA
 * timezone → country map and country bounding boxes), so a wrong entry in
 * StealthBrowserManager.localePersonas fails here rather than being restated.
 *
 * Run: node --test --test-force-exit tests/unit/fingerprintCoherence.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { StealthBrowserManager } from '../../src/core/StealthBrowserManager.js';

const SAMPLES = 1000;

// Independent reference data — deliberately NOT imported from the manager.
const TIMEZONE_COUNTRY = {
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'Europe/London': 'GB',
  'Europe/Berlin': 'DE',
  'Europe/Paris': 'FR',
  'Europe/Madrid': 'ES',
  'Asia/Tokyo': 'JP',
  'Australia/Sydney': 'AU'
};

// Generous land bounding boxes: { latMin, latMax, lonMin, lonMax }
const COUNTRY_BOX = {
  US: { latMin: 24, latMax: 50, lonMin: -125, lonMax: -66 },
  GB: { latMin: 49, latMax: 61, lonMin: -8, lonMax: 2 },
  DE: { latMin: 47, latMax: 55, lonMin: 5, lonMax: 16 },
  FR: { latMin: 41, latMax: 51, lonMin: -5, lonMax: 9 },
  ES: { latMin: 36, latMax: 44, lonMin: -10, lonMax: 4 },
  JP: { latMin: 30, latMax: 46, lonMin: 129, lonMax: 146 },
  AU: { latMin: -44, latMax: -10, lonMin: 112, lonMax: 154 }
};

const PLATFORM_FOR_OS = { windows: 'Win32', macos: 'MacIntel', linux: 'Linux x86_64' };
const SEC_CH_PLATFORM_FOR_OS = { windows: '"Windows"', macos: '"macOS"', linux: '"Linux"' };

// Fonts each OS ships that the other two do not.
const OS_EXCLUSIVE_FONTS = {
  windows: ['Segoe UI', 'Calibri', 'Consolas', 'Cambria', 'Candara'],
  macos: ['SF Pro Display', 'Helvetica Neue', 'Menlo', 'Avenir', 'Optima'],
  linux: ['Ubuntu', 'DejaVu Sans', 'Liberation Sans', 'Noto Sans', 'Source Sans Pro']
};

// A GPU string only a machine of that OS can produce.
const WEBGL_PATTERN_FOR_OS = {
  windows: /Direct3D11/,
  macos: /Metal Renderer/,
  linux: /OpenGL/
};

/** Infer the OS from the user agent alone — the one signal a site always sees. */
function osFromUserAgent(ua) {
  if (/Macintosh|Mac OS X/.test(ua)) return 'macos';
  if (/X11|Linux/.test(ua)) return 'linux';
  return 'windows';
}

/** RFC1918 / loopback / link-local / CGNAT / multicast / documentation space. */
function isPublicIPv4(ip) {
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false;          // 192.0.0.0/24 + 192.0.2.0/24 (TEST-NET-1)
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51) return false;          // TEST-NET-2
  if (a === 203 && b === 0) return false;           // TEST-NET-3
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a >= 224) return false;                       // multicast + reserved
  return true;
}

let manager;

before(() => {
  manager = new StealthBrowserManager();
});

after(async () => {
  // The context pool starts an idle timer in the constructor.
  await manager.contexts.destroy?.();
});

describe('stealth fingerprint coherence', () => {
  test('the locale persona table agrees with independent timezone/country data', () => {
    for (const persona of manager.localePersonas) {
      assert.equal(
        TIMEZONE_COUNTRY[persona.timezone],
        persona.country,
        `${persona.timezone} is not a ${persona.country} timezone`
      );
      const box = COUNTRY_BOX[persona.country];
      assert.ok(box, `no bounding box for ${persona.country}`);
      assert.ok(
        persona.latitude >= box.latMin && persona.latitude <= box.latMax &&
        persona.longitude >= box.lonMin && persona.longitude <= box.lonMax,
        `${persona.locale} city (${persona.latitude}, ${persona.longitude}) is outside ${persona.country}`
      );
    }
  });

  test(`${SAMPLES} generated fingerprints are internally consistent`, () => {
    for (let i = 0; i < SAMPLES; i++) {
      const fp = manager.generateAdvancedFingerprint({ locale: 'en-US', useRandomUserAgent: true });
      const os = osFromUserAgent(fp.userAgent);
      const where = `sample ${i} (${os}, ${fp.userAgent})`;

      // navigator.platform and sec-ch-ua-platform follow the user agent's OS
      assert.equal(fp.hardware.platform, PLATFORM_FOR_OS[os], `platform mismatch — ${where}`);
      assert.equal(
        fp.headers['sec-ch-ua-platform'],
        SEC_CH_PLATFORM_FOR_OS[os],
        `sec-ch-ua-platform mismatch — ${where}`
      );

      // sec-ch-ua reports the same Chrome major version as the User-Agent
      const chromeVersion = fp.userAgent.match(/Chrome\/(\d+)/);
      if (chromeVersion) {
        assert.match(
          fp.headers['sec-ch-ua'],
          new RegExp(`"Google Chrome";v="${chromeVersion[1]}"`),
          `sec-ch-ua version does not match the UA — ${where}`
        );
      }

      // Timezone comes from a persona, and the geolocation from the same one
      const persona = manager.localePersonas.find((p) => p.timezone === fp.timezone);
      assert.ok(persona, `timezone ${fp.timezone} is not in the persona table — ${where}`);
      const country = TIMEZONE_COUNTRY[fp.timezone];
      const box = COUNTRY_BOX[country];
      assert.ok(
        fp.geolocation.latitude >= box.latMin && fp.geolocation.latitude <= box.latMax &&
        fp.geolocation.longitude >= box.lonMin && fp.geolocation.longitude <= box.lonMax,
        `geolocation (${fp.geolocation.latitude}, ${fp.geolocation.longitude}) is not in ${country} ` +
        `but the timezone is ${fp.timezone} — ${where}`
      );
      assert.ok(
        Math.abs(fp.geolocation.latitude - persona.latitude) <= 0.03 &&
        Math.abs(fp.geolocation.longitude - persona.longitude) <= 0.03,
        `geolocation drifted away from its persona city — ${where}`
      );

      // Accept-Language leads with the persona locale (not a hardcoded en-us)
      assert.equal(fp.locale, 'en-US', `requested locale was dropped — ${where}`);
      assert.equal(
        fp.headers['Accept-Language'].split(',')[0],
        fp.locale,
        `Accept-Language does not lead with the persona locale — ${where}`
      );

      // Media device labels belong to this OS
      const macOnlyDevice = fp.mediaDevices.some((d) => /FaceTime|MacBook/.test(d.label));
      const winOnlyDevice = fp.mediaDevices.some((d) => /Realtek|Intel® Smart Sound/.test(d.label));
      const linuxOnlyDevice = fp.mediaDevices.some((d) => /Built-in Audio Analog|UVC WebCam|Integrated C$/.test(d.label));
      if (os === 'macos') assert.ok(!winOnlyDevice && !linuxOnlyDevice, `foreign device labels — ${where}`);
      if (os === 'windows') assert.ok(!macOnlyDevice && !linuxOnlyDevice, `foreign device labels — ${where}`);
      if (os === 'linux') assert.ok(!macOnlyDevice && !winOnlyDevice, `foreign device labels — ${where}`);

      // WebGL renderer is producible by this OS
      assert.match(fp.webGL.renderer, WEBGL_PATTERN_FOR_OS[os], `implausible GPU — ${where}`);

      // Font list carries no other OS's exclusive fonts
      for (const [otherOS, fonts] of Object.entries(OS_EXCLUSIVE_FONTS)) {
        if (otherOS === os) continue;
        for (const font of fonts) {
          assert.ok(!fp.fonts.includes(font), `${otherOS} font "${font}" on ${os} — ${where}`);
        }
      }

      // The WebRTC "public" IP is actually routable
      assert.ok(
        isPublicIPv4(fp.webRTC.publicIP),
        `webRTC.publicIP ${fp.webRTC.publicIP} is not a public address — ${where}`
      );
      // …while the local candidates stay private, as they should be
      for (const local of fp.webRTC.localIPs) {
        assert.ok(!isPublicIPv4(local), `local candidate ${local} is a public address — ${where}`);
      }
    }
  });

  test('a non-default locale moves the timezone and geolocation with it', () => {
    for (let i = 0; i < 50; i++) {
      const fp = manager.generateAdvancedFingerprint({ locale: 'de-DE', useRandomUserAgent: true });
      assert.equal(fp.locale, 'de-DE');
      assert.equal(fp.timezone, 'Europe/Berlin');
      assert.equal(fp.headers['Accept-Language'], 'de-DE,de;q=0.9');
      const box = COUNTRY_BOX.DE;
      assert.ok(
        fp.geolocation.latitude >= box.latMin && fp.geolocation.latitude <= box.latMax &&
        fp.geolocation.longitude >= box.lonMin && fp.geolocation.longitude <= box.lonMax,
        'de-DE fingerprint is not geolocated in Germany'
      );
    }
  });

  test('an explicit user agent pins the whole persona to that OS', () => {
    const macUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
    for (let i = 0; i < 50; i++) {
      const fp = manager.generateAdvancedFingerprint({ customUserAgent: macUA, locale: 'en-US' });
      assert.equal(fp.userAgent, macUA);
      assert.equal(fp.hardware.platform, 'MacIntel');
      assert.equal(fp.headers['sec-ch-ua-platform'], '"macOS"');
      assert.match(fp.webGL.renderer, /Metal Renderer/);
      for (const font of OS_EXCLUSIVE_FONTS.windows) {
        assert.ok(!fp.fonts.includes(font), `Windows font "${font}" on a macOS persona`);
      }
    }
  });

  test('create_context summary stays small and keeps what a caller uses', () => {
    const fp = manager.generateAdvancedFingerprint({ locale: 'en-US', useRandomUserAgent: true });
    const summary = manager.summarizeFingerprint(fp);

    assert.equal(summary.userAgent, fp.userAgent);
    assert.equal(summary.platform, fp.hardware.platform);
    assert.equal(summary.locale, fp.locale);
    assert.equal(summary.timezone, fp.timezone);
    assert.deepEqual(summary.viewport, { width: fp.viewport.width, height: fp.viewport.height });

    const summaryBytes = Buffer.byteLength(JSON.stringify(summary, null, 2), 'utf8');
    assert.ok(summaryBytes < 500, `summary is ${summaryBytes} bytes, expected < 500`);

    const fullBytes = Buffer.byteLength(JSON.stringify(fp, null, 2), 'utf8');
    assert.ok(fullBytes > 3000, `full fingerprint is only ${fullBytes} bytes — is it still worth trimming?`);
  });
});
