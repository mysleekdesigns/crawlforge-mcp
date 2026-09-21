/**
 * Fingerprint self-probes for the stealth benchmark
 * (docs/STEALTH_REVIEW_2026-09.md section 2.3, Phase 0).
 *
 * Section 2.3 was hand-read off five detector pages. This module turns the part
 * a browser can be asked about itself into machine-checked assertions, so a
 * Playwright or Camoufox bump that reopens a worker leak, or a spoofing layer
 * that deletes `navigator.webdriver` instead of setting it to `false`, fails a
 * run instead of being noticed six months later.
 *
 * These probes need no third party, which is why they are the ones CI runs. The
 * detector-page parsers in ./detector-pages.js are excluded from `--ci`.
 *
 * The caller owns navigation: `runDetectorProbes()` expects a page already at
 * NEUTRAL_ORIGIN — a real https origin, because blob Workers and
 * RTCPeerConnection do not behave normally on about:blank. Nothing here
 * launches, navigates or closes anything.
 *
 * Nothing here throws. A probe that cannot run reports `status:'skip'` with the
 * reason in `detail`, and a `pass` is only ever reported for something actually
 * observed. `navigator-webdriver` in particular must come back `fail` with
 * `actual:'true'` when an init script has forced it — that is the Phase 0
 * verification gate, so nothing in this file may swallow it.
 */

export const NEUTRAL_ORIGIN = 'https://example.com/';

/** How long one probe gets before it is reported as a skip. */
const PROBE_TIMEOUT_MS = 5000;
/** In-page deadlines, kept under the node-side one so the page reports first. */
const WORKER_TIMEOUT_MS = 3000;
const ICE_GATHER_TIMEOUT_MS = 4000;

/**
 * @typedef {{id:string,name:string,status:'pass'|'fail'|'skip',expected:string,actual:string,detail?:string}} DetectorCheck
 */

// ─── Check plumbing ───────────────────────────────────────────────────────────

/**
 * Build one check. Shared with ./detector-pages.js so both halves of the
 * benchmark emit the same shape.
 * @returns {DetectorCheck}
 */
export function makeCheck(id, name, status, expected, actual, detail) {
  const check = { id, name, status, expected, actual };
  if (detail) check.detail = detail;
  return check;
}

/** @returns {'pass'|'fail'} */
export const verdict = (ok) => (ok ? 'pass' : 'fail');

/**
 * `page.evaluate` with a node-side deadline. Playwright has no per-evaluate
 * timeout, so one wedged page would otherwise stall the whole run; the pending
 * evaluate is abandoned and dies with the page the caller closes.
 * Returns `{ ok:true, value }` or `{ ok:false, error }` — never throws.
 */
export async function evaluateWithTimeout(page, fn, arg, timeoutMs = PROBE_TIMEOUT_MS) {
  let timer;
  try {
    const value = await Promise.race([
      page.evaluate(fn, arg),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`probe timed out after ${timeoutMs} ms`)), timeoutMs);
      })
    ]);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

// ─── In-page probes ───────────────────────────────────────────────────────────
// Each of these is serialised into the page, so it must be self-contained: no
// closure over module scope, no optional chaining on hosts that may not support
// it, no imports.

/** Everything the main thread says about itself. */
const mainThreadProbe = () => {
  const uad = navigator.userAgentData;
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    languages: Array.prototype.slice.call(navigator.languages || []),
    // String() so a deleted property and a real `false` stay distinguishable.
    webdriver: String(navigator.webdriver),
    webdriverType: typeof navigator.webdriver,
    webdriverInNavigator: 'webdriver' in navigator,
    userAgentData: uad
      ? {
          brands: Array.prototype.slice.call(uad.brands || []).map((b) => ({ brand: b.brand, version: b.version })),
          platform: uad.platform,
          mobile: uad.mobile
        }
      : null
  };
};

/**
 * The same values read inside a Web Worker. Section 2.3 caught Chromium
 * reporting `HeadlessChrome/151`, Macintosh and 32 cores here while the main
 * thread claimed Windows with 8 cores. Built from a Blob URL, always terminated
 * and revoked, and self-limiting so a worker that never starts cannot hang.
 */
const workerProbe = (timeoutMs) => {
  const source = [
    'self.onmessage = function () {',
    '  self.postMessage({',
    '    userAgent: navigator.userAgent,',
    '    platform: navigator.platform,',
    '    hardwareConcurrency: navigator.hardwareConcurrency,',
    '    languages: Array.prototype.slice.call(navigator.languages || [])',
    '  });',
    '};'
  ].join('\n');
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  let worker;
  try {
    worker = new Worker(url);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw new Error('worker could not be created: ' + (error && error.message ? error.message : error));
  }
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (settle, value) => {
      clearTimeout(timer);
      try { worker.terminate(); } catch (_) { /* already gone */ }
      URL.revokeObjectURL(url);
      settle(value);
    };
    timer = setTimeout(
      () => finish(reject, new Error('worker did not answer within ' + timeoutMs + ' ms')),
      timeoutMs
    );
    worker.onmessage = (event) => finish(resolve, event.data);
    worker.onerror = (event) => finish(reject, new Error(event.message || 'worker failed to start'));
    worker.postMessage('probe');
  });
};

