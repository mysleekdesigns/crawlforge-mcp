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

  // Search ranking and deduplication
  search: {
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
      cacheTTL: config.performance.cacheTTL,
      rankingOptions: {
        weights: config.search.ranking.weights,
        bm25: config.search.ranking.bm25,
        cacheEnabled: config.performance.cacheEnableDisk,
        cacheTTL: config.performance.cacheTTL
      },
      deduplicationOptions: {
        thresholds: config.search.deduplication.thresholds,
        strategies: config.search.deduplication.strategies,
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