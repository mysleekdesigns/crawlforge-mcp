/**
 * StealthBrowserManager - Anti-detection browser management
 * Features: fingerprint randomization, stealth configurations, anti-bot detection
 */

import { chromium } from 'playwright';
import { z } from 'zod';

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
  webRTCLocalIPs: z.array(z.string()).optional()
});

export class StealthBrowserManager {
  constructor(options = {}) {
    this.browser = null;
    this.contexts = new Map();
    this.fingerprints = new Map();
    
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
      locale: 'en-US'
    };

    // User agent pools for randomization
    this.userAgentPools = {
      chrome: [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      ],
      firefox: [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0',
        'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0'
      ],
      safari: [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Version/17.1 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
      ]
    };

    // Common viewport sizes
    this.viewportSizes = [
      { width: 1920, height: 1080 },
      { width: 1536, height: 864 },
      { width: 1440, height: 900 },
      { width: 1366, height: 768 },
      { width: 1280, height: 720 },
      { width: 1024, height: 768 }
    ];

    // Timezone options
    this.timezones = [
      'America/New_York',
      'America/Los_Angeles',
      'Europe/London',
      'Europe/Berlin',
      'Asia/Tokyo',
      'Australia/Sydney',
      'America/Chicago',
      'Europe/Paris'
    ];

