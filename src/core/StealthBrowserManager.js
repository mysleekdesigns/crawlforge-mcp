/**
 * StealthBrowserManager - Comprehensive Anti-detection browser management
 * Phase 2.2 Features:
 * - Advanced browser fingerprint randomization (User Agent, Canvas, WebGL, Screen, Plugins)
 * - Human behavior simulation (Bezier mouse movements, realistic typing, scroll patterns)
 * - Anti-detection features (CloudFlare bypass, reCAPTCHA handling, proxy rotation)
 * - WebRTC leak prevention and automation indicator hiding
 * - Stealth mode robust enough to bypass common bot detection services
 */

import { chromium } from 'playwright';
import { z } from 'zod';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import HumanBehaviorSimulator from '../utils/HumanBehaviorSimulator.js';
import { BrowserContextPool } from './BrowserContextPool.js';
import { safeGoto } from '../utils/ssrfGuard.js';
import { looksLikeInterstitial } from '../utils/challengeDetection.js';
import { guardFirefoxPageErrors } from '../utils/firefoxPageErrorGuard.js';
import { serverStealthProxies } from '../constants/config.js';

// Grace given to a document that rendered no title and no text (see _waitOutEmptyDocument).
export const EMPTY_DOCUMENT_GRACE_MS = 8000;

// The Chrome major claimed when the installed binary cannot be read at all.
// Only ever a floor: installedChromeVersion() prefers playwright-core's own
// browsers.json, and a launched browser's real version overrides both.
const FALLBACK_CHROME_MAJOR = 151;

// The proxy a camoufox browser was launched with, kept on the browser itself so
// it survives being parked and restored by an engine switch.
const CAMOUFOX_PROXY = Symbol('crawlforge.camoufoxProxy');

// The locale that camoufox browser was launched with — null when geoip derived
// one from the proxy's exit IP and we therefore do not know it. Kept on the
// browser for the same reason as the proxy: camoufox fixes it at launch.
const CAMOUFOX_LOCALE = Symbol('crawlforge.camoufoxLocale');

const StealthConfigSchema = z.object({
  level: z.enum(['basic', 'medium', 'advanced']).default('medium'),
  randomizeFingerprint: z.boolean().default(true),
  hideWebDriver: z.boolean().default(true),
  blockWebRTC: z.boolean().default(true),
  spoofTimezone: z.boolean().default(true),
  randomizeHeaders: z.boolean().default(true),
  useRandomUserAgent: z.boolean().default(true),
  simulateHumanBehavior: z.boolean().default(true),
  customUserAgent: z.string().optional(),
  customViewport: z.object({
    width: z.number().min(800).max(1920),
    height: z.number().min(600).max(1080)
  }).optional(),
  locale: z.string().default('en-US'),
  timezone: z.string().optional(),
  webRTCPublicIP: z.string().optional(),
  webRTCLocalIPs: z.array(z.string()).optional(),
  
  // Advanced stealth options
  proxyRotation: z.object({
    enabled: z.boolean().default(false),
    proxies: z.array(z.string()).optional(),
    rotationInterval: z.number().default(300000) // 5 minutes
  }).optional(),
  
  antiDetection: z.object({
    cloudflareBypass: z.boolean().default(true),
    recaptchaHandling: z.boolean().default(true),
    hideAutomation: z.boolean().default(true),
    spoofMediaDevices: z.boolean().default(true),
    spoofBatteryAPI: z.boolean().default(true)
  }).optional(),

  fingerprinting: z.object({
    canvasNoise: z.boolean().default(true),
    webglSpoofing: z.boolean().default(true),
    audioContextSpoofing: z.boolean().default(true),
    fontSpoofing: z.boolean().default(true),
    hardwareSpoofing: z.boolean().default(true)
  }).optional(),

  // C2: browser engine selection — 'auto' (default), 'chromium' or 'camoufox'
  // (Firefox-based). 'auto' is resolved to one of the concrete two by
  // resolveStealthEngine before anything reads this field; see it for why the
  // default moved off chromium.
  engine: z.enum(['chromium', 'camoufox', 'auto']).optional().default('auto')
});

/**
 * True when a page is driven by Chromium, the only engine that speaks CDP.
 *
 * Playwright exposes the engine as `browser.browserType().name()`. A context
 * created over a persistent/connected browser can report a null browser, so an
 * unknown engine is treated as not-Chromium: skipping an optional emulation is
 * cheap, and calling CDP on Firefox throws.
 *
 * @param {import('playwright').Page} page
 * @returns {boolean}
 */
function isChromium(page) {
  try {
    return page.context().browser()?.browserType().name() === 'chromium';
  } catch {
    return false;
  }
}

/**
 * Resolve a requested engine to the one that will actually launch.
 *
 * Camoufox is the engine that gets past the walls a stealth call is made for —
 * it spoofs at the C++/Juggler level, where a page cannot see the seam — so
 * 'auto', now the default everywhere, asks for it and drops to Chromium only
 * when the package is not there. That is the semantic ResearchOrchestrator has
 * run with since v4.6.6 (RESEARCH_STEALTH_ENGINE='auto'); it is lifted here so
 * every stealth path shares one definition of it.
 *
 * A caller who NAMED an engine gets that engine and nothing else: 'camoufox'
 * is never downgraded, so a missing install still fails at launch with the
 * install instructions rather than quietly running a browser the caller
 * rejected — the failure mode this whole review exists to remove.
 *
 * @param {'auto'|'chromium'|'camoufox'|'playwright'|null|undefined} requested
 *   'playwright' is the tool layer's public name for chromium; null/undefined
 *   mean 'auto'.
 * @returns {Promise<{engine: 'chromium'|'camoufox', fallbackWarning: string|null}>}
 *   fallbackWarning is set only when 'auto' wanted camoufox and could not have
 *   it, and is the one thing that stops that downgrade from being silent.
 */
export async function resolveStealthEngine(requested) {
  if (requested === 'camoufox') return { engine: 'camoufox', fallbackWarning: null };
  if (requested && requested !== 'auto') return { engine: 'chromium', fallbackWarning: null };

  let reason = 'camoufox is not installed (npm install camoufox)';
  try {
    if (await new CamoufoxAdapter().isAvailable()) {
      return { engine: 'camoufox', fallbackWarning: null };
    }
  } catch (error) {
    // Installed-but-broken arrives as a throw, and it is a different problem
    // from not installed — a fetched binary that will not load is worth
    // naming. Either way it is a reason to run Chromium, not to fail a scrape
    // the caller never asked to pin to one engine.
    reason = error.message;
  }
  return {
    engine: 'chromium',
    fallbackWarning:
      `Stealth engine fell back to chromium: ${reason}. ` +
      'Camoufox passes bot walls this Chromium does not; install it to use it.'
  };
}

export class StealthBrowserManager {
  constructor(options = {}) {
    this.browser = null;
    // Why the running browser is not the engine 'auto' asked for, or null when
    // nothing was downgraded. Kept on the instance beside _launchedEngine so a
    // tool layer can tell the caller which browser actually ran — a drop to
    // Chromium that nobody reports reads as a camoufox result that failed.
    this._engineFallbackWarning = null;
    this._maxContexts = parseInt(process.env.MAX_BROWSER_CONTEXTS || '10', 10);
    this.contexts = this._createContextPool();
    // D2.2: fingerprints Map is capped at _maxContexts to prevent unbounded growth.
    // Oldest entries are evicted when the cap is exceeded (insertion order via Map).
    this.fingerprints = new Map();
    
    // Enhanced stealth components
    this.humanBehaviorSimulator = null;
    this.proxyManager = {
      currentProxy: null,
      proxyIndex: 0,
      lastRotation: 0,
      activeProxies: []
    };
    
    // Detection bypass cache
    this.bypassCache = new Map();
    
    // Canvas fingerprint cache to maintain consistency
    this.canvasCache = new Map();
    
    // Performance monitoring
    this.performanceMetrics = {
      detectionAttempts: 0,
      successfulBypasses: 0,
      failedBypasses: 0,
      averageResponseTime: 0
    };
    
    // Default stealth configuration
    this.defaultConfig = {
      level: 'medium',
      randomizeFingerprint: true,
      hideWebDriver: true,
      blockWebRTC: true,
      spoofTimezone: true,
      randomizeHeaders: true,
      useRandomUserAgent: true,
      simulateHumanBehavior: true,
      locale: 'en-US',
      proxyRotation: { enabled: false },
      antiDetection: {
        cloudflareBypass: true,
        recaptchaHandling: true,
        hideAutomation: true,
        spoofMediaDevices: true,
        spoofBatteryAPI: true
      },
      fingerprinting: {
        canvasNoise: true,
        webglSpoofing: true,
        audioContextSpoofing: true,
        fontSpoofing: true,
        hardwareSpoofing: true
      }
    };

    // User agent pools. Chrome majors track the bundled Chromium (151 at
    // playwright-core 1.62) and Firefox tracks the Camoufox build (135): a
    // UA thirty majors behind the engine — the pool sat at 119–121 while
    // Chrome 152 shipped — is a staleness tell for anything that reads
    // sec-ch-ua (R15, 2026-09-04).
    //
    // The Chrome major is now read from the installed binary rather than
    // listed. A pool of four majors on one binary meant three of four personas
    // mis-stated the version navigator.userAgentData reports — the UA claimed
    // Chrome 149 on a 151 Chromium (2026-09-21 benchmark, ua-version-vs-binary).
    // One string per OS is not lost entropy: Chrome's UA has been frozen since
    // the UA-reduction rollout, so minor/build/patch are always 0.0.0 and the OS
    // token is fixed, and that one string is the only one a real Chrome of that
    // major sends. Variation lives in the display, fonts, hardware and persona.
    this.chromeVersion = StealthBrowserManager.installedChromeVersion() || `${FALLBACK_CHROME_MAJOR}.0.0.0`;
    this.chromeMajor = StealthBrowserManager.majorVersion(this.chromeVersion) || FALLBACK_CHROME_MAJOR;
    this.userAgentPools = {
      chrome: this.buildChromeUserAgents(this.chromeMajor),
      firefox: {
        windows: [
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0'
        ],
        macos: [
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:135.0) Gecko/20100101 Firefox/135.0'
        ],
        linux: [
          'Mozilla/5.0 (X11; Linux x86_64; rv:135.0) Gecko/20100101 Firefox/135.0',
          'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:135.0) Gecko/20100101 Firefox/135.0'
        ]
      },
      safari: {
        macos: [
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15'
        ]
      }
    };

    // No OS distribution any more: the persona's OS is the host's (see
    // selectOS), not a draw from market share.

    // Browser market share for realistic selection
    this.browserDistribution = {
      chrome: 0.65,
      firefox: 0.20,
      safari: 0.15
    };

    // Screen sizes (CSS pixels) with market distribution. The screen is the
    // root of the display — the window is derived from it in generateDisplay.
    // 1536×864 and 1280×720 are 1920×1080 panels at 125% / 150% scaling, so
    // each size names the device scale factors it is really seen at.
    this.viewportSizes = [
      { width: 1920, height: 1080, weight: 0.27, dpr: [1] },     // Most common
      { width: 1366, height: 768, weight: 0.20, dpr: [1] },      // Second most common
      { width: 1536, height: 864, weight: 0.15, dpr: [1.25] },
      { width: 1440, height: 900, weight: 0.12, dpr: [1] },
      { width: 1280, height: 720, weight: 0.10, dpr: [1.5, 1] },
      { width: 1600, height: 900, weight: 0.08, dpr: [1] },
      { width: 1024, height: 768, weight: 0.05, dpr: [1] },      // Legacy but still used
      { width: 2560, height: 1440, weight: 0.03, dpr: [1] }      // High-res displays
    ];
    // Retina Macs report their "looks like" size at a scale factor of 2.
    this.macScreenSizes = [
      { width: 1440, height: 900, weight: 0.35, dpr: [2] },
      { width: 1512, height: 982, weight: 0.25, dpr: [2] },
      { width: 1728, height: 1117, weight: 0.15, dpr: [2] },
      { width: 1680, height: 1050, weight: 0.10, dpr: [2] },
      { width: 1920, height: 1080, weight: 0.15, dpr: [1, 2] }   // External display
    ];
    
    // Mobile viewport sizes for mobile emulation
    this.mobileViewportSizes = [
      { width: 375, height: 667, weight: 0.25 }, // iPhone SE/8
      { width: 414, height: 896, weight: 0.20 }, // iPhone 11/XR
      { width: 390, height: 844, weight: 0.15 }, // iPhone 12/13/14
      { width: 360, height: 640, weight: 0.15 }, // Android common
      { width: 412, height: 915, weight: 0.10 }, // Pixel
      { width: 393, height: 851, weight: 0.10 }, // Pixel 7
      { width: 320, height: 568, weight: 0.05 }  // iPhone 5s (legacy)
    ];

    // Locale personas: timezone, country and a plausible city centre drawn
    // together, so one fingerprint cannot claim Asia/Tokyo, a Beijing
    // geolocation and en-US at the same time. A self-contradicting fingerprint
    // is a stronger detection signal than no spoofing at all — these are picked
    // once per fingerprint and threaded through timezone, geolocation and
    // Accept-Language.
    this.localePersonas = [
      { locale: 'en-US', timezone: 'America/New_York',    country: 'US', latitude: 40.7128,  longitude: -74.0060 },
      { locale: 'en-US', timezone: 'America/Chicago',     country: 'US', latitude: 41.8781,  longitude: -87.6298 },
      { locale: 'en-US', timezone: 'America/Denver',      country: 'US', latitude: 39.7392,  longitude: -104.9903 },
      { locale: 'en-US', timezone: 'America/Los_Angeles', country: 'US', latitude: 34.0522,  longitude: -118.2437 },
      { locale: 'en-GB', timezone: 'Europe/London',       country: 'GB', latitude: 51.5074,  longitude: -0.1278 },
      { locale: 'de-DE', timezone: 'Europe/Berlin',       country: 'DE', latitude: 52.5200,  longitude: 13.4050 },
      { locale: 'fr-FR', timezone: 'Europe/Paris',        country: 'FR', latitude: 48.8566,  longitude: 2.3522 },
      { locale: 'es-ES', timezone: 'Europe/Madrid',       country: 'ES', latitude: 40.4168,  longitude: -3.7038 },
      { locale: 'ja-JP', timezone: 'Asia/Tokyo',          country: 'JP', latitude: 35.6762,  longitude: 139.6503 },
      { locale: 'en-AU', timezone: 'Australia/Sydney',    country: 'AU', latitude: -33.8688, longitude: 151.2093 }
    ];

