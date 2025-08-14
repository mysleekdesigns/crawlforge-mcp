/**
 * LocalizationManager - Location/Language Settings Management
 * Handles country-specific settings, browser locale emulation,
 * timezone spoofing, and geo-blocked content handling
 */

import { z } from 'zod';
import { EventEmitter } from 'events';

// ISO 3166-1 alpha-2 country codes with associated settings (Expanded to 15+ countries)
const SUPPORTED_COUNTRIES = {
  'US': { timezone: 'America/New_York', currency: 'USD', language: 'en-US', searchDomain: 'google.com', isRTL: false, proxyRegion: 'us-east', countryName: 'United States' },
  'GB': { timezone: 'Europe/London', currency: 'GBP', language: 'en-GB', searchDomain: 'google.co.uk', isRTL: false, proxyRegion: 'eu-west', countryName: 'United Kingdom' },
  'DE': { timezone: 'Europe/Berlin', currency: 'EUR', language: 'de-DE', searchDomain: 'google.de', isRTL: false, proxyRegion: 'eu-central', countryName: 'Germany' },
  'FR': { timezone: 'Europe/Paris', currency: 'EUR', language: 'fr-FR', searchDomain: 'google.fr', isRTL: false, proxyRegion: 'eu-west', countryName: 'France' },
  'JP': { timezone: 'Asia/Tokyo', currency: 'JPY', language: 'ja-JP', searchDomain: 'google.co.jp', isRTL: false, proxyRegion: 'asia-pacific', countryName: 'Japan' },
  'CN': { timezone: 'Asia/Shanghai', currency: 'CNY', language: 'zh-CN', searchDomain: 'baidu.com', isRTL: false, proxyRegion: 'asia-pacific', countryName: 'China' },
  'AU': { timezone: 'Australia/Sydney', currency: 'AUD', language: 'en-AU', searchDomain: 'google.com.au', isRTL: false, proxyRegion: 'asia-pacific', countryName: 'Australia' },
  'CA': { timezone: 'America/Toronto', currency: 'CAD', language: 'en-CA', searchDomain: 'google.ca', isRTL: false, proxyRegion: 'us-east', countryName: 'Canada' },
  'IT': { timezone: 'Europe/Rome', currency: 'EUR', language: 'it-IT', searchDomain: 'google.it', isRTL: false, proxyRegion: 'eu-central', countryName: 'Italy' },
  'ES': { timezone: 'Europe/Madrid', currency: 'EUR', language: 'es-ES', searchDomain: 'google.es', isRTL: false, proxyRegion: 'eu-west', countryName: 'Spain' },
  'RU': { timezone: 'Europe/Moscow', currency: 'RUB', language: 'ru-RU', searchDomain: 'yandex.ru', isRTL: false, proxyRegion: 'eu-east', countryName: 'Russia' },
  'BR': { timezone: 'America/Sao_Paulo', currency: 'BRL', language: 'pt-BR', searchDomain: 'google.com.br', isRTL: false, proxyRegion: 'south-america', countryName: 'Brazil' },
  'IN': { timezone: 'Asia/Kolkata', currency: 'INR', language: 'hi-IN', searchDomain: 'google.co.in', isRTL: false, proxyRegion: 'asia-pacific', countryName: 'India' },
  'KR': { timezone: 'Asia/Seoul', currency: 'KRW', language: 'ko-KR', searchDomain: 'google.co.kr', isRTL: false, proxyRegion: 'asia-pacific', countryName: 'South Korea' },
  'MX': { timezone: 'America/Mexico_City', currency: 'MXN', language: 'es-MX', searchDomain: 'google.com.mx', isRTL: false, proxyRegion: 'north-america', countryName: 'Mexico' },
  'NL': { timezone: 'Europe/Amsterdam', currency: 'EUR', language: 'nl-NL', searchDomain: 'google.nl', isRTL: false, proxyRegion: 'eu-west', countryName: 'Netherlands' },
  'SE': { timezone: 'Europe/Stockholm', currency: 'SEK', language: 'sv-SE', searchDomain: 'google.se', isRTL: false, proxyRegion: 'eu-north', countryName: 'Sweden' },
  'NO': { timezone: 'Europe/Oslo', currency: 'NOK', language: 'nb-NO', searchDomain: 'google.no', isRTL: false, proxyRegion: 'eu-north', countryName: 'Norway' },
  'SA': { timezone: 'Asia/Riyadh', currency: 'SAR', language: 'ar-SA', searchDomain: 'google.com.sa', isRTL: true, proxyRegion: 'middle-east', countryName: 'Saudi Arabia' },
  'AE': { timezone: 'Asia/Dubai', currency: 'AED', language: 'ar-AE', searchDomain: 'google.ae', isRTL: true, proxyRegion: 'middle-east', countryName: 'United Arab Emirates' },
  'TR': { timezone: 'Europe/Istanbul', currency: 'TRY', language: 'tr-TR', searchDomain: 'google.com.tr', isRTL: false, proxyRegion: 'eu-east', countryName: 'Turkey' },
  'IL': { timezone: 'Asia/Jerusalem', currency: 'ILS', language: 'he-IL', searchDomain: 'google.co.il', isRTL: true, proxyRegion: 'middle-east', countryName: 'Israel' },
  'TH': { timezone: 'Asia/Bangkok', currency: 'THB', language: 'th-TH', searchDomain: 'google.co.th', isRTL: false, proxyRegion: 'asia-pacific', countryName: 'Thailand' },
  'SG': { timezone: 'Asia/Singapore', currency: 'SGD', language: 'en-SG', searchDomain: 'google.com.sg', isRTL: false, proxyRegion: 'asia-pacific', countryName: 'Singapore' },
  'PL': { timezone: 'Europe/Warsaw', currency: 'PLN', language: 'pl-PL', searchDomain: 'google.pl', isRTL: false, proxyRegion: 'eu-central', countryName: 'Poland' },
  'ZA': { timezone: 'Africa/Johannesburg', currency: 'ZAR', language: 'en-ZA', searchDomain: 'google.co.za', isRTL: false, proxyRegion: 'africa', countryName: 'South Africa' }
};

