# MCP WebScraper Enhanced Architecture

## Overview

This document outlines the enhanced architecture for transforming the MCP WebScraper into a powerful Firecrawl-like search and crawling engine capable of searching the web up to 5 pages deep and returning relevant information based on queries.

## System Architecture

### Core Components

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
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                Processing Engine                     │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │   │
│  │  │  Queue   │ │  Worker  │ │    Content       │   │   │
│  │  │  Manager │ │   Pool   │ │    Processor     │   │   │
│  │  └──────────┘ └──────────┘ └──────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  Storage Layer                       │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │   │
│  │  │  Cache   │ │   URL    │ │    Content       │   │   │
│  │  │  Manager │ │  Store   │ │    Database      │   │   │
│  │  └──────────┘ └──────────┘ └──────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Component Descriptions

#### 1. Tool Manager
Manages all MCP tools and routes requests to appropriate handlers.

**New Tools:**
- `search_web`: Web search integration
- `crawl_deep`: Recursive crawling with depth control
- `map_site`: Site structure discovery
- `extract_content`: Enhanced content extraction
- `rank_results`: Result ranking and filtering
- `analyze_links`: Link relationship analysis
- `summarize_content`: Content summarization
- `detect_changes`: Page change monitoring
- `export_data`: Multi-format data export
- `manage_cache`: Cache control and management

#### 2. Processing Engine
Handles concurrent operations and manages resource allocation.

**Components:**
- **Queue Manager**: FIFO queue with priority support for URL management
- **Worker Pool**: Concurrent workers for parallel processing
- **Content Processor**: Text extraction, HTML parsing, and content analysis

#### 3. Storage Layer
Manages data persistence and caching.

**Components:**
- **Cache Manager**: Multi-level caching (memory + disk)
- **URL Store**: Visited URL tracking and deduplication
- **Content Database**: Structured storage for crawled content

## Data Flow

### Search Flow
```
User Query
    ↓
search_web Tool
    ↓
Search API Integration
    ├── Google Custom Search API
    └── Bing Search API (until Aug 2025)
    ↓
Result Collection
    ↓
Content Extraction
    ↓
Ranking Algorithm (BM25 + Semantic)
    ↓
Formatted Response
```

### Crawl Flow
```
Initial URL
    ↓
crawl_deep Tool
    ↓
URL Queue (BFS Algorithm)
    ↓
Worker Assignment
    ↓
Page Fetch
    ├── Check robots.txt
    ├── Rate limiting
    └── Cache check
    ↓
Content Processing
    ├── HTML parsing
    ├── Link extraction
    └── Content extraction
    ↓
Depth Check (max 5)
    ├── Yes → Add links to queue
    └── No → Stop branch
    ↓
Result Aggregation
```

## Algorithm Implementations

### 1. Breadth-First Search (BFS) Crawling
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

### 2. Content Ranking (BM25 + Semantic)
```javascript
class ContentRanker {
  constructor() {
    this.bm25 = new BM25();
    this.semanticAnalyzer = new SemanticAnalyzer();
  }
  
  rank(query, documents) {
    // Initial BM25 ranking
    const bm25Scores = documents.map(doc => ({
      doc,
      score: this.bm25.score(query, doc)
    }));
    
    // Get top N candidates
    const topCandidates = bm25Scores
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);
    
    // Semantic re-ranking
    const semanticScores = topCandidates.map(item => ({
      ...item,
      semanticScore: this.semanticAnalyzer.score(query, item.doc)
    }));
    
    // Combine scores
    return semanticScores
      .map(item => ({
        ...item,
        finalScore: item.score * 0.4 + item.semanticScore * 0.6
      }))
      .sort((a, b) => b.finalScore - a.finalScore);
  }
}
```

## Performance Optimizations

### 1. Parallel Processing
- **Worker Pool Size**: Dynamic based on system resources (default: 10 workers)
- **Connection Pooling**: Reuse HTTP connections
- **Stream Processing**: Process large documents in chunks

### 2. Caching Strategy
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
  
  async set(key, value, ttl = 3600) {
    this.memoryCache.set(key, value);
    await this.diskCache.set(key, value, ttl);
  }
}
```

### 3. Rate Limiting
```javascript
class RateLimiter {
  constructor() {
    this.limits = new Map(); // domain -> { count, resetTime }
    this.defaultLimit = { requests: 10, window: 1000 }; // 10 req/sec
  }
  