/**
 * ICE candidates from a peer connection with no STUN server. Host and mDNS
 * candidates are gathered locally, so this stays deterministic in CI — no
 * external server is contacted. Section 2.3 found the real IPv6 here on
 * Chromium despite `blockWebRTC` defaulting to true.
 */
const webrtcProbe = (timeoutMs) => {
  if (typeof RTCPeerConnection === 'undefined') {
    return { disabled: 'RTCPeerConnection is not defined', candidates: [] };
  }
  let pc;
  try {
    pc = new RTCPeerConnection({ iceServers: [] });
  } catch (error) {
    return { disabled: 'RTCPeerConnection could not be constructed: ' + (error && error.message ? error.message : error), candidates: [] };
  }
  const candidates = [];
  return new Promise((resolve) => {
    let timer;
    const finish = (extra) => {
      clearTimeout(timer);
      try { pc.close(); } catch (_) { /* already closed */ }
      resolve(Object.assign({ candidates }, extra));
    };
    timer = setTimeout(() => finish({ timedOut: true }), timeoutMs);
    pc.onicecandidate = (event) => {
      if (!event.candidate) return finish({ timedOut: false }); // null candidate = gathering complete
      if (event.candidate.candidate) candidates.push(event.candidate.candidate);
    };
    try {
      pc.createDataChannel('probe');
    } catch (error) {
      return finish({ error: 'createDataChannel failed: ' + (error && error.message ? error.message : error) });
    }
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch((error) => finish({ error: 'offer failed: ' + (error && error.message ? error.message : error) }));
  });
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** The leading integer of a version string: `151.0.7922.34` -> 151. */
export function majorVersion(version) {
  const match = /(\d+)/.exec(String(version == null ? '' : version));
  return match ? Number(match[1]) : null;
}

/** The browser major version the presented user agent claims. */
export function uaMajorVersion(userAgent, engine) {
  const pattern = engine === 'camoufox' ? /(?:Firefox|rv):?\/?(\d+)/ : /Chrome\/(\d+)/;
  const match = pattern.exec(String(userAgent || ''));
  return match ? Number(match[1]) : null;
}

/** The OS a user agent claims. Android and iOS are checked before Linux/Mac. */
export function osFromUserAgent(userAgent) {
  const ua = String(userAgent || '');
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Windows NT|Win64|Win32/i.test(ua)) return 'windows';
  if (/CrOS/.test(ua)) return 'chromeos';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return null;
}

/** `process.platform` or a friendly name -> the vocabulary osFromUserAgent uses. */
export function normaliseHostOS(hostOS) {
  const value = String(hostOS || '').toLowerCase();
  if (!value) return null;
  if (/^darwin|mac/.test(value)) return 'macos';
  if (/^win/.test(value)) return 'windows';
  if (/linux/.test(value)) return 'linux';
  if (/android/.test(value)) return 'android';
  if (/ios|iphone|ipad/.test(value)) return 'ios';
  return null;
}

/**
 * The connection address of an SDP candidate line:
 * `candidate:<foundation> <component> <transport> <priority> <address> <port> typ <type> ...`
 */
export function candidateAddress(line) {
  const parts = String(line || '').trim().split(/\s+/);
  return parts.length > 5 ? parts[4] : null;
}

/** 'mdns' for an obfuscated `.local` name, 'ip' for a raw address. */
export function classifyCandidate(line) {
  const address = candidateAddress(line);
  if (!address) return 'unknown';
  if (/\.local$/i.test(address)) return 'mdns';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address) || address.includes(':')) return 'ip';
  return 'unknown';
}

const truncate = (text, limit = 400) => (text.length > limit ? `${text.slice(0, limit)}…` : text);

const formatValue = (value) => (Array.isArray(value) ? value.join(', ') : String(value));

// ─── Checks ───────────────────────────────────────────────────────────────────

function webdriverCheck(main) {
  const id = 'navigator-webdriver';
  const name = 'navigator.webdriver reports false';
  const expected = 'false';
  if (!main.ok) return makeCheck(id, name, 'skip', expected, 'not observed', main.error);
  const { webdriver, webdriverType, webdriverInNavigator } = main.value;
  // A deleted property is a tell of its own: rebrowser marks it red (2.3).
  const actual = webdriverType === 'undefined' ? 'undefined (property deleted)' : webdriver;
  return makeCheck(
    id, name, verdict(actual === 'false'), expected, actual,
    `'webdriver' in navigator: ${webdriverInNavigator}`
  );
}