// Common language mappings for Accept-Language headers with cultural preferences
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
  'hi': 'hi-IN,hi;q=0.9,en;q=0.8',
  'ar': 'ar-SA,ar;q=0.9,en;q=0.8',
  'he': 'he-IL,he;q=0.9,en;q=0.8',
  'tr': 'tr-TR,tr;q=0.9,en;q=0.8',
  'th': 'th-TH,th;q=0.9,en;q=0.8',
  'pl': 'pl-PL,pl;q=0.9,en;q=0.8',
  'nl': 'nl-NL,nl;q=0.9,en;q=0.8',
  'sv': 'sv-SE,sv;q=0.9,en;q=0.8',
  'nb': 'nb-NO,nb;q=0.9,en;q=0.8'
};

// RTL Languages Configuration
const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur', 'ku', 'dv']);

// Proxy Provider Configuration
const PROXY_PROVIDERS = {
  regions: {
    'us-east': { endpoint: 'proxy-us-east.example.com', port: 8080 },
    'us-west': { endpoint: 'proxy-us-west.example.com', port: 8080 },
    'eu-west': { endpoint: 'proxy-eu-west.example.com', port: 8080 },
    'eu-central': { endpoint: 'proxy-eu-central.example.com', port: 8080 },
    'eu-north': { endpoint: 'proxy-eu-north.example.com', port: 8080 },
    'eu-east': { endpoint: 'proxy-eu-east.example.com', port: 8080 },
    'asia-pacific': { endpoint: 'proxy-asia-pacific.example.com', port: 8080 },
    'middle-east': { endpoint: 'proxy-middle-east.example.com', port: 8080 },
    'south-america': { endpoint: 'proxy-south-america.example.com', port: 8080 },
    'north-america': { endpoint: 'proxy-north-america.example.com', port: 8080 },
    'africa': { endpoint: 'proxy-africa.example.com', port: 8080 }
  },
  fallbackStrategies: {
    'geo-blocked': ['rotate-proxy', 'change-user-agent', 'delay-request'],
    'rate-limited': ['change-proxy', 'exponential-backoff'],
    'detection': ['rotate-fingerprint', 'change-proxy', 'human-delay']
  }
};

