import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env'), quiet: true });

export const config = {
  // Search Provider Configuration
  search: {
    provider: process.env.SEARCH_PROVIDER || 'auto', // 'google', 'duckduckgo', or 'auto'
    
    // Google Search API
    google: {
      apiKey: process.env.GOOGLE_API_KEY || '',
      searchEngineId: process.env.GOOGLE_SEARCH_ENGINE_ID || ''
    },
    
    // DuckDuckGo Configuration
    duckduckgo: {
      timeout: parseInt(process.env.DUCKDUCKGO_TIMEOUT || '30000'),
      maxRetries: parseInt(process.env.DUCKDUCKGO_MAX_RETRIES || '3'),
      retryDelay: parseInt(process.env.DUCKDUCKGO_RETRY_DELAY || '1000'),
      userAgent: process.env.DUCKDUCKGO_USER_AGENT || process.env.USER_AGENT || 'MCP-WebScraper/1.0'
    }
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
    userAgent: process.env.USER_AGENT || 'MCP-WebScraper/1.0',
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

  // Monitoring
  monitoring: {
    enableMetrics: process.env.ENABLE_METRICS === 'true',
    logLevel: process.env.LOG_LEVEL || 'info'
  },

  // Server
  server: {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000')
  }
};

// Validate required configuration
export function validateConfig() {
  const errors = [];

  // Check search provider configuration
  const provider = getActiveSearchProvider();
  
  if (config.server.nodeEnv === 'production') {
    if (provider === 'google') {
      if (!config.search.google.apiKey) {
        errors.push('GOOGLE_API_KEY is required when using Google search provider in production');
      }
      if (!config.search.google.searchEngineId) {
        errors.push('GOOGLE_SEARCH_ENGINE_ID is required when using Google search provider in production');
      }
    }
    
    if (!isSearchConfigured()) {
      errors.push('Search provider is not properly configured');
    }
  }
  
  // Validate search provider setting
  const validProviders = ['google', 'duckduckgo', 'auto'];
  if (!validProviders.includes(config.search.provider.toLowerCase())) {
    errors.push(`Invalid SEARCH_PROVIDER value. Must be one of: ${validProviders.join(', ')}`);
  }

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

  return errors;
}

// Check if search is properly configured
export function isSearchConfigured() {
  const provider = getActiveSearchProvider();
  
  switch (provider) {
    case 'google':
      return !!(config.search.google.apiKey && config.search.google.searchEngineId);
    case 'duckduckgo':
      return true; // DuckDuckGo doesn't require API credentials
    default:
      return false;
  }
}

// Get the active search provider based on configuration and availability
export function getActiveSearchProvider() {
  const configuredProvider = config.search.provider.toLowerCase();
  
  switch (configuredProvider) {
    case 'google':
      return 'google';
    case 'duckduckgo':
      return 'duckduckgo';
    case 'auto':
    default:
      // Auto mode: prefer Google if credentials available, otherwise use DuckDuckGo
      if (config.search.google.apiKey && config.search.google.searchEngineId) {
        return 'google';
      }
      return 'duckduckgo';
  }
}

// Get configuration for a specific tool
export function getToolConfig(toolName) {
  const provider = getActiveSearchProvider();
  
  const toolConfigs = {
    search_web: {
      provider: provider,
      
      // Google-specific configuration
      google: {
        apiKey: config.search.google.apiKey,
        searchEngineId: config.search.google.searchEngineId
      },
      
      // DuckDuckGo-specific configuration
      duckduckgo: {
        timeout: config.search.duckduckgo.timeout,
        maxRetries: config.search.duckduckgo.maxRetries,
        retryDelay: config.search.duckduckgo.retryDelay,
        userAgent: config.search.duckduckgo.userAgent
      },
      
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
    }
  };

  return toolConfigs[toolName] || {};
}

export default config;