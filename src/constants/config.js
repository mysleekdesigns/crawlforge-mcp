import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env'), quiet: true });

export const config = {
  // CrawlForge API Configuration
  crawlforge: {
    apiKey: process.env.CRAWLFORGE_API_KEY || '',
    apiBaseUrl: process.env.CRAWLFORGE_API_URL || 'https://www.crawlforge.dev'
  },

  // Performance
  performance: {
    maxWorkers: parseInt(process.env.MAX_WORKERS || '10'),
    queueConcurrency: parseInt(process.env.QUEUE_CONCURRENCY || '10'),
    cacheMaxSize: parseInt(process.env.CACHE_MAX_SIZE || '1000'),
    cacheTTL: parseInt(process.env.CACHE_TTL || '3600000'),
    cacheEnableDisk: process.env.CACHE_ENABLE_DISK !== 'false',
    cacheDir: process.env.CACHE_DIR || './cache'
  },

  // Rate Limiting
  rateLimit: {
    requestsPerSecond: parseInt(process.env.RATE_LIMIT_REQUESTS_PER_SECOND || '10'),
    requestsPerMinute: parseInt(process.env.RATE_LIMIT_REQUESTS_PER_MINUTE || '100'),
    perDomain: process.env.RATE_LIMIT_PER_DOMAIN !== 'false'
  },

  // Crawling
  crawling: {
    maxDepth: parseInt(process.env.MAX_CRAWL_DEPTH || '5'),
    maxPages: parseInt(process.env.MAX_PAGES_PER_CRAWL || '100'),
    respectRobots: process.env.RESPECT_ROBOTS_TXT !== 'false',
    userAgent: process.env.USER_AGENT || 'CrawlForge/1.0',
    timeout: parseInt(process.env.CRAWL_TIMEOUT || '30000'),
    followExternal: process.env.FOLLOW_EXTERNAL_LINKS === 'true'
  },

  // Search ranking and deduplication
  searchProcessing: {
    enableRanking: process.env.ENABLE_SEARCH_RANKING !== 'false',
    enableDeduplication: process.env.ENABLE_SEARCH_DEDUPLICATION !== 'false',
    
    // Ranking configuration
    ranking: {
      weights: {
        bm25: parseFloat(process.env.RANKING_WEIGHT_BM25 || '0.4'),
        semantic: parseFloat(process.env.RANKING_WEIGHT_SEMANTIC || '0.3'),
        authority: parseFloat(process.env.RANKING_WEIGHT_AUTHORITY || '0.2'),
        freshness: parseFloat(process.env.RANKING_WEIGHT_FRESHNESS || '0.1')
      },
      bm25: {
        k1: parseFloat(process.env.BM25_K1 || '1.5'),
        b: parseFloat(process.env.BM25_B || '0.75')
      }
    },
    
    // Deduplication configuration
    deduplication: {
      thresholds: {
        url: parseFloat(process.env.DEDUP_THRESHOLD_URL || '0.8'),
        title: parseFloat(process.env.DEDUP_THRESHOLD_TITLE || '0.75'),
        content: parseFloat(process.env.DEDUP_THRESHOLD_CONTENT || '0.7'),
        combined: parseFloat(process.env.DEDUP_THRESHOLD_COMBINED || '0.6')
      },
      strategies: {
        urlNormalization: process.env.DEDUP_URL_NORMALIZATION !== 'false',
        titleFuzzy: process.env.DEDUP_TITLE_FUZZY !== 'false',
        contentSimhash: process.env.DEDUP_CONTENT_SIMHASH !== 'false',
        domainClustering: process.env.DEDUP_DOMAIN_CLUSTERING !== 'false'
      }
    }
  },

  // Security Configuration
  security: {
    // SSRF Protection
    ssrfProtection: {
      enabled: process.env.SSRF_PROTECTION_ENABLED !== 'false',
      allowedProtocols: (process.env.ALLOWED_PROTOCOLS || 'http:,https:').split(','),
      maxRequestSize: parseInt(process.env.MAX_REQUEST_SIZE || '104857600'), // 100MB
      maxTimeout: parseInt(process.env.MAX_REQUEST_TIMEOUT || '60000'), // 60s
      maxRedirects: parseInt(process.env.MAX_REDIRECTS || '5'),
      allowedDomains: (process.env.ALLOWED_DOMAINS || '').split(',').filter(d => d.trim()),
      blockedDomains: (process.env.BLOCKED_DOMAINS || 'localhost,127.0.0.1,0.0.0.0,metadata.google.internal,169.254.169.254,metadata.azure.com').split(',')
    },

    // Input Validation
    inputValidation: {
      enabled: process.env.INPUT_VALIDATION_ENABLED !== 'false',
      maxStringLength: parseInt(process.env.MAX_STRING_LENGTH || '10000'),
      maxArrayLength: parseInt(process.env.MAX_ARRAY_LENGTH || '1000'),
      maxObjectDepth: parseInt(process.env.MAX_OBJECT_DEPTH || '10'),
      maxRegexLength: parseInt(process.env.MAX_REGEX_LENGTH || '500'),
      strictMode: process.env.STRICT_VALIDATION_MODE === 'true'
    },

    // API Security
    apiSecurity: {
      requireAuthentication: process.env.REQUIRE_AUTHENTICATION === 'true',
      apiKeyHeader: process.env.API_KEY_HEADER || 'X-API-Key',
      apiKey: process.env.API_KEY || '',
      rateLimitByKey: process.env.RATE_LIMIT_BY_KEY === 'true',
      auditLogging: process.env.AUDIT_LOGGING !== 'false'
    },

    // Content Security
    contentSecurity: {
      sanitizeHTML: process.env.SANITIZE_HTML !== 'false',
      allowedHTMLTags: (process.env.ALLOWED_HTML_TAGS || 'p,br,strong,em,u,h1,h2,h3,h4,h5,h6').split(','),
      blockScripts: process.env.BLOCK_SCRIPTS !== 'false',
      blockIframes: process.env.BLOCK_IFRAMES !== 'false'
    }
  },

  // Monitoring
  monitoring: {
    enableMetrics: process.env.ENABLE_METRICS === 'true',
    logLevel: process.env.LOG_LEVEL || 'info',
    securityLogging: process.env.SECURITY_LOGGING !== 'false',
    violationLogging: process.env.VIOLATION_LOGGING !== 'false'
  },

  // Server
  server: {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000'),
    enableSecurityHeaders: process.env.ENABLE_SECURITY_HEADERS !== 'false'
  },

  // Stealth Mode Configuration
  stealth: {
    // Global stealth settings
    enabled: process.env.STEALTH_MODE_ENABLED === 'true',
    defaultLevel: process.env.STEALTH_LEVEL || 'medium', // 'basic', 'medium', 'advanced'
    
    // Browser fingerprinting
    fingerprinting: {
      randomizeUserAgent: process.env.STEALTH_RANDOMIZE_USER_AGENT !== 'false',
      randomizeViewport: process.env.STEALTH_RANDOMIZE_VIEWPORT !== 'false',
      spoofTimezone: process.env.STEALTH_SPOOF_TIMEZONE !== 'false',
      hideWebDriver: process.env.STEALTH_HIDE_WEBDRIVER !== 'false',
      blockWebRTC: process.env.STEALTH_BLOCK_WEBRTC !== 'false',
      customUserAgent: process.env.STEALTH_CUSTOM_USER_AGENT || null
    },
    
    // Human behavior simulation
    humanBehavior: {
      enabled: process.env.STEALTH_HUMAN_BEHAVIOR_ENABLED !== 'false',
      mouseMovements: process.env.STEALTH_MOUSE_MOVEMENTS !== 'false',
      naturalTyping: process.env.STEALTH_NATURAL_TYPING !== 'false',
      scrollBehavior: process.env.STEALTH_SCROLL_BEHAVIOR !== 'false',
      idlePeriods: process.env.STEALTH_IDLE_PERIODS !== 'false',
      readingSimulation: process.env.STEALTH_READING_SIMULATION !== 'false',
      
      // Timing configurations
      mouseSpeed: process.env.STEALTH_MOUSE_SPEED || 'normal', // 'slow', 'normal', 'fast'
      typingSpeed: process.env.STEALTH_TYPING_SPEED || 'normal', // 'slow', 'normal', 'fast'
      typingVariability: parseFloat(process.env.STEALTH_TYPING_VARIABILITY || '0.3'), // 0.0 to 1.0
      mistakeFrequency: parseFloat(process.env.STEALTH_MISTAKE_FREQUENCY || '0.02'), // 2% mistake rate
      
      // Idle period settings
      idleFrequency: parseFloat(process.env.STEALTH_IDLE_FREQUENCY || '0.1'), // 10% chance
      idleMinDuration: parseInt(process.env.STEALTH_IDLE_MIN_DURATION || '1000'), // 1 second
      idleMaxDuration: parseInt(process.env.STEALTH_IDLE_MAX_DURATION || '5000'), // 5 seconds
      
      // Click behavior
      hoverBeforeClick: process.env.STEALTH_HOVER_BEFORE_CLICK !== 'false',
      clickDelayMin: parseInt(process.env.STEALTH_CLICK_DELAY_MIN || '100'),
      clickDelayMax: parseInt(process.env.STEALTH_CLICK_DELAY_MAX || '300')
    },
    
    // Advanced anti-detection
    antiDetection: {
      bypassHeadlessDetection: process.env.STEALTH_BYPASS_HEADLESS !== 'false',
      spoofPlugins: process.env.STEALTH_SPOOF_PLUGINS !== 'false',
      spoofPermissions: process.env.STEALTH_SPOOF_PERMISSIONS !== 'false',
      mockBattery: process.env.STEALTH_MOCK_BATTERY !== 'false',
      preventCanvasFingerprinting: process.env.STEALTH_PREVENT_CANVAS !== 'false',
      preventWebGLFingerprinting: process.env.STEALTH_PREVENT_WEBGL !== 'false',
      networkEmulation: process.env.STEALTH_NETWORK_EMULATION === 'true'
    },
    
    // Resource optimization for stealth
    resources: {
      blockImages: process.env.STEALTH_BLOCK_IMAGES === 'true',
      blockFonts: process.env.STEALTH_BLOCK_FONTS === 'true',
      blockStylesheets: process.env.STEALTH_BLOCK_CSS === 'true',
      allowTrackingPixels: process.env.STEALTH_ALLOW_TRACKING === 'true', // Allow some tracking to appear normal
      maxConcurrentContexts: parseInt(process.env.STEALTH_MAX_CONTEXTS || '5')
    },
    
    // Geolocation spoofing
    geolocation: {
      enabled: process.env.STEALTH_SPOOF_GEOLOCATION === 'true',
      latitude: parseFloat(process.env.STEALTH_LATITUDE || '40.7128'), // NYC default
      longitude: parseFloat(process.env.STEALTH_LONGITUDE || '-74.0060'),
      accuracy: parseInt(process.env.STEALTH_LOCATION_ACCURACY || '100')
    }
  },

  // Localization Configuration
  localization: {
    // Global localization settings
    enabled: process.env.LOCALIZATION_ENABLED === 'true',
    defaultCountry: process.env.DEFAULT_COUNTRY_CODE || 'US',
    defaultLanguage: process.env.DEFAULT_LANGUAGE || 'en-US',
    
    // Proxy configuration for geo-specific access
    proxy: {
      enabled: process.env.LOCALIZATION_PROXY_ENABLED === 'true',
      rotation: {
        enabled: process.env.PROXY_ROTATION_ENABLED === 'true',
        interval: parseInt(process.env.PROXY_ROTATION_INTERVAL || '300000'), // 5 minutes
        strategy: process.env.PROXY_ROTATION_STRATEGY || 'round-robin'
      },
      healthCheck: {
        enabled: process.env.PROXY_HEALTH_CHECK_ENABLED !== 'false',
        interval: parseInt(process.env.PROXY_HEALTH_CHECK_INTERVAL || '300000'), // 5 minutes
        timeout: parseInt(process.env.PROXY_HEALTH_CHECK_TIMEOUT || '10000')
      },
      fallback: {
        enabled: process.env.PROXY_FALLBACK_ENABLED !== 'false',
        maxRetries: parseInt(process.env.PROXY_MAX_RETRIES || '3'),
        timeout: parseInt(process.env.PROXY_TIMEOUT || '10000')
      }
    },
    
    // Translation services
    translation: {
      enabled: process.env.TRANSLATION_ENABLED === 'true',
      defaultProvider: process.env.TRANSLATION_PROVIDER || 'google',
      autoDetect: process.env.TRANSLATION_AUTO_DETECT !== 'false',
      preserveFormatting: process.env.TRANSLATION_PRESERVE_FORMAT !== 'false',
      cacheEnabled: process.env.TRANSLATION_CACHE_ENABLED !== 'false',
      cacheTTL: parseInt(process.env.TRANSLATION_CACHE_TTL || '86400000') // 24 hours
    },
    
    // Geo-blocking bypass
    geoBlocking: {
      autoBypass: process.env.GEO_BLOCKING_AUTO_BYPASS === 'true',
      maxRetries: parseInt(process.env.GEO_BLOCKING_MAX_RETRIES || '3'),
      retryDelay: parseInt(process.env.GEO_BLOCKING_RETRY_DELAY || '2000'),
      fallbackCountries: (process.env.GEO_BLOCKING_FALLBACK_COUNTRIES || 'US,GB,DE,CA').split(','),
      detectionSensitivity: process.env.GEO_BLOCKING_DETECTION_SENSITIVITY || 'medium'
    },
    
    // Cultural browsing simulation
    cultural: {
      enabled: process.env.CULTURAL_SIMULATION_ENABLED === 'true',
      adaptBehavior: process.env.CULTURAL_ADAPT_BEHAVIOR !== 'false',
      adaptTiming: process.env.CULTURAL_ADAPT_TIMING !== 'false',
      respectRTL: process.env.CULTURAL_RESPECT_RTL !== 'false'
    },
    
    // DNS configuration
    dns: {
      enabled: process.env.LOCALIZATION_DNS_ENABLED === 'true',
      overHttps: process.env.DNS_OVER_HTTPS === 'true',
      customResolvers: process.env.CUSTOM_DNS_RESOLVERS ? 
        JSON.parse(process.env.CUSTOM_DNS_RESOLVERS) : {},
      preferredCountry: process.env.DNS_PREFERRED_COUNTRY || null
    }
  }
};