// Translation Service Configuration
const TRANSLATION_SERVICES = {
  google: {
    enabled: process.env.GOOGLE_TRANSLATE_API_KEY ? true : false,
    apiKey: process.env.GOOGLE_TRANSLATE_API_KEY,
    endpoint: 'https://translation.googleapis.com/language/translate/v2'
  },
  azure: {
    enabled: process.env.AZURE_TRANSLATE_KEY ? true : false,
    key: process.env.AZURE_TRANSLATE_KEY,
    region: process.env.AZURE_TRANSLATE_REGION || 'global',
    endpoint: 'https://api.cognitive.microsofttranslator.com/translate'
  },
  libre: {
    enabled: process.env.LIBRE_TRANSLATE_URL ? true : false,
    url: process.env.LIBRE_TRANSLATE_URL,
    apiKey: process.env.LIBRE_TRANSLATE_API_KEY
  }
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
    region: z.string().optional(), // Proxy region preference
    type: z.enum(['http', 'https', 'socks4', 'socks5']).default('https'),
    server: z.string().optional(),
    port: z.number().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    rotation: z.object({
      enabled: z.boolean().default(false),
      interval: z.number().default(300000), // 5 minutes
      strategy: z.enum(['round-robin', 'random', 'failover']).default('round-robin')
    }).optional(),
    fallback: z.object({
      enabled: z.boolean().default(true),
      maxRetries: z.number().default(3),
      timeout: z.number().default(10000)
    }).optional()
  }).optional(),
  dnsSettings: z.object({
    enabled: z.boolean().default(false),
    servers: z.array(z.string()).optional(),
    preferredCountry: z.string().length(2).optional(),
    dnsOverHttps: z.boolean().default(false),
    customResolvers: z.record(z.string()).optional() // domain -> IP mappings
  }).optional(),
  translationSettings: z.object({
    enabled: z.boolean().default(false),
    targetLanguage: z.string().optional(),
    provider: z.enum(['google', 'azure', 'libre']).default('google'),
    autoDetect: z.boolean().default(true),
    preserveFormatting: z.boolean().default(true)
  }).optional(),
  culturalSettings: z.object({
    dateFormat: z.string().optional(),
    numberFormat: z.string().optional(),
    currencyDisplay: z.enum(['symbol', 'narrowSymbol', 'code', 'name']).default('symbol'),
    firstDayOfWeek: z.number().min(0).max(6).optional(),
    timeFormat: z.enum(['12h', '24h']).optional(),
    measurementSystem: z.enum(['metric', 'imperial']).optional()
  }).optional()
});