function userAgentDataBrandsCheck(main, engine) {
  const id = 'useragentdata-brands';
  const name = 'userAgentData brands are a real Chrome';
  const expected = 'a "Google Chrome" brand and no "HeadlessChrome" brand';
  if (engine === 'camoufox') {
    return makeCheck(id, name, 'skip', expected, 'not applicable', 'Firefox exposes no navigator.userAgentData');
  }
  if (!main.ok) return makeCheck(id, name, 'skip', expected, 'not observed', main.error);
  const uad = main.value.userAgentData;
  if (!uad) return makeCheck(id, name, 'skip', expected, 'not observed', 'navigator.userAgentData is not exposed');
  const brands = uad.brands || [];
  const list = brands.map((b) => `${b.brand} ${b.version}`).join(', ') || '(empty)';
  const headless = brands.filter((b) => /headless/i.test(b.brand)).map((b) => b.brand);
  const hasChrome = brands.some((b) => /^google chrome$/i.test(String(b.brand).trim()));
  const problems = [];
  if (headless.length) problems.push(`headless brand: ${headless.join(', ')}`);
  if (!hasChrome) problems.push('no "Google Chrome" brand');
  return makeCheck(
    id, name, verdict(problems.length === 0), expected,
    problems.length ? problems.join('; ') : 'Google Chrome present, no headless brand',
    `brands: ${list}`
  );
}

/** One worker-vs-main-thread comparison. */
function workerCheck(id, name, key, worker, main) {
  const expected = 'worker matches the main thread';
  if (!main.ok) return makeCheck(id, name, 'skip', expected, 'not observed', main.error);
  if (!worker.ok) return makeCheck(id, name, 'skip', expected, 'not observed', worker.error);
  const mainValue = main.value[key];
  const workerValue = worker.value[key];
  const same = JSON.stringify(mainValue) === JSON.stringify(workerValue);
  return makeCheck(
    id, name, verdict(same), expected,
    same ? formatValue(mainValue) : `worker "${formatValue(workerValue)}" vs main "${formatValue(mainValue)}"`
  );
}

function webrtcCheck(webrtc) {
  const id = 'webrtc-host-candidates';
  const name = 'WebRTC leaks no real address';
  const expected = 'no ICE candidate with a raw IP address';
  if (!webrtc.ok) return makeCheck(id, name, 'skip', expected, 'not observed', webrtc.error);
  const { disabled, error, candidates = [], timedOut } = webrtc.value;
  // WebRTC switched off entirely is an observation, not a guess: nothing can
  // leak through an API the page does not have. That is the Camoufox result.
  if (disabled) return makeCheck(id, name, 'pass', expected, 'WebRTC unavailable', disabled);
  if (error) return makeCheck(id, name, 'skip', expected, 'not observed', error);
  const leaking = candidates.filter((c) => classifyCandidate(c) === 'ip');
  const actual = candidates.length === 0
    ? `no candidates gathered${timedOut ? ' before the deadline' : ''}`
    : `${candidates.length} candidates, ${leaking.length} with a raw address`;
  return makeCheck(
    id, name, verdict(leaking.length === 0), expected, actual,
    truncate(candidates.join(' | ') || 'none', 800)
  );
}

function uaVersionCheck(main, engine, browserVersion) {
  const id = 'ua-version-vs-binary';
  const name = 'user agent states the launched version';
  const token = engine === 'camoufox' ? 'Firefox' : 'Chrome';
  const binaryMajor = majorVersion(browserVersion);
  const expected = binaryMajor === null ? `${token} major of the binary` : `${token} ${binaryMajor}`;
  if (!main.ok) return makeCheck(id, name, 'skip', expected, 'not observed', main.error);
  if (binaryMajor === null) {
    return makeCheck(id, name, 'skip', expected, 'not observed', `browserVersion not supplied (got ${JSON.stringify(browserVersion)})`);
  }
  const userAgent = main.value.userAgent;
  const uaMajor = uaMajorVersion(userAgent, engine);
  if (uaMajor === null) {
    return makeCheck(id, name, 'skip', expected, 'not observed', `no ${token} version token in UA: ${truncate(String(userAgent), 200)}`);
  }
  return makeCheck(
    id, name, verdict(uaMajor === binaryMajor), expected,
    `UA ${token} ${uaMajor}, binary ${browserVersion}`,
    truncate(String(userAgent), 200)
  );
}

