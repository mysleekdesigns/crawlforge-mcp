/**
 * BrowserProcessor - JavaScript-rendered content handling using Playwright
 * Handles dynamic content, SPAs, and JavaScript-heavy websites
 * Enhanced with stealth mode capabilities for anti-detection
 */

import { chromium } from 'playwright';
import { z } from 'zod';
import StealthBrowserManager from '../StealthBrowserManager.js';
import HumanBehaviorSimulator from '../../utils/HumanBehaviorSimulator.js';
import LocalizationManager from '../LocalizationManager.js';

const BrowserProcessorSchema = z.object({
  url: z.string().url(),
  options: z.object({
    waitForSelector: z.string().optional(),
    waitForFunction: z.string().optional(),
    waitForTimeout: z.number().min(0).max(60000).default(5000),
    viewportWidth: z.number().min(320).max(1920).default(1280),
    viewportHeight: z.number().min(240).max(1080).default(720),
    userAgent: z.string().optional(),
    enableJavaScript: z.boolean().default(true),
    enableImages: z.boolean().default(false),
    blockResources: z.array(z.string()).default(['font', 'stylesheet']),
    extraHeaders: z.record(z.string()).optional(),
    cookies: z.array(z.object({
      name: z.string(),
      value: z.string(),
      domain: z.string().optional(),
      path: z.string().default('/'),
      expires: z.number().optional(),
      httpOnly: z.boolean().default(false),
      secure: z.boolean().default(false),
      sameSite: z.enum(['Strict', 'Lax', 'None']).default('Lax')
    })).optional(),
    scrollToBottom: z.boolean().default(false),
    executeScript: z.string().optional(),
    captureScreenshot: z.boolean().default(false),
    mobileEmulation: z.boolean().default(false),
    
    // Stealth mode options
    stealthMode: z.object({
      enabled: z.boolean().default(false),
      level: z.enum(['basic', 'medium', 'advanced']).default('medium'),
      randomizeFingerprint: z.boolean().default(true),
      simulateHumanBehavior: z.boolean().default(true),
      customUserAgent: z.string().optional(),
      hideWebDriver: z.boolean().default(true),
      blockWebRTC: z.boolean().default(true)
    }).optional(),
    
    // Human behavior simulation options
    humanBehavior: z.object({
      enabled: z.boolean().default(false),
      mouseMovements: z.boolean().default(true),
      typingVariation: z.boolean().default(true),
      scrollBehavior: z.boolean().default(true),
      idlePeriods: z.boolean().default(true),
      readingTime: z.boolean().default(true)
    }).optional(),
    
    // Localization options
    localization: z.object({
      enabled: z.boolean().default(false),
      countryCode: z.string().length(2).optional(),
      language: z.string().optional(),
      timezone: z.string().optional(),
      customLocation: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        accuracy: z.number().min(1).max(100).optional()
      }).optional(),
      enableTimezoneSpoof: z.boolean().default(true),
      enableGeoLocationSpoof: z.boolean().default(true)
    }).optional()
  }).optional().default({})
});

const BrowserResult = z.object({
  url: z.string(),
  html: z.string(),
  text: z.string(),
  title: z.string(),
  screenshot: z.string().optional(),
  loadTime: z.number(),
  dynamicContent: z.object({
    detectedFrameworks: z.array(z.string()),
    hasLazyLoading: z.boolean(),
    hasDynamicContent: z.boolean(),
    scriptCount: z.number(),
    ajaxRequests: z.array(z.string())
  }),
  metrics: z.object({
    domContentLoaded: z.number(),
    loadComplete: z.number(),
    firstContentfulPaint: z.number().optional(),
    largestContentfulPaint: z.number().optional()
  }),
  processedAt: z.string(),
  success: z.boolean(),
  error: z.string().optional()
});

export class BrowserProcessor {
  constructor() {
    this.browser = null;
    this.stealthManager = null;
    this.humanBehaviorSimulator = null;
    this.localizationManager = null;
    this.activeContexts = new Map();
    
    this.defaultOptions = {
      waitForTimeout: 5000,
      viewportWidth: 1280,
      viewportHeight: 720,
      enableJavaScript: true,
      enableImages: false,
      blockResources: ['font', 'stylesheet'],
      scrollToBottom: false,
      captureScreenshot: false,
      mobileEmulation: false,
      stealthMode: {
        enabled: false,
        level: 'medium',
        randomizeFingerprint: true,
        simulateHumanBehavior: true,
        hideWebDriver: true,
        blockWebRTC: true
      },
      humanBehavior: {
        enabled: false,
        mouseMovements: true,
        typingVariation: true,
        scrollBehavior: true,
        idlePeriods: true,
        readingTime: true
      },
      localization: {
        enabled: false,
        enableTimezoneSpoof: true,
        enableGeoLocationSpoof: true
      }
    };
    
    // Initialize localization manager
    this.localizationManager = new LocalizationManager();
  }

