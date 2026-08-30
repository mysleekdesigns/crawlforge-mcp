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
import HumanBehaviorSimulator from '../utils/HumanBehaviorSimulator.js';
import { BrowserContextPool } from './BrowserContextPool.js';

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

  // C2: browser engine selection — 'chromium' (default) or 'camoufox' (Firefox-based)
  engine: z.enum(['chromium', 'camoufox']).optional().default('chromium')
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

export class StealthBrowserManager {
  constructor(options = {}) {
    this.browser = null;
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

    // Enhanced User agent pools with realistic patterns
    this.userAgentPools = {
      chrome: {
        windows: [
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
          'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        ],
        macos: [
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        ],
        linux: [
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ]
      },
      firefox: {
        windows: [
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
        ],
        macos: [
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:122.0) Gecko/20100101 Firefox/122.0',
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0'
        ],
        linux: [
          'Mozilla/5.0 (X11; Linux x86_64; rv:122.0) Gecko/20100101 Firefox/122.0',
          'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:122.0) Gecko/20100101 Firefox/122.0'
        ]
      },
      safari: {
        macos: [
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
        ]
      }
    };
    
    // Operating system distributions for realistic user agent selection
    this.osDistribution = {
      windows: 0.75,
      macos: 0.15,
      linux: 0.10
    };
    
    // Browser market share for realistic selection
    this.browserDistribution = {
      chrome: 0.65,
      firefox: 0.20,
      safari: 0.15
    };

    // Realistic viewport sizes with market distribution
    this.viewportSizes = [
      { width: 1920, height: 1080, weight: 0.25 }, // Most common
      { width: 1366, height: 768, weight: 0.20 },  // Second most common
      { width: 1536, height: 864, weight: 0.15 },
      { width: 1440, height: 900, weight: 0.12 },
      { width: 1280, height: 720, weight: 0.10 },
      { width: 1600, height: 900, weight: 0.08 },
      { width: 1024, height: 768, weight: 0.05 },  // Legacy but still used
      { width: 2560, height: 1440, weight: 0.03 }, // High-res displays
      { width: 3840, height: 2160, weight: 0.02 }  // 4K displays
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

    // A Chromium that was OOM-killed or crashed doesn't error on reuse — its
    // protocol calls hang. Detect the corpse and relaunch instead.
    if (this.browser && !this.browser.isConnected()) {
      this.browser = null;
    }

    // C2: if the requested engine differs from the running browser, tear it down first.
    if (this.browser && this._launchedEngine && this._launchedEngine !== validatedConfig.engine) {
      await this.browser.close().catch(() => {});
      this.browser = null;
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
   * Actual browser launch, guarded by launchStealthBrowser's in-flight
   * promise so only one launch can be in progress at a time.
   */
  async _doLaunchStealthBrowser(validatedConfig) {
    // C2: delegate to CamoufoxAdapter when engine === 'camoufox'
    if (validatedConfig.engine === 'camoufox') {
      const adapter = new CamoufoxAdapter();
      const available = await adapter.isAvailable();
      if (!available) {
        throw new Error(
          'camoufox is not installed. Run: npm install camoufox to use the Firefox-based stealth engine.'
        );
      }
      this.browser = await adapter.launch({
        headless: true,
        launchOptions: {}
      });
      this._launchedEngine = 'camoufox';
      return this.browser;
    }

    this._launchedEngine = 'chromium';
    // Base browser args for stealth (Chromium path)
    const stealthArgs = [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-extensions',
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
      
      // Additional stealth arguments
      '--disable-default-apps',
      '--disable-component-extensions-with-background-pages',
      '--disable-background-networking',
      '--disable-component-update',
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
        '--disable-popup-blocking',
        '--disable-setuid-sandbox',
        '--disable-site-isolation-trials',
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

    // WebRTC blocking
    if (validatedConfig.blockWebRTC) {
      stealthArgs.push(
        '--disable-webrtc-hw-decoding',
        '--disable-webrtc-hw-encoding',
        '--disable-webrtc-multiple-routes',
        '--disable-webrtc-hw-vp8-encoding',
        '--enforce-webrtc-ip-permission-check'
      );
    }

    // Handle proxy configuration
    const currentProxy = await this.rotateProxy(validatedConfig);
    if (currentProxy) {
      stealthArgs.push(`--proxy-server=${currentProxy}`);
    }

    const browser = await chromium.launch({
      headless: true,
      // Hosted images set this to their system Chromium (Playwright itself
      // never reads it) — see Dockerfile.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: stealthArgs,
      ignoreDefaultArgs: [
        '--enable-blink-features=IdleDetection',
        '--enable-automation'
      ]
    });

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
    
    if (!this.browser) {
      await this.launchStealthBrowser(validatedConfig);
    }

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
      
      // Bypass various detections
      bypassCSP: true,
      javaScriptEnabled: true
    };

    // camoufox's Firefox build predates the Browser.setDefaultViewport fields
    // playwright-core 1.62 sends (screenSize, isMobile, ...) and rejects unknown
    // properties, so any fixed viewport fails. viewport:null skips that protocol
    // call entirely (deviceScaleFactor/isMobile/hasTouch/screen are invalid or
    // meaningless without a viewport). window.screen is still spoofed via
    // addInitScript in applyAdvancedStealthConfigurations.
    if (this._launchedEngine === 'camoufox') {
      contextOptions.viewport = null;
      delete contextOptions.deviceScaleFactor;
      delete contextOptions.isMobile;
      delete contextOptions.hasTouch;
      delete contextOptions.screen;
    }

    const context = await this.browser.newContext(contextOptions);
    const contextId = this.generateContextId();
    
    // Apply stealth scripts and configurations
    await this.applyAdvancedStealthConfigurations(context, validatedConfig, fingerprint);
    
    await this.contexts.set(contextId, { context, fingerprint, config: validatedConfig });
    // D2.2: enforce LRU cap on fingerprints Map
    this._setFingerprint(contextId, fingerprint);

    return { context, contextId, fingerprint };
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
    const fingerprint = {
      userAgent,
      locale: persona.locale,
      viewport: config.customViewport || this.selectWeightedViewport(),
      timezone: config.timezone || persona.timezone,
      deviceScaleFactor: this.randomFloat(1, 2, 1),
      isMobile: Math.random() < 0.1, // 10% mobile
      hasTouch: Math.random() < 0.15, // 15% touch
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
      screen: this.generateAdvancedScreenProperties(),
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
      // width/height only — the pool's selection weight is an internal.
      viewport: { width: fingerprint.viewport.width, height: fingerprint.viewport.height }
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

    const persona = pool[Math.floor(Math.random() * pool.length)];
    return { ...persona, locale: requested };
  }

  /**
   * Choose a single OS ('windows' | 'macos' | 'linux') for a fingerprint.
   * A custom UA pins the OS to whatever that UA reports; a non-random UA pins
   * to windows (the default pool below); otherwise weighted-random.
   */
  selectOS(config = {}) {
    if (config.customUserAgent) {
      return this.inferOSFromUserAgent(config.customUserAgent);
    }
    if (!config.useRandomUserAgent) {
      return 'windows';
    }
    return this.weightedRandom(this.osDistribution);
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
   * Select realistic user agent based on market distribution
   */
  selectRealisticUserAgent(config, selectedOS) {
    if (config.customUserAgent) {
      return config.customUserAgent;
    }

    if (!config.useRandomUserAgent) {
      return this.userAgentPools.chrome.windows[0];
    }

    // Use the OS chosen once for this fingerprint (falls back to a fresh draw
    // if called without one, preserving the original standalone behavior).
    selectedOS = selectedOS || this.weightedRandom(this.osDistribution);

    // Select browser based on distribution and OS compatibility
    let availableBrowsers = { ...this.browserDistribution };
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
   * Select viewport size based on weights
   */
  selectWeightedViewport() {
    return this.weightedRandomFromArray(this.viewportSizes);
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
   * Generate sec-ch-ua header.
   * C2: brand versions are derived from the UA's Chrome major version so
   * sec-ch-ua and the User-Agent header stay consistent.
   * @param {string} [userAgent] — the selected user agent string
   */
  generateSecChUaHeader(userAgent = '') {
    // Extract Chrome major version from the UA (e.g. "Chrome/121.0.0.0" → "121").
    // Fall back to 121 if the UA is not a Chrome UA.
    const match = userAgent.match(/Chrome\/(\d+)/i);
    const version = match ? match[1] : '121';

    const brands = [
      { brand: 'Not_A Brand', version: '8' },
      { brand: 'Chromium', version },
      { brand: 'Google Chrome', version }
    ];

    return brands
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

    selectedOS = selectedOS || this.weightedRandom(this.osDistribution);
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
    selectedOS = selectedOS || this.weightedRandom(this.osDistribution);

    const processors = [
      { cores: 4, threads: 8, name: 'Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz' },
      { cores: 6, threads: 12, name: 'Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz' },
      { cores: 8, threads: 16, name: 'Intel(R) Core(TM) i7-10700K CPU @ 3.80GHz' },
      { cores: 4, threads: 4, name: 'Intel(R) Core(TM) i5-7400 CPU @ 3.00GHz' },
      { cores: 6, threads: 6, name: 'AMD Ryzen 5 3600 6-Core Processor' },
      { cores: 8, threads: 16, name: 'AMD Ryzen 7 3700X 8-Core Processor' }
    ];

    const selectedProcessor = processors[Math.floor(Math.random() * processors.length)];

    return {
      hardwareConcurrency: selectedProcessor.threads,
      processor: selectedProcessor.name,
      architecture: 'x86_64',
      memory: Math.floor(Math.random() * 24) + 8, // 8-32 GB
      deviceMemory: Math.pow(2, Math.floor(Math.random() * 3) + 3), // 8, 16, or 32 GB
      platform: this.selectRealisticPlatform(selectedOS)
    };
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
   * Generate advanced screen properties
   */
  generateAdvancedScreenProperties() {
    const viewport = this.selectWeightedViewport();
    
    return {
      width: viewport.width,
      height: viewport.height,
      availWidth: viewport.width,
      availHeight: viewport.height - (30 + Math.floor(Math.random() * 20)), // Account for taskbar
      colorDepth: Math.random() < 0.95 ? 24 : 32,
      pixelDepth: 24,
      orientation: {
        angle: 0,
        type: 'landscape-primary'
      }
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
    // Enhanced initialization script with comprehensive stealth measures
    await context.addInitScript((locale) => {
      // Remove webdriver property completely
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true
      });

      // Hide automation indicators
      delete window.navigator.__proto__.webdriver;
      delete window.navigator.webdriver;
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

      // Hide headless indicators. configurable: true because the hardware
      // spoofing script below redefines this with the fingerprint's own core
      // count — without it that redefinition throws "Cannot redefine property"
      // and takes navigator.platform and deviceMemory down with it, so the
      // page saw a Win32 platform on every persona.
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 4,
        configurable: true
      });

      // Spoof connection
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          effectiveType: '4g',
          rtt: 50 + Math.random() * 50,
          downlink: 10,
          saveData: false
        })
      });

      // Override plugin array
      Object.defineProperty(navigator, 'plugins', {
        get: function() {
          const plugins = [
            {
              0: {
                type: "application/x-google-chrome-pdf",
                suffixes: "pdf",
                description: "Portable Document Format"
              },
              description: "Portable Document Format",
              filename: "internal-pdf-viewer",
              length: 1,
              name: "Chrome PDF Plugin"
            }
          ];
          plugins.item = function(index) { return this[index] || null; };
          plugins.namedItem = function(name) { 
            return this.find(plugin => plugin.name === name) || null; 
          };
          return plugins;
        }
      });

      // Override languages with the fingerprint's own locale — a hardcoded
      // en-US here contradicts navigator.language and Accept-Language whenever
      // the persona is not American.
      Object.defineProperty(navigator, 'languages', {
        get: function() {
          const primary = locale.split('-')[0];
          return primary === locale ? [locale] : [locale, primary];
        }
      });

      // Mock battery API with realistic values
      Object.defineProperty(navigator, 'getBattery', {
        get: function() {
          return function() {
            return Promise.resolve({
              charging: true,
              chargingTime: 0,
              dischargingTime: Infinity,
              level: 0.8 + Math.random() * 0.19 // 80-99%
            });
          };
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
    }, fingerprint.locale || config.locale || 'en-US');

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
          
          if (contextType === 'webgl' || contextType === 'experimental-webgl') {
            const originalGetParameter = ctx.getParameter;
            ctx.getParameter = function(parameter) {
              // Spoof specific WebGL parameters
              if (parameter === ctx.RENDERER) {
                return webglConfig.renderer;
              }
              if (parameter === ctx.VENDOR) {
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
            
            const originalGetExtension = ctx.getExtension;
            ctx.getExtension = function(name) {
              if (webglConfig.extensions.includes(name)) {
                return originalGetExtension.call(this, name) || {};
              }
              return null;
            };
          }
          
          return ctx;
        };
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

    // Hardware spoofing
    if (config.fingerprinting?.hardwareSpoofing) {
      await context.addInitScript((hardware) => {
        Object.defineProperty(navigator, 'hardwareConcurrency', {
          get: () => hardware.hardwareConcurrency
        });
        
        Object.defineProperty(navigator, 'platform', {
          get: () => hardware.platform
        });
        
        if (navigator.deviceMemory !== undefined) {
          Object.defineProperty(navigator, 'deviceMemory', {
            get: () => hardware.deviceMemory
          });
        }
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
    await context.addInitScript((screenConfig) => {
      Object.defineProperties(screen, {
        width: { value: screenConfig.width, configurable: true },
        height: { value: screenConfig.height, configurable: true },
        availWidth: { value: screenConfig.availWidth, configurable: true },
        availHeight: { value: screenConfig.availHeight, configurable: true },
        colorDepth: { value: screenConfig.colorDepth, configurable: true },
        pixelDepth: { value: screenConfig.pixelDepth, configurable: true }
      });
    }, fingerprint.screen);

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
        if (navigator.getBattery) {
          navigator.getBattery = function() {
            return Promise.resolve(battery);
          };
        }
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
   * Proxy rotation management
   */
  async rotateProxy(config) {
    if (!config.proxyRotation?.enabled || !config.proxyRotation?.proxies?.length) {
      return null;
    }
    
    const now = Date.now();
    const { rotationInterval, proxies } = config.proxyRotation;
    
    if (now - this.proxyManager.lastRotation > rotationInterval) {
      this.proxyManager.proxyIndex = (this.proxyManager.proxyIndex + 1) % proxies.length;
      this.proxyManager.currentProxy = proxies[this.proxyManager.proxyIndex];
      this.proxyManager.lastRotation = now;
      
      console.error('Rotated to proxy:', this.proxyManager.currentProxy);
    }
    
    return this.proxyManager.currentProxy;
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
   * @param {string} [params.engine]            — browser engine (forwarded to config; playwright by default)
   * @param {number} [params.wait_for]          — extra wait after load, in ms
   * @param {boolean} [params.screenshot]       — capture a base64 PNG screenshot
   * @param {Object} [params.stealthConfig]     — stealth configuration overrides
   * @returns {Promise<{success:boolean, url:string, title:string, text:string, html:string, screenshot:?string}>}
   */
  async scrapeWithStealth({ url, engine, wait_for = 0, screenshot = false, stealthConfig = {} } = {}) {
    if (!url) throw new Error('scrapeWithStealth requires a url');

    const { contextId } = await this.createStealthContext({ ...stealthConfig, engine });
    try {
      const page = await this.createStealthPage(contextId);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (wait_for > 0) await page.waitForTimeout(wait_for);

      const [title, html, text] = await Promise.all([
        page.title().catch(() => ''),
        page.content().catch(() => ''),
        page.innerText('body').catch(() => '')
      ]);
      const shot = screenshot
        ? await page.screenshot({ encoding: 'base64', fullPage: false }).catch(() => null)
        : null;

      return { success: true, url, title, text, html, screenshot: shot };
    } finally {
      await this.closeContext(contextId).catch(() => {});
    }
  }

  /**
   * Apply page-level stealth measures
   */
  async applyPageStealthMeasures(page, config, fingerprint) {
    // Enhanced resource blocking with stealth considerations
    await page.route('**/*', route => {
      const resourceType = route.request().resourceType();
      const url = route.request().url();
      
      // Block known bot detection resources
      const blockedDomains = [
        'botd.fpjs.io',
        'challenges.cloudflare.com',
        'datadome.co',
        'perimeterx.net',
        'distilnetworks.com'
      ];
      
      if (blockedDomains.some(domain => url.includes(domain))) {
        route.abort();
        return;
      }

      // Don't block detection-related resources that might be expected
      if (url.includes('webdriver') || url.includes('selenium') || url.includes('puppeteer')) {
        route.abort();
        return;
      }

      // Selective resource blocking based on level
      if (config.level === 'advanced') {
        if (['image', 'font', 'stylesheet'].includes(resourceType)) {
          // Allow some images/fonts to maintain realism
          if (Math.random() < 0.3) {
            route.continue();
          } else {
            route.abort();
          }
        } else {
          route.continue();
        }
      } else {
        route.continue();
      }
    });

    // Add request headers
    await page.setExtraHTTPHeaders(fingerprint.headers);

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
    if (this.browser) {
      const browser = this.browser;
      this.browser = null;
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

    // camoufox's launcher is Camoufox(options) — the package has no launch()
    // export. It resolves the fetched Firefox binary (npx camoufox fetch) and
    // returns a Playwright-compatible Browser. Takes `headless` directly plus
    // passthrough Playwright Firefox launch options.
    return camoufox.Camoufox({
      headless: config.headless !== false,
      ...config.launchOptions
    });
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