    // WebRTC leak prevention IPs
    this.webRTCIPs = [
      '192.168.1.1',
      '10.0.0.1',
      '172.16.0.1'
    ];
  }

  /**
   * Launch stealth browser with anti-detection configurations
   */
  async launchStealthBrowser(config = {}) {
    if (this.browser) {
      return this.browser;
    }

    const validatedConfig = StealthConfigSchema.parse({ ...this.defaultConfig, ...config });
    
    // Base browser args for stealth
    const stealthArgs = [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-extensions-except=/path/to/extension',
      '--disable-extensions',
      '--disable-plugins',
      '--disable-images',
      '--disable-javascript-harmony-shipping',
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
      '--enable-automation',
      '--password-store=basic',
      '--use-mock-keychain'
    ];

    // Advanced stealth args based on level
    if (validatedConfig.level === 'advanced') {
      stealthArgs.push(
        '--disable-client-side-phishing-detection',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-domain-reliability',
        '--disable-gpu-sandbox',
        '--disable-ipc-flooding-protection',
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
        '--disable-accelerated-video-decode'
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

    this.browser = await chromium.launch({
      headless: true,
      args: stealthArgs,
      ignoreDefaultArgs: [
        '--enable-blink-features=IdleDetection',
        '--enable-automation'
      ]
    });

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
    const fingerprint = this.generateFingerprint(validatedConfig);
    
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

    const context = await this.browser.newContext(contextOptions);
    const contextId = this.generateContextId();
    
    // Apply stealth scripts and configurations
    await this.applyStealthConfigurations(context, validatedConfig, fingerprint);
    
    this.contexts.set(contextId, { context, fingerprint, config: validatedConfig });
    this.fingerprints.set(contextId, fingerprint);

    return { context, contextId, fingerprint };
  }

  /**
   * Generate randomized browser fingerprint
   */
  generateFingerprint(config) {
    const fingerprint = {
      userAgent: this.selectUserAgent(config),
      viewport: config.customViewport || this.selectViewport(),
      timezone: config.timezone || this.selectTimezone(),
      deviceScaleFactor: this.randomFloat(1, 2, 1),
      isMobile: Math.random() < 0.1, // 10% mobile
      hasTouch: Math.random() < 0.15, // 15% touch
      colorScheme: Math.random() < 0.3 ? 'dark' : 'light',
      reducedMotion: Math.random() < 0.1 ? 'reduce' : 'no-preference',
      forcedColors: Math.random() < 0.05 ? 'active' : 'none',
      headers: this.generateRandomHeaders(config),
      webRTC: this.generateWebRTCConfig(config),
      canvas: this.generateCanvasFingerprint(),
      webGL: this.generateWebGLFingerprint(),
      fonts: this.generateFontList(),
      plugins: this.generatePluginList(),
      geolocation: this.generateGeolocation(),
      screen: this.generateScreenProperties()
    };

    return fingerprint;
  }

  /**
   * Select user agent based on configuration
   */
  selectUserAgent(config) {
    if (config.customUserAgent) {
      return config.customUserAgent;
    }

    if (!config.useRandomUserAgent) {
      return this.userAgentPools.chrome[0];
    }

    // Weight Chrome higher as it's most common
    const browserWeights = { chrome: 0.7, firefox: 0.2, safari: 0.1 };
    const selectedBrowser = this.weightedRandom(browserWeights);
    const pool = this.userAgentPools[selectedBrowser];
    
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * Select viewport size
   */
  selectViewport() {
    return this.viewportSizes[Math.floor(Math.random() * this.viewportSizes.length)];
  }

  /**
   * Select timezone
   */
  selectTimezone() {
    return this.timezones[Math.floor(Math.random() * this.timezones.length)];
  }

  /**
   * Generate random HTTP headers
   */
  generateRandomHeaders(config) {
    const headers = {
      'Accept-Language': `${config.locale.toLowerCase()},en;q=0.9`,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'max-age=0',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"'
    };

    // Randomize some headers
    if (Math.random() < 0.3) {
      headers['DNT'] = '1';
    }

    if (Math.random() < 0.5) {
      headers['Connection'] = 'keep-alive';
    }

    return headers;
  }

  /**
   * Generate WebRTC configuration for leak prevention
   */
  generateWebRTCConfig(config) {
    return {
      publicIP: config.webRTCPublicIP || '192.168.1.' + Math.floor(Math.random() * 255),
      localIPs: config.webRTCLocalIPs || [
        '192.168.1.' + Math.floor(Math.random() * 255),
        '10.0.0.' + Math.floor(Math.random() * 255)
      ]
    };
  }

  /**
   * Generate canvas fingerprint spoofing data
   */
  generateCanvasFingerprint() {
    return {
      toDataURL: this.randomHex(64),
      textMetrics: {
        width: this.randomFloat(50, 200, 2),
        height: this.randomFloat(10, 30, 2)
      }
    };
  }

  /**
   * Generate WebGL fingerprint spoofing data
   */
  generateWebGLFingerprint() {
    return {
      renderer: 'ANGLE (Intel, Intel(R) HD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      vendor: 'Google Inc. (Intel)',
      version: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)',
      shadingLanguageVersion: 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)',
      extensions: [
        'ANGLE_instanced_arrays',
        'EXT_blend_minmax',
        'EXT_color_buffer_half_float',
        'EXT_disjoint_timer_query',
        'EXT_float_blend',
        'EXT_frag_depth',
        'EXT_shader_texture_lod',
        'EXT_texture_compression_rgtc',
        'EXT_texture_filter_anisotropic',
        'WEBKIT_EXT_texture_filter_anisotropic'
      ]
    };
  }

  /**
   * Generate font list for fingerprinting
   */
  generateFontList() {
    const baseFonts = [
      'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Verdana',
      'Georgia', 'Palatino', 'Garamond', 'Bookman', 'Tahoma'
    ];

    const additionalFonts = [
      'Comic Sans MS', 'Trebuchet MS', 'Arial Black', 'Impact',
      'Lucida Sans Unicode', 'Franklin Gothic Medium', 'Arial Narrow'
    ];

    // Randomly include additional fonts
    const fonts = [...baseFonts];
    additionalFonts.forEach(font => {
      if (Math.random() < 0.6) {
        fonts.push(font);
      }
    });

    return fonts.sort();
  }

  /**
   * Generate plugin list
   */
  generatePluginList() {
    const plugins = [];
    
    if (Math.random() < 0.8) {
      plugins.push({
        name: 'Chrome PDF Plugin',
        filename: 'internal-pdf-viewer',
        description: 'Portable Document Format'
      });
    }

    if (Math.random() < 0.6) {
      plugins.push({
        name: 'Chrome PDF Viewer',
        filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
        description: 'Portable Document Format'
      });
    }

    return plugins;
  }

  /**
   * Generate geolocation data
   */
  generateGeolocation() {
    // Random coordinates in major cities
    const cities = [
      { latitude: 40.7128, longitude: -74.0060 }, // New York
      { latitude: 34.0522, longitude: -118.2437 }, // Los Angeles
      { latitude: 51.5074, longitude: -0.1278 }, // London
      { latitude: 48.8566, longitude: 2.3522 }, // Paris
      { latitude: 35.6762, longitude: 139.6503 }, // Tokyo
      { latitude: -33.8688, longitude: 151.2093 } // Sydney
    ];

    const city = cities[Math.floor(Math.random() * cities.length)];
    
    return {
      latitude: city.latitude + (Math.random() - 0.5) * 0.1,
      longitude: city.longitude + (Math.random() - 0.5) * 0.1,
      accuracy: Math.floor(Math.random() * 100) + 50
    };
  }

  /**
   * Generate screen properties
   */
  generateScreenProperties() {
    const viewport = this.selectViewport();
    
    return {
      width: viewport.width,
      height: viewport.height,
      availWidth: viewport.width,
      availHeight: viewport.height - 40, // Account for taskbar
      colorDepth: 24,
      pixelDepth: 24
    };
  }

  /**
   * Apply stealth configurations to browser context
   */
  async applyStealthConfigurations(context, config, fingerprint) {
    // Add initialization script to override various APIs
    await context.addInitScript(() => {
      // Remove webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Override plugins
      Object.defineProperty(navigator, 'plugins', {
        get: function() {
          return [
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
        }
      });

      // Override languages
      Object.defineProperty(navigator, 'languages', {
        get: function() {
          return ['en-US', 'en'];
        }
      });

      // Override permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );

      // Mock battery API
      Object.defineProperty(navigator, 'getBattery', {
        get: function() {
          return function() {
            return Promise.resolve({
              charging: true,
              chargingTime: 0,
              dischargingTime: Infinity,
              level: Math.random()
            });
          };
        }
      });
    });

    // WebRTC leak prevention
    if (config.blockWebRTC) {
      await context.addInitScript((webrtcConfig) => {
        const getOrig = RTCPeerConnection.prototype.createOffer;
        RTCPeerConnection.prototype.createOffer = function() {
          const rtc = this;
          return getOrig.apply(rtc, arguments)
            .then(offer => {
              offer.sdp = offer.sdp.replace(/c=IN IP4 .*\r\n/g, 'c=IN IP4 ' + webrtcConfig.publicIP + '\r\n');
              return offer;
            });
        };
      }, fingerprint.webRTC);
    }

    // Canvas fingerprinting protection
    await context.addInitScript((canvasConfig) => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(contextType, contextAttributes) {
        const ctx = getContext.call(this, contextType, contextAttributes);
        
        if (contextType === '2d') {
          const originalToDataURL = this.toDataURL;
          this.toDataURL = function(...args) {
            // Add slight noise to canvas data
            const imageData = ctx.getImageData(0, 0, this.width, this.height);
            for (let i = 0; i < imageData.data.length; i += 4) {
              imageData.data[i] = Math.min(255, imageData.data[i] + Math.random() * 2 - 1);
            }
            ctx.putImageData(imageData, 0, 0);
            return originalToDataURL.apply(this, args);
          };
        }
        
        return ctx;
      };
    }, fingerprint.canvas);

    // Font detection spoofing
    await context.addInitScript((fonts) => {
      const addRule = CSSStyleSheet.prototype.insertRule;
      CSSStyleSheet.prototype.insertRule = function(rule) {
        if (rule.includes('font-family')) {
          // Modify font detection attempts
          return addRule.call(this, rule);
        }
        return addRule.call(this, rule);
      };
    }, fingerprint.fonts);

    // Screen resolution spoofing
    await context.addInitScript((screenConfig) => {
      Object.defineProperties(screen, {
        width: { value: screenConfig.width },
        height: { value: screenConfig.height },
        availWidth: { value: screenConfig.availWidth },
        availHeight: { value: screenConfig.availHeight },
        colorDepth: { value: screenConfig.colorDepth },
        pixelDepth: { value: screenConfig.pixelDepth }
      });
    }, fingerprint.screen);

    // Timezone spoofing
    if (config.spoofTimezone) {
      await context.addInitScript((timezone) => {
        const originalDateTimeFormat = Intl.DateTimeFormat;
        Intl.DateTimeFormat = function(...args) {
          args[1] = args[1] || {};
          args[1].timeZone = timezone;
          return new originalDateTimeFormat(...args);
        };
        
        Date.prototype.getTimezoneOffset = function() {
          return -300; // EST offset in minutes
        };
      }, fingerprint.timezone);
    }
  }

  /**
   * Create stealth page with anti-detection measures
   */
  async createStealthPage(contextId) {
    const contextData = this.contexts.get(contextId);
    if (!contextData) {
      throw new Error('Context not found');
    }

    const page = await contextData.context.newPage();
    
    // Apply additional page-level stealth measures
    await this.applyPageStealthMeasures(page, contextData.config, contextData.fingerprint);
    
    return page;
  }

  /**
   * Apply page-level stealth measures
   */
  async applyPageStealthMeasures(page, config, fingerprint) {
    // Block unnecessary resources to reduce detection
    await page.route('**/*', route => {
      const resourceType = route.request().resourceType();
      if (['image', 'font', 'stylesheet'].includes(resourceType) && config.level === 'advanced') {
        route.abort();
      } else {
        route.continue();
      }
    });

    // Add request headers
    await page.setExtraHTTPHeaders(fingerprint.headers);

    // Emulate network conditions
    if (config.level === 'advanced') {
      const client = await page.context().newCDPSession(page);
      await client.send('Network.emulateNetworkConditions', {
        offline: false,
        downloadThroughput: 1.5 * 1024 * 1024 / 8, // 1.5 Mbps
        uploadThroughput: 750 * 1024 / 8, // 750 kbps  
        latency: 40 // 40ms
      });
    }

    return page;
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
    const contextData = this.contexts.get(contextId);
    if (contextData) {
      await contextData.context.close();
      this.contexts.delete(contextId);
      this.fingerprints.delete(contextId);
    }
  }

  /**
   * Close all contexts and browser
   */
  async cleanup() {
    // Close all contexts
    for (const [contextId, contextData] of this.contexts.entries()) {
      try {
        await contextData.context.close();
      } catch (error) {
        console.warn(`Failed to close context ${contextId}:`, error.message);
      }
    }

    this.contexts.clear();
    this.fingerprints.clear();

    // Close browser
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error) {
        console.warn('Failed to close browser:', error.message);
      }
      this.browser = null;
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      activeContexts: this.contexts.size,
      totalFingerprintsSaved: this.fingerprints.size,
      browserRunning: !!this.browser
    };
  }
}

export default StealthBrowserManager;