    // WebRTC leak prevention IPs
    this.webRTCIPs = [
      '192.168.1.1',
      '192.168.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '172.16.1.1'
    ];
  }

  /**
   * Build the context pool. Also used by cleanup(): the pool's destroy()
   * permanently stops its idle timer, so a destroyed pool must be replaced.
   */
  _createContextPool() {
    return new BrowserContextPool({
      maxContexts: this._maxContexts,
      periodicRefreshAfter: 200,
      closeIdleAfterMs: 30 * 60 * 1000,
      waitTimeoutMs: 10_000,
      onContextExpired: (contextId) => {
        this.fingerprints.delete(contextId);
      }
    });
  }

  /**
   * Launch stealth browser with anti-detection configurations.
   * C2: honours config.engine — 'chromium' (default) or 'camoufox' (Firefox-based).
   */
  async launchStealthBrowser(config = {}) {
    const validatedConfig = StealthConfigSchema.parse({ ...this.defaultConfig, ...config });
    // 'auto' has to become a concrete engine before the comparison below: an
    // unresolved 'auto' never equals _launchedEngine, so every call would park
    // a perfectly good browser and launch a second one beside it. This is the
    // call that decides the engine — every other path reaches a browser
    // through it — so it is the one that records the outcome.
    await this._resolveConfigEngine(validatedConfig, true);

    // A Chromium that was OOM-killed or crashed doesn't error on reuse — its
    // protocol calls hang. Detect the corpse and relaunch instead.
    if (this.browser && !this.browser.isConnected()) {
      this.browser = null;
    }

    // C2: the requested engine differs from the running browser. Park the
    // running one instead of closing it: closing took every live context in
    // it along, so a create_context on Chromium followed by any camoufox
    // scrape left the caller's contextId pointing at a closed browser
    // ("Target page, context or browser has been closed", R17 2026-09-04).
    // Each engine keeps its own browser; cleanup() closes the parked ones.
    if (this.browser && this._launchedEngine && this._launchedEngine !== validatedConfig.engine) {
      this._parkedBrowsers ??= new Map();
      this._parkedBrowsers.set(this._launchedEngine, this.browser);
      const parked = this._parkedBrowsers.get(validatedConfig.engine);
      this._parkedBrowsers.delete(validatedConfig.engine);
      this.browser = parked && parked.isConnected() ? parked : null;
      this._launchedEngine = this.browser ? validatedConfig.engine : null;
    }

    if (this.browser) {
      return this.browser;
    }

    // Guard against concurrent callers both seeing this.browser === null and
    // both launching a Chromium/Camoufox process — the second assignment to
    // this.browser would overwrite the first, orphaning it. Callers that
    // arrive while a launch is already in flight await the same promise.
    if (this._launchPromise) {
      return this._launchPromise;
    }
    this._launchPromise = this._doLaunchStealthBrowser(validatedConfig);
    try {
      return await this._launchPromise;
    } finally {
      this._launchPromise = null;
    }
  }

  /**
   * Rewrite config.engine in place to the engine that will actually launch,
   * recording any downgrade on the instance.
   *
   * In place, because `engine` is read again further down — the park/reuse
   * comparison, the fingerprint's browser pool, the camoufox context surgery —
   * and every one of them has to see the same answer. Idempotent and cheap (a
   * concrete engine resolves to itself; isAvailable()'s require is cached by
   * the module loader), so the context path and the launch path can each call
   * it without arranging who goes first.
   *
   * @param {{engine: string}} validatedConfig — mutated
   * @param {boolean} [ownsTheDecision] — true for the call this launch's engine
   *   is decided by (launchStealthBrowser). _doLaunchStealthBrowser re-checks
   *   the very config that call already resolved, and recording "nothing was
   *   downgraded" there would erase the downgrade the first pass had just
   *   found — which is how the fallback would go silent again.
   * @returns {Promise<string|null>} this call's fallback warning, if any
   */
  async _resolveConfigEngine(validatedConfig, ownsTheDecision = false) {
    // A concrete engine is already the answer and cannot have fallen back.
    if (validatedConfig.engine && validatedConfig.engine !== 'auto') {
      if (ownsTheDecision) this._engineFallbackWarning = null;
      return null;
    }

    const { engine, fallbackWarning } = await resolveStealthEngine(validatedConfig.engine);
    validatedConfig.engine = engine;
    this._engineFallbackWarning = fallbackWarning;
    return fallbackWarning;
  }

  /**
   * Actual browser launch, guarded by launchStealthBrowser's in-flight
   * promise so only one launch can be in progress at a time.
   */
  async _doLaunchStealthBrowser(validatedConfig) {
    // Resolved again here rather than trusted: this method is reachable on its
    // own, and an 'auto' that got this far unresolved would fall through to the
    // chromium branch below — the exact silent downgrade 'auto' is meant to
    // report.
    await this._resolveConfigEngine(validatedConfig);

    // C2: delegate to CamoufoxAdapter when engine === 'camoufox'
    if (validatedConfig.engine === 'camoufox') {
      const adapter = new CamoufoxAdapter();
      const available = await adapter.isAvailable();
      if (!available) {
        throw new Error(
          'camoufox is not installed. Run: npm install camoufox to use the Firefox-based stealth engine.'
        );
      }
      // camoufox fixes its fingerprint — and, with geoip, its geolocation,
      // timezone and locale — at launch, from the proxy it is launched with.
      // So the proxy is resolved once here and reused for every context this
      // browser serves (see createStealthContext): rotating underneath it would
      // leave camoufox reporting the first proxy's city behind the second
      // proxy's exit IP, which is a worse signal than not rotating at all.
      // A rotation takes effect on the next launch, after cleanup().
      const proxy = this.resolveProxy(validatedConfig);
      // The caller's locale goes to the launcher, not to the context. camoufox
      // sets language, Accept-Language and Intl together below the JS layer,
      // where a Worker reads the same answer as the document; Playwright's
      // Firefox context override reaches the document only, so asking for
      // de-DE there produced ["de-DE"] in the page beside camoufox's own list
      // in its worker (2026-09-21 benchmark, worker-languages). Fixed at
      // launch, like the proxy: a later context asking for a different locale
      // inherits the launched one until cleanup(). With a proxy, geoip derives
      // the locale from the exit IP and must win — a persona from this call
      // would name a country the address contradicts.
      const locale = proxy ? null : validatedConfig.locale;
      const browser = await adapter.launch({
        // 'virtual' runs a real, windowed Firefox inside Xvfb instead of the
        // headless build. Headless Firefox is its own tell — no window manager,
        // no compositor, and a set of media/GL answers that differ from the
        // browser everyone else runs — and camoufox ships this mode precisely
        // to avoid it. Only on Linux: that is where a hosted image has no
        // display and where the Dockerfile provides Xvfb; a Mac or Windows
        // developer machine has neither, so plain headless stays there.
        headless: process.platform === 'linux' ? 'virtual' : true,
        proxy,
        locale,
        // camoufox draws its persona from ["windows","macos","linux"] when it
        // is told nothing, so it claimed Windows on a Mac while still reporting
        // an Apple M1 GPU and a `-apple-system: Mac` CSS platform hint
        // (2026-09-21 benchmark, persona-os-vs-host). The host's OS is the only
        // one the GPU strings, the font list and the TCP/IP fingerprint agree
        // with, so it is the one camoufox is given.
        //
        // KNOWN NOT TO TAKE EFFECT on camoufox npm 0.1.19, measured 2026-09-21:
        // ten launches asking for "macos" on a Mac produced a Mac persona about
        // one time in three, which is the market-share draw, not the answer to a
        // constraint. The client forwards `{ screen, os }` to
        // fingerprint-generator (chunk-QNWJYPXY.js `generateFingerprint`), whose
        // option for this is `operatingSystems: string[]` — `os` is not a key it
        // knows, so it is dropped and the OS is drawn at random. The call below
        // is the documented API and is kept: it is inert (camoufox only
        // validates the value), it is correct the moment upstream honours it,
        // and the alternative — generating a BrowserForge fingerprint ourselves
        // and passing it through `fingerprint` — needs a dependency this package
        // does not declare. Phase 2 of the stealth review owns the camoufox
        // client; until then persona-os-vs-host stays baselined for camoufox.
        os: this.hostOS(),
        // Only ask for geoip when there is a proxy to derive it from. Without
        // one it would look up this machine's own public IP — a network call,
        // and an external service learning our address, to confirm a location
        // the browser is already in.
        geoip: !!proxy,
        blockWebRTC: validatedConfig.blockWebRTC,
        humanize: validatedConfig.simulateHumanBehavior,
        launchOptions: {}
      });
      browser[CAMOUFOX_PROXY] = proxy;
      browser[CAMOUFOX_LOCALE] = locale;
      this.browser = browser;
      this._launchedEngine = 'camoufox';
      return this.browser;
    }

    this._launchedEngine = 'chromium';
    // Base browser args for stealth (Chromium path)
    const stealthArgs = [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=VizDisplayCompositor',
      '--disable-plugins',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-field-trial-config',
      '--disable-back-forward-cache',
      '--disable-hang-monitor',
      '--disable-prompt-on-repost',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--no-first-run',
      '--safebrowsing-disable-auto-update',
      '--password-store=basic',
      '--use-mock-keychain',

      // A headless Chromium has no pointing device, so it reports
      // primaryPointerType=coarse/none and hover:none — the media-query answer
      // of a touchscreen kiosk under a desktop UA. These four blink settings
      // (2 = HOVER_HOVER_TYPE, 4 = POINTER_FINE_TYPE) give it the mouse a
      // desktop persona is supposed to have. Verified present in Chromium 151
      // with `strings -a` on the binary.
      '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4',

      // Additional stealth arguments
      '--disable-component-extensions-with-background-pages',
      '--disable-background-networking',
      '--disable-client-side-phishing-detection',
      '--disable-domain-reliability',
      '--disable-ipc-flooding-protection',
      '--no-default-browser-check',
      '--no-pings',
      '--disable-notifications'
    ];

    // Advanced stealth args based on level
    if (validatedConfig.level === 'advanced') {
      stealthArgs.push(
        '--disable-gpu-sandbox',
        '--disable-setuid-sandbox',
        '--disable-threaded-animation',
        '--disable-threaded-scrolling',
        '--disable-in-process-stack-traces',
        '--disable-histogram-customizer',
        '--disable-gl-extensions',
        '--disable-composited-antialiasing',
        '--disable-canvas-aa',
        '--disable-3d-apis',
        '--disable-accelerated-2d-canvas',
        '--disable-accelerated-jpeg-decoding',
        '--disable-accelerated-mjpeg-decode',
        '--disable-app-list-dismiss-on-blur',
        '--disable-accelerated-video-decode',
        '--disable-logging',
        '--silent'
      );
    }

    // WebRTC blocking. The five flags that used to stand here disabled
    // hardware codecs and extra routes — none of them stops an ICE candidate
    // carrying the real address, which is what CreepJS read the host's IPv6
    // out of (2026-09-21 benchmark, finding 9). This one is the switch that
    // governs which local addresses WebRTC may use: with it, only the address
    // the proxy already exposes is offered. Verified present in Chromium 151
    // with `strings -a` on the binary.
    if (validatedConfig.blockWebRTC) {
      stealthArgs.push('--webrtc-ip-handling-policy=disable_non_proxied_udp');
    }

    // No proxy argument here. Chromium's --proxy-server= has no field for the
    // user:pass every residential proxy requires, and a proxy fixed at launch
    // could never rotate: the browser it was baked into is cached for the life
    // of the process. Both engines take the proxy per context instead — see
    // createStealthContext.

    const browser = await chromium.launch({
      headless: true,
      // Hosted images set this to their system Chromium (Playwright itself
      // never reads it) — see Dockerfile.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: stealthArgs,
      // patchright's "marks you as a stealth driver" list. Playwright passes
      // all four by default, so dropping them from stealthArgs above is only
      // half the job — they have to be taken off the default set too, or the
      // command line still carries them. --disable-web-security went with them:
      // it is readable in one line from any page (a cross-origin fetch that
      // should throw and does not), and it contradicts this file's own decision
      // to leave bypassCSP unset (R15, 2026-09-04).
      ignoreDefaultArgs: [
        '--enable-blink-features=IdleDetection',
        '--enable-automation',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-popup-blocking'
      ]
    });

    // A hosted image's system Chromium may not be the version browsers.json
    // named, and the UA has to state the version that is actually running.
    this._alignUserAgentsWithBinary(browser);

    // If this Chromium dies (OOM kill, crash), drop the handle so the next
    // call relaunches instead of reusing a corpse. The identity guard keeps a
    // late event from an old instance from nulling a newer one.
    browser.on('disconnected', () => {
      if (this.browser === browser) {
        this.browser = null;
      }
    });
    this.browser = browser;

    return this.browser;
  }

  /**
   * Create stealth browser context with anti-fingerprinting
   */
  async createStealthContext(config = {}) {
    const validatedConfig = StealthConfigSchema.parse({ ...this.defaultConfig, ...config });

    // Always go through launchStealthBrowser: it returns the running browser
    // when the engine matches, and closes + relaunches on an engine mismatch.
    // Guarding on `!this.browser` here skipped that mismatch check, so a
    // camoufox request silently reused an already-running chromium browser.
    await this.launchStealthBrowser(validatedConfig);
    // The browser that came back is the authority on which engine this context
    // is created over, and everything below reads it: the fingerprint's browser
    // pool branches on it, and an 'auto' left unresolved here would draw a
    // Chrome persona for a Firefox browser.
    validatedConfig.engine = this._launchedEngine ?? validatedConfig.engine;
    const engineFallbackWarning = this._engineFallbackWarning;

    // Generate fingerprint for this context
    const fingerprint = this.generateAdvancedFingerprint(validatedConfig);
    
    const contextOptions = {
      viewport: fingerprint.viewport,
      userAgent: fingerprint.userAgent,
      locale: validatedConfig.locale,
      timezoneId: fingerprint.timezone,
      deviceScaleFactor: fingerprint.deviceScaleFactor,
      isMobile: fingerprint.isMobile,
      hasTouch: fingerprint.hasTouch,
      colorScheme: fingerprint.colorScheme,
      reducedMotion: fingerprint.reducedMotion,
      forcedColors: fingerprint.forcedColors,
      extraHTTPHeaders: fingerprint.headers,
      
      // Geolocation spoofing
      geolocation: fingerprint.geolocation,
      permissions: ['geolocation'],
      
      // Media spoofing
      screen: {
        width: fingerprint.screen.width,
        height: fingerprint.screen.height
      },
      
      // bypassCSP is deliberately NOT set: ignoring a page's Content Security
      // Policy is "invalid behavior for a normal browser" and rebrowser's
      // bot detector flags it red (R15, 2026-09-04). Every init script here
      // goes through addInitScript/evaluate, which need no CSP bypass.
      javaScriptEnabled: true,

      // Init scripts never reach a service worker, whose navigator therefore
      // reported the real "HeadlessChrome/151 (Macintosh)" beside a spoofed
      // Windows Chrome main thread (bot.incolumitas.com, R17 2026-09-04).
      // Blocking registration removes that vantage point; a page's content
      // does not depend on its service worker on a first, uncached visit.
      serviceWorkers: 'block'
    };

    // The proxy rides on the context, credentials included: Chromium takes it
    // on Target.createBrowserContext and camoufox's Juggler on
    // Browser.setContextProxy. Both were verified against a local authenticating
    // proxy. camoufox additionally gets one at launch, because its geoip lookup
    // runs there — but a launch-time proxy routes traffic and drops the
    // credentials, so the context is what actually authenticates, on both
    // engines. camoufox stays on the proxy it was launched with: its geolocation,
    // timezone and locale were derived from that exit IP, and rotating
    // underneath it would leave the first proxy's city behind the second
    // proxy's address.
    const proxy = this._launchedEngine === 'camoufox'
      ? (this.browser[CAMOUFOX_PROXY] || null)
      : this.resolveProxy(validatedConfig);
    if (proxy) {
      contextOptions.proxy = proxy;
    }

    if (this._launchedEngine === 'camoufox') {
      // camoufox's Firefox build predates the Browser.setDefaultViewport fields
      // playwright-core 1.62 sends (screenSize, isMobile, ...) and rejects
      // unknown properties, so any fixed viewport fails. viewport:null skips
      // that protocol call entirely (deviceScaleFactor/isMobile/hasTouch/screen
      // are invalid or meaningless without a viewport). camoufox generates its
      // own screen and window and spoofs them below the JS layer.
      contextOptions.viewport = null;
      delete contextOptions.deviceScaleFactor;
      delete contextOptions.isMobile;
      delete contextOptions.hasTouch;
      delete contextOptions.screen;
      delete contextOptions.serviceWorkers;

      // camoufox arrives with a complete Firefox identity of its own. Ours was
      // overwriting it, and not with a Firefox one: for this engine the browser
      // distribution is left open, so about two thirds of camoufox contexts were
      // handed a Chrome User-Agent on a Gecko engine. Every one of them also
      // sent sec-ch-ua, sec-ch-ua-mobile and sec-ch-ua-platform — client hints
      // Firefox has never implemented and never sends. That is a decision a
      // detector can make from the request headers alone, before a line of
      // script runs.
      delete contextOptions.userAgent;
      delete contextOptions.extraHTTPHeaders;

      // The locale goes the same way, proxy or no proxy — but it is not
      // dropped: _doLaunchStealthBrowser hands the caller's locale to camoufox
      // itself, which sets language, Accept-Language and Intl together below
      // the JS layer. Playwright's Firefox context override reaches the
      // document only, so setting it here reported ["de-DE"] in the page beside
      // camoufox's own list in its worker (2026-09-21 benchmark,
      // worker-languages).
      delete contextOptions.locale;

      // Behind a proxy, camoufox has already derived timezone and geolocation
      // from the exit IP. Those agree with the address the site sees; a persona
      // drawn here does not, so it must not override them.
      if (proxy) {
        delete contextOptions.timezoneId;
        delete contextOptions.geolocation;
      }

      // Keep what we hand back honest. create_context returns this fingerprint,
      // and reporting a Chrome user agent and a persona the browser never uses
      // is worse than reporting nothing: null reads as "the engine owns this".
      fingerprint.userAgent = null;
      fingerprint.headers = {};
      fingerprint.viewport = null;
      fingerprint.hardware = { ...fingerprint.hardware, platform: null };
      // The locale camoufox was actually launched with, which is this call's
      // only when this call is the one that launched it — null behind a proxy,
      // where geoip derived a locale we never see.
      fingerprint.locale = this.browser[CAMOUFOX_LOCALE] ?? null;
      if (proxy) {
        fingerprint.timezone = null;
      }
    }

    const context = await this.browser.newContext(contextOptions);
    const contextId = this.generateContextId();
    
    // Apply stealth scripts and configurations
    await this.applyAdvancedStealthConfigurations(context, validatedConfig, fingerprint);
    
    await this.contexts.set(contextId, { context, fingerprint, config: validatedConfig });
    // D2.2: enforce LRU cap on fingerprints Map
    this._setFingerprint(contextId, fingerprint);

    // The engine and its warning ride back with the context, not only on the
    // instance: the instance fields follow the browser, which the next call
    // may switch, and the caller of THIS context still has to be able to say
    // which browser it got.
    return { context, contextId, fingerprint, engine: validatedConfig.engine, engineFallbackWarning };
  }

  /**
   * Generate advanced browser fingerprint with enhanced randomization
   */
  generateAdvancedFingerprint(config = {}) {
    // Select the OS and the locale persona once, then thread both through every
    // generator. The OS drives UA, headers, hardware, device labels, fonts and
    // WebGL; the persona drives timezone, geolocation and Accept-Language. The
    // user agent is resolved here rather than twice, so sec-ch-ua cannot report
    // a different Chrome version than the User-Agent header.
    const selectedOS = this.selectOS(config);
    const persona = this.selectLocalePersona(config);
    const userAgent = this.selectRealisticUserAgent(config, selectedOS);
    const display = this.generateDisplay(selectedOS, config);
    const fingerprint = {
      userAgent,
      locale: persona.locale,
      viewport: display.viewport,
      timezone: config.timezone || persona.timezone,
      deviceScaleFactor: display.deviceScaleFactor,
      // Every user agent in the pool is a desktop one; mobile emulation under
      // it (10% of fingerprints until R16) contradicted the UA outright.
      isMobile: false,
      hasTouch: selectedOS === 'windows' && Math.random() < 0.15, // touch laptops
      colorScheme: Math.random() < 0.3 ? 'dark' : 'light',
      reducedMotion: Math.random() < 0.1 ? 'reduce' : 'no-preference',
      forcedColors: Math.random() < 0.05 ? 'active' : 'none',
      headers: this.generateAdvancedHeaders(config, selectedOS, persona, userAgent),
      webRTC: this.generateWebRTCConfig(config),
      canvas: this.generateAdvancedCanvasFingerprint(),
      webGL: this.generateAdvancedWebGLFingerprint(selectedOS),
      audioContext: this.generateAudioContextFingerprint(),
      mediaDevices: this.generateMediaDevicesFingerprint(selectedOS),
      hardware: this.generateHardwareFingerprint(selectedOS),
      fonts: this.generateAdvancedFontList(selectedOS),
      plugins: this.generateAdvancedPluginList(),
      geolocation: this.generateRealisticGeolocation(persona),
      screen: display.screen,
      window: display.window,
      battery: this.generateBatteryFingerprint()
    };

    return fingerprint;
  }

  /**
   * The parts of a fingerprint a caller can act on. The full object is ~4 KB of
   * canvas noise arrays and WebGL extension lists that no caller reads, so
   * create_context returns this by default and the full object only on request.
   */
  summarizeFingerprint(fingerprint) {
    return {
      userAgent: fingerprint.userAgent,
      platform: fingerprint.hardware.platform,
      locale: fingerprint.locale,
      timezone: fingerprint.timezone,
      // width/height only — the pool's selection weight is an internal. null on
      // camoufox, which sizes its own window.
      viewport: fingerprint.viewport
        ? { width: fingerprint.viewport.width, height: fingerprint.viewport.height }
        : null
    };
  }

  /**
   * Pick the locale persona (timezone + country + city) for a fingerprint.
   * The caller's `locale` stays authoritative — it only narrows which personas
   * are eligible, so a caller asking for de-DE gets a Berlin timezone and
   * geolocation rather than a Denver one.
   */
  selectLocalePersona(config = {}) {
    const requested = String(config.locale || 'en-US');
    const language = requested.toLowerCase().split('-')[0];

    const exact = this.localePersonas.filter(p => p.locale.toLowerCase() === requested.toLowerCase());
    const sameLanguage = this.localePersonas.filter(p => p.locale.toLowerCase().startsWith(`${language}-`));
    // An unmodelled locale still gets a coherent timezone/geolocation pair.
    const pool = exact.length ? exact : (sameLanguage.length ? sameLanguage : this.localePersonas);

    // The host's own zone is where the egress address is. A persona drawn at
    // random put America/Chicago in JavaScript beside a Florida IP, and both
    // pixelscan and iphey called the timezone spoofed (R16, 2026-09-04). So a
    // persona in the host zone is preferred — from the requested locale's
    // pool, or from any locale when nothing beyond the default was asked for.
    // An explicit config.timezone still overrides in the caller.
    const hostZone = this.hostTimezone();
    const inHostZone = (personas) => (hostZone ? personas.find((p) => p.timezone === hostZone) : undefined);
    const persona = inHostZone(pool)
      || (requested.toLowerCase() === 'en-us' ? inHostZone(this.localePersonas) : undefined)
      || pool[Math.floor(Math.random() * pool.length)];
    return { ...persona, locale: requested };
  }

  /**
   * Choose a single OS ('windows' | 'macos' | 'linux') for a fingerprint.
   * A custom UA pins the OS to whatever that UA reports; every other path takes
   * the host's OS.
   *
   * A persona drawn at random claimed Windows, then Linux, on a macOS host
   * (2026-09-21 benchmark, persona-os-vs-host). Nothing about the machine
   * follows the draw: the TCP/IP fingerprint is the host kernel's, the GPU
   * strings and the CSS platform hints are the host's, and a WebGL renderer
   * reading "Apple M1" under a Windows UA is a cleaner signal than no spoofing
   * at all. So the OS is the one thing in this fingerprint that is not
   * randomised — it is observed.
   */
  selectOS(config = {}) {
    if (config.customUserAgent) {
      return this.inferOSFromUserAgent(config.customUserAgent);
    }
    return this.hostOS();
  }

  /**
   * The host's own OS in the vocabulary the pools and generators use. Anything
   * that is neither macOS nor Windows is treated as linux: it is the only other
   * desktop persona modelled, and the closest to a BSD host's TCP fingerprint.
   */
  hostOS() {
    if (process.platform === 'darwin') return 'macos';
    if (process.platform === 'win32') return 'windows';
    return 'linux';
  }

  /**
   * Infer the OS key from a user-agent string.
   */
  inferOSFromUserAgent(ua = '') {
    if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
    if (/Linux|X11|CrOS/i.test(ua)) return 'linux';
    return 'windows';
  }

  /**
   * The version of the Chromium that is actually installed, as
   * `151.0.7922.34`. playwright-core's browsers.json names the build it
   * downloads — the same file Scrapling reads — and is the only source
   * available before a browser is launched; once one is running,
   * _alignUserAgentsWithBinary() corrects for a hosted image that pointed
   * PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH at a Chromium of its own.
   */
  static installedChromeVersion() {
    try {
      const require = createRequire(import.meta.url);
      const file = path.join(path.dirname(require.resolve('playwright-core')), 'browsers.json');
      const entry = JSON.parse(fs.readFileSync(file, 'utf8')).browsers
        .find((browser) => browser.name === 'chromium');
      return entry?.browserVersion || null;
    } catch {
      return null;
    }
  }

  /** The leading integer of a version string: `151.0.7922.34` -> 151. */
  static majorVersion(version) {
    const match = /^(\d+)/.exec(String(version ?? '').trim());
    return match ? Number(match[1]) : null;
  }

  /**
   * One Chrome user agent per OS at `major`. Chrome froze every other token of
   * the string years ago, so these are literal, not templates with room.
   */
  buildChromeUserAgents(major) {
    const chrome = `AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
    return {
      windows: [`Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${chrome}`],
      macos: [`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${chrome}`],
      linux: [`Mozilla/5.0 (X11; Linux x86_64) ${chrome}`]
    };
  }

  /**
   * Re-derive the Chrome pool from the browser that actually launched. Only
   * does anything when the running binary is not the one browsers.json named —
   * a hosted image's system Chromium — which is exactly the case where the
   * pool would otherwise mis-state the version userAgentData reports.
   */
  _alignUserAgentsWithBinary(browser) {
    let version = null;
    try {
      version = browser.version();
    } catch { /* a browser that cannot be asked keeps the installed version */ }
    if (!version || version === this.chromeVersion) return;
    this.chromeVersion = version;
    const major = StealthBrowserManager.majorVersion(version);
    if (!major || major === this.chromeMajor) return;
    this.chromeMajor = major;
    this.userAgentPools.chrome = this.buildChromeUserAgents(major);
  }

  /**
   * Select realistic user agent based on market distribution
   */
  selectRealisticUserAgent(config, selectedOS) {
    if (config.customUserAgent) {
      return config.customUserAgent;
    }

    if (!config.useRandomUserAgent) {
      // Not "the Windows default" any more: a fixed UA still has to be the
      // host's, or it contradicts everything the machine itself reports.
      return this.userAgentPools.chrome[this.hostOS()][0];
    }

    // Use the OS chosen once for this fingerprint (falls back to the host's own
    // if called without one, which is what selectOS would have returned).
    selectedOS = selectedOS || this.hostOS();

    // Select browser based on distribution and OS compatibility
    let availableBrowsers = { ...this.browserDistribution };
    // The engine decides the pool. Chromium exposes navigator.vendor
    // "Google Inc.", window.chrome and Chrome's PDF viewer plugins, so a
    // Firefox or Safari User-Agent on it contradicts what the page can see —
    // sannysoft printed a Firefox UA beside "Chrome: present" (R14). Camoufox
    // presents its own Firefox identity and never draws from this pool.
    if (config.engine !== 'camoufox') {
      availableBrowsers = { chrome: 1 };
    }
    if (selectedOS === 'linux' && availableBrowsers.safari) {
      delete availableBrowsers.safari;
      // Redistribute safari's weight
      availableBrowsers.chrome += 0.075;
      availableBrowsers.firefox += 0.075;
    }
    
    const selectedBrowser = this.weightedRandom(availableBrowsers);
    const pool = this.userAgentPools[selectedBrowser][selectedOS];
    
    if (!pool || pool.length === 0) {
      // Fallback to Chrome Windows
      return this.userAgentPools.chrome.windows[0];
    }
    
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * One display for the whole fingerprint: the screen is drawn from the pool
   * and the window derived from it as a maximised browser — viewport width is
   * the screen width, viewport height the available height minus the browser
   * chrome, outer size the available area. The screen and the viewport used
   * to be drawn from the pool independently and the scale factor was a random
   * float, so a 1536×864 window sat on a 1366×768 screen at a scale of 1.7
   * (which Chromium reports as 1.7000000476837158 and a 1408.0000305175781px
   * screen) — pixelscan's "Your browser fingerprint is inconsistent" (R16,
   * 2026-09-04). A custom viewport gets the smallest pooled screen it fits on.
   */
  generateDisplay(selectedOS, config = {}) {
    const chrome = selectedOS === 'macos' ? 87 : 85;
    const taskbar = selectedOS === 'macos' ? 25 : (selectedOS === 'linux' ? 27 : 40);
    const pool = selectedOS === 'macos' ? this.macScreenSizes : this.viewportSizes;

    let screen;
    let viewport;
    if (config.customViewport) {
      viewport = { width: config.customViewport.width, height: config.customViewport.height };
      const needed = { width: viewport.width, height: viewport.height + chrome + taskbar };
      screen = pool
        .filter((s) => s.width >= needed.width && s.height >= needed.height)
        .sort((a, b) => a.width * a.height - b.width * b.height)[0]
        || { ...needed, dpr: [1] };
    } else {
      screen = this.weightedRandomFromArray(pool);
      viewport = { width: screen.width, height: screen.height - taskbar - chrome };
    }

    return {
      viewport,
      deviceScaleFactor: screen.dpr[Math.floor(Math.random() * screen.dpr.length)],
      screen: {
        width: screen.width,
        height: screen.height,
        availWidth: screen.width,
        availHeight: screen.height - taskbar,
        colorDepth: 24,
        pixelDepth: 24,
        orientation: { angle: 0, type: 'landscape-primary' }
      },
      window: { outerWidth: viewport.width, outerHeight: viewport.height + chrome }
    };
  }

  /**
   * The machine's own timezone, or null when it is the UTC of a container —
   * set TZ on such a host to the zone its egress address geolocates to.
   */
  hostTimezone() {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && zone !== 'UTC' && !/^(?:Etc|GMT)/.test(zone) ? zone : null;
  }

  /**
   * Generate advanced HTTP headers with realistic patterns.
   * @param {Object} config
   * @param {string} selectedOS  — the OS chosen for this fingerprint
   * @param {Object} persona     — the locale persona chosen for this fingerprint
   * @param {string} resolvedUA  — the UA already chosen for this fingerprint
   */
  generateAdvancedHeaders(config, selectedOS, persona, resolvedUA) {
    // Accept-Language follows the persona, so the header and navigator.language
    // agree with the timezone and geolocation the same persona picked.
    const language = persona.locale.split('-')[0];

    const headers = {
      'Accept-Language': `${persona.locale},${language};q=0.9`,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'max-age=0',
      'Upgrade-Insecure-Requests': '1',
      // No Sec-Fetch-* here. They are per-request values the browser computes
      // itself (a stylesheet is Sec-Fetch-Dest: style, not document), and
      // forcing navigation values onto every request through
      // setExtraHTTPHeaders made Chromium reject each subresource with
      // ERR_INVALID_ARGUMENT — jQuery never loaded, so a JS-rendered page came
      // back as a title and an empty body.
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': this.generateSecChUaPlatform(selectedOS)
    };

    // C2: pass UA so sec-ch-ua brand version matches the Chrome major version.
    headers['sec-ch-ua'] = this.generateSecChUaHeader(resolvedUA);

    // Randomize some headers
    if (Math.random() < 0.25) {
      headers['DNT'] = '1';
    }

    if (Math.random() < 0.6) {
      headers['Connection'] = 'keep-alive';
    }

    // Add Save-Data header occasionally
    if (Math.random() < 0.1) {
      headers['Save-Data'] = 'on';
    }

    return headers;
  }

  /**
   * The brand list Chrome presents, in both places it is read: the sec-ch-ua
   * request header and navigator.userAgentData.brands.
   *
   * One source for both because the two used to disagree. The header was built
   * here and said "Google Chrome"; userAgentData was left to Chromium, which
   * filled it in from the binary and answered "HeadlessChrome 151, Chromium
   * 151" with no Google Chrome brand at all — rebrowser flagged the page as
   * Chrome for Testing (2026-09-21 benchmark, useragentdata-brands and
   * headless-markers). _applyEmulatedIdentity now hands this list to the
   * renderer, so the header and the JS API are the same list.
   *
   * @param {string} [userAgent] — the selected user agent string
   * @returns {Array<{brand:string, version:string}>}
   */
  generateUserAgentBrands(userAgent = '') {
    // Extract Chrome major version from the UA (e.g. "Chrome/151.0.0.0" → "151").
    // Fall back to the installed Chromium's major if the UA is not a Chrome UA.
    const match = String(userAgent).match(/Chrome\/(\d+)/i);
    const version = match ? match[1] : String(this.chromeMajor);

    return [
      { brand: 'Not_A Brand', version: '8' },
      { brand: 'Chromium', version },
      { brand: 'Google Chrome', version }
    ];
  }

  /**
   * Generate sec-ch-ua header.
   * C2: brand versions are derived from the UA's Chrome major version so
   * sec-ch-ua and the User-Agent header stay consistent.
   * @param {string} [userAgent] — the selected user agent string
   */
  generateSecChUaHeader(userAgent = '') {
    return this.generateUserAgentBrands(userAgent)
      .map(b => `"${b.brand}";v="${b.version}"`)
      .join(', ');
  }

  /**
   * Generate sec-ch-ua-platform header
   */
  generateSecChUaPlatform(selectedOS) {
    const platforms = {
      windows: '"Windows"',
      macos: '"macOS"',
      linux: '"Linux"'
    };

    selectedOS = selectedOS || this.hostOS();
    return platforms[selectedOS] || '"Windows"';
  }

  /**
   * Generate WebRTC configuration for leak prevention
   */
  generateWebRTCConfig(config) {
    return {
      // A "public" IP inside RFC1918 space is a contradiction any WebRTC probe
      // can spot — the local candidates are the private ones, the public one
      // has to be routable.
      publicIP: config.webRTCPublicIP || this.generatePublicIPv4(),
      localIPs: config.webRTCLocalIPs || [
        '192.168.1.' + Math.floor(Math.random() * 255),
        '10.0.0.' + Math.floor(Math.random() * 255)
      ]
    };
  }

  /**
   * Random routable IPv4 address, drawn from /8s that carry ordinary
   * residential traffic (no RFC1918, loopback, link-local, CGNAT, multicast or
   * documentation ranges).
   */
  generatePublicIPv4() {
    const residentialPrefixes = [24, 47, 62, 71, 73, 86, 90, 92, 108, 176];
    const first = residentialPrefixes[Math.floor(Math.random() * residentialPrefixes.length)];
    const octet = () => Math.floor(Math.random() * 254) + 1;
    return `${first}.${octet()}.${Math.floor(Math.random() * 256)}.${octet()}`;
  }

  /**
   * Advanced Canvas fingerprinting protection with noise injection
   */
  generateAdvancedCanvasFingerprint() {
    const seed = crypto.randomBytes(16).toString('hex');
    
    return {
      seed,
      noisePattern: this.generateCanvasNoise(seed),
      textMetrics: {
        width: this.randomFloat(45, 210, 3),
        height: this.randomFloat(8, 35, 3),
        actualBoundingBoxLeft: this.randomFloat(-2, 5, 3),
        actualBoundingBoxRight: this.randomFloat(50, 200, 3),
        actualBoundingBoxAscent: this.randomFloat(10, 25, 3),
        actualBoundingBoxDescent: this.randomFloat(2, 8, 3)
      },
      imageData: this.generateCanvasImageData(seed)
    };
  }

  /**
   * Generate consistent canvas noise based on seed
   */
  generateCanvasNoise(seed) {
    const noise = [];
    let seedNum = parseInt(seed.substring(0, 8), 16);
    
    for (let i = 0; i < 100; i++) {
      seedNum = (seedNum * 9301 + 49297) % 233280;
      noise.push((seedNum / 233280) * 2 - 1); // -1 to 1
    }
    
    return noise;
  }

  /**
   * Generate canvas image data with controlled randomness
   */
  generateCanvasImageData(seed) {
    const hash = crypto.createHash('md5').update(seed).digest('hex');
    return {
      checksum: hash.substring(0, 16),
      variance: parseFloat('0.' + hash.substring(16, 24)),
      pixelShift: parseInt(hash.substring(24, 26), 16) % 3
    };
  }

  /**
   * Enhanced WebGL fingerprinting with realistic spoofing
   */
  generateAdvancedWebGLFingerprint(selectedOS) {
    // A Direct3D11 renderer on a Mac user agent is a contradiction, so the GPU
    // string follows the OS: D3D11 on Windows, Metal on macOS, OpenGL on Linux.
    const gpuVendorsByOS = {
      windows: [
        { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)' },
        { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
        { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) HD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
        { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0, D3D11)' },
        { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' }
      ],
      macos: [
        { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)' },
        { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)' },
        { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, ANGLE Metal Renderer: Intel(R) Iris(TM) Plus Graphics 640, Unspecified Version)' }
      ],
      linux: [
        { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)' },
        { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6600 (radeonsi, navi23, LLVM 15.0.7), OpenGL 4.6)' },
        { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL 4.6)' }
      ]
    };

    const gpuVendors = gpuVendorsByOS[selectedOS] || gpuVendorsByOS.windows;
    const selectedGpu = gpuVendors[Math.floor(Math.random() * gpuVendors.length)];

    return {
      vendor: selectedGpu.vendor,
      renderer: selectedGpu.renderer,
      version: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)',
      shadingLanguageVersion: 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)',
      extensions: this.generateWebGLExtensions(),
      parameters: this.generateWebGLParameters(),
      supportedFormats: this.generateWebGLFormats()
    };
  }

  /**
   * Generate realistic WebGL extensions list
   */
  generateWebGLExtensions() {
    const baseExtensions = [
      'ANGLE_instanced_arrays',
      'EXT_blend_minmax',
      'EXT_color_buffer_half_float',
      'EXT_disjoint_timer_query',
      'EXT_float_blend',
      'EXT_frag_depth',
      'EXT_shader_texture_lod',
      'EXT_texture_compression_rgtc',
      'EXT_texture_filter_anisotropic',
      'EXT_sRGB',
      'OES_texture_float',
      'OES_texture_float_linear',
      'OES_texture_half_float',
      'OES_texture_half_float_linear',
      'OES_vertex_array_object',
      'WEBKIT_EXT_texture_filter_anisotropic',
      'WEBKIT_WEBGL_depth_texture'
    ];
    
    const optionalExtensions = [
      'EXT_color_buffer_float',
      'EXT_texture_compression_bptc',
      'EXT_texture_norm16',
      'OES_draw_buffers_indexed',
      'WEBGL_color_buffer_float',
      'WEBGL_compressed_texture_s3tc',
      'WEBGL_debug_renderer_info',
      'WEBGL_debug_shaders',
      'WEBGL_depth_texture',
      'WEBGL_draw_buffers',
      'WEBGL_lose_context'
    ];
    
    const extensions = [...baseExtensions];
    
    // Randomly include optional extensions (60-90% chance each)
    optionalExtensions.forEach(ext => {
      if (Math.random() < 0.6 + Math.random() * 0.3) {
        extensions.push(ext);
      }
    });
    
    return extensions.sort();
  }

  /**
   * Generate WebGL parameters with realistic values
   */
  generateWebGLParameters() {
    return {
      MAX_TEXTURE_SIZE: 16384,
      MAX_CUBE_MAP_TEXTURE_SIZE: 16384,
      MAX_RENDERBUFFER_SIZE: 16384,
      MAX_VERTEX_ATTRIBS: 16,
      MAX_VERTEX_UNIFORM_VECTORS: 1024,
      MAX_FRAGMENT_UNIFORM_VECTORS: 1024,
      MAX_VARYING_VECTORS: 30,
      MAX_COMBINED_TEXTURE_IMAGE_UNITS: 32,
      MAX_VERTEX_TEXTURE_IMAGE_UNITS: 16,
      MAX_TEXTURE_IMAGE_UNITS: 16,
      MAX_VIEWPORT_DIMS: [16384, 16384],
      ALIASED_LINE_WIDTH_RANGE: [1, 1],
      ALIASED_POINT_SIZE_RANGE: [1, 1024]
    };
  }

  /**
   * Generate WebGL supported formats
   */
  generateWebGLFormats() {
    return {
      textureFormats: ['RGB', 'RGBA', 'LUMINANCE', 'LUMINANCE_ALPHA', 'ALPHA'],
      compressedFormats: ['COMPRESSED_RGB_S3TC_DXT1_EXT', 'COMPRESSED_RGBA_S3TC_DXT5_EXT'],
      depthFormats: ['DEPTH_COMPONENT16', 'DEPTH_STENCIL'],
      pixelTypes: ['UNSIGNED_BYTE', 'UNSIGNED_SHORT_4_4_4_4', 'UNSIGNED_SHORT_5_5_5_1', 'UNSIGNED_SHORT_5_6_5']
    };
  }

  /**
   * Advanced audio context spoofing
   */
  generateAudioContextFingerprint() {
    return {
      sampleRate: 44100 + Math.floor(Math.random() * 2000), // Slight variation
      baseLatency: this.randomFloat(0.005, 0.02, 6),
      outputLatency: this.randomFloat(0.01, 0.05, 6),
      maxChannelCount: 2 + Math.floor(Math.random() * 6), // 2-8 channels
      numberOfInputs: Math.floor(Math.random() * 2) + 1,
      numberOfOutputs: Math.floor(Math.random() * 2) + 1,
      channelCount: 2,
      channelCountMode: 'max',
      channelInterpretation: 'speakers'
    };
  }

  /**
   * Enhanced media devices spoofing
   */
  generateMediaDevicesFingerprint(selectedOS) {
    // Device labels are OS-specific strings: a FaceTime HD Camera on a Win32
    // navigator.platform is a giveaway, so the labels follow the chosen OS.
    const labelsByOS = {
      windows: {
        video: ['HD Pro Webcam C920 (046d:082d)', 'Integrated Camera (04f2:b6d9)'],
        audioinput: ['Microphone (Realtek(R) Audio)', 'Microphone Array (Intel® Smart Sound Technology)'],
        audiooutput: ['Speakers (Realtek(R) Audio)', 'Headphones (Realtek(R) Audio)']
      },
      macos: {
        video: ['FaceTime HD Camera', 'FaceTime HD Camera (Built-in)'],
        audioinput: ['MacBook Pro Microphone', 'External Microphone'],
        audiooutput: ['MacBook Pro Speakers', 'External Headphones']
      },
      linux: {
        video: ['Integrated Camera: Integrated C', 'USB2.0 HD UVC WebCam'],
        audioinput: ['Built-in Audio Analog Stereo', 'Monitor of Built-in Audio Analog Stereo'],
        audiooutput: ['Built-in Audio Analog Stereo', 'HDMI / DisplayPort']
      }
    };

    const labels = labelsByOS[selectedOS] || labelsByOS.windows;
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const device = (kind, label) => ({
      deviceId: crypto.randomUUID(),
      kind,
      label,
      groupId: crypto.randomUUID()
    });

    const selectedDevices = [];
    if (Math.random() < 0.8) selectedDevices.push(device('videoinput', pick(labels.video)));
    selectedDevices.push(device('audioinput', pick(labels.audioinput)));
    if (Math.random() < 0.9) selectedDevices.push(device('audiooutput', pick(labels.audiooutput)));

    return selectedDevices;
  }

  /**
   * Generate realistic hardware fingerprint
   */
  generateHardwareFingerprint(selectedOS) {
    selectedOS = selectedOS || this.hostOS();

    const processors = [
      { cores: 4, threads: 8, name: 'Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz' },
      { cores: 6, threads: 12, name: 'Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz' },
      { cores: 8, threads: 16, name: 'Intel(R) Core(TM) i7-10700K CPU @ 3.80GHz' },
      { cores: 4, threads: 4, name: 'Intel(R) Core(TM) i5-7400 CPU @ 3.00GHz' },
      { cores: 6, threads: 6, name: 'AMD Ryzen 5 3600 6-Core Processor' },
      { cores: 8, threads: 16, name: 'AMD Ryzen 7 3700X 8-Core Processor' }
    ];

    // hardwareConcurrency and deviceMemory are observed, not drawn — the same
    // call taken for the persona OS, and for the same reason.
    //
    // Both are readable from a Worker. An init script does not run in one, and
    // Emulation.setHardwareConcurrencyOverride does not reach one either: a
    // Worker is a separate target and the Emulation domain is not available on
    // it. So a drawn value only ever landed in the document, beside the host's
    // real one in the worker — 16 cores against 32 (2026-09-21 benchmark,
    // worker-hardware-concurrency). A machine that reports its own cores is not
    // a signal. A machine that disagrees with itself is.
    const hardwareConcurrency = this.hostHardwareConcurrency();
    const matching = processors.filter((p) => p.threads === hardwareConcurrency);
    const selectedProcessor = matching.length
      ? matching[Math.floor(Math.random() * matching.length)]
      // No modelled CPU has this many threads. Name one that could — the
      // processor string is reported in the fingerprint, never to a page.
      : {
          cores: Math.max(1, Math.round(hardwareConcurrency / 2)),
          threads: hardwareConcurrency,
          name: `AMD Ryzen ${Math.max(1, Math.round(hardwareConcurrency / 2))}-Core Processor`
        };

    return {
      hardwareConcurrency,
      processor: selectedProcessor.name,
      architecture: 'x86_64',
      memory: Math.floor(Math.random() * 24) + 8, // 8-32 GB
      deviceMemory: this.hostDeviceMemory(),
      platform: this.selectRealisticPlatform(selectedOS)
    };
  }

  /**
   * The core count navigator.hardwareConcurrency will report: the host's own
   * logical CPU count, which is what Chromium answers with
   * (base::SysInfo::NumberOfProcessors) in the document and in every worker.
   */
  hostHardwareConcurrency() {
    const count = os.cpus()?.length || 0;
    return count > 0 ? count : 4;
  }

  /**
   * navigator.deviceMemory as Chromium computes it: physical RAM rounded to the
   * nearest power of two, in GiB, then clamped to [0.25, 8]. The clamp is why
   * 16 or 32 is a value no real browser reports (sannysoft CHR_MEMORY: FAIL),
   * and why almost every desktop answers 8.
   */
  hostDeviceMemory() {
    const gib = os.totalmem() / (1024 ** 3);
    if (!(gib > 0)) return 8;
    return Math.min(8, Math.max(0.25, 2 ** Math.round(Math.log2(gib))));
  }

  /**
   * Map the chosen OS to its navigator.platform value so it stays consistent
   * with the user-agent and sec-ch-ua-platform header.
   */
  selectRealisticPlatform(selectedOS) {
    switch (selectedOS) {
      case 'macos':
        return 'MacIntel';
      case 'linux':
        return 'Linux x86_64';
      case 'windows':
      default:
        return 'Win32';
    }
  }

  /**
   * Generate advanced font list with realistic variation
   */
  generateAdvancedFontList(selectedOS) {
    const baseFonts = [
      'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Verdana',
      'Georgia', 'Palatino', 'Garamond', 'Bookman', 'Tahoma', 'Geneva'
    ];

    const systemFonts = {
      windows: ['Segoe UI', 'Calibri', 'Consolas', 'Cambria', 'Candara'],
      macos: ['SF Pro Display', 'Helvetica Neue', 'Menlo', 'Avenir', 'Optima'],
      linux: ['Ubuntu', 'DejaVu Sans', 'Liberation Sans', 'Noto Sans', 'Source Sans Pro']
    };

    const additionalFonts = [
      'Comic Sans MS', 'Trebuchet MS', 'Arial Black', 'Impact',
      'Lucida Sans Unicode', 'Franklin Gothic Medium', 'Arial Narrow'
    ];

    // Start with base fonts
    const fonts = [...baseFonts];
    
    // Add system-specific fonts for the OS this fingerprint claims to run.
    // (This used to call selectRealisticPlatform() with no OS, which always
    // returned Win32 — so a macOS persona shipped a Windows-only font list.)
    const osKey = systemFonts[selectedOS] ? selectedOS : 'windows';

    systemFonts[osKey].forEach(font => {
      if (Math.random() < 0.8) { // 80% chance to include
        fonts.push(font);
      }
    });

    // Randomly include additional fonts
    additionalFonts.forEach(font => {
      if (Math.random() < 0.6) {
        fonts.push(font);
      }
    });

    return fonts.sort();
  }

  /**
   * Generate advanced plugin list
   */
  generateAdvancedPluginList() {
    const plugins = [];
    
    // Chrome PDF Plugin (almost always present)
    if (Math.random() < 0.95) {
      plugins.push({
        name: 'Chrome PDF Plugin',
        filename: 'internal-pdf-viewer',
        description: 'Portable Document Format',
        version: '1'
      });
    }

    // Chrome PDF Viewer
    if (Math.random() < 0.8) {
      plugins.push({
        name: 'Chrome PDF Viewer',
        filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
        description: 'Portable Document Format',
        version: '1'
      });
    }

    // Native Client
    if (Math.random() < 0.3) {
      plugins.push({
        name: 'Native Client',
        filename: 'internal-nacl-plugin',
        description: 'Native Client Executable',
        version: '1'
      });
    }

    return plugins;
  }

  /**
   * Generate realistic geolocation data for a locale persona.
   * The city comes from the persona (not a second independent draw), so the
   * coordinates always sit in the country whose timezone the fingerprint
   * reports.
   * @param {{latitude:number, longitude:number}} persona
   */
  generateRealisticGeolocation(persona) {
    return {
      latitude: persona.latitude + (Math.random() - 0.5) * 0.05, // ±0.025 degrees (~2.8km)
      longitude: persona.longitude + (Math.random() - 0.5) * 0.05,
      accuracy: Math.floor(Math.random() * 50) + 20 // 20-70m accuracy
    };
  }


  /**
   * Generate battery API fingerprint
   */
  generateBatteryFingerprint() {
    return {
      charging: Math.random() < 0.7, // 70% chance charging
      chargingTime: Math.random() < 0.3 ? Math.floor(Math.random() * 7200) : Infinity,
      dischargingTime: Math.random() < 0.7 ? Math.floor(Math.random() * 28800) + 3600 : Infinity, // 1-9 hours
      level: Math.random() * 0.7 + 0.2 // 20-90%
    };
  }

  /**
   * Apply advanced stealth configurations to browser context
   */
  async applyAdvancedStealthConfigurations(context, config, fingerprint) {
    // Nothing is injected into camoufox.
    //
    // Every script below is Chromium-shaped — it patches navigator.webdriver,
    // installs a window.chrome, and patches getContext, AudioContext and font
    // metrics from the main world. camoufox does all of that in its own
    // C++/Juggler layer, where there is no JS seam to find, and a page that
    // compares property descriptors, Function.prototype.toString output or the
    // main thread against a Worker sees ours and not camoufox's. Injecting on
    // top of an engine built to need no injection only adds back the tells the
    // engine was chosen to avoid.
    //
    // This does not clear deviceandbrowserinfo.com's hasInconsistentWorkerValues
    // on camoufox: that flag stayed set with every one of these disabled, so it
    // is camoufox's own worker leak, not ours. What it removes is our share.
    if (this._launchedEngine === 'camoufox') {
      return;
    }

    // Enhanced initialization script with comprehensive stealth measures
    await context.addInitScript(() => {
      // Everything this script changes about navigator goes on
      // Navigator.prototype, never on the navigator instance.
      //
      // A real Chrome answers Object.getOwnPropertyNames(navigator) with an
      // empty array: every property it has is inherited. So one
      // defineProperty(navigator, …) puts the spoof's own name in a list any
      // page can print in a line — rebrowser's bot detector prints exactly that
      // list, and it read ["connection","plugins","mimeTypes","getBattery"]
      // (2026-09-21 bench). It is the same class of tell as the deleted
      // webdriver property, one level up.
      //
      // A property that is not on the prototype is left alone rather than
      // invented: a shape that no Chromium has is worse than the real value.
      const defineOnPrototype = (key, descriptor) => {
        if (!(key in Navigator.prototype)) return false;
        try {
          // WebIDL attributes and operations are both enumerable and
          // configurable on the prototype; matching that keeps the descriptor
          // indistinguishable from the one it replaces.
          Object.defineProperty(Navigator.prototype, key, Object.assign(
            { configurable: true, enumerable: true }, descriptor
          ));
          return true;
        } catch (e) {
          return false;
        }
      };

      // navigator.webdriver reports false; the property stays. Deleting it was
      // its own tell — rebrowser's bot detector marks a missing webdriver red,
      // because every real Chrome has the property and answers false
      // (2026-09-21 benchmark, navigator-webdriver). The launch flags do this
      // already (--disable-blink-features=AutomationControlled, and
      // --enable-automation taken off the default args), so on a normal launch
      // this is a no-op and the native prototype getter is left untouched; the
      // redefinition is only for a binary where the flag did not take.
      if (navigator.webdriver !== false) {
        defineOnPrototype('webdriver', { get: () => false });
      }

      // Hide automation indicators
      delete window.webdriver;
      delete window._phantom;
      delete window.__nightmare;
      delete window._selenium;

      // Override chrome runtime
      if (!window.chrome) {
        window.chrome = {};
      }
      window.chrome.runtime = {
        onConnect: undefined,
        onMessage: undefined,
        connect: undefined,
        sendMessage: undefined
      };

      // Override permissions API
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );

      // No hardwareConcurrency here, and none anywhere else either: the
      // fingerprint now carries the host's own core count
      // (generateHardwareFingerprint), so there is nothing to override. A
      // defineProperty here only ever reached the document, and the worker
      // answering with the real count beside it was the mismatch
      // bot.incolumitas.com scores.

      // Spoof connection
      defineOnPrototype('connection', {
        get: () => ({
          effectiveType: '4g',
          rtt: 50 + Math.random() * 50,
          downlink: 10,
          saveData: false
        })
      });

      // Plugin list. New headless Chromium already reports the same five PDF
      // viewer entries as a real PluginArray, and replacing them with a plain
      // Array fails the "plugins is of type PluginArray" check every scanner
      // runs. Only an empty list — the legacy headless tell — is replaced.
      if (navigator.plugins.length === 0 && typeof PluginArray !== 'undefined') {
        // Built on the real prototypes so `instanceof PluginArray`, the
        // toStringTag and the DOM-style accessors all hold — a plain Array here
        // failed bot.sannysoft.com's "plugins is of type PluginArray" check.
        // The five entries are what every desktop Chrome reports.
        const mimeSpecs = [
          { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
          { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' }
        ];
        const makePlugin = (name) => {
          const plugin = Object.create(Plugin.prototype);
          const mimeTypes = mimeSpecs.map((spec) => {
            const mimeType = Object.create(MimeType.prototype);
            Object.defineProperties(mimeType, {
              type: { value: spec.type },
              suffixes: { value: spec.suffixes },
              description: { value: spec.description },
              enabledPlugin: { get: () => plugin }
            });
            return mimeType;
          });
          Object.defineProperties(plugin, {
            name: { value: name },
            filename: { value: 'internal-pdf-viewer' },
            description: { value: 'Portable Document Format' },
            length: { value: mimeTypes.length },
            item: { value: (index) => mimeTypes[index] || null },
            namedItem: { value: (type) => mimeTypes.find((m) => m.type === type) || null },
            [Symbol.iterator]: { value: function* () { yield* mimeTypes; } }
          });
          mimeTypes.forEach((mimeType, index) => {
            Object.defineProperty(plugin, index, { value: mimeType, enumerable: true });
            Object.defineProperty(plugin, mimeType.type, { value: mimeType });
          });
          return plugin;
        };
        const plugins = [
          'PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer',
          'Microsoft Edge PDF Viewer', 'WebKit built-in PDF'
        ].map(makePlugin);
        const pluginArray = Object.create(PluginArray.prototype);
        Object.defineProperties(pluginArray, {
          length: { value: plugins.length },
          item: { value: (index) => plugins[index] || null },
          namedItem: { value: (name) => plugins.find((p) => p.name === name) || null },
          refresh: { value: () => {} },
          [Symbol.iterator]: { value: function* () { yield* plugins; } }
        });
        plugins.forEach((plugin, index) => {
          Object.defineProperty(pluginArray, index, { value: plugin, enumerable: true });
          Object.defineProperty(pluginArray, plugin.name, { value: plugin });
        });
        defineOnPrototype('plugins', { get: () => pluginArray });

        // Real Chrome pairs those plugins with two navigator.mimeTypes entries
        // (application/pdf, text/pdf). Five plugins beside an empty mimeTypes
        // is its own tell — infosimples' detect-headless read "5 plugins /
        // 0 mime types" (R15, 2026-09-04).
        if (typeof MimeTypeArray !== 'undefined') {
          const mimeTypeArray = Object.create(MimeTypeArray.prototype);
          const mimeTypes = Array.from(plugins[0]);
          Object.defineProperties(mimeTypeArray, {
            length: { value: mimeTypes.length },
            item: { value: (index) => mimeTypes[index] || null },
            namedItem: { value: (type) => mimeTypes.find((m) => m.type === type) || null },
            [Symbol.iterator]: { value: function* () { yield* mimeTypes; } }
          });
          mimeTypes.forEach((mimeType, index) => {
            Object.defineProperty(mimeTypeArray, index, { value: mimeType, enumerable: true });
            Object.defineProperty(mimeTypeArray, mimeType.type, { value: mimeType });
          });
          defineOnPrototype('mimeTypes', { get: () => mimeTypeArray });
        }
      }

      // No languages here either. The persona's language list is handed to
      // Chromium as the accept-language override in _applyEmulatedIdentity, so
      // the document and every worker parse the same list; this defineProperty
      // reached only the document, and the worker's ["en-US"] against the
      // document's ["en-US", "en"] was the difference the benchmark measured
      // (2026-09-21, worker-languages).

      // Mock battery API with realistic values. A data property, not an
      // accessor: getBattery is a WebIDL operation, so on a real Navigator
      // prototype it is a writable function value and not a getter.
      defineOnPrototype('getBattery', {
        writable: true,
        value: function getBattery() {
          return Promise.resolve({
            charging: true,
            chargingTime: 0,
            dischargingTime: Infinity,
            level: 0.8 + Math.random() * 0.19 // 80-99%
          });
        }
      });

      // Override Date.prototype.getTimezoneOffset if timezone spoofing is enabled
      if (window.stealthTimezone) {
        const originalGetTimezoneOffset = Date.prototype.getTimezoneOffset;
        Date.prototype.getTimezoneOffset = function() {
          // Return offset for spoofed timezone
          const timezoneOffsets = {
            'America/New_York': 300,
            'America/Los_Angeles': 480,
            'Europe/London': 0,
            'Asia/Tokyo': -540
          };
          return timezoneOffsets[window.stealthTimezone] || originalGetTimezoneOffset.call(this);
        };
      }

      // Modify Error.prepareStackTrace to hide automation
      if (Error.prepareStackTrace) {
        const originalPrepareStackTrace = Error.prepareStackTrace;
        Error.prepareStackTrace = function(error, stack) {
          const filteredStack = stack.filter(frame => {
            const frameString = frame.toString();
            return !frameString.includes('puppeteer') && 
                   !frameString.includes('playwright') && 
                   !frameString.includes('selenium');
          });
          return originalPrepareStackTrace.call(this, error, filteredStack);
        };
      }
    });

    // WebRTC leak prevention with advanced spoofing
    if (config.blockWebRTC) {
      await context.addInitScript((webrtcConfig) => {
        // Override RTCPeerConnection
        const originalRTCPeerConnection = window.RTCPeerConnection || 
                                        window.webkitRTCPeerConnection || 
                                        window.mozRTCPeerConnection;
        
        if (originalRTCPeerConnection) {
          const StealthRTCPeerConnection = function(...args) {
            const pc = new originalRTCPeerConnection(...args);
            
            const originalCreateOffer = pc.createOffer;
            pc.createOffer = function(...offerArgs) {
              return originalCreateOffer.apply(this, offerArgs).then(offer => {
                // Modify SDP to use fake IP
                offer.sdp = offer.sdp.replace(
                  /c=IN IP4 .*\r\n/g, 
                  'c=IN IP4 ' + webrtcConfig.publicIP + '\r\n'
                );
                return offer;
              });
            };
            
            return pc;
          };
          
          StealthRTCPeerConnection.prototype = originalRTCPeerConnection.prototype;
          window.RTCPeerConnection = StealthRTCPeerConnection;
          window.webkitRTCPeerConnection = StealthRTCPeerConnection;
        }
      }, fingerprint.webRTC);
    }

    // Advanced canvas fingerprinting protection
    if (config.fingerprinting?.canvasNoise) {
      await context.addInitScript((canvasConfig) => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(contextType, contextAttributes) {
          const ctx = getContext.call(this, contextType, contextAttributes);
          
          if (contextType === '2d') {
            const originalToDataURL = this.toDataURL;
            this.toDataURL = function(...args) {
              // Add controlled noise based on seed
              const imageData = ctx.getImageData(0, 0, this.width, this.height);
              const noise = canvasConfig.noisePattern;
              
              for (let i = 0; i < imageData.data.length; i += 4) {
                const noiseIndex = i % noise.length;
                const noiseValue = noise[noiseIndex] * canvasConfig.imageData.pixelShift;
                
                imageData.data[i] = Math.min(255, Math.max(0, imageData.data[i] + noiseValue));
                imageData.data[i + 1] = Math.min(255, Math.max(0, imageData.data[i + 1] + noiseValue));
                imageData.data[i + 2] = Math.min(255, Math.max(0, imageData.data[i + 2] + noiseValue));
              }
              
              ctx.putImageData(imageData, 0, 0);
              return originalToDataURL.apply(this, args);
            };
          }
          
          return ctx;
        };
      }, fingerprint.canvas);
    }

    // WebGL spoofing
    if (config.fingerprinting?.webglSpoofing) {
      await context.addInitScript((webglConfig) => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(contextType, contextAttributes) {
          const ctx = getContext.call(this, contextType, contextAttributes);
          
          // Headless Chromium without a GPU path answers getContext('webgl')
          // with null; wrapping it threw a TypeError where a real browser
          // returns null, which is itself a tell.
          if (ctx && (contextType === 'webgl' || contextType === 'experimental-webgl')) {
            const originalGetParameter = ctx.getParameter;
            // Real Chrome answers VENDOR/RENDERER with "WebKit"/"WebKit WebGL";
            // the GPU identity lives behind WEBGL_debug_renderer_info as the
            // UNMASKED_VENDOR_WEBGL (37445) / UNMASKED_RENDERER_WEBGL (37446)
            // parameters. Those are what a scanner reads, so those are spoofed.
            const UNMASKED_VENDOR_WEBGL = 37445;
            const UNMASKED_RENDERER_WEBGL = 37446;
            ctx.getParameter = function(parameter) {
              // Spoof specific WebGL parameters
              if (parameter === UNMASKED_RENDERER_WEBGL) {
                return webglConfig.renderer;
              }
              if (parameter === UNMASKED_VENDOR_WEBGL) {
                return webglConfig.vendor;
              }
              if (parameter === ctx.VERSION) {
                return webglConfig.version;
              }
              if (parameter === ctx.SHADING_LANGUAGE_VERSION) {
                return webglConfig.shadingLanguageVersion;
              }
              
              return originalGetParameter.call(this, parameter);
            };
            
            // getExtension is left alone: returning null for an extension the
            // fingerprint's list did not name made WEBGL_debug_renderer_info
            // vanish, and a page that reads it threw a TypeError where a real
            // browser reports a GPU (sannysoft "WebGL Vendor: Error", R14).
          }
          
          return ctx;
        };

        // A webgl2 context (and any OffscreenCanvas context) never passed
        // through the wrapper above: iphey read the GPU through webgl2 and
        // printed "SwiftShader" under a Windows user agent (R16, 2026-09-04).
        // The two unmasked parameters are answered on the prototypes, where
        // every context of either kind reads them.
        for (const Context of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
          if (!Context || !Context.prototype) continue;
          const getParameter = Context.prototype.getParameter;
          Context.prototype.getParameter = function(parameter) {
            if (parameter === 37446) return webglConfig.renderer;
            if (parameter === 37445) return webglConfig.vendor;
            return getParameter.call(this, parameter);
          };
        }
      }, fingerprint.webGL);
    }

    // Audio context spoofing
    if (config.fingerprinting?.audioContextSpoofing) {
      await context.addInitScript((audioConfig) => {
        const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
        
        if (OriginalAudioContext) {
          window.AudioContext = function(...args) {
            const ctx = new OriginalAudioContext(...args);
            
            Object.defineProperty(ctx, 'sampleRate', {
              get: () => audioConfig.sampleRate
            });
            
            Object.defineProperty(ctx, 'baseLatency', {
              get: () => audioConfig.baseLatency
            });
            
            Object.defineProperty(ctx, 'outputLatency', {
              get: () => audioConfig.outputLatency
            });
            
            return ctx;
          };
          
          if (window.webkitAudioContext) {
            window.webkitAudioContext = window.AudioContext;
          }
        }
      }, fingerprint.audioContext);
    }

    // Media devices spoofing
    if (config.antiDetection?.spoofMediaDevices) {
      await context.addInitScript((mediaDevices) => {
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
          const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices;
          navigator.mediaDevices.enumerateDevices = function() {
            return Promise.resolve(mediaDevices);
          };
        }
      }, fingerprint.mediaDevices);
    }

    // Hardware. Nothing is defined onto the document's navigator any more.
    // hardwareConcurrency and deviceMemory are the host's own values
    // (generateHardwareFingerprint), so there is nothing left to override — a
    // defineProperty that sets a property to the value it already has is a JS
    // seam bought for nothing. platform is set through CDP
    // (_applyEmulatedIdentity), and with the persona OS taken from the host it
    // is usually the truth as well.
    //
    // Init scripts never run inside a dedicated Worker, so a detector that
    // compares navigator in a worker with the main thread saw the real
    // platform, deviceMemory and hardwareConcurrency beside the spoofed
    // ones (bot.incolumitas.com "inconsistentWebWorkerNavigatorPropery",
    // R17 2026-09-04). At the advanced level, classic workers start from a
    // blob that patches WorkerNavigator and then importScripts() the real
    // script; relative importScripts/fetch inside such a worker resolve
    // against the original script URL. Module workers, data:/blob: worker
    // URLs and a CSP that refuses blob workers fall through to the native
    // constructor untouched. (camoufox never reaches here — this whole method
    // returns early for it.)
    //
    // MEASURED COVERAGE, 2026-09-16, chromium, comparing a worker's navigator
    // with the main thread's:
    //
    //   level      new Worker('/w.js')   new Worker(blob:)
    //   medium     leaks all four        leaks all four
    //   advanced   matches               leaks all four
    //
    // The four are platform, hardwareConcurrency, deviceMemory and languages.
    // So a detector that builds its worker from a Blob — which needs no second
    // request and is the usual shape — read straight past this at every level.
    //
    // THE CALL, taken 2026-09-21: stop drawing what a worker can contradict.
    // hardwareConcurrency and deviceMemory are the host's own values now, and
    // languages comes from the context locale, which Playwright applies to the
    // worker as well as the document — all three agree without a wrapper.
    // That leaves platform, and only for a caller who pins a customUserAgent
    // from another OS: the persona's OS is otherwise the host's, so the spoofed
    // platform IS the real one and the wrapper would rewrite every worker
    // source on the page to change nothing. Hence the guard — the surface is
    // paid for only when it buys something. WebGL's unmasked vendor/renderer is
    // still window-only and still leaks in a worker.
    const hostPlatform = this.selectRealisticPlatform(this.hostOS());
    if (config.fingerprinting?.hardwareSpoofing
        && config.level === 'advanced'
        && fingerprint.hardware.platform !== hostPlatform) {
      await context.addInitScript((hardware) => {
        const NativeWorker = window.Worker;
        if (typeof NativeWorker !== 'function') return;
        const spoof = JSON.stringify({ platform: hardware.platform });
        const prelude = (scriptUrl) =>
            `(() => {
              const spoof = ${spoof};
              const proto = self.WorkerNavigator && self.WorkerNavigator.prototype;
              const define = (key, value) => {
                try { Object.defineProperty(proto, key, { get: () => value, configurable: true }); } catch (e) {}
              };
              if (proto) {
                define('platform', spoof.platform);
              }
              const base = ${JSON.stringify(scriptUrl)};
              const resolve = (u) => { try { return new URL(String(u), base).href; } catch (e) { return u; } };
              const nativeImport = self.importScripts;
              self.importScripts = (...urls) => nativeImport.apply(self, urls.map(resolve));
              const nativeFetch = self.fetch;
              if (typeof nativeFetch === 'function') {
                self.fetch = (input, init) => nativeFetch.call(self, typeof input === 'string' ? resolve(input) : input, init);
              }
              if (self.XMLHttpRequest) {
                const nativeOpen = self.XMLHttpRequest.prototype.open;
                self.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                  return nativeOpen.call(this, method, resolve(url), ...rest);
                };
              }
            })();
            importScripts(${JSON.stringify(scriptUrl)});`;
        const Wrapped = function Worker(scriptURL, options) {
          try {
            const isModule = options && options.type === 'module';
            const absolute = new URL(String(scriptURL), location.href).href;
            if (!isModule && /^https?:/.test(absolute)) {
              const blob = new Blob([prelude(absolute)], { type: 'text/javascript' });
              return new NativeWorker(URL.createObjectURL(blob), options);
            }
          } catch (e) {
            // CSP refused the blob URL or the URL failed to parse: native worker.
          }
          return new NativeWorker(scriptURL, options);
        };
        Wrapped.prototype = NativeWorker.prototype;
        Object.defineProperty(Wrapped, 'name', { value: 'Worker' });
        Wrapped.toString = () => 'function Worker() { [native code] }';
        window.Worker = Wrapped;
      }, fingerprint.hardware);
    }

    // Font spoofing
    if (config.fingerprinting?.fontSpoofing) {
      await context.addInitScript((fonts) => {
        // Override font detection methods
        const originalMeasureText = CanvasRenderingContext2D.prototype.measureText;
        CanvasRenderingContext2D.prototype.measureText = function(text) {
          const result = originalMeasureText.call(this, text);
          
          // Add slight variations to font measurements
          const variance = 0.1 + Math.random() * 0.1;
          return {
            width: result.width * variance,
            actualBoundingBoxLeft: result.actualBoundingBoxLeft || 0,
            actualBoundingBoxRight: result.actualBoundingBoxRight || result.width,
            fontBoundingBoxAscent: result.fontBoundingBoxAscent || 10,
            fontBoundingBoxDescent: result.fontBoundingBoxDescent || 2,
            actualBoundingBoxAscent: result.actualBoundingBoxAscent || 8,
            actualBoundingBoxDescent: result.actualBoundingBoxDescent || 2,
            emHeightAscent: result.emHeightAscent || 8,
            emHeightDescent: result.emHeightDescent || 2,
            hangingBaseline: result.hangingBaseline || 6,
            alphabeticBaseline: result.alphabeticBaseline || 0,
            ideographicBaseline: result.ideographicBaseline || -2
          };
        };
      }, fingerprint.fonts);
    }

    // Screen resolution spoofing
    await context.addInitScript(({ screen: screenConfig, window: windowConfig }) => {
      Object.defineProperties(screen, {
        width: { value: screenConfig.width, configurable: true },
        height: { value: screenConfig.height, configurable: true },
        availWidth: { value: screenConfig.availWidth, configurable: true },
        availHeight: { value: screenConfig.availHeight, configurable: true },
        colorDepth: { value: screenConfig.colorDepth, configurable: true },
        pixelDepth: { value: screenConfig.pixelDepth, configurable: true }
      });
      // Headless Chromium reports outerWidth/outerHeight equal to the inner
      // size — a window with no tabs and no toolbar.
      if (windowConfig) {
        Object.defineProperty(window, 'outerWidth', { get: () => windowConfig.outerWidth, configurable: true });
        Object.defineProperty(window, 'outerHeight', { get: () => windowConfig.outerHeight, configurable: true });
      }
    }, {
      screen: fingerprint.screen,
      // camoufox runs without a fixed viewport (see createStealthContext), so
      // an outer size derived from one would contradict the real window.
      window: this._launchedEngine === 'camoufox' ? null : fingerprint.window
    });

    // Timezone spoofing
    if (config.spoofTimezone) {
      await context.addInitScript((timezone) => {
        window.stealthTimezone = timezone;
        
        // Override Intl.DateTimeFormat
        const originalDateTimeFormat = Intl.DateTimeFormat;
        Intl.DateTimeFormat = function(locales, options = {}) {
          if (!options.timeZone) {
            options.timeZone = timezone;
          }
          return new originalDateTimeFormat(locales, options);
        };
        
        // Override Date methods
        const originalToLocaleDateString = Date.prototype.toLocaleDateString;
        Date.prototype.toLocaleDateString = function(locales, options = {}) {
          if (!options.timeZone) {
            options.timeZone = timezone;
          }
          return originalToLocaleDateString.call(this, locales, options);
        };
      }, fingerprint.timezone);
    }

    // Battery API spoofing
    if (config.antiDetection?.spoofBatteryAPI) {
      await context.addInitScript((battery) => {
        // On the prototype, where getBattery natively lives. A plain
        // `navigator.getBattery = …` assignment makes it an OWN property of the
        // navigator instance, which is the list rebrowser prints (2026-09-21
        // bench) — a real Chrome's Object.getOwnPropertyNames(navigator) is
        // empty.
        if (!('getBattery' in Navigator.prototype)) return;
        try {
          Object.defineProperty(Navigator.prototype, 'getBattery', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: function getBattery() {
              return Promise.resolve(battery);
            }
          });
        } catch (e) { /* a build that refuses the redefinition keeps the real one */ }
      }, fingerprint.battery);
    }
  }

  /**
   * Enhanced human behavior simulation using dedicated simulator
   */
  async initializeHumanBehaviorSimulator(config = {}) {
    if (!this.humanBehaviorSimulator) {
      this.humanBehaviorSimulator = new HumanBehaviorSimulator({
        mouseMovements: {
          enabled: true,
          speed: 'normal',
          accuracy: 0.85,
          naturalCurves: true,
          randomMicroMovements: true
        },
        typing: {
          enabled: true,
          speed: 'normal',
          variability: 0.3,
          mistakes: {
            enabled: true,
            frequency: 0.015, // 1.5% mistake rate
            correctionDelay: 600
          }
        },
        scrolling: {
          enabled: true,
          naturalAcceleration: true,
          randomPauses: true,
          scrollBackProbability: 0.12
        },
        interactions: {
          hoverBeforeClick: true,
          clickDelay: { min: 120, max: 350 },
          focusBlurSimulation: true,
          idlePeriods: {
            enabled: true,
            frequency: 0.08,
            minDuration: 800,
            maxDuration: 3500
          }
        },
        ...config
      });
    }
    return this.humanBehaviorSimulator;
  }

  /**
   * Advanced CloudFlare detection and bypass
   */
  async bypassCloudflareChallenge(page) {
    try {
      this.performanceMetrics.detectionAttempts++;
      
      // Wait for potential challenge page
      await page.waitForTimeout(2000);
      
      // Check for CloudFlare challenge indicators
      const challengeDetected = await page.evaluate(() => {
        const indicators = [
          'cf-browser-verification',
          'cf-challenge-running',
          'Checking your browser',
          'DDoS protection by Cloudflare',
          'Ray ID'
        ];
        
        const pageText = document.body.innerText;
        return indicators.some(indicator => pageText.includes(indicator));
      });
      
      if (challengeDetected) {
        console.error('CloudFlare challenge detected, attempting bypass...');
        
        // Simulate human behavior during challenge
        if (this.humanBehaviorSimulator) {
          await this.humanBehaviorSimulator.simulateIdlePeriod();
          
          // Random mouse movements during challenge
          const viewport = await page.viewportSize();
          for (let i = 0; i < 3; i++) {
            const x = Math.random() * viewport.width;
            const y = Math.random() * viewport.height;
            await this.humanBehaviorSimulator.simulateMouseMovement(
              page, x - 50, y - 50, x, y
            );
            await this.humanBehaviorSimulator.delay(1000, 0.3);
          }
        }
        
        // Wait for challenge to complete (up to 30 seconds)
        await page.waitForFunction(() => {
          const indicators = [
            'cf-browser-verification',
            'cf-challenge-running',
            'Checking your browser'
          ];
          const pageText = document.body.innerText;
          return !indicators.some(indicator => pageText.includes(indicator));
        }, { timeout: 30000 }).catch(() => {});
        
        this.performanceMetrics.successfulBypasses++;
        return true;
      }
      
      return false;
    } catch (error) {
      this.performanceMetrics.failedBypasses++;
      console.warn('CloudFlare bypass failed:', error.message);
      return false;
    }
  }

  /**
   * Enhanced reCAPTCHA detection and handling
   */
  async handleRecaptcha(page) {
    try {
      // Check for reCAPTCHA elements
      const recaptchaDetected = await page.evaluate(() => {
        const recaptchaElements = [
          '.g-recaptcha',
          '#recaptcha',
          '[data-sitekey]',
          'iframe[src*="recaptcha"]'
        ];
        
        return recaptchaElements.some(selector => 
          document.querySelector(selector) !== null
        );
      });
      
      if (recaptchaDetected) {
        console.error('reCAPTCHA detected, implementing human behavior...');
        
        // Simulate human inspection of the reCAPTCHA
        if (this.humanBehaviorSimulator) {
          // Look around the page naturally
          await this.humanBehaviorSimulator.simulateReadingTime(page, 'body');
          
          // Hover over the reCAPTCHA area
          try {
            const recaptchaBox = await page.$('.g-recaptcha, #recaptcha, [data-sitekey]');
            if (recaptchaBox) {
              const boundingBox = await recaptchaBox.boundingBox();
              if (boundingBox) {
                await this.humanBehaviorSimulator.simulateMouseMovement(
                  page, 
                  boundingBox.x - 100, 
                  boundingBox.y - 100,
                  boundingBox.x + boundingBox.width / 2,
                  boundingBox.y + boundingBox.height / 2
                );
                await this.humanBehaviorSimulator.delay(2000, 0.4);
              }
            }
          } catch (error) {
            console.warn('reCAPTCHA interaction failed:', error.message);
          }
        }
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.warn('reCAPTCHA handling failed:', error.message);
      return false;
    }
  }

  /**
   * Parse one proxyRotation entry into the { server, username, password } shape
   * Playwright takes.
   *
   * Residential proxies — the only kind that helps against Cloudflare's IP
   * reputation check — are issued as `http://user:pass@host:port`. Those
   * credentials are the whole point: the previous code pushed the entry into
   * `--proxy-server=`, a Chromium flag with nowhere to put them, so every
   * authenticating proxy answered 407 and the request failed. Splitting them out
   * here is what lets both engines authenticate.
   *
   * A malformed entry throws rather than returning null. A proxy that silently
   * does not apply is the failure mode this whole path is being fixed for: the
   * caller believes their traffic is proxied and it is not.
   */
  parseProxyEntry(entry) {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error('proxyRotation.proxies entries must be non-empty strings');
    }
    const raw = entry.trim();
    // `host:port` with no scheme parses as protocol "host:" and an empty host,
    // so give the bare form the http:// every proxy list assumes.
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;

    let url;
    try {
      url = new URL(withScheme);
    } catch {
      throw new Error(`Invalid proxy "${this.redactProxy(raw)}": expected host:port or scheme://user:pass@host:port`);
    }

    const scheme = url.protocol.replace(':', '').toLowerCase();
    if (!['http', 'https', 'socks4', 'socks5'].includes(scheme)) {
      throw new Error(`Invalid proxy scheme "${scheme}": expected http, https, socks4 or socks5`);
    }
    if (!url.hostname) {
      throw new Error(`Invalid proxy "${this.redactProxy(raw)}": no host`);
    }

    // url.origin is the string "null" for socks4/socks5 — they are not special
    // schemes — so the server is rebuilt from protocol and host.
    const proxy = { server: `${url.protocol}//${url.host}` };
    // A password with a "@" or ":" in it must arrive percent-encoded to parse at
    // all; the proxy expects the decoded value.
    if (url.username) proxy.username = decodeURIComponent(url.username);
    if (url.password) proxy.password = decodeURIComponent(url.password);
    return proxy;
  }

  /** A proxy entry with its credentials removed, for logs and get_stats. */
  redactProxy(entry) {
    return String(entry).replace(/\/\/[^/@]*@/, '//');
  }

  /**
   * Pick the proxy this context should use, advancing the rotation when its
   * interval has elapsed.
   *
   * Called per context rather than per launch. The old call site ran once, at
   * browser launch, and the browser is cached for the life of the process — so
   * rotationInterval could never elapse anywhere that mattered and the second
   * proxy in a list was never reached.
   */
  resolveProxy(config) {
    // The caller's list always wins: a per-call proxyRotation is a deliberate
    // choice of exit address, and the server-level CRAWLFORGE_STEALTH_PROXIES
    // is only what this server goes out from when nobody chose one — the
    // escalation stage, the agent and browser_session have no caller to ask.
    // Read through the helper on every call, so an operator's list can be set
    // for a run without restarting the process.
    const requested = config.proxyRotation?.enabled ? (config.proxyRotation.proxies || []) : [];
    const proxies = requested.length ? requested : serverStealthProxies();
    if (!proxies.length) {
      return null;
    }
    // The server-level list arrives as a bare list with no rotation block of
    // its own, so it gets the schema's own default interval rather than
    // comparing against undefined — which is never greater, i.e. never rotates.
    const rotationInterval = config.proxyRotation?.rotationInterval ?? 300000;

    const now = Date.now();
    if (this.proxyManager.currentProxy === null) {
      // First use takes proxies[0]. The old code advanced the index before its
      // first read, so a single-proxy list worked by wrapping to 0 and every
      // longer list silently started at the second entry.
      this.proxyManager.proxyIndex = 0;
      this.proxyManager.lastRotation = now;
    } else if (now - this.proxyManager.lastRotation > rotationInterval) {
      this.proxyManager.proxyIndex = (this.proxyManager.proxyIndex + 1) % proxies.length;
      this.proxyManager.lastRotation = now;
    }

    const entry = proxies[this.proxyManager.proxyIndex % proxies.length];
    const parsed = this.parseProxyEntry(entry);
    // Only ever hold the redacted form: getStats() returns currentProxy to the
    // caller, and these strings carry a password.
    this.proxyManager.currentProxy = this.redactProxy(entry);
    this.proxyManager.activeProxies = proxies.map((p) => this.redactProxy(p));
    return parsed;
  }

  /**
   * Create stealth page with anti-detection measures
   */
  async createStealthPage(contextId) {
    const contextData = this.contexts.get(contextId);
    if (!contextData) {
      throw new Error('Context not found');
    }

    // Record use and check if context needs periodic refresh
    const needsRefresh = this.contexts.recordUse(contextId);
    if (needsRefresh) {
      // Dispose old context; caller should create a fresh one
      await this.contexts.dispose(contextId);
      this.fingerprints.delete(contextId);
      throw new Error(`StealthBrowserManager: context ${contextId} has reached its use limit and was recycled. Create a new context.`);
    }

    const page = await contextData.context.newPage();

    // Apply additional page-level stealth measures
    await this.applyPageStealthMeasures(page, contextData.config, contextData.fingerprint);

    return page;
  }

  /**
   * One-shot stealth scrape: create a context + page, navigate to the URL,
   * extract content, and tear the context down. Convenience wrapper over the
   * operation-based API (createStealthContext → createStealthPage → goto).
   *
   * @param {Object} params
   * @param {string} params.url                 — URL to scrape
   * @param {string} [params.engine]            — browser engine (forwarded to config; 'auto' by default, i.e. camoufox when installed)
   * @param {number} [params.wait_for]          — extra wait after load, in ms
   * @param {boolean} [params.screenshot]       — capture a base64 PNG screenshot
   * @param {Object} [params.stealthConfig]     — stealth configuration overrides
   * @returns {Promise<{success:boolean, url:string, title:string, text:string, html:string, screenshot:?string, engine:?string, warnings:string[]}>}
   *   `engine` is the one that actually ran and `warnings` carries the
   *   'auto'→chromium downgrade, so the caller can report it.
   */
  /**
   * If the document is a self-solving bot-wall interstitial, wait up to
   * timeoutMs for the title to change — the challenge script navigates to the
   * real page when it passes — and for that navigation to reach
   * domcontentloaded. A challenge that never passes is left to
   * challengeDetection to report as blocked.
   *
   * The trigger is looksLikeInterstitial, not a known title: nowsecure.nl's
   * interstitial is titled "nowsecure.nl", so a title-only test skipped the
   * wait entirely and the block verdict fired on a challenge that had not been
   * given its chance to solve itself (2026-09-21 benchmark, section 2.2). That
   * costs one page.content() per call, which is what reading the challenge
   * bootstrap out of the document takes.
   */
  /**
   * A document with no title and no text right after domcontentloaded is
   * usually a page that has not painted yet: a self-solving bot wall the
   * vendor list does not name (booking.com's chal_t redirect), or a client-
   * rendered shell (carvana.com, chewy.com). Round 18 (2026-09-04) reported
   * every one of them as "rendered no title and no text after 0ms" while a
   * 6-second wait in scrape_with_actions returned the full page. Give an
   * empty document one bounded grace period to fill in — or to navigate on —
   * before it is read. Returns the milliseconds waited (0 when the document
   * already had content).
   */
  async _waitOutEmptyDocument(page, { timeoutMs = EMPTY_DOCUMENT_GRACE_MS } = {}) {
    const hasContent = () =>
      Boolean((document.title && document.title.trim()) || (document.body && document.body.innerText.trim()));
    let empty;
    try {
      empty = !(await page.evaluate(hasContent));
    } catch {
      return 0;
    }
    if (!empty) return 0;
    const started = Date.now();
    await page.waitForFunction(hasContent, null, { timeout: timeoutMs }).catch(() => {});
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    // What filled the document may itself be a challenge that navigates on.
    await this._waitOutChallenge(page);
    return Date.now() - started;
  }

  /**
   * Give the page the chance to finish rendering before it is read.
   *
   * Navigation returns at DOMContentLoaded, and everything before this only
   * waits for the document to become non-empty (_waitOutEmptyDocument) or to
   * stop being an interstitial (_waitOutChallenge). A page that already has
   * prose and writes the part the caller came for in a load handler passed all
   * of those as finished, and the read landed mid-render.
   *
   * The 6.6.2 bench recorded that as a format bug — "markdown silently dropped
   * the verdict, text captured it" — but its two calls were two page loads and
   * only one of them raced. One call asking for markdown and text returns the
   * same content in both, because both are built from one render. The defect
   * was the timing.
   *
   * Two bounded waits: the page's own load event, then quiet in the DOM. What
   * this cannot do is predict a payload injected into a still page some
   * arbitrary time later — that is what the caller's `wait_for` is for.
   *
   * @returns {Promise<number>} milliseconds actually waited, 0 for a page that
   *   was already finished.
   */
  async _settleRender(page, { loadTimeoutMs = 3000, quietMs = 400, capMs = 2500 } = {}) {
    const started = Date.now();
    // Subresources are often what the render waits on. Bounded, because a page
    // with a hanging tracker request never fires load at all.
    await page.waitForLoadState('load', { timeout: loadTimeoutMs }).catch(() => {});
    const loadMs = Date.now() - started;
    return loadMs + await this._settleDom(page, { quietMs, capMs });
  }

  /**
   * Resolve once the DOM has been unchanged for `quietMs`, or at `capMs`.
   *
   * A MutationObserver in the page, so this is one round trip and returns
   * immediately on a page that was already still. The cap bounds a page that
   * never stops animating.
   *
   * @returns {Promise<number>} milliseconds the DOM went on changing for — 0
   *   when the page was already still, so a settled page reports no extra wait.
   */
  async _settleDom(page, { quietMs = 400, capMs = 2500 } = {}) {
    try {
      return await page.evaluate(({ quiet, cap }) => new Promise((resolve) => {
        if (!document.documentElement) {
          resolve(0);
          return;
        }
        const started = Date.now();
        let quietTimer;
        const finish = () => {
          observer.disconnect();
          clearTimeout(quietTimer);
          clearTimeout(capTimer);
          // Subtract the quiet window itself: what is worth reporting is how
          // long the page kept changing, not the time spent confirming it had
          // stopped.
          resolve(Math.max(0, Date.now() - started - quiet));
        };
        const observer = new MutationObserver(() => {
          clearTimeout(quietTimer);
          quietTimer = setTimeout(finish, quiet);
        });
        const capTimer = setTimeout(finish, cap);
        quietTimer = setTimeout(finish, quiet);
        observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      }), { quiet: quietMs, cap: capMs });
    } catch {
      // Navigated away, closed or crashed mid-settle. The read that follows
      // reports that properly; there is nothing to add here.
      return 0;
    }
  }

  async _waitOutChallenge(page, { timeoutMs = 8000 } = {}) {
    let title;
    try {
      title = await page.title();
    } catch {
      return;
    }
    // A page that is navigating — which a challenge that has just solved itself
    // is — can answer title() and still refuse content(). Falling back to the
    // title-only decision keeps a known interstitial waited on; only the marker
    // branch, and with it the custom-titled wall, is lost for that call.
    let html = '';
    try {
      html = await page.content();
    } catch { /* title-only decision */ }
    if (!looksLikeInterstitial({ title, html })) return;
    await page
      .waitForFunction((t) => document.title !== t, title, { timeout: timeoutMs })
      .catch(() => {});
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
  }

  async scrapeWithStealth({ url, engine, wait_for = 0, screenshot = false, stealthConfig = {} } = {}) {
    if (!url) throw new Error('scrapeWithStealth requires a url');

    const { contextId, engineFallbackWarning = null } = await this.createStealthContext({ ...stealthConfig, engine });
    // What ran, not what was asked for: 'auto' becomes chromium when camoufox
    // is absent, and a result that says the stealth browser did not get the
    // page has to name the browser that tried.
    const engineUsed = this._launchedEngine ?? null;
    const warnings = engineFallbackWarning ? [engineFallbackWarning] : [];
    try {
      const page = await this.createStealthPage(contextId);
      let crashed = false;
      page.on('crash', () => { crashed = true; });
      // The HTTP status of the document finally read: the navigation's own
      // response, then whatever a challenge or redirect navigated on to.
      // Edmunds' "403 - Access Denied" and Lufthansa's 404 came back as
      // success:true because nothing looked at the status (R18, 2026-09-04).
      let status = null;
      page.on('response', (response) => {
        try {
          const request = response.request();
          if (request.isNavigationRequest() && request.frame() === page.mainFrame()) status = response.status();
        } catch { /* a detached frame; keep the last status */ }
      });
      // SSRF guard at the navigation boundary: the stealth engine resolves DNS
      // itself, so a URL/host-only check would miss rebinding to private/metadata IPs.
      const response = await safeGoto(page, url, { waitUntil: 'domcontentloaded' });
      if (response && status === null) status = response.status();
      if (wait_for > 0) await page.waitForTimeout(wait_for);
      // Cloudflare's and Vercel's JavaScript challenges solve themselves in a
      // real browser and then reload the page. camoufox on lesswrong.com was
      // read while the "Vercel Security Checkpoint" interstitial was still
      // up, so the interstitial came back as success:true (R17, 2026-09-04).
      // An auto-solving challenge gets one bounded wait to finish first.
      await this._waitOutChallenge(page);
      const emptyGraceMs = await this._waitOutEmptyDocument(page);
      // Last: let whatever is still rendering finish. Without this the read
      // below can land between "the page has content" and "the page has the
      // content the caller came for", and a half-rendered page is returned as
      // a successful scrape.
      const renderMs = await this._settleRender(page);
      const gracedMs = emptyGraceMs + renderMs;

      // A failure to read the document is a failure. With every read wrapped
      // in .catch(() => ''), a renderer that crashed or a page closed during
      // the wait (iphey.com under software GL, R16 2026-09-04) came back as
      // success:true with an empty title and body — indistinguishable from a
      // page that rendered nothing. The body text is read through evaluate,
      // not innerText('body'): a frameset document has no <body>, and
      // innerText waited its full 30s for one before throwing.
      let title; let html; let text;
      try {
        [title, html, text] = await Promise.all([
          page.title(),
          page.content(),
          page.evaluate(() => (document.body ? document.body.innerText : ''))
        ]);
      } catch (error) {
        const what = crashed ? 'crashed' : (page.isClosed() ? 'was closed' : 'could not be read');
        throw new Error(
          `The stealth page ${what} before its content could be read (${String(error.message).split('\n')[0]}). ` +
          'The page did not render; retry, or use scrape_with_actions for a page this heavy.'
        );
      }
      const shot = screenshot
        ? await page.screenshot({ encoding: 'base64', fullPage: false }).catch(() => null)
        : null;

      return { success: true, url, title, text, html, screenshot: shot, status, gracedMs, engine: engineUsed, warnings };
    } finally {
      await this.closeContext(contextId).catch(() => {});
    }
  }

  /**
   * Whether a request is dropped before it leaves the browser. Nothing is, at
   * any level, which is why applyPageStealthMeasures routes no page at all —
   * this is the one place that answers the question, and the answer is the
   * reason the interception is gone.
   * @param {string} resourceType - Playwright's request.resourceType()
   * @param {string} level - stealth level
   * @returns {boolean}
   */
  static shouldAbortRequest(_resourceType, _level) {
    return false;
  }

  /**
   * The full user-agent client-hint metadata for a fingerprint: what Playwright
   * already derives from the user agent, plus the brand lists it leaves to the
   * binary. Omitting a field means "fill this in with what you would normally
   * use", and what a headless Chromium normally uses says HeadlessChrome — in
   * brands, in fullVersionList, and so in every high-entropy hint a detector
   * asks for.
   *
   * The five derived fields are what playwright-core's own
   * calculateUserAgentMetadata produces for the three desktop personas this
   * manager draws — so for every user agent it can hand out, this changes the
   * brands and nothing else. A mobile persona is out of scope here for the same
   * reason isMobile is pinned false in generateAdvancedFingerprint: the pool has
   * no mobile user agent to be coherent with.
   *
   * @param {Object} fingerprint
   * @returns {Object} a CDP Emulation.UserAgentMetadata
   */
  generateUserAgentMetadata(fingerprint) {
    const userAgent = String(fingerprint.userAgent || '');
    const brands = this.generateUserAgentBrands(userAgent);
    const brandVersion = brands[brands.length - 1].version;
    // The four-part build number, but only when it is the binary the brand
    // version names; a custom UA on another major gets the reduced form rather
    // than this machine's build under someone else's version.
    const fullVersion = brandVersion === String(this.chromeMajor)
      ? this.chromeVersion
      : `${brandVersion}.0.0.0`;
    const platformVersions = { windows: '10.0', macos: '10_15_7', linux: '' };
    const platforms = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };
    const os = this.inferOSFromUserAgent(userAgent);

    return {
      brands,
      fullVersionList: brands.map((brand) => ({ brand: brand.brand, version: fullVersion })),
      fullVersion,
      platform: platforms[os],
      platformVersion: platformVersions[os],
      architecture: 'x86',
      model: '',
      mobile: false
    };
  }

  /**
   * Tell the renderer who it is, instead of patching it from script.
   *
   * navigator.userAgent, .platform and .userAgentData were being defined on the
   * document's navigator by init scripts. An init script does not run in a
   * Worker, so every one of those values was spoofed in the document and
   * truthful in the worker beside it — a MacIntel under a Windows persona,
   * which is what bot.incolumitas.com and CreepJS score (2026-09-21 benchmark,
   * worker-*). Emulation.setUserAgentOverride is applied by the renderer, and
   * the brands it carries are the ones the binary would otherwise fill in as
   * HeadlessChrome.
   *
   * `acceptLanguage` is the plain locale tag, the same single value Playwright
   * gives the context. It is deliberately NOT the two-entry "en-US,en" list:
   * this override reaches the document only, while a worker's
   * navigator.languages comes from the context locale, so a second entry here
   * showed up in the document and nowhere else — the very mismatch the init
   * script used to create (2026-09-21 benchmark, worker-languages). The
   * Accept-Language *header* still carries the `en;q=0.9` fallback, from
   * generateAdvancedHeaders, which is what a real Chrome sends for a
   * single-locale preference. The field cannot simply be omitted: that clears
   * the override Playwright installed and a de-DE persona would fall back to
   * the binary's default.
   *
   * Chromium only: CDP does not exist on camoufox's Firefox, which spoofs all
   * of this in its own engine anyway. A failure here is not fatal — Playwright
   * has already set the user agent through the context, so the persona survives
   * without the brands.
   */
  async _applyEmulatedIdentity(page, config, fingerprint) {
    if (!isChromium(page) || !fingerprint.userAgent) return;
    try {
      const client = await page.context().newCDPSession(page);
      await client.send('Emulation.setUserAgentOverride', {
        userAgent: fingerprint.userAgent,
        acceptLanguage: fingerprint.locale || config.locale || 'en-US',
        platform: fingerprint.hardware.platform,
        userAgentMetadata: this.generateUserAgentMetadata(fingerprint)
      });
    } catch (error) {
      console.warn(`Identity emulation skipped: ${error.message}`);
    }
  }

  /**
   * Apply page-level stealth measures
   */
  async applyPageStealthMeasures(page, config, fingerprint) {
    // No request routing at all. R15 had already stopped aborting by URL (the
    // old list blocked challenges.cloudflare.com, so a Cloudflare challenge
    // could never complete, and killed the navigation to www.selenium.dev);
    // what was left was the advanced level dropping about a third of images,
    // fonts and stylesheets at random. Both halves of that are timeable: a page
    // that renders without the fonts and images it asked for does not look like
    // a browser reading it, and route('**/*') itself puts every request through
    // a node round trip, which shows up as latency no network explains
    // (2026-09-21 review, finding 10). With nothing left to abort there is
    // nothing for the interception to decide, so the handler is gone rather
    // than made conditional.

    // Every identity the renderer can be told about directly, rather than
    // patched into from script.
    await this._applyEmulatedIdentity(page, config, fingerprint);

    // Add request headers — Chromium only. These carry sec-ch-ua,
    // sec-ch-ua-mobile and sec-ch-ua-platform, client hints Gecko does not
    // implement, so setting them here would put them straight back onto a
    // camoufox page after createStealthContext had taken them off the context.
    if (isChromium(page)) {
      await page.setExtraHTTPHeaders(fingerprint.headers);
    }

    // Emulate realistic network conditions.
    //
    // Network.emulateNetworkConditions is a Chrome DevTools Protocol command,
    // and CDP is Chromium-only — Playwright throws "CDP session is only
    // available in Chromium" on Firefox and WebKit, and there is no
    // cross-browser equivalent. Unguarded, this made `engine: "camoufox"` fail
    // 100% of the time, because Camoufox is Firefox-based: every advanced-level
    // camoufox scrape died here before it ever reached the page.
    //
    // The emulation is cosmetic realism, not a stealth requirement, so on a
    // non-Chromium engine it is skipped rather than fatal.
    if (config.level === 'advanced' && isChromium(page)) {
      try {
        const client = await page.context().newCDPSession(page);
        await client.send('Network.emulateNetworkConditions', {
          offline: false,
          downloadThroughput: (1.5 + Math.random() * 2) * 1024 * 1024 / 8, // 1.5-3.5 Mbps
          uploadThroughput: (0.75 + Math.random() * 1.25) * 1024 * 1024 / 8, // 0.75-2 Mbps
          latency: 40 + Math.random() * 60 // 40-100ms
        });
      } catch (error) {
        // A browser build that reports chromium but refuses CDP must not take
        // the scrape down with it.
        console.warn(`Network condition emulation skipped: ${error.message}`);
      }
    }

    // Set up human behavior if enabled
    if (config.simulateHumanBehavior) {
      await this.initializeHumanBehaviorSimulator();
    }

    return page;
  }

  /**
   * Simulate realistic mouse movements using Bezier curves
   */
  async simulateRealisticMouseMovements(page) {
    if (!this.humanBehaviorSimulator) return;
    
    const viewport = await page.viewportSize();
    const movements = Math.floor(Math.random() * 4) + 2; // 2-5 movements
    
    let currentX = Math.random() * viewport.width;
    let currentY = Math.random() * viewport.height;
    
    for (let i = 0; i < movements; i++) {
      const targetX = Math.random() * viewport.width;
      const targetY = Math.random() * viewport.height;
      
      await this.humanBehaviorSimulator.simulateMouseMovement(
        page, currentX, currentY, targetX, targetY
      );
      
      currentX = targetX;
      currentY = targetY;
      
      await this.humanBehaviorSimulator.delay(300, 0.5);
    }
  }

  /**
   * Simulate natural scrolling behavior
   */
  async simulateNaturalScrolling(page) {
    if (!this.humanBehaviorSimulator) return;
    
    // Random scroll behavior
    if (Math.random() < 0.7) { // 70% chance to scroll
      const direction = Math.random() < 0.8 ? 'down' : 'up';
      const distance = 100 + Math.random() * 300;
      const duration = 800 + Math.random() * 1200;
      
      await this.humanBehaviorSimulator.simulateScroll(page, {
        direction,
        distance,
        duration
      });
    }
  }

  /**
   * Utility functions
   */
  weightedRandom(weights) {
    const random = Math.random();
    let sum = 0;
    for (const [option, weight] of Object.entries(weights)) {
      sum += weight;
      if (random <= sum) {
        return option;
      }
    }
    return Object.keys(weights)[0];
  }

  weightedRandomFromArray(items) {
    const totalWeight = items.reduce((sum, item) => sum + (item.weight || 1), 0);
    let random = Math.random() * totalWeight;
    
    for (const item of items) {
      random -= (item.weight || 1);
      if (random <= 0) {
        return item;
      }
    }
    
    return items[0];
  }

  randomFloat(min, max, decimals = 2) {
    return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
  }

  randomHex(length) {
    return Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }

  generateContextId() {
    return 'stealth_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Get context information
   */
  getContextInfo(contextId) {
    const contextData = this.contexts.get(contextId);
    if (!contextData) {
      return null;
    }

    return {
      contextId,
      fingerprint: contextData.fingerprint,
      config: contextData.config,
      created: contextData.created || Date.now()
    };
  }

  /**
   * Close specific context
   */
  async closeContext(contextId) {
    if (this.contexts.has(contextId)) {
      await this.contexts.dispose(contextId);
      this.fingerprints.delete(contextId);
    }
  }

  /**
   * D2.2: LRU-capped fingerprint setter.
   * Evicts the oldest entry when the Map exceeds _maxContexts to prevent unbounded growth.
   */
  _setFingerprint(contextId, fingerprint) {
    if (this.fingerprints.size >= this._maxContexts) {
      const oldestKey = this.fingerprints.keys().next().value;
      this.fingerprints.delete(oldestKey);
    }
    this.fingerprints.set(contextId, fingerprint);
  }

  /**
   * Close all contexts and browser
   */
  async cleanup() {
    // A wedged Chromium doesn't error on close() — it hangs. Race each close
    // against a short deadline so cleanup always finishes inside callers'
    // timeout windows and works as a remote unwedge lever.
    const withDeadline = (promise, ms) =>
      Promise.race([
        promise.then(() => true, () => true),
        new Promise((resolve) => setTimeout(() => resolve(false), ms))
      ]);

    // Close all contexts via pool (handles idle timer cleanup + wait queue
    // drain). destroy() permanently stops the pool's idle timer, so recreate
    // the pool afterwards or idle reaping is dead for the process lifetime.
    await withDeadline(this.contexts.destroy(), 5000);
    this.contexts = this._createContextPool();
    this.fingerprints.clear();

    // Reset human behavior simulator
    if (this.humanBehaviorSimulator) {
      this.humanBehaviorSimulator.resetStats();
      this.humanBehaviorSimulator = null;
    }

    // Close browser; if close hangs, kill the process so the OS reclaims it.
    // Browsers parked by an engine switch are closed the same way.
    const browsers = [];
    if (this.browser) {
      browsers.push(this.browser);
      this.browser = null;
    }
    if (this._parkedBrowsers) {
      browsers.push(...this._parkedBrowsers.values());
      this._parkedBrowsers.clear();
    }
    this._launchedEngine = null;
    this._engineFallbackWarning = null;
    for (const browser of browsers) {
      const closed = await withDeadline(browser.close(), 5000);
      if (!closed) {
        try {
          browser.process()?.kill('SIGKILL');
        } catch {
          // Process already gone.
        }
      }
    }
  }

  /**
   * Get comprehensive statistics
   */
  getStats() {
    return {
      activeContexts: this.contexts.size,
      totalFingerprintsSaved: this.fingerprints.size,
      browserRunning: !!this.browser,
      humanBehaviorActive: !!this.humanBehaviorSimulator,
      performanceMetrics: this.performanceMetrics,
      proxyStatus: {
        enabled: this.proxyManager.activeProxies.length > 0,
        currentProxy: this.proxyManager.currentProxy,
        totalProxies: this.proxyManager.activeProxies.length
      },
      bypassCacheSize: this.bypassCache.size,
      canvasCacheSize: this.canvasCache.size
    };
  }

  /**
   * Validate stealth configuration
   */
  validateConfig(config) {
    try {
      return StealthConfigSchema.parse(config);
    } catch (error) {
      throw new Error(`Invalid stealth configuration: ${error.message}`);
    }
  }

  /**
   * Get the stealth configuration schema
   */
  getStealthConfigSchema() {
    return StealthConfigSchema;
  }

  /**
   * Update performance metrics
   */
  updatePerformanceMetrics(metric, value) {
    if (this.performanceMetrics.hasOwnProperty(metric)) {
      this.performanceMetrics[metric] = value;
    }
  }

  /**
   * Clear bypass cache
   */
  clearBypassCache() {
    this.bypassCache.clear();
  }

  /**
   * Enable stealth mode with specified level
   */
  enableStealthMode(level = 'medium') {
    this.defaultConfig.level = level;
    this.defaultConfig.randomizeFingerprint = true;
    this.defaultConfig.simulateHumanBehavior = true;
  }

  /**
   * Disable stealth mode
   */
  disableStealthMode() {
    this.defaultConfig.level = 'basic';
    this.defaultConfig.randomizeFingerprint = false;
    this.defaultConfig.simulateHumanBehavior = false;
  }
}



