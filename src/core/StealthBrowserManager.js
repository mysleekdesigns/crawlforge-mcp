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
  }).optional()
});

export class StealthBrowserManager {
  constructor(options = {}) {
    this.browser = null;
    this.contexts = new Map();
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

    // Timezone options
    this.timezones = [
      'America/New_York',
      'America/Los_Angeles',
      'America/Chicago',
      'America/Denver',
      'Europe/London',
      'Europe/Berlin',
      'Europe/Paris',
      'Europe/Madrid',
      'Asia/Tokyo',
      'Asia/Shanghai',
      'Asia/Seoul',
      'Australia/Sydney',
      'Australia/Melbourne'
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

    const context = await this.browser.newContext(contextOptions);
    const contextId = this.generateContextId();
    
    // Apply stealth scripts and configurations
    await this.applyAdvancedStealthConfigurations(context, validatedConfig, fingerprint);
    
    this.contexts.set(contextId, { context, fingerprint, config: validatedConfig });
    this.fingerprints.set(contextId, fingerprint);

    return { context, contextId, fingerprint };
  }

  /**
   * Generate advanced browser fingerprint with enhanced randomization
   */
  generateAdvancedFingerprint(config = {}) {
    const fingerprint = {
      userAgent: this.selectRealisticUserAgent(config),
      viewport: config.customViewport || this.selectWeightedViewport(),
      timezone: config.timezone || this.selectTimezone(),
      deviceScaleFactor: this.randomFloat(1, 2, 1),
      isMobile: Math.random() < 0.1, // 10% mobile
      hasTouch: Math.random() < 0.15, // 15% touch
      colorScheme: Math.random() < 0.3 ? 'dark' : 'light',
      reducedMotion: Math.random() < 0.1 ? 'reduce' : 'no-preference',
      forcedColors: Math.random() < 0.05 ? 'active' : 'none',
      headers: this.generateAdvancedHeaders(config),
      webRTC: this.generateWebRTCConfig(config),
      canvas: this.generateAdvancedCanvasFingerprint(),
      webGL: this.generateAdvancedWebGLFingerprint(),
      audioContext: this.generateAudioContextFingerprint(),
      mediaDevices: this.generateMediaDevicesFingerprint(),
      hardware: this.generateHardwareFingerprint(),
      fonts: this.generateAdvancedFontList(),
      plugins: this.generateAdvancedPluginList(),
      geolocation: this.generateRealisticGeolocation(),
      screen: this.generateAdvancedScreenProperties(),
      battery: this.generateBatteryFingerprint()
    };

    return fingerprint;
  }

  /**
   * Select realistic user agent based on market distribution
   */
  selectRealisticUserAgent(config) {
    if (config.customUserAgent) {
      return config.customUserAgent;
    }

    if (!config.useRandomUserAgent) {
      return this.userAgentPools.chrome.windows[0];
    }

    // Select OS based on distribution
    const selectedOS = this.weightedRandom(this.osDistribution);
    
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
   * Select timezone
   */
  selectTimezone() {
    return this.timezones[Math.floor(Math.random() * this.timezones.length)];
  }

  /**
   * Generate advanced HTTP headers with realistic patterns
   */
  generateAdvancedHeaders(config) {
    const headers = {
      'Accept-Language': `${(config.locale || 'en-US').toLowerCase()},en;q=0.9`,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'max-age=0',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': this.generateSecChUaPlatform()
    };

    // Add sec-ch-ua header
    headers['sec-ch-ua'] = this.generateSecChUaHeader();

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
   * Generate sec-ch-ua header
   */
  generateSecChUaHeader() {
    const brands = [
      { brand: 'Not_A Brand', version: '8' },
      { brand: 'Chromium', version: '120' },
      { brand: 'Google Chrome', version: '120' }
    ];
    
    return brands
      .map(b => `"${b.brand}";v="${b.version}"`)
      .join(', ');
  }

  /**
   * Generate sec-ch-ua-platform header
   */
  generateSecChUaPlatform() {
    const platforms = {
      windows: '"Windows"',
      macos: '"macOS"',
      linux: '"Linux"'
    };
    
    const selectedOS = this.weightedRandom(this.osDistribution);
    return platforms[selectedOS] || '"Windows"';
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
  generateAdvancedWebGLFingerprint() {
    const gpuVendors = [
      { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) HD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' }
    ];
    
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
  generateMediaDevicesFingerprint() {
    const videoDevices = [
      { deviceId: crypto.randomUUID(), kind: 'videoinput', label: 'HD Pro Webcam C920 (046d:082d)', groupId: crypto.randomUUID() },
      { deviceId: crypto.randomUUID(), kind: 'videoinput', label: 'FaceTime HD Camera', groupId: crypto.randomUUID() },
      { deviceId: crypto.randomUUID(), kind: 'videoinput', label: 'Integrated Camera', groupId: crypto.randomUUID() }
    ];
    
    const audioDevices = [
      { deviceId: crypto.randomUUID(), kind: 'audioinput', label: 'Default - Internal Microphone', groupId: crypto.randomUUID() },
      { deviceId: crypto.randomUUID(), kind: 'audiooutput', label: 'Default - Internal Speakers', groupId: crypto.randomUUID() },
      { deviceId: crypto.randomUUID(), kind: 'audioinput', label: 'Communications - Internal Microphone', groupId: crypto.randomUUID() }
    ];
    
    // Randomly select devices
    const selectedDevices = [];
    if (Math.random() < 0.8) selectedDevices.push(videoDevices[Math.floor(Math.random() * videoDevices.length)]);
    if (Math.random() < 0.9) selectedDevices.push(...audioDevices.slice(0, Math.floor(Math.random() * audioDevices.length) + 1));
    
    return selectedDevices;
  }

  /**
   * Generate realistic hardware fingerprint
   */
  generateHardwareFingerprint() {
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
      architecture: Math.random() < 0.9 ? 'x86_64' : 'arm64',
      memory: Math.floor(Math.random() * 24) + 8, // 8-32 GB
      deviceMemory: Math.pow(2, Math.floor(Math.random() * 3) + 3), // 8, 16, or 32 GB
      platform: this.selectRealisticPlatform()
    };
  }

  /**
   * Select realistic platform based on distribution
   */
  selectRealisticPlatform() {
    const platforms = {
      'Win32': 0.75,
      'MacIntel': 0.15,
      'Linux x86_64': 0.08,
      'Linux armv7l': 0.02
    };
    
    return this.weightedRandom(platforms);
  }

  /**
   * Generate advanced font list with realistic variation
   */
  generateAdvancedFontList() {
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
    
    // Add system-specific fonts based on platform
    const platform = this.selectRealisticPlatform();
    let osKey = 'windows';
    if (platform.includes('Mac')) osKey = 'macos';
    else if (platform.includes('Linux')) osKey = 'linux';
    
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
   * Generate realistic geolocation data
   */
  generateRealisticGeolocation() {
    // Random coordinates in major cities with realistic distribution
    const cities = [
      { latitude: 40.7128, longitude: -74.0060, weight: 0.15 }, // New York
      { latitude: 34.0522, longitude: -118.2437, weight: 0.12 }, // Los Angeles
      { latitude: 51.5074, longitude: -0.1278, weight: 0.10 }, // London
      { latitude: 48.8566, longitude: 2.3522, weight: 0.08 }, // Paris
      { latitude: 35.6762, longitude: 139.6503, weight: 0.07 }, // Tokyo
      { latitude: -33.8688, longitude: 151.2093, weight: 0.05 }, // Sydney
      { latitude: 52.5200, longitude: 13.4050, weight: 0.05 }, // Berlin
      { latitude: 37.7749, longitude: -122.4194, weight: 0.08 }, // San Francisco
      { latitude: 41.8781, longitude: -87.6298, weight: 0.06 }, // Chicago
      { latitude: 55.7558, longitude: 37.6176, weight: 0.04 }, // Moscow
      { latitude: 39.9042, longitude: 116.4074, weight: 0.06 }, // Beijing
      { latitude: 28.6139, longitude: 77.2090, weight: 0.05 }, // Delhi
      { latitude: -23.5505, longitude: -46.6333, weight: 0.04 }, // São Paulo
      { latitude: 19.4326, longitude: -99.1332, weight: 0.05 } // Mexico City
    ];

    const city = this.weightedRandomFromArray(cities);
    
    return {
      latitude: city.latitude + (Math.random() - 0.5) * 0.05, // ±0.025 degrees (~2.8km)
      longitude: city.longitude + (Math.random() - 0.5) * 0.05,
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
    await context.addInitScript(() => {
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

      // Hide headless indicators
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 4
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

      // Override languages with realistic patterns
      Object.defineProperty(navigator, 'languages', {
        get: function() {
          return ['en-US', 'en'];
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
        console.log('CloudFlare challenge detected, attempting bypass...');
        
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
        console.log('reCAPTCHA detected, implementing human behavior...');
        
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
      
      console.log('Rotated to proxy:', this.proxyManager.currentProxy);
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

    const page = await contextData.context.newPage();
    
    // Apply additional page-level stealth measures
    await this.applyPageStealthMeasures(page, contextData.config, contextData.fingerprint);
    
    return page;
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

    // Emulate realistic network conditions
    if (config.level === 'advanced') {
      const client = await page.context().newCDPSession(page);
      await client.send('Network.emulateNetworkConditions', {
        offline: false,
        downloadThroughput: (1.5 + Math.random() * 2) * 1024 * 1024 / 8, // 1.5-3.5 Mbps
        uploadThroughput: (0.75 + Math.random() * 1.25) * 1024 * 1024 / 8, // 0.75-2 Mbps  
        latency: 40 + Math.random() * 60 // 40-100ms
      });
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

    // Reset human behavior simulator
    if (this.humanBehaviorSimulator) {
      this.humanBehaviorSimulator.resetStats();
      this.humanBehaviorSimulator = null;
    }

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

export default StealthBrowserManager;