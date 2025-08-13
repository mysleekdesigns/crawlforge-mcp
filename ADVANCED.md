# MCP WebScraper Advanced Technical Guide

This document provides comprehensive technical documentation for advanced users and contributors to the MCP WebScraper project. It consolidates architecture, performance, security, monitoring, and search ranking system details.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Performance Optimization](#performance-optimization)
3. [Security Implementation](#security-implementation)
4. [Monitoring and Observability](#monitoring-and-observability)
5. [Search Ranking System](#search-ranking-system)
6. [Development Guidelines](#development-guidelines)

## Architecture Overview

### System Architecture

The MCP WebScraper follows a modular architecture with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                         MCP Server                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   Tool Manager                       │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │   │
│  │  │  Search  │ │  Crawl   │ │    Extract       │   │   │
│  │  │   Tools  │ │  Tools   │ │    Tools         │   │   │
│  │  └──────────┘ └──────────┘ └──────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                Processing Engine                     │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │   │
│  │  │  Queue   │ │  Worker  │ │    Content       │   │   │
│  │  │  Manager │ │   Pool   │ │    Processor     │   │   │
│  │  └──────────┘ └──────────┘ └──────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  Storage Layer                       │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │   │
│  │  │  Cache   │ │   URL    │ │    Content       │   │   │
│  │  │  Manager │ │  Store   │ │    Database      │   │   │
│  │  └──────────┘ └──────────┘ └──────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Core Infrastructure

#### QueueManager (`src/core/QueueManager.js`)
- Manages concurrent operations using p-queue
- Handles job scheduling and worker pool management
- FIFO queue with priority support for URL management

#### CacheManager (`src/core/CacheManager.js`)
- Two-tier caching system (LRU memory + disk persistence)
- Multi-level caching for optimal performance
- Configurable TTL and cache strategies

```javascript
class CacheManager {
  constructor() {
    this.memoryCache = new LRUCache({ max: 1000 });
    this.diskCache = new DiskCache('./cache');
    this.cacheStats = { hits: 0, misses: 0 };
  }
  
  async get(key) {
    // L1: Memory cache
    if (this.memoryCache.has(key)) {
      this.cacheStats.hits++;
      return this.memoryCache.get(key);
    }
    
    // L2: Disk cache
    const diskData = await this.diskCache.get(key);
    if (diskData) {
      this.cacheStats.hits++;
      this.memoryCache.set(key, diskData);
      return diskData;
    }
    
    this.cacheStats.misses++;
    return null;
  }
}
```

#### BFSCrawler (`src/core/BFSCrawler.js`)
- Breadth-first search crawler with depth control
- URL tracking and domain filtering
- Supports crawling up to 5 levels deep

```javascript
class BFSCrawler {
  constructor(maxDepth = 5) {
    this.queue = [];
    this.visited = new Set();
    this.maxDepth = maxDepth;
  }
  
  async crawl(startUrl) {
    this.queue.push({ url: startUrl, depth: 0 });
    
    while (this.queue.length > 0) {
      const { url, depth } = this.queue.shift();
      
      if (depth > this.maxDepth || this.visited.has(url)) {
        continue;
      }
      
      this.visited.add(url);
      const content = await this.fetchAndProcess(url);
      
      if (depth < this.maxDepth) {
        const links = this.extractLinks(content);
        links.forEach(link => {
          this.queue.push({ url: link, depth: depth + 1 });
        });
      }
    }
  }
}
```

### Tool Architecture

The system provides 12 comprehensive tools organized in three categories:

**Basic Scraping Tools:**
- `fetch_url` - Fetch content with headers and timeout support
- `extract_text` - Extract clean text from HTML
- `extract_links` - Extract and filter links
- `extract_metadata` - Extract page metadata (Open Graph, Twitter Cards, etc.)
- `scrape_structured` - Extract data using CSS selectors

**Search & Crawling Tools:**
- `search_web` - Web search with multiple provider support
- `crawl_deep` - BFS crawling up to 5 levels deep
- `map_site` - Discover website structure with sitemap support

**Advanced Content Processing:**
- `extract_content` - Enhanced content extraction with readability detection
- `process_document` - Multi-format document processing (PDFs, web pages)
- `summarize_content` - Intelligent text summarization
- `analyze_content` - Comprehensive content analysis

## Performance Optimization

### Multi-Threading Architecture

#### WorkerPool (`src/core/workers/WorkerPool.js`)
- Multi-threaded processing using Node.js worker_threads
- CPU-intensive task optimization (8x faster for HTML parsing)
- Automatic worker lifecycle management with retry mechanisms

```javascript
const workerPool = new WorkerPool({
  maxWorkers: 8,
  taskTimeout: 30000
});

const result = await workerPool.execute('parseHtml', {
  html: htmlContent,
  options: { extractText: true, extractLinks: true }
});
```

**Supported Task Types:**
- `parseHtml` - HTML parsing and structure extraction
- `extractContent` - Content extraction using Mozilla Readability
- `analyzeText` - Text analysis including NLP features
- `processStructuredData` - Structured data extraction

#### ConnectionPool (`src/core/connections/ConnectionPool.js`)
- HTTP connection pooling with backpressure handling
- 50% faster for network operations
- Intelligent request management and optimization

```javascript
const connectionPool = new ConnectionPool({
  maxSockets: 50,
  maxFreeSockets: 10,
  keepAlive: true,
  backpressureThreshold: 0.8
});
```

#### StreamProcessor (`src/core/processing/StreamProcessor.js`)
- Memory-efficient streaming for large datasets (90% less memory usage)
- Automatic memory pressure detection
- LRU-based page eviction for large datasets

### Performance Benchmarks

| Operation | Before | After | Improvement |
|-----------|--------|--------|-------------|
| HTML Parsing (large) | 2000ms | 250ms | 8x faster |
| Concurrent Requests | 5000ms | 2500ms | 2x faster |
| Large Dataset Processing | 512MB memory | 50MB memory | 90% less |
| Mixed Workloads | 15000ms | 8000ms | 1.9x faster |

### Rate Limiting

```javascript
class RateLimiter {
  constructor() {
    this.limits = new Map();
    this.defaultLimit = { requests: 10, window: 1000 }; // 10 req/sec
  }
  
  async checkLimit(domain) {
    const now = Date.now();
    const limit = this.limits.get(domain) || { 
      count: 0, 
      resetTime: now + this.defaultLimit.window 
    };
    
    if (now > limit.resetTime) {
      limit.count = 0;
      limit.resetTime = now + this.defaultLimit.window;
    }
    
    if (limit.count >= this.defaultLimit.requests) {
      const waitTime = limit.resetTime - now;
      await this.delay(waitTime);
      return this.checkLimit(domain);
    }
    
    limit.count++;
    this.limits.set(domain, limit);
    return true;
  }
}
```

## Security Implementation

### SSRF Protection (`src/utils/ssrfProtection.js`)

Comprehensive protection against Server-Side Request Forgery attacks:

**Features:**
- Validates URLs against private IP ranges
- Blocks dangerous protocols (file://, ftp://, etc.)
- Prevents access to cloud metadata services
- Validates DNS resolution and handles redirects securely

```javascript
const ssrfProtection = new SSRFProtection({
  allowedProtocols: ['http:', 'https:'],
  maxRequestSize: 100 * 1024 * 1024, // 100MB
  maxTimeout: 60000, // 60 seconds
  maxRedirects: 5
});
```

### Input Validation (`src/utils/inputValidation.js`)

Comprehensive input validation to prevent injection attacks:

**Features:**
- SQL injection detection and prevention
- XSS pattern detection and sanitization
- Command injection prevention
- CSS selector validation
- Regular expression validation (ReDoS protection)

```javascript
const validator = new InputValidator();
const result = validator.validateSearchQuery(userInput);
if (!result.isValid) {
  throw new Error('Invalid input detected');
}
```

### Security Middleware Integration

```javascript
// Validate tool parameters before execution
server.tool("fetch_url", "Fetch content from a URL", schema, async (request) => {
  const validation = await securityMiddleware.validateToolParameters(
    request.params, 
    'fetch_url'
  );
  
  if (!validation.isValid) {
    throw new Error(`Security validation failed: ${validation.violations.map(v => v.message).join(', ')}`);
  }
  
  const params = validation.sanitizedParams;
  // ... rest of tool implementation
});
```

### Security Configuration

**Production Environment:**
```bash
NODE_ENV=production
SSRF_PROTECTION_ENABLED=true
INPUT_VALIDATION_ENABLED=true
STRICT_VALIDATION_MODE=true
REQUIRE_AUTHENTICATION=true
SECURITY_LOGGING=true
RATE_LIMIT_REQUESTS_PER_SECOND=2
RATE_LIMIT_REQUESTS_PER_MINUTE=20
```

### OWASP Top 10 Coverage

- ✅ **Injection** - Input validation and sanitization
- ✅ **Broken Authentication** - API key validation
- ✅ **Sensitive Data Exposure** - Secure configuration
- ✅ **XML External Entities (XXE)** - Input validation
- ✅ **Broken Access Control** - Authorization checks
- ✅ **Security Misconfiguration** - Secure defaults
- ✅ **Cross-Site Scripting (XSS)** - HTML sanitization
- ✅ **Insecure Deserialization** - Object validation
- ✅ **Using Components with Known Vulnerabilities** - Dependency scanning
- ✅ **Insufficient Logging & Monitoring** - Security event logging

## Monitoring and Observability

### Health Check System (`src/monitoring/healthCheck.js`)

Comprehensive health monitoring with dependency checks:

```javascript
const healthCheck = new HealthCheckManager({
  checkInterval: 30000,        // 30 seconds
  timeout: 5000,              // 5 seconds
  memoryThreshold: 512 * 1024 * 1024,  // 512MB
  cpuThreshold: 90,            // 90%
  responseTimeThreshold: 2000  // 2 seconds
});
```

**Built-in Health Checks:**
- **System Resources**: Memory, CPU, disk space monitoring
- **Application Health**: Cache, queue, worker pool status
- **External Dependencies**: Search APIs, network connectivity

### Metrics Collection (`src/monitoring/metrics.js`)

Comprehensive performance and usage analytics:

```javascript
const metrics = new MetricsCollector({
  collectInterval: 10000,      // 10 seconds
  exportInterval: 60000,       // 1 minute
  exportPath: './cache/metrics',
  enableFileExport: true,
  enableRealtimeMetrics: true
});

// Record tool executions
metrics.recordToolExecution('search_web', responseTime, isError, {
  errorType: error?.name,
  queryLength: query.length,
  resultCount: results.length
});
```

**Available Metrics:**
- **System Metrics**: Total requests, errors, response times, memory/CPU usage
- **Tool-Specific Metrics**: Call counts, success rates, response times per tool
- **Cache Performance**: Hit/miss rates, response times, memory usage
- **Performance Components**: Worker pool, connection pool, queue statistics

### Dashboard Integration

**Grafana Configuration:**
```json
{
  "title": "MCP WebScraper Overview",
  "panels": [
    {
      "title": "Requests per Second",
      "type": "graph",
      "targets": [
        {
          "expr": "rate(mcp_requests_total[5m])",
          "legendFormat": "Requests/sec"
        }
      ]
    },
    {
      "title": "Error Rate",
      "type": "singlestat",
      "targets": [
        {
          "expr": "rate(mcp_errors_total[5m]) / rate(mcp_requests_total[5m]) * 100",
          "legendFormat": "Error %"
        }
      ]
    }
  ]
}
```

**Health Check Endpoints:**
```javascript
// Simple health endpoint
app.get('/health', (req, res) => {
  const status = healthCheck.getHealthStatus();
  const httpStatus = status.overall === 'healthy' ? 200 : 503;
  res.status(httpStatus).json(status);
});

// Detailed health endpoint
app.get('/health/detailed', (req, res) => {
  const status = healthCheck.getHealthStatus();
  res.json(status);
});
```

## Search Ranking System

### Architecture

```
searchWeb.js
    ├── ResultRanker (ranking/ResultRanker.js)
    │   ├── BM25 Algorithm
    │   ├── Semantic Similarity
    │   ├── Domain Authority Scoring
    │   └── Content Freshness Scoring
    └── ResultDeduplicator (ranking/ResultDeduplicator.js)
        ├── URL Normalization
        ├── Title Fuzzy Matching
        ├── Content SimHash
        └── Duplicate Merging
```

### Ranking Components

#### 1. BM25 Algorithm (Default Weight: 40%)
- Full BM25 formula with configurable k1 and b parameters
- Term frequency analysis and inverse document frequency calculation
- Document length normalization and query term matching

#### 2. Semantic Similarity (Default Weight: 30%)
- Cosine similarity with term vectors
- Phrase matching bonuses and content context analysis
- Query-content semantic alignment

#### 3. Domain Authority (Default Weight: 20%)
- Multi-factor authority calculation
- Pre-configured domain authority map
- HTTPS preference and URL structure analysis
- Educational/government domain bonuses

#### 4. Content Freshness (Default Weight: 10%)
- Exponential decay model for temporal relevance
- Multi-source date extraction
- Configurable decay rates and maximum age thresholds

### Deduplication System

**Strategies:**
- **URL Normalization**: Protocol removal, query parameter sorting
- **Content-Based Detection**: SimHash algorithm with 64-bit fingerprinting
- **Title Fuzzy Matching**: Jaccard similarity and edit distance
- **Smart Merging**: Best ranking result preservation with metadata combination

```javascript
const deduplicationOptions = {
  thresholds: {
    url: 0.8,            // URL similarity threshold
    title: 0.75,         // Title similarity threshold
    content: 0.7,        // Content similarity threshold
    combined: 0.6        // Combined decision threshold
  },
  strategies: {
    urlNormalization: true,
    titleFuzzy: true,
    contentSimhash: true,
    domainClustering: true
  }
};
```

### Performance Benefits

- **Relevance**: 35-50% improvement in result relevance
- **Diversity**: Reduced redundancy through intelligent deduplication
- **Authority**: Higher trust through domain credibility assessment
- **Efficiency**: Cached computations reduce latency

## Development Guidelines

### Error Handling Strategy

```javascript
class RetryManager {
  constructor() {
    this.maxRetries = 3;
    this.backoffMultiplier = 2;
    this.initialDelay = 1000;
  }
  
  async executeWithRetry(fn, context) {
    let lastError;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        if (attempt < this.maxRetries && this.isRetryable(error)) {
          const delay = this.initialDelay * Math.pow(this.backoffMultiplier, attempt);
          await this.delay(delay);
          continue;
        }
        
        break;
      }
    }
    
    throw lastError;
  }
  
  isRetryable(error) {
    const retryableCodes = [429, 502, 503, 504];
    return error.status && retryableCodes.includes(error.status);
  }
}
```

### Circuit Breaker Pattern

```javascript
class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.failureCount = 0;
    this.threshold = threshold;
    this.timeout = timeout;
    this.state = 'CLOSED';
    this.nextAttempt = Date.now();
  }
  
  async execute(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = 'HALF_OPEN';
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
}
```

### robots.txt Compliance

```javascript
class RobotsChecker {
  constructor() {
    this.robotsCache = new Map();
  }
  
  async canFetch(url, userAgent = 'MCP-WebScraper/1.0') {
    const urlObj = new URL(url);
    const robotsUrl = `${urlObj.protocol}//${urlObj.host}/robots.txt`;
    
    let robots = this.robotsCache.get(robotsUrl);
    if (!robots) {
      robots = await this.fetchRobotsTxt(robotsUrl);
      this.robotsCache.set(robotsUrl, robots);
    }
    
    return this.isAllowed(robots, urlObj.pathname, userAgent);
  }
}
```

### Configuration Management

Critical environment variables for development and production:

```bash
# Search Provider Configuration
SEARCH_PROVIDER=auto
GOOGLE_API_KEY=your_key
GOOGLE_SEARCH_ENGINE_ID=your_id

# Performance Settings
MAX_WORKERS=10
QUEUE_CONCURRENCY=10
CACHE_TTL=3600000
RATE_LIMIT_REQUESTS_PER_SECOND=10

# Crawling Limits
MAX_CRAWL_DEPTH=5
MAX_PAGES_PER_CRAWL=100
RESPECT_ROBOTS_TXT=true

# Security Settings
SSRF_PROTECTION_ENABLED=true
INPUT_VALIDATION_ENABLED=true
REQUIRE_AUTHENTICATION=true

# Monitoring Configuration
MONITORING_ENABLED=true
HEALTH_CHECK_INTERVAL=30000
METRICS_EXPORT_INTERVAL=60000
```

### Testing Strategy

- **Unit Tests**: Core components in `tests/unit/`
- **Performance Tests**: Load and memory testing in `tests/performance/`
- **Integration Tests**: End-to-end scenarios in `tests/integration/`
- **Security Tests**: Comprehensive security test suite

**Run Tests:**
```bash
npm test                           # Protocol compliance
npm run test:performance          # Full performance suite
npm run test:performance:quick    # Quick performance tests
npm run test:security            # Security test suite
```

### Key Performance Indicators

- **Response Time**: Target < 2s for search operations
- **Throughput**: Target 100+ URLs in 30 seconds
- **Cache Hit Rate**: Target > 80%
- **Memory Usage**: Target < 512MB under normal load
- **Error Rate**: Target < 1%

This advanced guide provides the technical foundation needed to understand, extend, and maintain the MCP WebScraper system. For specific implementation details, refer to the individual component files and test suites.