// ─── D3.2: BrowserEngine interface + CamoufoxAdapter ──────────────────────────
//
// Camoufox licensing note:
//   camoufox (github.com/daijro/camoufox) is MIT-licensed.
//   python-camoufox launcher is MPL-2.0. The JS bindings
//   (@camoufox/jsapi) are MIT. There are no AGPL forks in the
//   main distribution chain as of 2026-05. Always re-verify before
//   distributing: https://github.com/daijro/camoufox/blob/main/LICENSE
//
// Engine-selection criteria:
//   playwright — Chromium-based, fastest, best Playwright ecosystem support.
//               Good default for most sites.
//   camoufox  — Firefox-based, patches browser internals to hide automation
//               markers at the C++ level, not via JS injection. Scores
//               significantly higher on CreepJS and Datadome than any
//               Playwright+stealth combination. Use when Playwright is
//               detected and blocked.
//
// Benchmark methodology (not run here — network-dependent):
//   1. Open https://bot.sannysoft.com with each engine — count red indicators.
//   2. Open https://nowsecure.nl with each engine — check "You are not a bot".
//   3. Run https://abrahamjuliot.github.io/creepjs/ — compare trust score %.
//   4. Use Datadome test page — verify challenge is not triggered.
//   All tests must be run with a clean incognito context and no extensions.

