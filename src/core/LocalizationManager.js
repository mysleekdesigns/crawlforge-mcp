/**
 * LocalizationManager - Location/Language Settings Management
 * Handles country-specific settings, browser locale emulation,
 * timezone spoofing, and geo-blocked content handling
 */

import { z } from 'zod';
import { EventEmitter } from 'events';

// ISO 3166-1 alpha-2 country codes with associated settings
const SUPPORTED_COUNTRIES = {
  'US': { timezone: 'America/New_York', currency: 'USD', language: 'en-US', searchDomain: 'google.com' },
  'GB': { timezone: 'Europe/London', currency: 'GBP', language: 'en-GB', searchDomain: 'google.co.uk' },
  'DE': { timezone: 'Europe/Berlin', currency: 'EUR', language: 'de-DE', searchDomain: 'google.de' },
  'FR': { timezone: 'Europe/Paris', currency: 'EUR', language: 'fr-FR', searchDomain: 'google.fr' },
  'JP': { timezone: 'Asia/Tokyo', currency: 'JPY', language: 'ja-JP', searchDomain: 'google.co.jp' },
  'CN': { timezone: 'Asia/Shanghai', currency: 'CNY', language: 'zh-CN', searchDomain: 'baidu.com' },
  'AU': { timezone: 'Australia/Sydney', currency: 'AUD', language: 'en-AU', searchDomain: 'google.com.au' },
  'CA': { timezone: 'America/Toronto', currency: 'CAD', language: 'en-CA', searchDomain: 'google.ca' },
  'IT': { timezone: 'Europe/Rome', currency: 'EUR', language: 'it-IT', searchDomain: 'google.it' },
  'ES': { timezone: 'Europe/Madrid', currency: 'EUR', language: 'es-ES', searchDomain: 'google.es' },
  'RU': { timezone: 'Europe/Moscow', currency: 'RUB', language: 'ru-RU', searchDomain: 'yandex.ru' },
  'BR': { timezone: 'America/Sao_Paulo', currency: 'BRL', language: 'pt-BR', searchDomain: 'google.com.br' },
  'IN': { timezone: 'Asia/Kolkata', currency: 'INR', language: 'hi-IN', searchDomain: 'google.co.in' },
  'KR': { timezone: 'Asia/Seoul', currency: 'KRW', language: 'ko-KR', searchDomain: 'google.co.kr' },
  'MX': { timezone: 'America/Mexico_City', currency: 'MXN', language: 'es-MX', searchDomain: 'google.com.mx' }
};

// Common language mappings for Accept-Language headers
const LANGUAGE_MAPPINGS = {
  'en': 'en-US,en;q=0.9',
  'es': 'es-ES,es;q=0.9,en;q=0.8',
  'fr': 'fr-FR,fr;q=0.9,en;q=0.8',
  'de': 'de-DE,de;q=0.9,en;q=0.8',
  'it': 'it-IT,it;q=0.9,en;q=0.8',
  'pt': 'pt-BR,pt;q=0.9,en;q=0.8',
  'ru': 'ru-RU,ru;q=0.9,en;q=0.8',
  'ja': 'ja-JP,ja;q=0.9,en;q=0.8',
  'ko': 'ko-KR,ko;q=0.9,en;q=0.8',
  'zh': 'zh-CN,zh;q=0.9,en;q=0.8',
  'hi': 'hi-IN,hi;q=0.9,en;q=0.8'
};

const LocalizationSchema = z.object({
  countryCode: z.string().length(2).optional(),
  language: z.string().optional(),
  timezone: z.string().optional(),
  currency: z.string().length(3).optional(),
  customHeaders: z.record(z.string()).optional(),
  userAgent: z.string().optional(),
  acceptLanguage: z.string().optional(),
  geoLocation: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().min(1).max(100).optional()
  }).optional(),
  proxySettings: z.object({
    enabled: z.boolean().default(false),
    server: z.string().optional(),
    port: z.number().optional(),
    username: z.string().optional(),
    password: z.string().optional()
  }).optional(),
  dnsSettings: z.object({
    enabled: z.boolean().default(false),
    servers: z.array(z.string()).optional(),
    preferredCountry: z.string().length(2).optional()
  }).optional()
});