  /**
   * Process URL with browser automation
   * @param {Object} params - Processing parameters
   * @param {string} params.url - URL to process
   * @param {Object} params.options - Browser options
   * @returns {Promise<Object>} - Processing result with rendered content
   */
  async processURL(params) {
    const startTime = Date.now();
    
    try {
      const validated = BrowserProcessorSchema.parse(params);
      const { url, options } = validated;
      const processingOptions = { ...this.defaultOptions, ...options };

      const result = {
        url,
        processedAt: new Date().toISOString(),
        success: false,
        loadTime: 0
      };

      // Initialize browser and page (with stealth if enabled)
      const page = await this.initializePage(processingOptions);

      try {
        // Navigate and wait for content
        const navigationResult = await this.navigateAndWait(page, url, processingOptions);
        
        // Extract content and metadata
        const contentResult = await this.extractContent(page, processingOptions);
        
        // Analyze dynamic content
        const dynamicAnalysis = await this.analyzeDynamicContent(page);

        // Get performance metrics
        const metrics = await this.getPerformanceMetrics(page);

        // Capture screenshot if requested
        let screenshot = null;
        if (processingOptions.captureScreenshot) {
          screenshot = await this.captureScreenshot(page);
        }

        // Combine results
        Object.assign(result, {
          ...contentResult,
          screenshot,
          dynamicContent: dynamicAnalysis,
          metrics,
          loadTime: Date.now() - startTime,
          success: true
        });

      } finally {
        // Always close the page
        await page.close();
      }

      return result;

    } catch (error) {
      return {
        url: params.url || 'unknown',
        processedAt: new Date().toISOString(),
        success: false,
        error: `Browser processing failed: ${error.message}`,
        loadTime: Date.now() - startTime,
        html: '',
        text: '',
        title: '',
        dynamicContent: {
          detectedFrameworks: [],
          hasLazyLoading: false,
          hasDynamicContent: false,
          scriptCount: 0,
          ajaxRequests: []
        },
        metrics: {
          domContentLoaded: 0,
          loadComplete: Date.now() - startTime
        }
      };
    }
  }