/**
 * BrowserEngine interface (D3.2).
 * Implementors must provide:
 *   launch(config)  → Promise<Browser-like>
 *   name()          → string
 *   isAvailable()   → Promise<boolean>
 */
export class BrowserEngine {
  /** @returns {string} */
  name() { throw new Error('BrowserEngine.name() must be implemented'); }

  /** @returns {Promise<boolean>} */
  async isAvailable() { return false; }

  /**
   * @param {object} config
   * @returns {Promise<object>} browser-like handle
   */
  async launch(_config) { throw new Error('BrowserEngine.launch() must be implemented'); }
}

/**
 * CamoufoxAdapter — Firefox-based engine using the camoufox package.
 * Falls back gracefully when camoufox is not installed.
 *
 * Install: npm install camoufox  (MIT license)
 */
export class CamoufoxAdapter extends BrowserEngine {
  name() { return 'camoufox'; }

  /**
   * Load camoufox through its CJS entry (dist/index.cjs) via createRequire.
   * The package's ESM entry (dist/index.js, an esbuild bundle) throws
   * 'Dynamic require of "events" is not supported' when imported from ESM,
   * so `await import('camoufox')` fails even when the package IS installed.
   */
  async _load() {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    return require('camoufox'); // CJS build — ESM build is broken
  }

