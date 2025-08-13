# Advanced Topics

Technical documentation for developers and contributors working with the MCP WebScraper server.

## Table of Contents

- [Architecture](#architecture)
- [Performance Optimization](#performance-optimization)
- [Security Implementation](#security-implementation)
- [Monitoring & Observability](#monitoring--observability)
- [Search Ranking System](#search-ranking-system)
- [Development Guidelines](#development-guidelines)

## Architecture

### System Overview

The MCP WebScraper follows a modular three-layer architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                         MCP Server                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   Tool Layer                         │   │
│  │  - 12 MCP tools for web operations                  │   │
│  │  - Input validation and parameter handling           │   │
│  │  - Response formatting and error handling            │   │
│  └─────────────────────────────────────────────────────┘   │
│                            ↓                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                Processing Engine                     │   │
│  │  - Queue Manager (concurrent operations)             │   │
│  │  - Worker Pool (multi-threading)                     │   │
│  │  - Content Processor (extraction & analysis)         │   │
│  │  - Performance Manager (task routing)                │   │
│  └─────────────────────────────────────────────────────┘   │
│                            ↓                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  Storage Layer                       │   │
│  │  - Cache Manager (LRU + disk persistence)            │   │
│  │  - URL Store (deduplication)                         │   │
│  │  - Content Database (results storage)                │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Core Components

#### Queue Manager (`src/core/queue/QueueManager.js`)
- Manages concurrent operations using p-queue
- Configurable concurrency limits
- Priority queue support
- Job scheduling and retry logic

#### Worker Pool (`src/core/workers/WorkerPool.js`)
- Multi-threaded processing using Node.js worker_threads
- Supports 8 task types (HTML parsing, content extraction, etc.)
- Automatic worker lifecycle management
- Task timeout and retry mechanisms

#### Content Processor (`src/core/processing/ContentProcessor.js`)
- Mozilla Readability integration
- Structured data extraction (JSON-LD, microdata)
- Content quality assessment
- Multiple output formats (markdown, HTML, JSON)

#### Performance Manager (`src/core/PerformanceManager.js`)
- Intelligent task routing (CPU vs I/O vs memory-intensive)
- Resource monitoring and optimization
- Automatic scaling based on load

## Performance Optimization

### Multi-Threading Architecture

```javascript
// Worker Pool Configuration
const workerPool = new WorkerPool({
  maxWorkers: os.cpus().length,
  taskTimeout: 30000,
  recycleAfterTasks: 100
});

// Task Types
- parseHtml: HTML parsing and DOM manipulation
- extractContent: Content extraction with Readability
- analyzeText: NLP analysis (sentiment, entities)
- processStructuredData: JSON-LD/microdata extraction
- calculateSimilarity: Text similarity calculations
- validateUrls: URL validation and normalization
```

### Connection Pooling

```javascript
// HTTP Connection Pool
const connectionPool = new ConnectionPool({
  maxConnections: 100,
  maxConnectionsPerHost: 10,
  keepAlive: true,
  keepAliveMsecs: 60000
});
```

### Cache Strategy

Two-tier caching system:
1. **Memory Cache**: LRU with 10,000 entry limit
2. **Disk Cache**: Persistent storage with TTL

```javascript
const cache = new CacheManager({
  maxSize: 10000,           // Max entries
  ttl: 3600000,            // 1 hour default
  enableDiskCache: true,
  diskCachePath: './cache'
});
```

### Performance Benchmarks

| Operation | Target | Achieved | Status |
|-----------|--------|----------|--------|
| Search Response | <2s | 146ms | ✅ |
| Fetch Response | <1s | 48ms | ✅ |
| Extract Response | <500ms | 36ms | ✅ |
| Memory Usage | <512MB | 12MB | ✅ |
| Concurrent Ops | 100+ | 710/sec | ✅ |

## Security Implementation

### SSRF Protection

```javascript
// src/utils/ssrfProtection.js
class SSRFProtection {
  validateUrl(url) {
    // Block private IPs
    if (this.isPrivateIP(hostname)) {
      throw new Error('Private IP addresses not allowed');
    }
    
    // Block dangerous protocols
    if (!['http:', 'https:'].includes(protocol)) {
      throw new Error('Invalid protocol');
    }
    
    // Block cloud metadata services
    if (this.isMetadataService(hostname)) {
      throw new Error('Metadata service access blocked');
    }
  }
}
```

### Input Validation

All inputs validated using Zod schemas:

```javascript
const searchSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().min(1).max(100).default(10),
  lang: z.string().regex(/^[a-z]{2}$/).optional(),
  time_range: z.enum(['day', 'week', 'month', 'year']).optional()
});
```

### Security Headers

```javascript
// Rate Limiting
const rateLimiter = new RateLimiter({
  requestsPerSecond: 10,
  burstSize: 20,
  perDomain: true
});

// Request Size Limits
const MAX_REQUEST_SIZE = 100 * 1024 * 1024; // 100MB
const REQUEST_TIMEOUT = 60000; // 60 seconds
```

### OWASP Compliance

- ✅ A1: Broken Access Control - URL validation
- ✅ A2: Cryptographic Failures - Secure connections only
- ✅ A3: Injection - Input sanitization
- ✅ A4: Insecure Design - Defense in depth
- ✅ A5: Security Misconfiguration - Secure defaults
- ✅ A8: Software Integrity - Dependency scanning
- ✅ A10: SSRF - Comprehensive protection

## Monitoring & Observability

### Health Check System

```javascript
const healthCheck = new HealthCheckManager({
  checkInterval: 30000,
  checks: {
    memory: { threshold: 512 * 1024 * 1024 },
    cpu: { threshold: 90 },
    responseTime: { threshold: 2000 },
    errorRate: { threshold: 0.05 }
  }
});

// Endpoint: GET /health
{
  "status": "healthy",
  "uptime": 3600,
  "memory": { "used": 52428800, "total": 536870912 },
  "cpu": { "usage": 15.2 },
  "checks": {
    "database": "ok",
    "cache": "ok",
    "workers": "ok"
  }
}
```

### Metrics Collection

```javascript
const metrics = new MetricsCollector({
  collectInterval: 10000,
  exportInterval: 60000,
  metrics: [
    'request_count',
    'response_time',
    'error_rate',
    'cache_hit_rate',
    'worker_utilization',
    'queue_depth'
  ]
});
```

### Dashboard Integration

Compatible with:
- **Grafana**: JSON dashboard included
- **Prometheus**: Metrics endpoint at `/metrics`
- **DataDog**: Direct integration support
- **New Relic**: APM agent compatible

### Alerting Rules

```yaml
alerts:
  - name: high_error_rate
    condition: error_rate > 0.05
    duration: 5m
    severity: critical
    
  - name: high_memory_usage
    condition: memory_usage > 512MB
    duration: 10m
    severity: warning
    
  - name: slow_response_time
    condition: p95_response_time > 2000ms
    duration: 5m
    severity: warning
```

## Search Ranking System

### Ranking Algorithm

Multi-factor ranking with configurable weights:

```javascript
const ranker = new ResultRanker({
  weights: {
    bm25: 0.4,           // Keyword relevance
    semantic: 0.3,       // Semantic similarity
    authority: 0.2,      // Domain authority
    freshness: 0.1       // Content recency
  }
});
```

### BM25 Implementation

```javascript
calculateBM25(doc, query) {
  const k1 = 1.2;  // Term frequency saturation
  const b = 0.75;  // Document length normalization
  
  let score = 0;
  for (const term of queryTerms) {
    const tf = this.termFrequency(term, doc);
    const idf = this.inverseDocFrequency(term);
    const dl = doc.length;
    const avgdl = this.avgDocLength;
    
    score += idf * (tf * (k1 + 1)) / 
             (tf + k1 * (1 - b + b * dl / avgdl));
  }
  return score;
}
```

### Deduplication

SimHash-based duplicate detection:

```javascript
const deduplicator = new ResultDeduplicator({
  similarityThreshold: 0.85,
  urlNormalization: true,
  contentFingerprinting: true
});
```

## Development Guidelines

### Error Handling

```javascript
class ToolError extends Error {
  constructor(message, code, details) {
    super(message);
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

// Usage
throw new ToolError(
  'Failed to fetch URL',
  'FETCH_FAILED',
  { url, statusCode: 500 }
);
```

### Circuit Breaker Pattern

```javascript
const circuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 60000,
  halfOpenRequests: 3
});

await circuitBreaker.execute(async () => {
  return await fetchUrl(url);
});
```

### Testing Strategy

```bash
# Unit Tests
npm test

# Integration Tests
npm run test:integration

# Performance Tests
npm run test:performance

# Security Tests
npm run test:security

# Load Tests
npm run test:load
```

### Configuration Management

Environment variables with validation:

```javascript
const config = {
  maxWorkers: parseInt(process.env.MAX_WORKERS) || os.cpus().length,
  queueConcurrency: parseInt(process.env.QUEUE_CONCURRENCY) || 10,
  cacheSize: parseInt(process.env.CACHE_SIZE) || 10000,
  rateLimitRPS: parseInt(process.env.RATE_LIMIT_RPS) || 10
};

// Validate configuration
validateConfig(config);
```

## Contributing

### Adding New Tools

1. Create tool class in `src/tools/`
2. Implement `execute()` method
3. Add Zod schema for parameters
4. Register in `server.js`
5. Add tests in `tests/`
6. Update API documentation

### Performance Considerations

- Use Worker Pool for CPU-intensive tasks
- Implement caching for expensive operations
- Add rate limiting for external APIs
- Monitor memory usage in loops
- Use streaming for large datasets

### Security Checklist

- [ ] Validate all inputs with Zod
- [ ] Check URLs with SSRF protection
- [ ] Sanitize HTML content
- [ ] Limit request sizes
- [ ] Add timeout to all operations
- [ ] Log security events
- [ ] Review dependencies for vulnerabilities

## Next Steps

- 📚 [API Reference](./API_REFERENCE.md) - Complete tool documentation
- 🚀 [Deployment](./DEPLOYMENT.md) - Production deployment
- 🔧 [Troubleshooting](./TROUBLESHOOTING.md) - Common issues
- ⚡ [Quick Start](./QUICK_START.md) - Getting started guide