// Validate required configuration
export function validateConfig() {
  const errors = [];

  // Validate numeric ranges
  if (config.crawling.maxDepth > 10) {
    errors.push('MAX_CRAWL_DEPTH should not exceed 10 for performance reasons');
  }

  if (config.crawling.maxPages > 10000) {
    errors.push('MAX_PAGES_PER_CRAWL should not exceed 10000 for memory reasons');
  }

  if (config.performance.queueConcurrency > 50) {
    errors.push('QUEUE_CONCURRENCY should not exceed 50 to avoid overwhelming servers');
  }

  // Validate localization configuration
  const localizationErrors = validateLocalizationConfig();
  errors.push(...localizationErrors);

  return errors;
}

// Get configuration for a specific tool
export function getToolConfig(toolName) {
  const toolConfigs = {
    search_web: {
      apiKey: config.crawlforge.apiKey,
      apiBaseUrl: config.crawlforge.apiBaseUrl,
      
      // Common configuration
      cacheEnabled: config.performance.cacheEnableDisk,
      cacheTTL: config.performance.cacheTTL,
      rankingOptions: {
        weights: config.searchProcessing.ranking.weights,
        bm25: config.searchProcessing.ranking.bm25,
        cacheEnabled: config.performance.cacheEnableDisk,
        cacheTTL: config.performance.cacheTTL
      },
      deduplicationOptions: {
        thresholds: config.searchProcessing.deduplication.thresholds,
        strategies: config.searchProcessing.deduplication.strategies,
        cacheEnabled: config.performance.cacheEnableDisk,
        cacheTTL: config.performance.cacheTTL
      }
    },
    crawl_deep: {
      maxDepth: config.crawling.maxDepth,
      maxPages: config.crawling.maxPages,
      respectRobots: config.crawling.respectRobots,
      userAgent: config.crawling.userAgent,
      timeout: config.crawling.timeout,
      followExternal: config.crawling.followExternal,
      concurrency: config.performance.queueConcurrency
    },
    map_site: {
      userAgent: config.crawling.userAgent,
      timeout: config.crawling.timeout
    },
    process_document: {
      stealthMode: config.stealth.enabled ? {
        enabled: true,
        level: config.stealth.defaultLevel,
        randomizeFingerprint: config.stealth.fingerprinting.randomizeUserAgent,
        hideWebDriver: config.stealth.fingerprinting.hideWebDriver,
        blockWebRTC: config.stealth.fingerprinting.blockWebRTC
      } : { enabled: false }
    },
    scrape_with_actions: {
      stealthMode: config.stealth.enabled ? {
        enabled: true,
        level: config.stealth.defaultLevel,
        randomizeFingerprint: config.stealth.fingerprinting.randomizeUserAgent,
        simulateHumanBehavior: config.stealth.humanBehavior.enabled,
        customUserAgent: config.stealth.fingerprinting.customUserAgent,
        hideWebDriver: config.stealth.fingerprinting.hideWebDriver,
        blockWebRTC: config.stealth.fingerprinting.blockWebRTC
      } : { enabled: false },
      humanBehavior: config.stealth.humanBehavior.enabled ? {
        enabled: true,
        mouseMovements: config.stealth.humanBehavior.mouseMovements,
        typingVariation: config.stealth.humanBehavior.naturalTyping,
        scrollBehavior: config.stealth.humanBehavior.scrollBehavior,
        idlePeriods: config.stealth.humanBehavior.idlePeriods,
        readingTime: config.stealth.humanBehavior.readingSimulation
      } : { enabled: false }
    }
  };

  return toolConfigs[toolName] || {};
}