  /** True only when the camoufox package itself is absent (vs. present but failing to load). */
  _isNotInstalled(err) {
    return err?.code === 'MODULE_NOT_FOUND' && (err.message || '').includes("Cannot find module 'camoufox'");
  }

  async isAvailable() {
    try {
      await this._load();
      return true;
    } catch (err) {
      if (this._isNotInstalled(err)) {
        return false;
      }
      // Installed but broken — surface the real error instead of misreporting "not installed".
      throw new Error(`camoufox is installed but failed to load: ${err.message}`);
    }
  }

  /**
   * A browserforge fingerprint pinned to the installed binary's Firefox major.
   *
   * camoufox@0.1.19 rewrites the persona's version tokens with
   *
   *   data.replace(/(?<!\d)(1[0-9]{2})(\.0)(?!\d)/, `${ffVersion}$2`)
   *
   * and there is no /g, so only the FIRST match in each string changes. In a
   * Firefox UA that match is `rv:`, and `Firefox/` keeps whatever version
   * browserforge drew — the two then agree only by coincidence. Measured on
   * the installed 135 binary: 4 of 8 launches produced a self-contradicting UA
   * (`rv:135.0 ... Firefox/150.0`), which is a one-line detection. Generating
   * the persona ourselves at the binary's own version makes that replace a
   * no-op and both tokens agree (8/8 measured, end to end through
   * launchOptions).
   *
   * Nothing else is constrained here because camoufox constrains nothing else:
   * its getScreenCons() returns null on both branches, and its `os` option is
   * dropped before it reaches the generator (the client sends `os`, the
   * generator's key is `operatingSystems`). Pinning the OS too would fix that
   * second bug, but it is Phase 1's documented `persona-os-vs-host` finding and
   * changing it here would move a baseline this change has no business moving.
   *
   * @returns {object|null} null when the version cannot be read, or when
   *   browserforge has no data for it — 152 is outside its set, and silently
   *   drawing some other version would put us back where we started. The
   *   caller then lets camoufox generate as it did before.
   */
  _pinnedFingerprint(camoufox) {
    try {
      const raw = fs.readFileSync(path.join(camoufox.INSTALL_DIR, 'version.json'), 'utf8');
      const major = parseInt(String(JSON.parse(raw).version).split('.')[0], 10);
      if (!Number.isInteger(major)) return null;

      // Resolved through camoufox's own module path first: fingerprint-generator
      // is its dependency, not ours, and this guarantees the same copy it feeds
      // its data to rather than a second one hoisted elsewhere.
      const here = createRequire(import.meta.url);
      let load;
      try {
        load = createRequire(here.resolve('camoufox'));
      } catch {
        load = here;
      }
      const { FingerprintGenerator } = load('fingerprint-generator');

      const { fingerprint } = new FingerprintGenerator({
        browsers: [{ name: 'firefox', minVersion: major, maxVersion: major }]
      }).getFingerprint();

      // Verify rather than assume: a generator with no data for this version
      // can still hand back a persona on a different one, and an unchecked
      // fingerprint would reintroduce exactly the mismatch this exists to close.
      const ua = fingerprint?.navigator?.userAgent ?? '';
      const rv = ua.match(/rv:(\d+)/)?.[1];
      const ff = ua.match(/Firefox\/(\d+)/)?.[1];
      if (rv !== String(major) || ff !== String(major)) return null;

      return fingerprint;
    } catch {
      // Best effort: a missing version.json or an absent generator is a reason
      // to fall back to camoufox's own persona, not to fail a launch.
      return null;
    }
  }