  /**
   * Initialize browser instance
   * @returns {Promise<void>}
   */
  async initBrowser() {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding'
        ]
      });
    }
  }

  /**
   * Initialize page with stealth capabilities if enabled
   * @param {Object} options - Processing options
   * @returns {Promise<Page>} - Playwright page
   */
  async initializePage(options) {
    // Apply localization if enabled
    let processedOptions = options;
    if (options.localization?.enabled) {
      processedOptions = await this.applyLocalization(options);
    }
    
    // Check if stealth mode is enabled
    if (processedOptions.stealthMode && processedOptions.stealthMode.enabled) {
      return await this.createStealthPage(processedOptions);
    } else {
      // Standard browser initialization
      await this.initBrowser();
      return await this.createPage(processedOptions);
    }
  }

  /**
   * Create stealth page with anti-detection measures
   * @param {Object} options - Processing options
   * @returns {Promise<Page>} - Stealth-enabled page
   */
  async createStealthPage(options) {
    // Initialize stealth manager if needed
    if (!this.stealthManager) {
      this.stealthManager = new StealthBrowserManager();
    }

    // Initialize human behavior simulator if needed
    if (!this.humanBehaviorSimulator && options.humanBehavior?.enabled) {
      this.humanBehaviorSimulator = new HumanBehaviorSimulator({
        mouseMovements: {
          enabled: options.humanBehavior.mouseMovements,
          speed: 'normal',
          accuracy: 0.8,
          naturalCurves: true
        },
        typing: {
          enabled: options.humanBehavior.typingVariation,
          speed: 'normal',
          variability: 0.3,
          mistakes: {
            enabled: true,
            frequency: 0.02
          }
        },
        scrolling: {
          enabled: options.humanBehavior.scrollBehavior,
          naturalAcceleration: true,
          randomPauses: true
        },
        interactions: {
          hoverBeforeClick: true,
          focusBlurSimulation: true,
          idlePeriods: {
            enabled: options.humanBehavior.idlePeriods,
            frequency: 0.1
          }
        }
      });
    }

    // Launch stealth browser
    await this.stealthManager.launchStealthBrowser({
      level: options.stealthMode.level,
      randomizeFingerprint: options.stealthMode.randomizeFingerprint,
      hideWebDriver: options.stealthMode.hideWebDriver,
      blockWebRTC: options.stealthMode.blockWebRTC,
      customUserAgent: options.stealthMode.customUserAgent || options.userAgent
    });

    // Create stealth context
    const { context, contextId } = await this.stealthManager.createStealthContext({
      level: options.stealthMode.level,
      customViewport: {
        width: options.viewportWidth,
        height: options.viewportHeight
      }
    });

    // Create stealth page
    const page = await this.stealthManager.createStealthPage(contextId);
    
    // Store context for cleanup
    this.activeContexts.set(contextId, { context, page });

    // Apply additional stealth configurations
    await this.applyStealthMiddleware(page, options);

    return page;
  }

  /**
   * Apply additional stealth middleware to page
   * @param {Page} page - Playwright page
   * @param {Object} options - Processing options
   * @returns {Promise<void>}
   */
  async applyStealthMiddleware(page, options) {
    // Set cookies if provided
    if (options.cookies && options.cookies.length > 0) {
      await page.context().addCookies(options.cookies);
    }

    // Block unnecessary resources with stealth considerations
    if (options.blockResources && options.blockResources.length > 0) {
      await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        const url = route.request().url();
        
        // Don't block detection-related resources
        if (url.includes('webdriver') || url.includes('selenium') || url.includes('puppeteer')) {
          route.abort();
          return;
        }

        if (options.blockResources.includes(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });
    }

    // Disable images if requested (with stealth considerations)
    if (!options.enableImages) {
      await page.route('**/*.{jpg,jpeg,png,gif,webp,svg}', (route) => {
        // Allow favicon and small images that might be used for tracking
        const url = route.request().url();
        if (url.includes('favicon') || url.includes('tracking') || url.includes('analytics')) {
          route.continue();
        } else {
          route.abort();
        }
      });
    }

    // Add extra stealth protections
    await page.addInitScript(() => {
      // Additional webdriver detection removal
      delete window.navigator.__proto__.webdriver;
      
      // Override chrome runtime
      window.chrome = {
        runtime: {
          onConnect: undefined,
          onMessage: undefined
        }
      };

      // Mock notification permission
      Object.defineProperty(Notification, 'permission', {
        get: () => 'granted'
      });

      // Hide headless indicators
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 4
      });
    });
  }

  /**
   * Apply localization settings to browser options
   * @param {Object} options - Original options
   * @returns {Object} - Localized options
   */
  async applyLocalization(options) {
    const { localization } = options;
    
    try {
      // Get localization configuration
      const localizationConfig = await this.localizationManager.localizeBrowserContext(
        options,
        localization.countryCode
      );
      
      // Merge localized settings
      const localizedOptions = {
        ...options,
        ...localizationConfig,
        
        // Override specific browser settings
        locale: localizationConfig.locale,
        timezoneId: localizationConfig.timezoneId,
        geolocation: localization.customLocation || localizationConfig.geolocation,
        extraHeaders: {
          ...options.extraHeaders,
          ...localizationConfig.extraHTTPHeaders
        },
        userAgent: localizationConfig.userAgent || options.userAgent
      };
      
      // Add timezone spoofing script if enabled
      if (localization.enableTimezoneSpoof) {
        const timezoneScript = await this.localizationManager.generateTimezoneSpoof(
          localization.countryCode
        );
        localizedOptions.timezoneSpoof = timezoneScript;
      }
      
      return localizedOptions;
      
    } catch (error) {
      console.warn('Failed to apply localization, using default options:', error.message);
      return options;
    }
  }

  /**
   * Create new page with specified options
   * @param {Object} options - Page options
   * @returns {Promise<Page>} - Playwright page
   */
  async createPage(options) {
    const contextOptions = {
      viewport: {
        width: options.viewportWidth,
        height: options.viewportHeight
      },
      userAgent: options.userAgent,
      extraHTTPHeaders: options.extraHeaders,
      deviceScaleFactor: options.mobileEmulation ? 2 : 1,
      isMobile: options.mobileEmulation,
      hasTouch: options.mobileEmulation
    };
    
    // Add localization-specific context options
    if (options.locale) {
      contextOptions.locale = options.locale;
    }
    if (options.timezoneId) {
      contextOptions.timezoneId = options.timezoneId;
    }
    if (options.geolocation) {
      contextOptions.geolocation = options.geolocation;
    }
    if (options.proxy) {
      contextOptions.proxy = options.proxy;
    }

    const context = await this.browser.newContext(contextOptions);
    const page = await context.newPage();
    
    // Inject timezone spoofing script if provided
    if (options.timezoneSpoof) {
      await page.addInitScript(options.timezoneSpoof);
    }

    // Set cookies if provided
    if (options.cookies && options.cookies.length > 0) {
      await context.addCookies(options.cookies);
    }

    // Block unnecessary resources
    if (options.blockResources && options.blockResources.length > 0) {
      await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        if (options.blockResources.includes(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });
    }

    // Disable images if requested
    if (!options.enableImages) {
      await page.route('**/*.{jpg,jpeg,png,gif,webp,svg}', (route) => {
        route.abort();
      });
    }

    // Disable JavaScript if requested
    if (!options.enableJavaScript) {
      await context.setExtraHTTPHeaders({
        'Content-Security-Policy': 'script-src \'none\''
      });
    }

    return page;
  }

  /**
   * Navigate to URL and wait for content to load
   * @param {Page} page - Playwright page
   * @param {string} url - URL to navigate to
   * @param {Object} options - Navigation options
   * @returns {Promise<Object>} - Navigation result
   */
  async navigateAndWait(page, url, options) {
    const startTime = Date.now();

    // Navigate to URL
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Wait for specific selector if provided
    if (options.waitForSelector) {
      try {
        await page.waitForSelector(options.waitForSelector, {
          timeout: options.waitForTimeout
        });
      } catch (error) {
        console.warn(`Selector "${options.waitForSelector}" not found within timeout`);
      }
    }

    // Wait for custom function if provided
    if (options.waitForFunction) {
      try {
        await page.waitForFunction(options.waitForFunction, {
          timeout: options.waitForTimeout
        });
      } catch (error) {
        console.warn(`Wait function failed: ${error.message}`);
      }
    }

    // General timeout wait
    await page.waitForTimeout(Math.min(options.waitForTimeout, 10000));

    // Scroll to bottom if requested (for lazy loading)
    if (options.scrollToBottom) {
      await this.scrollToBottom(page, options);
    }

    // Execute custom script if provided
    if (options.executeScript) {
      try {
        await page.evaluate(options.executeScript);
      } catch (error) {
        console.warn(`Custom script execution failed: ${error.message}`);
      }
    }

    return {
      navigationTime: Date.now() - startTime
    };
  }

  /**
   * Extract content from page
   * @param {Page} page - Playwright page
   * @param {Object} options - Extraction options
   * @returns {Promise<Object>} - Extracted content
   */
  async extractContent(page, options) {
    // Get HTML content
    const html = await page.content();

    // Get text content
    const text = await page.evaluate(() => {
      // Remove script and style elements
      const scripts = document.querySelectorAll('script, style, noscript');
      scripts.forEach(el => el.remove());
      
      return document.body ? document.body.innerText : '';
    });

    // Get page title
    const title = await page.title();

    return {
      html,
      text: text.trim(),
      title
    };
  }

  /**
   * Analyze dynamic content characteristics
   * @param {Page} page - Playwright page
   * @returns {Promise<Object>} - Dynamic content analysis
   */
  async analyzeDynamicContent(page) {
    return await page.evaluate(() => {
      const analysis = {
        detectedFrameworks: [],
        hasLazyLoading: false,
        hasDynamicContent: false,
        scriptCount: 0,
        ajaxRequests: []
      };

      // Count scripts
      analysis.scriptCount = document.querySelectorAll('script').length;

      // Detect frameworks
      if (window.React || document.querySelector('[data-reactroot]')) {
        analysis.detectedFrameworks.push('React');
      }
      if (window.Vue || document.querySelector('[data-v-]')) {
        analysis.detectedFrameworks.push('Vue.js');
      }
      if (window.angular || document.querySelector('[ng-app], [data-ng-app]')) {
        analysis.detectedFrameworks.push('Angular');
      }
      if (window.jQuery || window.$) {
        analysis.detectedFrameworks.push('jQuery');
      }

      // Check for lazy loading
      const lazyImages = document.querySelectorAll('[loading="lazy"], [data-src], .lazy');
      analysis.hasLazyLoading = lazyImages.length > 0;

      // Check for dynamic content indicators
      const dynamicIndicators = document.querySelectorAll(
        '[data-bind], [v-if], [v-for], [ng-if], [ng-repeat], [*ngFor], [*ngIf]'
      );
      analysis.hasDynamicContent = dynamicIndicators.length > 0 || analysis.detectedFrameworks.length > 0;

      return analysis;
    });
  }

  /**
   * Get performance metrics
   * @param {Page} page - Playwright page
   * @returns {Promise<Object>} - Performance metrics
   */
  async getPerformanceMetrics(page) {
    return await page.evaluate(() => {
      const metrics = {
        domContentLoaded: 0,
        loadComplete: 0
      };

      if (window.performance && window.performance.timing) {
        const timing = window.performance.timing;
        metrics.domContentLoaded = timing.domContentLoadedEventEnd - timing.navigationStart;
        metrics.loadComplete = timing.loadEventEnd - timing.navigationStart;
      }

      // Try to get Paint Timing metrics
      if (window.performance && window.performance.getEntriesByType) {
        const paintEntries = window.performance.getEntriesByType('paint');
        paintEntries.forEach(entry => {
          if (entry.name === 'first-contentful-paint') {
            metrics.firstContentfulPaint = entry.startTime;
          }
        });

        const navigationEntries = window.performance.getEntriesByType('largest-contentful-paint');
        if (navigationEntries.length > 0) {
          metrics.largestContentfulPaint = navigationEntries[navigationEntries.length - 1].startTime;
        }
      }

      return metrics;
    });
  }

  /**
   * Capture screenshot
   * @param {Page} page - Playwright page
   * @returns {Promise<string>} - Base64 encoded screenshot
   */
  async captureScreenshot(page) {
    try {
      const screenshot = await page.screenshot({
        type: 'png',
        fullPage: false,
        encoding: 'base64'
      });
      return screenshot;
    } catch (error) {
      console.warn(`Screenshot capture failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Scroll to bottom of page to trigger lazy loading
   * @param {Page} page - Playwright page
   * @returns {Promise<void>}
   */
  async scrollToBottom(page, options = {}) {
    // Use human behavior simulation if available
    if (this.humanBehaviorSimulator && options.humanBehavior?.enabled) {
      const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
      const viewportHeight = await page.evaluate(() => window.innerHeight);
      const totalDistance = scrollHeight - viewportHeight;
      
      if (totalDistance > 0) {
        await this.humanBehaviorSimulator.simulateScroll(page, {
          direction: 'down',
          distance: totalDistance,
          duration: 2000 + Math.random() * 3000 // 2-5 seconds
        });
      }
    } else {
      // Standard scroll behavior
      await page.evaluate(async () => {
        await new Promise(resolve => {
          let totalHeight = 0;
          const distance = 100;
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;

            if (totalHeight >= scrollHeight) {
              clearInterval(timer);
              resolve();
            }
          }, 100);
        });
      });
    }

    // Wait a bit for any lazy content to load
    await page.waitForTimeout(2000);
  }

  /**
   * Process multiple URLs concurrently
   * @param {Array} urls - Array of URLs to process
   * @param {Object} options - Processing options
   * @returns {Promise<Array>} - Array of processing results
   */
  async processMultipleURLs(urls, options = {}) {
    const concurrency = options.concurrency || 3;
    const results = [];

    // Initialize browser once for all requests
    await this.initBrowser();

    try {
      // Process in batches
      for (let i = 0; i < urls.length; i += concurrency) {
        const batch = urls.slice(i, i + concurrency);
        const batchPromises = batch.map(url => {
          const params = typeof url === 'string' 
            ? { url, options }
            : { ...url, options: { ...options, ...url.options } };
          
          return this.processURL(params).catch(error => ({
            url: params.url,
            success: false,
            error: error.message,
            processedAt: new Date().toISOString(),
            loadTime: 0,
            html: '',
            text: '',
            title: '',
            dynamicContent: {
              detectedFrameworks: [],
              hasLazyLoading: false,
              hasDynamicContent: false,
              scriptCount: 0,
              ajaxRequests: []
            },
            metrics: {
              domContentLoaded: 0,
              loadComplete: 0
            }
          }));
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
      }
    } finally {
      // Clean up browser
      await this.cleanup();
    }

    return results;
  }

  /**
   * Clean up browser resources
   * @returns {Promise<void>}
   */
  async cleanup() {
    // Clean up stealth contexts first
    for (const [contextId, contextData] of this.activeContexts.entries()) {
      try {
        await contextData.page.close();
        await contextData.context.close();
      } catch (error) {
        console.warn(`Failed to close stealth context ${contextId}:`, error.message);
      }
    }
    this.activeContexts.clear();

    // Clean up stealth manager
    if (this.stealthManager) {
      await this.stealthManager.cleanup();
      this.stealthManager = null;
    }

    // Clean up regular browser
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    // Reset human behavior simulator
    if (this.humanBehaviorSimulator) {
      this.humanBehaviorSimulator.resetStats();
      this.humanBehaviorSimulator = null;
    }
  }

  /**
   * Check if URL likely requires JavaScript rendering
   * @param {string} url - URL to check
   * @param {string} html - Optional HTML content for analysis
   * @returns {Promise<Object>} - Analysis result
   */
  async requiresJavaScript(url, html = null) {
    const analysis = {
      likely: false,
      confidence: 0,
      indicators: []
    };

    // URL-based indicators
    const urlIndicators = [
      { pattern: /\.(js|jsx|ts|tsx)$/, weight: 0.9, name: 'JavaScript file extension' },
      { pattern: /#/, weight: 0.3, name: 'Hash-based routing' },
      { pattern: /\/(app|spa|dashboard|admin)/, weight: 0.4, name: 'SPA-like path' }
    ];

    urlIndicators.forEach(indicator => {
      if (indicator.pattern.test(url)) {
        analysis.confidence += indicator.weight;
        analysis.indicators.push(indicator.name);
      }
    });

    // HTML-based indicators (if provided)
    if (html) {
      const htmlIndicators = [
        { pattern: /data-reactroot|ReactDOM\.render/i, weight: 0.8, name: 'React framework' },
        { pattern: /ng-app|angular\.module/i, weight: 0.8, name: 'Angular framework' },
        { pattern: /v-if|v-for|new Vue/i, weight: 0.8, name: 'Vue.js framework' },
        { pattern: /<script[^>]*src.*\.js/gi, weight: 0.1, name: 'External JavaScript' },
        { pattern: /data-bind|knockout/i, weight: 0.6, name: 'Knockout.js' },
        { pattern: /ember-application|Ember\.Application/i, weight: 0.7, name: 'Ember.js' }
      ];

      htmlIndicators.forEach(indicator => {
        const matches = html.match(indicator.pattern);
        if (matches) {
          const weight = indicator.weight * Math.min(matches.length, 3);
          analysis.confidence += weight;
          analysis.indicators.push(`${indicator.name} (${matches.length} matches)`);
        }
      });
    }

    analysis.likely = analysis.confidence > 0.5;
    analysis.confidence = Math.min(1, analysis.confidence);

    return analysis;
  }

  /**
   * Get stealth mode statistics
   * @returns {Object} Stealth statistics
   */
  getStealthStats() {
    const stats = {
      stealthManagerActive: !!this.stealthManager,
      humanBehaviorActive: !!this.humanBehaviorSimulator,
      activeContexts: this.activeContexts.size,
      stealthStats: null,
      behaviorStats: null
    };

    if (this.stealthManager) {
      stats.stealthStats = this.stealthManager.getStats();
    }

    if (this.humanBehaviorSimulator) {
      stats.behaviorStats = this.humanBehaviorSimulator.getStats();
    }

    return stats;
  }

  /**
   * Update stealth configuration
   * @param {Object} stealthConfig - New stealth configuration
   * @returns {void}
   */
  updateStealthConfig(stealthConfig) {
    // Update default options
    this.defaultOptions.stealthMode = {
      ...this.defaultOptions.stealthMode,
      ...stealthConfig
    };

    // If human behavior simulator exists, update its config
    if (this.humanBehaviorSimulator && stealthConfig.humanBehavior) {
      this.humanBehaviorSimulator.updateConfig(stealthConfig.humanBehavior);
    }
  }

  /**
   * Enable stealth mode with specified level
   * @param {string} level - Stealth level ('basic', 'medium', 'advanced')
   * @returns {void}
   */
  enableStealthMode(level = 'medium') {
    this.defaultOptions.stealthMode.enabled = true;
    this.defaultOptions.stealthMode.level = level;
    this.defaultOptions.humanBehavior.enabled = true;
  }

  /**
   * Disable stealth mode
   * @returns {void}
   */
  disableStealthMode() {
    this.defaultOptions.stealthMode.enabled = false;
    this.defaultOptions.humanBehavior.enabled = false;
  }
}

export default BrowserProcessor;