// Get stealth configuration for specific level
export function getStealthConfig(level = 'medium') {
  const baseConfig = {
    enabled: true,
    level,
    randomizeFingerprint: config.stealth.fingerprinting.randomizeUserAgent,
    hideWebDriver: config.stealth.fingerprinting.hideWebDriver,
    blockWebRTC: config.stealth.fingerprinting.blockWebRTC,
    customUserAgent: config.stealth.fingerprinting.customUserAgent
  };

  // Adjust settings based on level
  switch (level) {
    case 'basic':
      return {
        ...baseConfig,
        randomizeFingerprint: false,
        blockWebRTC: true,
        hideWebDriver: true
      };
    case 'advanced':
      return {
        ...baseConfig,
        randomizeFingerprint: true,
        blockWebRTC: true,
        hideWebDriver: true,
        spoofTimezone: config.stealth.fingerprinting.spoofTimezone,
        preventCanvasFingerprinting: config.stealth.antiDetection.preventCanvasFingerprinting,
        preventWebGLFingerprinting: config.stealth.antiDetection.preventWebGLFingerprinting,
        networkEmulation: config.stealth.antiDetection.networkEmulation
      };
    case 'medium':
    default:
      return baseConfig;
  }
}

// Get human behavior configuration for specific level
export function getHumanBehaviorConfig(level = 'medium') {
  const baseConfig = {
    enabled: config.stealth.humanBehavior.enabled,
    mouseMovements: config.stealth.humanBehavior.mouseMovements,
    typingVariation: config.stealth.humanBehavior.naturalTyping,
    scrollBehavior: config.stealth.humanBehavior.scrollBehavior,
    idlePeriods: config.stealth.humanBehavior.idlePeriods,
    readingTime: config.stealth.humanBehavior.readingSimulation
  };

  // Adjust behavior complexity based on level
  switch (level) {
    case 'basic':
      return {
        ...baseConfig,
        mouseMovements: false,
        typingVariation: false,
        idlePeriods: false
      };
    case 'advanced':
      return {
        ...baseConfig,
        mouseMovements: true,
        typingVariation: true,
        scrollBehavior: true,
        idlePeriods: true,
        readingTime: true
      };
    case 'medium':
    default:
      return baseConfig;
  }
}