  async launch(config = {}) {
    let camoufox;
    try {
      camoufox = await this._load();
    } catch (err) {
      if (this._isNotInstalled(err)) {
        throw new Error(
          'camoufox is not installed. Run: npm install camoufox. Note: camoufox is MIT-licensed and requires Firefox to be installed.'
        );
      }
      throw new Error(`camoufox is installed but failed to load: ${err.message}`);
    }

    await this._ensureMacOSLayout(camoufox);

    // Before any Firefox page can run: camoufox reports an uncaught page error
    // with no location, and playwright reads one anyway. See the guard.
    guardFirefoxPageErrors();

    // camoufox's launcher is Camoufox(options) — the package has no launch()
    // export. It resolves the fetched Firefox binary (npx camoufox fetch) and
    // returns a Playwright-compatible Browser. Takes `headless` directly plus
    // passthrough Playwright Firefox launch options.
    //
    // The snake_case names below are camoufox's own option names. They are the
    // reason to run this engine at all: camoufox spoofs at the C++/Juggler
    // level, where a page cannot see the seam, and every one of these was
    // simply not being passed — camoufox ran with its own features off.
    const options = {
      // A string mode ('virtual' — Xvfb) has to reach camoufox as that string.
      // `config.headless !== false` collapsed it to `true`, which is plain
      // headless: the one mode 'virtual' exists to avoid. Booleans keep their
      // old meaning, so an unset headless is still headless.
      headless: typeof config.headless === 'string' ? config.headless : config.headless !== false,
      ...config.launchOptions
    };
    // A bare `{ server }` is fine here; camoufox normalises both shapes.
    if (config.proxy) options.proxy = config.proxy;
    // "windows" | "macos" | "linux", as a plain string — a one-element ARRAY is
    // ignored and falls back to the random draw. Left unset, camoufox picks one
    // of the three at random, which is how a Mac ended up claiming Windows.
    if (config.os) options.os = config.os;
    // The first listed locale is the one used for the Intl API. camoufox
    // applies it in its own engine, so navigator.language, Accept-Language and
    // Intl agree in the document and in every worker. Left unset with geoip on,
    // camoufox derives it from the proxy's exit IP instead.
    if (config.locale) options.locale = config.locale;
    // geoip derives longitude, latitude, timezone, country and locale from the
    // proxy's exit IP, which is the one thing that makes a proxied browser
    // coherent. It costs a request through the proxy, and the first ever call
    // downloads MaxMind's city database (~60 MB) into camoufox's install dir.
    if (config.geoip) options.geoip = true;
    // Blocking WebRTC is itself a signal. With geoip camoufox instead reports
    // the proxy's exit IP through WebRTC, which is the coherent answer — so
    // `blockWebRTC: false` is the stealthier setting behind a proxy.
    if (config.blockWebRTC) options.block_webrtc = true;
    // Native cursor humanization: camoufox moves the pointer along a plausible
    // path rather than teleporting it.
    if (config.humanize) options.humanize = true;
    // Pin the persona to the installed binary's Firefox major so the UA's two
    // version tokens agree. Left unpinned, camoufox's own version rewrite
    // reaches only `rv:` and about half of all launches announce a Firefox
    // that is not the one running — see _pinnedFingerprint.
    const fingerprint = this._pinnedFingerprint(camoufox);
    if (fingerprint) {
      options.fingerprint = fingerprint;
      // Switches off exactly two things: camoufox's "you passed your own
      // fingerprint" advisory, and its non-Firefox fingerprint check, which is
      // satisfied by construction — the generator above is Firefox-only. The
      // other options this flag gates (ff_version, block_images, disable_coop,
      // block_webgl) are ones this adapter never sets, so nothing else is
      // silenced.
      options.i_know_what_im_doing = true;
    }

    try {
      return await camoufox.Camoufox(options);
    } catch (err) {
      if (options.geoip) {
        // Do not quietly retry without geoip. A proxied camoufox whose
        // geolocation says one country while its exit IP says another is a
        // cleaner detection signal than an unproxied one.
        throw new Error(
          `camoufox failed to launch with geoip through the configured proxy: ${err.message}. ` +
          'Check the proxy credentials and that the proxy can reach the internet.'
        );
      }
      throw err;
    }
  }