  async checkLimit(domain) {
    const now = Date.now();
    const limit = this.limits.get(domain) || { count: 0, resetTime: now + this.defaultLimit.window };
    
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

## Tool Schemas

### search_web
```javascript
const SearchWebSchema = z.object({
  query: z.string().min(1),
  limit: z.number().min(1).max(100).optional().default(10),
  offset: z.number().min(0).optional().default(0),
  lang: z.string().optional().default('en'),
  safe_search: z.boolean().optional().default(true),
  time_range: z.enum(['day', 'week', 'month', 'year', 'all']).optional().default('all')
});
```

### crawl_deep
```javascript
const CrawlDeepSchema = z.object({
  url: z.string().url(),
  max_depth: z.number().min(1).max(5).optional().default(3),
  max_pages: z.number().min(1).max(1000).optional().default(100),
  include_patterns: z.array(z.string()).optional(),
  exclude_patterns: z.array(z.string()).optional(),
  follow_external: z.boolean().optional().default(false),
  respect_robots: z.boolean().optional().default(true)
});
```

### map_site
```javascript
const MapSiteSchema = z.object({
  url: z.string().url(),
  include_sitemap: z.boolean().optional().default(true),
  max_urls: z.number().min(1).max(10000).optional().default(1000),
  group_by_path: z.boolean().optional().default(true)
});
```

### extract_content
```javascript
const ExtractContentSchema = z.object({
  url: z.string().url(),
  extract_main: z.boolean().optional().default(true),
  include_images: z.boolean().optional().default(false),
  include_links: z.boolean().optional().default(false),
  readability_score: z.boolean().optional().default(false),
  format: z.enum(['text', 'markdown', 'html', 'json']).optional().default('markdown')
});
```

### rank_results
```javascript
const RankResultsSchema = z.object({
  query: z.string().min(1),
  documents: z.array(z.object({
    content: z.string(),
    url: z.string().optional(),
    metadata: z.record(z.any()).optional()
  })),
  algorithm: z.enum(['bm25', 'tfidf', 'semantic', 'hybrid']).optional().default('hybrid'),
  top_k: z.number().min(1).max(100).optional().default(10)
});
```

## Error Handling

### Retry Strategy
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

### Circuit Breaker
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
  
  onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }
  
  onFailure() {
    this.failureCount++;
    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.timeout;
    }
  }
}
```

## Security Considerations

### 1. Input Validation
- All URLs validated against whitelist/blacklist
- Query parameters sanitized
- Maximum request size limits enforced

### 2. Rate Limiting
- Per-domain rate limiting
- Global rate limiting for API endpoints
- User-based rate limiting for search APIs

### 3. robots.txt Compliance
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

## Monitoring & Metrics

### Key Performance Indicators
- **Response Time**: Target < 2s for search operations
- **Throughput**: Target 100+ URLs in 30 seconds
- **Cache Hit Rate**: Target > 80%
- **Memory Usage**: Target < 512MB under normal load
- **Error Rate**: Target < 1%

### Metrics Collection
```javascript
class MetricsCollector {
  constructor() {
    this.metrics = {
      requests: 0,
      errors: 0,
      cacheHits: 0,
      cacheMisses: 0,
      avgResponseTime: 0,
      memoryUsage: 0
    };
  }
  
  recordRequest(duration, success = true) {
    this.metrics.requests++;
    if (!success) this.metrics.errors++;
    
    // Update rolling average
    const n = this.metrics.requests;
    this.metrics.avgResponseTime = 
      ((n - 1) * this.metrics.avgResponseTime + duration) / n;
    
    // Update memory usage
    this.metrics.memoryUsage = process.memoryUsage().heapUsed;
  }
  
  getMetrics() {
    return {
      ...this.metrics,
      errorRate: this.metrics.errors / this.metrics.requests,
      cacheHitRate: this.metrics.cacheHits / 
        (this.metrics.cacheHits + this.metrics.cacheMisses)
    };
  }
}
```

## Deployment Architecture

### Docker Configuration
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### Environment Variables
```bash
# API Keys
GOOGLE_SEARCH_API_KEY=
GOOGLE_SEARCH_ENGINE_ID=
BING_SEARCH_API_KEY=

# Cache Configuration
CACHE_TTL=3600
CACHE_MAX_SIZE=1000
CACHE_DIR=./cache

# Worker Configuration
MAX_WORKERS=10
WORKER_TIMEOUT=30000

# Rate Limiting
RATE_LIMIT_REQUESTS=10
RATE_LIMIT_WINDOW=1000

# Monitoring
METRICS_ENABLED=true
METRICS_PORT=9090
```

## Migration Path from Basic to Enhanced

### Phase 1: Core Infrastructure (Current)
- ✅ Basic MCP server setup
- ✅ Simple scraping tools
- ⬜ Architecture design
- ⬜ Research completion

### Phase 2: Search & Crawl Implementation
- ⬜ Search API integration
- ⬜ BFS crawler implementation
- ⬜ URL management system
- ⬜ Basic rate limiting

### Phase 3: Advanced Processing
- ⬜ Content ranking algorithms
- ⬜ Semantic analysis
- ⬜ Multi-format support
- ⬜ Summarization

### Phase 4: Performance & Scale
- ⬜ Worker pool implementation
- ⬜ Caching system
- ⬜ Memory optimization
- ⬜ Load testing

### Phase 5: Production Ready
- ⬜ Complete testing suite
- ⬜ Documentation
- ⬜ Docker deployment
- ⬜ NPM publishing

## Conclusion

This architecture provides a scalable, performant foundation for transforming the MCP WebScraper into a comprehensive web search and crawling engine. The modular design allows for incremental implementation while maintaining backward compatibility with existing tools.

Key innovations:
- Hybrid ranking combining BM25 and semantic search
- Multi-level caching for optimal performance
- Breadth-first crawling with depth control
- Comprehensive error handling and retry mechanisms
- Production-ready monitoring and metrics

The system is designed to handle modern web scraping challenges while remaining efficient and respectful of target servers through rate limiting and robots.txt compliance.