// Check if stealth mode is properly configured
export function isStealthConfigured() {
  return config.stealth.enabled && (
    config.stealth.fingerprinting.randomizeUserAgent ||
    config.stealth.fingerprinting.hideWebDriver ||
    config.stealth.humanBehavior.enabled
  );
}

// Get localization configuration
export function getLocalizationConfig() {
  return config.localization;
}

// Check if localization is enabled and properly configured
export function isLocalizationConfigured() {
  return config.localization.enabled && (
    config.localization.proxy.enabled ||
    config.localization.translation.enabled ||
    config.localization.geoBlocking.autoBypass
  );
}

// Get proxy configuration for localization
export function getProxyConfig() {
  return config.localization.proxy;
}

// Get translation configuration
export function getTranslationConfig() {
  return config.localization.translation;
}

// Get geo-blocking bypass configuration
export function getGeoBlockingConfig() {
  return config.localization.geoBlocking;
}

// Get cultural simulation configuration
export function getCulturalConfig() {
  return config.localization.cultural;
}

// Validate localization configuration
export function validateLocalizationConfig() {
  const errors = [];
  const localizationConfig = config.localization;
  
  if (localizationConfig.enabled) {
    // Validate country code
    if (!localizationConfig.defaultCountry || localizationConfig.defaultCountry.length !== 2) {
      errors.push('DEFAULT_COUNTRY_CODE must be a valid 2-letter country code');
    }
    
    // Validate language code
    if (!localizationConfig.defaultLanguage || !localizationConfig.defaultLanguage.includes('-')) {
      errors.push('DEFAULT_LANGUAGE must be in format language-country (e.g., en-US)');
    }
    
    // Validate proxy configuration
    if (localizationConfig.proxy.enabled) {
      if (localizationConfig.proxy.rotation.interval < 60000) {
        errors.push('PROXY_ROTATION_INTERVAL should be at least 60000ms (1 minute)');
      }
      
      if (localizationConfig.proxy.healthCheck.interval < 60000) {
        errors.push('PROXY_HEALTH_CHECK_INTERVAL should be at least 60000ms (1 minute)');
      }
    }
    
    // Validate translation configuration
    if (localizationConfig.translation.enabled) {
      const validProviders = ['google', 'azure', 'libre'];
      if (!validProviders.includes(localizationConfig.translation.defaultProvider)) {
        const providersString = validProviders.join(', ');
        errors.push('TRANSLATION_PROVIDER must be one of: ' + providersString);
      }
    }
    
    // Validate geo-blocking configuration
    if (localizationConfig.geoBlocking.autoBypass) {
      if (localizationConfig.geoBlocking.maxRetries > 10) {
        errors.push('GEO_BLOCKING_MAX_RETRIES should not exceed 10');
      }
      
      if (localizationConfig.geoBlocking.retryDelay < 1000) {
        errors.push('GEO_BLOCKING_RETRY_DELAY should be at least 1000ms');
      }
    }
  }
  
  return errors;
}

export default config;