  /**
   * macOS packaging fix for camoufox-js: it expects properties.json in
   * Camoufox.app/Contents/MacOS/, but the .app bundle ships it under
   * Contents/Resources/. Bridge it so the launcher can boot. Best-effort.
   * (Same fix as ResearchOrchestrator._ensureCamoufoxLayout.)
   */
  async _ensureMacOSLayout(camoufox) {
    if (process.platform !== 'darwin' || !camoufox?.INSTALL_DIR) return;
    try {
      const fs = await import('fs');
      const path = await import('path');
      const appDir = path.join(camoufox.INSTALL_DIR, 'Camoufox.app', 'Contents');
      const target = path.join(appDir, 'MacOS', 'properties.json');
      const source = path.join(appDir, 'Resources', 'properties.json');
      if (!fs.existsSync(target) && fs.existsSync(source)) {
        fs.copyFileSync(source, target);
      }
    } catch { /* best-effort; launch surfaces a real error if it matters */ }
  }
}

// ─── D3.4: BrowserBackend interface + backends ────────────────────────────────
//
// CRAWLFORGE_BROWSER_BACKEND=local  → LocalPlaywrightBackend (default, current behavior)
// CRAWLFORGE_BROWSER_BACKEND=browserbase → BrowserBaseBackend via CDP
//
// Graceful fallback: resolveBrowserBackend() below falls back to LocalPlaywrightBackend
// when CRAWLFORGE_BROWSER_BACKEND=browserbase but BROWSERBASE_API_KEY is unset.
// NOTE: resolveBrowserBackend() is exported but not currently called anywhere in
// StealthBrowserManager's own launch path — this backend is defined but unwired.