const BrowserLocaleSchema = z.object({
  languages: z.array(z.string()),
  timezone: z.string(),
  locale: z.string(),
  currency: z.string(),
  dateFormat: z.string(),
  numberFormat: z.string(),
  firstDayOfWeek: z.number().min(0).max(6)
});

export class LocalizationManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.defaultSettings = {
      countryCode: 'US',
      language: 'en-US',
      timezone: 'America/New_York',
      currency: 'USD',
      customHeaders: {},
      geoBlockingBypass: true,
      dynamicFingerprinting: true
    };
    
    this.currentSettings = { ...this.defaultSettings, ...options };
    this.localeCache = new Map();
    this.geoLocationCache = new Map();
    this.timezoneCache = new Map();
    
    // Statistics tracking
    this.stats = {
      localizationApplied: 0,
      geoBlocksBypass: 0,
      timezoneChanges: 0,
      languageDetections: 0,
      proxyUsage: 0,
      dnsOverrides: 0,
      lastUpdated: Date.now()
    };
    
    this.initialize();
  }
  
  async initialize() {
    // Pre-populate timezone mappings
    await this.loadTimezoneData();
    
    // Initialize geo-location data
    await this.loadGeoLocationData();
    
    this.emit('initialized');
  }
  
  /**
   * Configure localization settings for a specific country
   * @param {string} countryCode - ISO 3166-1 alpha-2 country code
   * @param {Object} options - Additional localization options
   * @returns {Object} - Complete localization configuration
   */
  async configureCountry(countryCode, options = {}) {
    const validatedInput = LocalizationSchema.parse({
      countryCode: countryCode.toUpperCase(),
      ...options
    });
    
    if (!SUPPORTED_COUNTRIES[validatedInput.countryCode]) {
      throw new Error(`Unsupported country code: ${validatedInput.countryCode}`);
    }
    
    const countryData = SUPPORTED_COUNTRIES[validatedInput.countryCode];
    
    // Merge country defaults with custom options
    const localizationConfig = {
      countryCode: validatedInput.countryCode,
      language: validatedInput.language || countryData.language,
      timezone: validatedInput.timezone || countryData.timezone,
      currency: validatedInput.currency || countryData.currency,
      searchDomain: countryData.searchDomain,
      acceptLanguage: this.buildAcceptLanguageHeader(validatedInput.language || countryData.language),
      customHeaders: validatedInput.customHeaders || {},
      geoLocation: validatedInput.geoLocation,
      proxySettings: validatedInput.proxySettings,
      dnsSettings: validatedInput.dnsSettings
    };
    
    // Generate browser locale configuration
    const browserLocale = await this.generateBrowserLocale(localizationConfig);
    
    // Cache the configuration
    const cacheKey = `${countryCode}-${JSON.stringify(options)}`;
    this.localeCache.set(cacheKey, {
      ...localizationConfig,
      browserLocale,
      createdAt: Date.now()
    });
    
    this.currentSettings = localizationConfig;
    this.stats.localizationApplied++;
    
    this.emit('countryConfigured', countryCode, localizationConfig);
    
    return {
      ...localizationConfig,
      browserLocale
    };
  }
  
  /**
   * Generate browser locale emulation settings
   * @param {Object} localizationConfig - Localization configuration
   * @returns {Object} - Browser locale settings
   */
  async generateBrowserLocale(localizationConfig) {
    const { language, timezone, currency, countryCode } = localizationConfig;
    
    // Extract language code from full locale
    const langCode = language.split('-')[0];
    
    // Generate comprehensive browser locale
    const browserLocale = {
      languages: [language, langCode, 'en'],
      timezone: timezone,
      locale: language,
      currency: currency,
      dateFormat: this.getDateFormat(countryCode),
      numberFormat: this.getNumberFormat(countryCode),
      firstDayOfWeek: this.getFirstDayOfWeek(countryCode),
      
      // Additional browser properties
      screen: this.generateScreenProperties(countryCode),
      navigator: await this.generateNavigatorProperties(localizationConfig),
      intl: this.generateIntlProperties(language, countryCode)
    };
    
    return BrowserLocaleSchema.parse(browserLocale);
  }
  
  /**
   * Apply localization to search query parameters
   * @param {Object} searchParams - Original search parameters
   * @param {string} countryCode - Target country code
   * @returns {Object} - Localized search parameters
   */
  async localizeSearchQuery(searchParams, countryCode = null) {
    const targetCountry = countryCode || this.currentSettings.countryCode;
    const config = await this.getLocalizationConfig(targetCountry);
    
    const localizedParams = {
      ...searchParams,
      
      // Apply language localization
      lang: config.language.split('-')[0],
      cr: `country${targetCountry}`, // Country restrict
      lr: `lang_${config.language.split('-')[0]}`, // Language restrict
      
      // Apply regional search domain
      searchDomain: config.searchDomain,
      
      // Add geo-location hints
      uule: this.encodeLocationString(targetCountry),
      
      // Custom headers for the request
      headers: {
        'Accept-Language': config.acceptLanguage,
        'X-Forwarded-For': await this.getProxyIP(targetCountry),
        ...config.customHeaders,
        ...searchParams.headers
      }
    };
    
    this.emit('searchQueryLocalized', targetCountry, localizedParams);
    
    return localizedParams;
  }
  
  /**
   * Apply localization to browser context
   * @param {Object} browserOptions - Browser configuration options
   * @param {string} countryCode - Target country code
   * @returns {Object} - Localized browser options
   */
  async localizeBrowserContext(browserOptions, countryCode = null) {
    const targetCountry = countryCode || this.currentSettings.countryCode;
    const config = await this.getLocalizationConfig(targetCountry);
    
    const localizedOptions = {
      ...browserOptions,
      
      // Set locale and timezone
      locale: config.language,
      timezoneId: config.timezone,
      
      // Configure geolocation
      geolocation: config.geoLocation || await this.getDefaultGeoLocation(targetCountry),
      
      // Set HTTP headers
      extraHTTPHeaders: {
        'Accept-Language': config.acceptLanguage,
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'DNT': '1',
        ...config.customHeaders,
        ...browserOptions.extraHTTPHeaders
      },
      
      // Configure user agent
      userAgent: config.userAgent || this.generateUserAgent(targetCountry),
      
      // Proxy configuration
      proxy: config.proxySettings?.enabled ? {
        server: `${config.proxySettings.server}:${config.proxySettings.port}`,
        username: config.proxySettings.username,
        password: config.proxySettings.password
      } : undefined
    };
    
    // Apply browser fingerprinting adjustments
    if (this.currentSettings.dynamicFingerprinting) {
      localizedOptions.fingerprint = await this.generateFingerprint(targetCountry);
    }
    
    this.stats.localizationApplied++;
    this.emit('browserContextLocalized', targetCountry, localizedOptions);
    
    return localizedOptions;
  }
  
  /**
   * Generate JavaScript code to inject timezone and locale overrides
   * @param {string} countryCode - Target country code
   * @returns {string} - JavaScript injection code
   */
  async generateTimezoneSpoof(countryCode = null) {
    const targetCountry = countryCode || this.currentSettings.countryCode;
    const config = await this.getLocalizationConfig(targetCountry);
    
    const timezoneOffset = this.getTimezoneOffset(config.timezone);
    
    const injectionScript = `
      // Override timezone and locale detection
      (function() {
        const originalDate = Date;
        const targetTimezone = '${config.timezone}';
        const timezoneOffset = ${timezoneOffset};
        const targetLocale = '${config.language}';
        
        // Override Date object
        Date = function(...args) {
          if (args.length === 0) {
            const now = new originalDate();
            now.setTime(now.getTime() + (now.getTimezoneOffset() + timezoneOffset) * 60000);
            return now;
          }
          return new originalDate(...args);
        };
        
        // Copy static methods
        Object.setPrototypeOf(Date, originalDate);
        Object.getOwnPropertyNames(originalDate).forEach(name => {
          if (name !== 'prototype' && name !== 'name' && name !== 'length') {
            Date[name] = originalDate[name];
          }
        });
        
        Date.prototype = originalDate.prototype;
        
        // Override timezone methods
        Date.prototype.getTimezoneOffset = function() {
          return -timezoneOffset;
        };
        
        // Override Intl.DateTimeFormat
        const originalIntlDateTimeFormat = Intl.DateTimeFormat;
        Intl.DateTimeFormat = function(locales, options) {
          return new originalIntlDateTimeFormat(targetLocale, {
            ...options,
            timeZone: targetTimezone
          });
        };
        
        // Override navigator.language
        Object.defineProperty(navigator, 'language', {
          get: () => targetLocale
        });
        
        Object.defineProperty(navigator, 'languages', {
          get: () => ['${config.language}', '${config.language.split('-')[0]}', 'en']
        });
        
        // Override screen properties for regional differences
        ${this.generateScreenOverrides(targetCountry)}
        
        console.debug('Timezone spoofing applied:', {
          timezone: targetTimezone,
          locale: targetLocale,
          offset: timezoneOffset
        });
      })();
    `;
    
    this.stats.timezoneChanges++;
    return injectionScript;
  }
  
  /**
   * Detect and handle geo-blocked content
   * @param {string} url - URL to check
   * @param {Object} response - HTTP response object
   * @returns {Object} - Analysis and bypass suggestions
   */
  async handleGeoBlocking(url, response) {
    const geoBlockingIndicators = [
      /not available in your country/i,
      /access denied/i,
      /geo.?block/i,
      /region.?restrict/i,
      /unavailable in your location/i,
      /vpn.?detect/i
    ];
    
    const isGeoBlocked = response.status === 403 || 
                       response.status === 451 || 
                       geoBlockingIndicators.some(pattern => 
                         pattern.test(response.body || response.statusText || '')
                       );
    
    if (!isGeoBlocked) {
      return { blocked: false, url, status: response.status };
    }
    
    // Suggest bypass strategies
    const bypassStrategies = [
      {
        type: 'country_change',
        description: 'Try accessing from a different country',
        suggestedCountries: this.getSuggestedCountries(url)
      },
      {
        type: 'user_agent_change',
        description: 'Use a different browser user agent',
        suggestedUserAgents: await this.getSuggestedUserAgents(url)
      },
      {
        type: 'proxy_recommendation',
        description: 'Use proxy servers from allowed regions',
        proxyRegions: this.getProxyRegions(url)
      }
    ];
    
    this.stats.geoBlocksBypass++;
    this.emit('geoBlockingDetected', {
      url,
      status: response.status,
      strategies: bypassStrategies
    });
    
    return {
      blocked: true,
      url,
      status: response.status,
      bypassStrategies,
      autoBypass: this.currentSettings.geoBlockingBypass
    };
  }
  
  /**
   * Auto-detect appropriate localization from content
   * @param {string} content - Web page content
   * @param {string} url - Source URL
   * @returns {Object} - Detected localization settings
   */
  async autoDetectLocalization(content, url) {
    const detection = {
      detectedLanguage: null,
      detectedCountry: null,
      confidence: 0,
      evidence: [],
      recommendations: []
    };
    
    // Language detection from HTML lang attribute
    const langMatch = content.match(/<html[^>]+lang=["']([^"']+)["']/i);
    if (langMatch) {
      detection.detectedLanguage = langMatch[1];
      detection.evidence.push(`HTML lang attribute: ${langMatch[1]}`);
      detection.confidence += 0.3;
    }
    
    // Country detection from TLD
    const urlObj = new URL(url);
    const tldMatch = urlObj.hostname.match(/\.([a-z]{2})$/);
    if (tldMatch) {
      const tld = tldMatch[1].toUpperCase();
      if (SUPPORTED_COUNTRIES[tld]) {
        detection.detectedCountry = tld;
        detection.evidence.push(`TLD suggests country: ${tld}`);
        detection.confidence += 0.2;
      }
    }
    
    // Currency detection
    const currencyPatterns = {
      '$': ['US', 'CA', 'AU'],
      '€': ['DE', 'FR', 'IT', 'ES'],
      '£': ['GB'],
      '¥': ['JP'],
      '₹': ['IN'],
      '₽': ['RU']
    };
    
    for (const [symbol, countries] of Object.entries(currencyPatterns)) {
      if (content.includes(symbol)) {
        detection.evidence.push(`Currency symbol found: ${symbol}`);
        detection.confidence += 0.1;
        
        if (!detection.detectedCountry && countries.length === 1) {
          detection.detectedCountry = countries[0];
        }
      }
    }
    
    // Generate recommendations
    if (detection.detectedCountry) {
      detection.recommendations.push({
        type: 'country_localization',
        countryCode: detection.detectedCountry,
        reason: 'Detected from page content and URL'
      });
    }
    
    if (detection.detectedLanguage) {
      detection.recommendations.push({
        type: 'language_localization',
        language: detection.detectedLanguage,
        reason: 'Detected from HTML lang attribute'
      });
    }
    
    this.stats.languageDetections++;
    this.emit('localizationDetected', detection);
    
    return detection;
  }
  
  // Helper methods
  
  async getLocalizationConfig(countryCode) {
    const cacheKey = `config-${countryCode}`;
    if (this.localeCache.has(cacheKey)) {
      return this.localeCache.get(cacheKey);
    }
    
    return await this.configureCountry(countryCode);
  }
  
  buildAcceptLanguageHeader(language) {
    const langCode = language.split('-')[0];
    return LANGUAGE_MAPPINGS[langCode] || `${language},${langCode};q=0.9,en;q=0.8`;
  }
  
  async loadTimezoneData() {
    // Pre-populate common timezone offsets
    const timezones = {
      'America/New_York': -300, // EST offset in minutes
      'Europe/London': 0,
      'Europe/Berlin': 60,
      'Asia/Tokyo': 540,
      'Australia/Sydney': 600,
      // Add more as needed
    };
    
    for (const [tz, offset] of Object.entries(timezones)) {
      this.timezoneCache.set(tz, offset);
    }
  }
  
  async loadGeoLocationData() {
    // Pre-populate major city coordinates
    const geoData = {
      'US': { latitude: 40.7128, longitude: -74.0060 }, // New York
      'GB': { latitude: 51.5074, longitude: -0.1278 },  // London
      'DE': { latitude: 52.5200, longitude: 13.4050 },  // Berlin
      'FR': { latitude: 48.8566, longitude: 2.3522 },   // Paris
      'JP': { latitude: 35.6762, longitude: 139.6503 }, // Tokyo
      'AU': { latitude: -33.8688, longitude: 151.2093 } // Sydney
    };
    
    for (const [country, coords] of Object.entries(geoData)) {
      this.geoLocationCache.set(country, coords);
    }
  }
  
  /**
   * Validate timezone string
   */
  validateTimezone(timezone) {
    if (!timezone || typeof timezone !== "string") {
      throw new Error("Timezone must be a non-empty string");
    }
    
    // Check if timezone is in the supported countries
    const validTimezones = Object.values(SUPPORTED_COUNTRIES).map(c => c.timezone);
    const commonTimezones = [
      "America/New_York", "America/Los_Angeles", "America/Chicago",
      "Europe/London", "Europe/Berlin", "Europe/Paris", "Europe/Rome",
      "Asia/Tokyo", "Asia/Shanghai", "Asia/Kolkata", "Asia/Seoul",
      "Australia/Sydney", "America/Toronto", "America/Sao_Paulo",
      "America/Mexico_City", "Europe/Moscow", "Europe/Madrid"
    ];
    
    if (!validTimezones.includes(timezone) && !commonTimezones.includes(timezone)) {
      throw new Error(`Unsupported timezone: ${timezone}`);
    }
    
    // Test if timezone is valid by trying to use it
    try {
      new Date().toLocaleString("en-US", { timeZone: timezone });
    } catch (error) {
      throw new Error(`Invalid timezone: ${timezone}`);
    }
    
    return true;
  }

  getCountryCoordinates(countryCode) {
    return this.geoLocationCache.get(countryCode) || null;
  }

  getTimezoneOffset(timezone) {
    if (this.timezoneCache.has(timezone)) {
      return this.timezoneCache.get(timezone);
    }
    
    // Calculate dynamically if not cached
    const now = new Date();
    const utc = new Date(now.getTime() + (now.getTimezoneOffset() * 60000));
    const targetTime = new Date(utc.toLocaleString('en-US', { timeZone: timezone }));
    const offset = (targetTime.getTime() - utc.getTime()) / (1000 * 60);
    
    this.timezoneCache.set(timezone, offset);
    return offset;
  }
  
  async getDefaultGeoLocation(countryCode) {
    return this.geoLocationCache.get(countryCode) || { latitude: 0, longitude: 0 };
  }
  
  generateUserAgent(countryCode) {
    const userAgents = {
      'US': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'GB': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'DE': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    };
    
    return userAgents[countryCode] || userAgents['US'];
  }
  
  getDateFormat(countryCode) {
    const formats = {
      'US': 'MM/DD/YYYY',
      'GB': 'DD/MM/YYYY',
      'DE': 'DD.MM.YYYY',
      'JP': 'YYYY/MM/DD'
    };
    
    return formats[countryCode] || 'MM/DD/YYYY';
  }
  
  getNumberFormat(countryCode) {
    const formats = {
      'US': '1,234.56',
      'GB': '1,234.56',
      'DE': '1.234,56',
      'FR': '1 234,56'
    };
    
    return formats[countryCode] || '1,234.56';
  }
  
  getFirstDayOfWeek(countryCode) {
    // 0 = Sunday, 1 = Monday
    const firstDays = {
      'US': 0,
      'GB': 1,
      'DE': 1,
      'FR': 1
    };
    
    return firstDays[countryCode] || 1;
  }
  
  generateScreenProperties(countryCode) {
    // Different regions may have different common screen resolutions
    const screenProps = {
      'US': { width: 1920, height: 1080, colorDepth: 24 },
      'JP': { width: 1366, height: 768, colorDepth: 24 },
      'DE': { width: 1920, height: 1080, colorDepth: 24 }
    };
    
    return screenProps[countryCode] || screenProps['US'];
  }
  
  async generateNavigatorProperties(localizationConfig) {
    return {
      language: localizationConfig.language,
      languages: [localizationConfig.language, localizationConfig.language.split('-')[0], 'en'],
      platform: 'Win32',
      userAgent: localizationConfig.userAgent || this.generateUserAgent(localizationConfig.countryCode),
      cookieEnabled: true,
      onLine: true,
      hardwareConcurrency: 8
    };
  }
  
  generateIntlProperties(language, countryCode) {
    return {
      locale: language,
      timeZone: SUPPORTED_COUNTRIES[countryCode].timezone,
      currency: SUPPORTED_COUNTRIES[countryCode].currency,
      numberingSystem: 'latn',
      calendar: 'gregory'
    };
  }
  
  encodeLocationString(countryCode) {
    // Google's UULE encoding for country-based searches
    const countryNames = {
      'US': 'United States',
      'GB': 'United Kingdom',
      'DE': 'Germany',
      'FR': 'France'
    };
    
    const countryName = countryNames[countryCode] || countryCode;
    return Buffer.from(countryName).toString('base64');
  }
  
  async getProxyIP(countryCode) {
    // This would integrate with proxy services
    // For now, return placeholder
    return '192.0.2.1'; // RFC5737 documentation IP
  }
  
  getSuggestedCountries(url) {
    // Analyze URL to suggest appropriate countries
    const domain = new URL(url).hostname;
    
    if (domain.includes('.co.uk')) return ['GB'];
    if (domain.includes('.de')) return ['DE'];
    if (domain.includes('.fr')) return ['FR'];
    if (domain.includes('.jp')) return ['JP'];
    
    return ['US', 'GB', 'DE']; // Common fallbacks
  }
  
  async getSuggestedUserAgents(url) {
    return [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    ];
  }
  
  getProxyRegions(url) {
    // Based on the URL, suggest proxy regions
    return ['US-East', 'EU-West', 'Asia-Pacific'];
  }
  
  generateScreenOverrides(countryCode) {
    const screen = this.generateScreenProperties(countryCode);
    
    return `
      Object.defineProperty(screen, 'width', { value: ${screen.width} });
      Object.defineProperty(screen, 'height', { value: ${screen.height} });
      Object.defineProperty(screen, 'colorDepth', { value: ${screen.colorDepth} });
    `;
  }
  
  async generateFingerprint(countryCode) {
    // Generate browser fingerprint consistent with the target country
    return {
      userAgent: this.generateUserAgent(countryCode),
      screen: this.generateScreenProperties(countryCode),
      timezone: SUPPORTED_COUNTRIES[countryCode].timezone,
      language: SUPPORTED_COUNTRIES[countryCode].language,
      platform: 'Win32'
    };
  }
  
  // Public API methods
  
  getSupportedCountries() {
    return Object.keys(SUPPORTED_COUNTRIES);
  }
  
  getCurrentSettings() {
    return { ...this.currentSettings };
  }
  
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.localeCache.size,
      supportedCountries: Object.keys(SUPPORTED_COUNTRIES).length,
      lastUpdated: Date.now()
    };
  }
  
  resetStats() {
    this.stats = {
      localizationApplied: 0,
      geoBlocksBypass: 0,
      timezoneChanges: 0,
      languageDetections: 0,
      proxyUsage: 0,
      dnsOverrides: 0,
      lastUpdated: Date.now()
    };
  }
  

  /**
   * Get country configuration
   */
  getCountryConfig(countryCode) {
    return SUPPORTED_COUNTRIES[countryCode] || null;
  }

  /**
   * Generate Accept-Language header
   */
  generateAcceptLanguageHeader(language) {
    const langCode = language.split("-")[0];
    return `${language},${langCode};q=0.9,en;q=0.8`;
  }

  /**
   * Create browser locale configuration
   */
  createBrowserLocale(countryCode) {
    const config = this.getCountryConfig(countryCode);
    if (!config) return null;
    
    return {
      languages: [config.language, config.language.split("-")[0], "en"],
      timezone: config.timezone,
      currency: config.currency,
      dateFormat: this.getDateFormat(countryCode),
      numberFormat: this.getNumberFormat(countryCode)
    };
  }

  /**
   * Generate localized headers
   */
  generateLocalizedHeaders(countryCode) {
    const config = this.getCountryConfig(countryCode);
    if (!config) return {};
    
    return {
      "Accept-Language": this.generateAcceptLanguageHeader(config.language),
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      "DNT": "1"
    };
  }

  /**
   * Detect content language
   */
  detectContentLanguage(content) {
    // Look for lang attribute in HTML
    const langMatch = content.match(/<html[^>]+lang=["']([^"']+)["']/i);
    if (langMatch) {
      return langMatch[1];
    }
    
    // Look for meta tag
    const metaMatch = content.match(/<meta[^>]+http-equiv=["']content-language["'][^>]+content=["']([^"']+)["']/i);
    if (metaMatch) {
      return metaMatch[1];
    }
    
    return null;
  }
  clearCache() {
    this.localeCache.clear();
    this.geoLocationCache.clear();
    this.timezoneCache.clear();
    this.emit('cacheCleared');
  }
}

export default LocalizationManager;