const BrowserLocaleSchema = z.object({
  languages: z.array(z.string()),
  timezone: z.string(),
  locale: z.string(),
  currency: z.string(),
  dateFormat: z.string(),
  numberFormat: z.string(),
  firstDayOfWeek: z.number().min(0).max(6),
  isRTL: z.boolean().default(false),
  measurementSystem: z.string().optional(),
  timeFormat: z.string().optional(),
  currencyDisplay: z.string().optional(),
  textDirection: z.enum(['ltr', 'rtl']).default('ltr')
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
      dynamicFingerprinting: true,
      enableProxyRotation: false,
      enableTranslation: false
    };
    
    this.currentSettings = { ...this.defaultSettings, ...options };
    this.localeCache = new Map();
    this.geoLocationCache = new Map();
    this.timezoneCache = new Map();
    this.proxyCache = new Map();
    this.translationCache = new Map();
    
    // Proxy management
    this.proxyManager = {
      activeProxies: new Map(),
      currentProxy: null,
      rotationIndex: 0,
      lastRotation: 0,
      failedProxies: new Set(),
      healthChecks: new Map()
    };
    
    // Translation services
    this.translationProviders = new Map();
    this.languageDetector = null;
    
    // Cultural browsing patterns
    this.culturalPatterns = new Map();
    
    // Statistics tracking
    this.stats = {
      localizationApplied: 0,
      geoBlocksBypass: 0,
      timezoneChanges: 0,
      languageDetections: 0,
      proxyUsage: 0,
      proxyRotations: 0,
      dnsOverrides: 0,
      translationRequests: 0,
      culturalAdaptations: 0,
      lastUpdated: Date.now()
    };
    
    this.initialize();
  }
  
  async initialize() {
    try {
      // Pre-populate timezone mappings
      await this.loadTimezoneData();
      
      // Initialize geo-location data
      await this.loadGeoLocationData();
      
      // Initialize proxy configurations
      await this.initializeProxySystem();
      
      // Initialize translation services
      await this.initializeTranslationServices();
      
      // Load cultural browsing patterns
      await this.loadCulturalPatterns();
      
      // Setup periodic health checks
      this.setupHealthChecks();
      
      this.emit('initialized');
    } catch (error) {
      this.emit('error', { 
        type: 'initialization_failed', 
        error: error.message 
      });
      throw error;
    }
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
    const countryConfig = SUPPORTED_COUNTRIES[countryCode];
    
    // Determine text direction and RTL support
    const isRTL = RTL_LANGUAGES.has(langCode) || countryConfig?.isRTL;
    
    // Generate comprehensive browser locale with RTL support
    const browserLocale = {
      languages: [language, langCode, 'en'],
      timezone: timezone,
      locale: language,
      currency: currency,
      dateFormat: this.getDateFormat(countryCode),
      numberFormat: this.getNumberFormat(countryCode),
      firstDayOfWeek: this.getFirstDayOfWeek(countryCode),
      isRTL: isRTL,
      textDirection: isRTL ? 'rtl' : 'ltr',
      measurementSystem: this.getMeasurementSystem(countryCode),
      timeFormat: this.getTimeFormat(countryCode),
      currencyDisplay: this.getCurrencyDisplay(countryCode),
      
      // Additional browser properties
      screen: this.generateScreenProperties(countryCode),
      navigator: await this.generateNavigatorProperties(localizationConfig),
      intl: this.generateIntlProperties(language, countryCode),
      
      // Cultural browsing behavior
      culturalBehavior: this.getCulturalBehavior(countryCode)
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
    
    // Advanced bypass strategies with fallback options
    const bypassStrategies = await this.generateBypassStrategies(url, response);
    
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
      detectedScript: null,
      isRTL: false,
      confidence: 0,
      evidence: [],
      recommendations: [],
      culturalIndicators: []
    };
    
    // Enhanced language detection
    await this.performLanguageDetection(content, detection);
    
    // Country detection from multiple sources
    await this.performCountryDetection(content, url, detection);
    
    // Script and direction detection
    await this.performScriptDetection(content, detection);
    
    // Cultural pattern detection
    await this.performCulturalDetection(content, detection);
    
    // Generate comprehensive recommendations
    await this.generateLocalizationRecommendations(detection);
    
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
      activeProxies: this.proxyManager.activeProxies.size,
      failedProxies: this.proxyManager.failedProxies.size,
      translationProviders: this.translationProviders.size,
      culturalPatterns: this.culturalPatterns.size,
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
      proxyRotations: 0,
      dnsOverrides: 0,
      translationRequests: 0,
      culturalAdaptations: 0,
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
  /**
   * Initialize proxy system with regional configurations
   */
  async initializeProxySystem() {
    try {
      // Load proxy configurations from environment or config
      for (const [region, config] of Object.entries(PROXY_PROVIDERS.regions)) {
        if (process.env[`PROXY_${region.toUpperCase().replace('-', '_')}_ENABLED`] === 'true') {
          this.proxyManager.activeProxies.set(region, {
            ...config,
            username: process.env[`PROXY_${region.toUpperCase().replace('-', '_')}_USERNAME`],
            password: process.env[`PROXY_${region.toUpperCase().replace('-', '_')}_PASSWORD`],
            healthScore: 100,
            lastCheck: 0,
            failureCount: 0
          });
        }
      }
      
      // Setup proxy health monitoring
      if (this.proxyManager.activeProxies.size > 0) {
        await this.performProxyHealthChecks();
      }
      
    } catch (error) {
      console.warn('Failed to initialize proxy system:', error.message);
    }
  }
  
  /**
   * Initialize translation services
   */
  async initializeTranslationServices() {
    try {
      // Google Translate
      if (TRANSLATION_SERVICES.google.enabled) {
        this.translationProviders.set('google', {
          type: 'google',
          apiKey: TRANSLATION_SERVICES.google.apiKey,
          endpoint: TRANSLATION_SERVICES.google.endpoint,
          available: true
        });
      }
      
      // Azure Translator
      if (TRANSLATION_SERVICES.azure.enabled) {
        this.translationProviders.set('azure', {
          type: 'azure',
          key: TRANSLATION_SERVICES.azure.key,
          region: TRANSLATION_SERVICES.azure.region,
          endpoint: TRANSLATION_SERVICES.azure.endpoint,
          available: true
        });
      }
      
      // LibreTranslate
      if (TRANSLATION_SERVICES.libre.enabled) {
        this.translationProviders.set('libre', {
          type: 'libre',
          url: TRANSLATION_SERVICES.libre.url,
          apiKey: TRANSLATION_SERVICES.libre.apiKey,
          available: true
        });
      }
      
    } catch (error) {
      console.warn('Failed to initialize translation services:', error.message);
    }
  }
  
  /**
   * Load cultural browsing patterns for different regions
   */
  async loadCulturalPatterns() {
    const patterns = {
      'US': {
        scrollSpeed: 'fast',
        clickDelay: 200,
        readingSpeed: 250, // words per minute
        pageStayTime: { min: 5000, max: 30000 },
        bounceRate: 0.4
      },
      'JP': {
        scrollSpeed: 'medium',
        clickDelay: 500,
        readingSpeed: 400,
        pageStayTime: { min: 8000, max: 45000 },
        bounceRate: 0.25
      },
      'DE': {
        scrollSpeed: 'medium',
        clickDelay: 300,
        readingSpeed: 200,
        pageStayTime: { min: 10000, max: 60000 },
        bounceRate: 0.3
      },
      'CN': {
        scrollSpeed: 'slow',
        clickDelay: 400,
        readingSpeed: 300,
        pageStayTime: { min: 12000, max: 50000 },
        bounceRate: 0.35
      },
      'SA': {
        scrollSpeed: 'slow',
        clickDelay: 600,
        readingSpeed: 180,
        pageStayTime: { min: 15000, max: 70000 },
        bounceRate: 0.2,
        rtlBehavior: true
      }
    };
    
    for (const [country, pattern] of Object.entries(patterns)) {
      this.culturalPatterns.set(country, pattern);
    }
  }
  
  /**
   * Setup periodic health checks for proxies and services
   */
  setupHealthChecks() {
    // Proxy health checks every 5 minutes
    setInterval(async () => {
      if (this.proxyManager.activeProxies.size > 0) {
        await this.performProxyHealthChecks();
      }
    }, 300000);
    
    // Translation service health checks every 10 minutes
    setInterval(async () => {
      if (this.translationProviders.size > 0) {
        await this.checkTranslationServiceHealth();
      }
    }, 600000);
  }

  /**
   * Perform health checks on all active proxies
   */
  async performProxyHealthChecks() {
    const healthCheckPromises = [];
    
    for (const [region, proxy] of this.proxyManager.activeProxies) {
      healthCheckPromises.push(this.checkProxyHealth(region, proxy));
    }
    
    await Promise.allSettled(healthCheckPromises);
  }
  
  /**
   * Check health of a specific proxy
   */
  async checkProxyHealth(region, proxy) {
    try {
      const start = Date.now();
      const response = await fetch('http://httpbin.org/ip', {
        method: 'GET',
        headers: { 'User-Agent': 'Health-Check/1.0' },
        // Proxy configuration would go here
        timeout: 10000
      });
      
      const latency = Date.now() - start;
      
      if (response.ok) {
        proxy.healthScore = Math.min(100, proxy.healthScore + 10);
        proxy.failureCount = 0;
        proxy.latency = latency;
      } else {
        proxy.healthScore = Math.max(0, proxy.healthScore - 20);
        proxy.failureCount++;
      }
      
      proxy.lastCheck = Date.now();
      
    } catch (error) {
      proxy.healthScore = Math.max(0, proxy.healthScore - 30);
      proxy.failureCount++;
      proxy.lastCheck = Date.now();
      
      if (proxy.failureCount > 3) {
        this.proxyManager.failedProxies.add(region);
      }
    }
  }

  /**
   * Get optimal proxy for a target country
   */
  async getOptimalProxy(countryCode, proxySettings) {
    if (!proxySettings?.enabled || this.proxyManager.activeProxies.size === 0) {
      return null;
    }
    
    const countryConfig = SUPPORTED_COUNTRIES[countryCode];
    const preferredRegion = proxySettings.region || countryConfig?.proxyRegion;
    
    // Try to get proxy from preferred region first
    if (preferredRegion && this.proxyManager.activeProxies.has(preferredRegion)) {
      const proxy = this.proxyManager.activeProxies.get(preferredRegion);
      if (proxy.healthScore > 50 && !this.proxyManager.failedProxies.has(preferredRegion)) {
        this.stats.proxyUsage++;
        return this.formatProxyConfig(proxy, proxySettings);
      }
    }
    
    // Fallback to best available proxy
    const availableProxies = Array.from(this.proxyManager.activeProxies.entries())
      .filter(([region, proxy]) => 
        proxy.healthScore > 30 && 
        !this.proxyManager.failedProxies.has(region)
      )
      .sort(([,a], [,b]) => b.healthScore - a.healthScore);
    
    if (availableProxies.length > 0) {
      const [region, proxy] = availableProxies[0];
      this.stats.proxyUsage++;
      return this.formatProxyConfig(proxy, proxySettings);
    }
    
    return null;
  }
  
  /**
   * Format proxy configuration for browser use
   */
  formatProxyConfig(proxy, settings) {
    return {
      server: `${settings.type || 'https'}://${proxy.endpoint}:${proxy.port}`,
      username: proxy.username,
      password: proxy.password,
      bypass: settings.bypass || 'localhost,127.0.0.1'
    };
  }

  /**
   * Get cultural browsing behavior for a country
   */
  getCulturalBehavior(countryCode) {
    return this.culturalPatterns.get(countryCode) || this.culturalPatterns.get('US');
  }
  
  /**
   * Get measurement system for a country
   */
  getMeasurementSystem(countryCode) {
    const imperialCountries = ['US', 'GB', 'LR', 'MM'];
    return imperialCountries.includes(countryCode) ? 'imperial' : 'metric';
  }
  
  /**
   * Get time format preference for a country
   */
  getTimeFormat(countryCode) {
    const twelveHourCountries = ['US', 'CA', 'AU', 'NZ', 'PH', 'EG', 'SA'];
    return twelveHourCountries.includes(countryCode) ? '12h' : '24h';
  }
  
  /**
   * Get currency display preference for a country
   */
  getCurrencyDisplay(countryCode) {
    const symbolCountries = ['US', 'GB', 'JP', 'CN', 'IN', 'KR'];
    return symbolCountries.includes(countryCode) ? 'symbol' : 'code';
  }

  /**
   * Generate bypass strategies for geo-blocking
   */
  async generateBypassStrategies(url, response) {
    const strategies = [];
    
    // Country-based bypass
    strategies.push({
      type: 'country_change',
      priority: 1,
      description: 'Access from different geographic location',
      suggestedCountries: this.getOptimalCountriesForUrl(url),
      estimatedSuccess: 0.8
    });
    
    // Proxy-based bypass
    if (this.proxyManager.activeProxies.size > 0) {
      strategies.push({
        type: 'proxy_rotation',
        priority: 2,
        description: 'Use proxy servers from different regions',
        availableRegions: Array.from(this.proxyManager.activeProxies.keys()),
        estimatedSuccess: 0.7
      });
    }
    
    // User agent rotation
    strategies.push({
      type: 'user_agent_rotation',
      priority: 3,
      description: 'Rotate user agent strings',
      suggestedAgents: await this.getOptimalUserAgents(url),
      estimatedSuccess: 0.4
    });
    
    // Header manipulation
    strategies.push({
      type: 'header_manipulation',
      priority: 4,
      description: 'Modify HTTP headers to bypass detection',
      modifications: this.getHeaderModifications(url),
      estimatedSuccess: 0.3
    });
    
    return strategies.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get optimal countries for accessing a URL
   */
  getOptimalCountriesForUrl(url) {
    const domain = new URL(url).hostname;
    
    // Domain-specific suggestions
    const domainMappings = {
      'bbc.co.uk': ['GB', 'IE', 'AU'],
      'cnn.com': ['US', 'CA'],
      'lemonde.fr': ['FR', 'BE', 'CH'],
      'spiegel.de': ['DE', 'AT', 'CH'],
      'nhk.or.jp': ['JP'],
      'globo.com': ['BR'],
      'rt.com': ['RU']
    };
    
    if (domainMappings[domain]) {
      return domainMappings[domain];
    }
    
    // TLD-based suggestions
    const tldMatch = domain.match(/\.([a-z]{2})$/);
    if (tldMatch) {
      const tld = tldMatch[1].toUpperCase();
      if (SUPPORTED_COUNTRIES[tld]) {
        return [tld];
      }
    }
    
    // Default fallbacks
    return ['US', 'GB', 'DE', 'CA', 'AU'];
  }

  /**
   * Get optimal user agents for a URL
   */
  async getOptimalUserAgents(url) {
    return [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/121.0'
    ];
  }

  /**
   * Get header modifications for bypass
   */
  getHeaderModifications(url) {
    return {
      'X-Forwarded-For': 'Remove or randomize',
      'X-Real-IP': 'Remove',
      'CF-Connecting-IP': 'Remove',
      'X-Originating-IP': 'Remove',
      'Referer': 'Randomize or remove',
      'Origin': 'Match target domain'
    };
  }

  /**
   * Enhanced language detection with multiple methods
   */
  async performLanguageDetection(content, detection) {
    // HTML lang attribute
    const langMatch = content.match(/<html[^>]+lang=["']([^"']+)["']/i);
    if (langMatch) {
      detection.detectedLanguage = langMatch[1];
      detection.evidence.push(`HTML lang attribute: ${langMatch[1]}`);
      detection.confidence += 0.3;
    }
    
    // Meta content-language
    const metaLangMatch = content.match(/<meta[^>]+http-equiv=["']content-language["'][^>]+content=["']([^"']+)["']/i);
    if (metaLangMatch) {
      detection.detectedLanguage = metaLangMatch[1];
      detection.evidence.push(`Meta content-language: ${metaLangMatch[1]}`);
      detection.confidence += 0.25;
    }
    
    // Text analysis for language detection
    const textSample = this.extractTextSample(content);
    if (textSample) {
      const detectedLang = await this.analyzeTextLanguage(textSample);
      if (detectedLang) {
        detection.evidence.push(`Text analysis: ${detectedLang.language} (${detectedLang.confidence}%)`);
        detection.confidence += detectedLang.confidence / 100 * 0.2;
      }
    }
  }

  /**
   * Script and text direction detection
   */
  async performScriptDetection(content, detection) {
    // RTL script detection
    const rtlPatterns = {
      arabic: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/,
      hebrew: /[\u0590-\u05FF]/,
      persian: /[\u06A0-\u06EF]/
    };
    
    for (const [script, pattern] of Object.entries(rtlPatterns)) {
      if (pattern.test(content)) {
        detection.detectedScript = script;
        detection.isRTL = true;
        detection.evidence.push(`RTL script detected: ${script}`);
        detection.confidence += 0.15;
        break;
      }
    }
    
    // CJK script detection
    const cjkPatterns = {
      chinese: /[\u4E00-\u9FFF]/,
      japanese: /[\u3040-\u309F\u30A0-\u30FF]/,
      korean: /[\uAC00-\uD7AF]/
    };
    
    for (const [script, pattern] of Object.entries(cjkPatterns)) {
      if (pattern.test(content)) {
        detection.detectedScript = script;
        detection.evidence.push(`CJK script detected: ${script}`);
        detection.confidence += 0.1;
        break;
      }
    }
  }

  /**
   * Extract text sample for language analysis
   */
  extractTextSample(content) {
    // Remove HTML tags and extract meaningful text
    const textContent = content.replace(/<[^>]*>/g, ' ')
                              .replace(/\s+/g, ' ')
                              .trim();
    
    // Return first 500 characters for analysis
    return textContent.substring(0, 500);
  }

  /**
   * Analyze text for language detection
   */
  async analyzeTextLanguage(text) {
    // Simple heuristic-based language detection
    // In a real implementation, this could use a proper language detection library
    const patterns = {
      'en': /\b(the|and|is|in|to|of|a|that|it|with|for|as|was|on|are|you)\b/gi,
      'es': /\b(el|la|de|que|y|en|un|es|se|no|te|lo|le|da|su|por|son)\b/gi,
      'fr': /\b(le|de|et|à|un|il|être|et|en|avoir|que|pour|dans|ce|son|une)\b/gi,
      'de': /\b(der|die|und|in|den|von|zu|das|mit|sich|des|auf|für|ist|im)\b/gi,
      'it': /\b(il|di|che|e|la|per|in|un|è|da|sono|con|non|si|una|su)\b/gi
    };
    
    let bestMatch = null;
    let maxMatches = 0;
    
    for (const [lang, pattern] of Object.entries(patterns)) {
      const matches = (text.match(pattern) || []).length;
      if (matches > maxMatches) {
        maxMatches = matches;
        bestMatch = { language: lang, confidence: Math.min(95, matches * 5) };
      }
    }
    
    return bestMatch;
  }

  /**
   * Enhanced country detection
   */
  async performCountryDetection(content, url, detection) {
    // TLD analysis
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
    
    // Enhanced currency detection
    const currencyPatterns = {
      '$': { countries: ['US', 'CA', 'AU', 'NZ', 'SG'], symbols: ['$', 'USD', 'CAD', 'AUD'] },
      '€': { countries: ['DE', 'FR', 'IT', 'ES', 'NL'], symbols: ['€', 'EUR'] },
      '£': { countries: ['GB'], symbols: ['£', 'GBP'] },
      '¥': { countries: ['JP', 'CN'], symbols: ['¥', 'JPY', 'CNY', '￥'] },
      '₹': { countries: ['IN'], symbols: ['₹', 'INR'] },
      '₽': { countries: ['RU'], symbols: ['₽', 'RUB'] },
      '₩': { countries: ['KR'], symbols: ['₩', 'KRW'] },
      '﷼': { countries: ['SA'], symbols: ['﷼', 'SAR'] }
    };
    
    for (const [symbol, data] of Object.entries(currencyPatterns)) {
      const found = data.symbols.some(s => content.includes(s));
      if (found) {
        detection.evidence.push(`Currency symbol found: ${symbol}`);
        detection.confidence += 0.1;
        
        if (!detection.detectedCountry && data.countries.length === 1) {
          detection.detectedCountry = data.countries[0];
        }
      }
    }
    
    // Phone number pattern analysis
    const phonePatterns = {
      'US': /\+1[\s.-]?\(?\\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/,
      'GB': /\+44[\s.-]?\d{2,4}[\s.-]?\d{6,8}/,
      'DE': /\+49[\s.-]?\d{2,4}[\s.-]?\d{6,8}/,
      'FR': /\+33[\s.-]?\d{1}[\s.-]?\d{8}/
    };
    
    for (const [country, pattern] of Object.entries(phonePatterns)) {
      if (pattern.test(content)) {
        detection.evidence.push(`Phone pattern suggests country: ${country}`);
        detection.confidence += 0.1;
        if (!detection.detectedCountry) {
          detection.detectedCountry = country;
        }
      }
    }
  }

  /**
   * Cultural pattern detection
   */
  async performCulturalDetection(content, detection) {
    // Date format detection
    const datePatterns = {
      'US': /\d{1,2}\/\d{1,2}\/\d{4}/,
      'GB': /\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}-\d{1,2}-\d{4}/,
      'DE': /\d{1,2}\.\d{1,2}\.\d{4}/,
      'JP': /\d{4}\/\d{1,2}\/\d{1,2}/
    };
    
    for (const [country, pattern] of Object.entries(datePatterns)) {
      if (pattern.test(content)) {
        detection.culturalIndicators.push(`Date format suggests: ${country}`);
      }
    }
    
    // Measurement system detection
    const metricIndicators = /\d+\s*(cm|mm|km|kg|celsius|°C)/i;
    const imperialIndicators = /\d+\s*(inch|foot|feet|yard|mile|pound|fahrenheit|°F)/i;
    
    if (metricIndicators.test(content)) {
      detection.culturalIndicators.push('Metric measurement system');
    }
    if (imperialIndicators.test(content)) {
      detection.culturalIndicators.push('Imperial measurement system');
    }
  }

  /**
   * Generate comprehensive localization recommendations
   */
  async generateLocalizationRecommendations(detection) {
    if (detection.detectedCountry) {
      detection.recommendations.push({
        type: 'country_localization',
        countryCode: detection.detectedCountry,
        confidence: detection.confidence,
        reason: 'Detected from page content analysis'
      });
    }
    
    if (detection.detectedLanguage) {
      detection.recommendations.push({
        type: 'language_localization',
        language: detection.detectedLanguage,
        confidence: detection.confidence,
        reason: 'Detected from HTML attributes and content'
      });
    }
    
    if (detection.isRTL) {
      detection.recommendations.push({
        type: 'rtl_support',
        enabled: true,
        reason: 'RTL script detected in content'
      });
    }
    
    // Translation recommendations
    if (this.translationProviders.size > 0 && detection.detectedLanguage) {
      detection.recommendations.push({
        type: 'translation_available',
        sourceLanguage: detection.detectedLanguage,
        providers: Array.from(this.translationProviders.keys()),
        reason: 'Translation services available'
      });
    }
  }

  clearCache() {
    this.localeCache.clear();
    this.geoLocationCache.clear();
    this.timezoneCache.clear();
    this.proxyCache.clear();
    this.translationCache.clear();
    this.emit('cacheCleared');
  }

  /**
   * Cleanup method for proper resource disposal
   */
  async cleanup() {
    try {
      this.clearCache();
      this.removeAllListeners();
      this.resetStats();
      
      // Clear all health check intervals
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }
      
      // Reset proxy manager
      this.proxyManager.activeProxies.clear();
      this.proxyManager.failedProxies.clear();
      
      // Clear translation providers
      this.translationProviders.clear();
      
    } catch (error) {
      console.warn("Warning during LocalizationManager cleanup:", error.message);
    }
  }
}

export default LocalizationManager;

// Export constants for external use
export { SUPPORTED_COUNTRIES, RTL_LANGUAGES, PROXY_PROVIDERS, TRANSLATION_SERVICES };