/**
 * BrowserBackend interface (D3.4).
 * Implementors must provide:
 *   connect(config)    → Promise<Browser-like>
 *   disconnect()       → Promise<void>
 *   name()             → string
 *   isConfigured()     → boolean
 */
export class BrowserBackend {
  name() { throw new Error('BrowserBackend.name() must be implemented'); }
  isConfigured() { return false; }
  async connect(_config) { throw new Error('BrowserBackend.connect() must be implemented'); }
  async disconnect() {}
}

/**
 * LocalPlaywrightBackend — wraps existing Playwright Chromium behavior.
 * This is the default backend (preserves all pre-D3.4 behavior).
 */
export class LocalPlaywrightBackend extends BrowserBackend {
  name() { return 'local'; }
  isConfigured() { return true; }

  async connect(config = {}) {
    const { chromium } = await import('playwright');
    return chromium.launch({
      headless: config.headless !== false,
      // Hosted images set this to their system Chromium (Playwright itself
      // never reads it) — see Dockerfile.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      ...config.launchOptions
    });
  }

  async disconnect() {}
}

/**
 * BrowserBaseBackend — connects to BrowserBase cloud browser via CDP.
 *
 * Requirements:
 *   BROWSERBASE_API_KEY — your BrowserBase API key
 *   CRAWLFORGE_BROWSER_BACKEND=browserbase
 *
 * The backend creates a BrowserBase session, gets the CDP endpoint, and
 * connects Playwright over it.  All stealth fingerprint injection still
 * runs through CrawlForge's existing page-level scripts.
 *
 * Docs: https://docs.browserbase.com/integrations/playwright
 */
export class BrowserBaseBackend extends BrowserBackend {
  constructor() {
    super();
    this._sessionId = null;
  }

  name() { return 'browserbase'; }

  isConfigured() {
    return Boolean(process.env.BROWSERBASE_API_KEY);
  }

  async connect(config = {}) {
    const apiKey = process.env.BROWSERBASE_API_KEY;
    if (!apiKey) {
      throw new Error(
        'BrowserBase requires BROWSERBASE_API_KEY environment variable. ' +
        'Get your key at https://browserbase.com'
      );
    }

    // Create a BrowserBase session
    const sessionRes = await fetch('https://www.browserbase.com/v1/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BB-API-Key': apiKey
      },
      body: JSON.stringify({
        projectId: process.env.BROWSERBASE_PROJECT_ID,
        ...config.sessionOptions
      })
    });

    if (!sessionRes.ok) {
      const err = await sessionRes.text().catch(() => '');
      throw new Error(`BrowserBase session create failed: HTTP ${sessionRes.status} ${err}`);
    }

    const session = await sessionRes.json();
    this._sessionId = session.id;

    // Connect Playwright over CDP
    const { chromium } = await import('playwright');
    const browser = await chromium.connectOverCDP(session.connectUrl, {
      timeout: config.timeout || 30000
    });

    return browser;
  }

  async disconnect() {
    if (!this._sessionId) return;
    const apiKey = process.env.BROWSERBASE_API_KEY;
    if (!apiKey) return;

    try {
      await fetch(`https://www.browserbase.com/v1/sessions/${this._sessionId}`, {
        method: 'DELETE',
        headers: { 'X-BB-API-Key': apiKey }
      });
    } catch {
      // Non-fatal — session will expire on BrowserBase's side
    } finally {
      this._sessionId = null;
    }
  }
}

/**
 * Factory: resolve which BrowserBackend to use based on env config.
 * Falls back to local on any error.
 *
 * @param {object} [options]
 * @returns {BrowserBackend}
 */
export function resolveBrowserBackend(options = {}) {
  const requested = (process.env.CRAWLFORGE_BROWSER_BACKEND || 'local').toLowerCase();

  if (requested === 'browserbase') {
    const bb = new BrowserBaseBackend();
    if (bb.isConfigured()) return bb;
    // BROWSERBASE_API_KEY not set — fall through to local
    console.error('[StealthBrowserManager] CRAWLFORGE_BROWSER_BACKEND=browserbase but BROWSERBASE_API_KEY is not set. Falling back to local Playwright.');
  }

  return new LocalPlaywrightBackend();
}

export default StealthBrowserManager;