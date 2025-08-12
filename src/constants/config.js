import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env'), quiet: true });

export const config = {
  // Google Search API
  google: {
    apiKey: process.env.GOOGLE_API_KEY || '',
    searchEngineId: process.env.GOOGLE_SEARCH_ENGINE_ID || ''
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

  // Check if Google API credentials are provided for production
  if (config.server.nodeEnv === 'production') {
    if (!config.google.apiKey) {
      errors.push('GOOGLE_API_KEY is required in production');
    }
    if (!config.google.searchEngineId) {
      errors.push('GOOGLE_SEARCH_ENGINE_ID is required in production');
    }
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
  return !!(config.google.apiKey && config.google.searchEngineId);
}

// Get configuration for a specific tool
export function getToolConfig(toolName) {
  const toolConfigs = {
    search_web: {
      apiKey: config.google.apiKey,
      searchEngineId: config.google.searchEngineId,
      cacheEnabled: config.performance.cacheEnableDisk,
      cacheTTL: config.performance.cacheTTL
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