function personaOsCheck(main, hostOS) {
  const id = 'persona-os-vs-host';
  const name = 'persona OS matches the host';
  const host = normaliseHostOS(hostOS);
  const expected = host ? `UA claims ${host}` : 'UA claims the host OS';
  if (!main.ok) return makeCheck(id, name, 'skip', expected, 'not observed', main.error);
  if (!host) return makeCheck(id, name, 'skip', expected, 'not observed', `host OS not recognised: ${JSON.stringify(hostOS)}`);
  const userAgent = main.value.userAgent;
  const claimed = osFromUserAgent(userAgent);
  if (!claimed) return makeCheck(id, name, 'skip', expected, 'not observed', `UA names no OS: ${truncate(String(userAgent), 200)}`);
  // Expected to fail on both engines today (2.3: Windows persona on a Mac).
  // Phase 1 fixes it; the harness's job is to measure it, not to excuse it.
  return makeCheck(
    id, name, verdict(claimed === host), expected,
    `UA claims ${claimed}, host is ${host}`,
    truncate(String(userAgent), 200)
  );
}

function headlessMarkerCheck(main, worker, engine) {
  const id = 'headless-markers';
  const name = 'no "Headless" marker anywhere';
  const expected = 'no "Headless" substring in main UA, worker UA or userAgentData';
  const inspected = [];
  const missing = [];
  if (main.ok) {
    inspected.push(['main-thread userAgent', String(main.value.userAgent)]);
    const uad = main.value.userAgentData;
    if (uad) {
      inspected.push(['userAgentData', `${(uad.brands || []).map((b) => b.brand).join(', ')} ${uad.platform || ''}`]);
    } else if (engine !== 'camoufox') {
      missing.push('userAgentData (not exposed)');
    }
  } else {
    missing.push(`main thread (${main.error})`);
  }
  if (worker.ok) inspected.push(['worker userAgent', String(worker.value.userAgent)]);
  else missing.push(`worker (${worker.error})`);

  const hits = inspected.filter(([, value]) => /headless/i.test(value));
  if (hits.length) {
    return makeCheck(
      id, name, 'fail', expected, `"Headless" in ${hits.map(([source]) => source).join(', ')}`,
      truncate(hits.map(([source, value]) => `${source}: ${value}`).join(' | '), 600)
    );
  }
  if (missing.length) {
    return makeCheck(
      id, name, 'skip', expected, 'not fully observed',
      `no marker in ${inspected.map(([source]) => source).join(', ') || 'nothing'}; not inspected: ${missing.join(', ')}`
    );
  }
  return makeCheck(id, name, 'pass', expected, 'none', inspected.map(([source]) => source).join(', '));
}

/**
 * Turn three raw probe results into the check table. Pure, so the whole table
 * can be exercised against a synthetic snapshot without a browser.
 * @returns {DetectorCheck[]}
 */
export function buildDetectorChecks(snapshot, { engine, browserVersion, hostOS } = {}) {
  const { main, worker, webrtc } = snapshot;
  return [
    webdriverCheck(main),
    userAgentDataBrandsCheck(main, engine),
    workerCheck('worker-useragent', 'worker navigator.userAgent', 'userAgent', worker, main),
    workerCheck('worker-platform', 'worker navigator.platform', 'platform', worker, main),
    workerCheck('worker-hardware-concurrency', 'worker navigator.hardwareConcurrency', 'hardwareConcurrency', worker, main),
    workerCheck('worker-languages', 'worker navigator.languages', 'languages', worker, main),
    webrtcCheck(webrtc),
    uaVersionCheck(main, engine, browserVersion),
    personaOsCheck(main, hostOS),
    headlessMarkerCheck(main, worker, engine)
  ];
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Run every self-probe against a page already sitting on NEUTRAL_ORIGIN.
 * Does not navigate, launch or close anything, and never throws.
 * @param {import('playwright').Page} page
 * @param {{engine:'chromium'|'camoufox', browserVersion?:string, hostOS?:string}} context
 * @returns {Promise<DetectorCheck[]>}
 */
export async function runDetectorProbes(page, context = {}) {
  let snapshot;
  try {
    // Sequential: one wedged probe should not skew the timing of the next.
    snapshot = {
      main: await evaluateWithTimeout(page, mainThreadProbe),
      worker: await evaluateWithTimeout(page, workerProbe, WORKER_TIMEOUT_MS),
      webrtc: await evaluateWithTimeout(page, webrtcProbe, ICE_GATHER_TIMEOUT_MS)
    };
  } catch (error) {
    // evaluateWithTimeout already swallows per-probe failures; this only fires
    // if the page itself is gone. Report every id as a skip rather than throw.
    const reason = error?.message || String(error);
    const dead = { ok: false, error: `page unusable: ${reason}` };
    snapshot = { main: dead, worker: dead, webrtc: dead };
  }
  return buildDetectorChecks(snapshot, context);
}
