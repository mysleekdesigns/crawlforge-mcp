# MCP WebScraper Implementation Plan

## Phase 1 Summary (COMPLETED)

### Research Findings

#### 1. Firecrawl API Patterns
- **Core Endpoints**: Scrape, Crawl, Map, Search, Extract, Deep Research
- **Async Processing**: Job-based crawling with webhook support
- **Output Formats**: Markdown, HTML, structured JSON, screenshots
- **AI Integration**: LLM-powered extraction with schema support
- **Performance**: Streaming for large documents, parallel processing

#### 2. Search API Integration
- **Google Custom Search API**:
  - 100 free queries/day, $5 per 1000 additional
  - Requires API key and Search Engine ID
  - RESTful API with JSON responses
  - Node.js SDK available: @googleapis/customsearch

- **Bing Search API**:
  - ⚠️ Retiring August 11, 2025
  - Currently uses v7 endpoint
  - Requires Azure subscription key
  - Consider alternative: Azure Cognitive Search

#### 3. Crawling Algorithms
- **BFS Preferred**: Better for web crawling (balanced, polite)
- **Queue Management**: FIFO with priority support
- **Depth Control**: Max 5 levels recommended
- **URL Deduplication**: Essential for efficiency
- **Politeness**: Per-domain rate limiting required

#### 4. Content Ranking
- **BM25**: Superior to TF-IDF for keyword matching
- **Semantic Search**: BERT/transformers for context understanding
- **Hybrid Approach**: BM25 for initial retrieval + semantic re-ranking
- **Performance**: Vector databases (FAISS) for scale

### Architecture Decisions

#### System Design
```
Three-layer architecture:
1. Tool Layer: MCP tool implementations
2. Processing Layer: Queue management, worker pool, content processing
3. Storage Layer: Caching, URL tracking, content database
```

#### Technology Choices
- **Queue System**: In-memory with optional Redis for scale
- **Worker Pool**: Native Node.js worker threads
- **Cache**: LRU memory cache + disk persistence
- **Content Processing**: Cheerio (existing) + readability algorithms
- **Search Integration**: Pluggable adapters for multiple APIs

#### Performance Targets
- Response time: < 2s for search operations
- Throughput: 100+ URLs in 30 seconds
- Memory usage: < 512MB normal load
- Cache hit rate: > 80%
- Concurrent workers: 10 (configurable)

## Next Steps for Phase 2

### Immediate Priorities

1. **Set Up Development Environment**
```bash
# Install additional dependencies
npm install --save \
  p-queue \
  lru-cache \
  robots-parser \
  @googleapis/customsearch \
  natural \
  node-cache
```

2. **Create Core Infrastructure**
```javascript
// src/queue/QueueManager.js
// src/workers/WorkerPool.js
// src/cache/CacheManager.js
// src/crawlers/BFSCrawler.js
// src/ranking/ContentRanker.js
```

3. **Implement search_web Tool**
- Create search adapter interface
- Implement Google Custom Search adapter
- Add query expansion logic
- Build result aggregation

4. **Implement crawl_deep Tool**
- Build BFS crawler with depth control
- Add URL discovery and normalization
- Implement robots.txt checker
- Create rate limiter

5. **Testing Strategy**
- Unit tests for each component
- Integration tests for tool workflows
- Performance benchmarks
- Memory leak detection

### Development Workflow

#### Day 1-2: Core Infrastructure
- [ ] Queue manager implementation
- [ ] Worker pool setup
- [ ] Cache manager with LRU
- [ ] Rate limiter per domain

#### Day 3-4: Search Implementation
- [ ] Search adapter interface
- [ ] Google Custom Search integration
- [ ] Result parsing and formatting
- [ ] Query expansion logic

#### Day 5-7: Crawling System
- [ ] BFS crawler algorithm
- [ ] URL discovery from HTML
- [ ] robots.txt compliance
- [ ] Depth and page limits

### Code Organization
```
webScraper-1.0/
├── server.js (existing)
├── src/
│   ├── tools/
│   │   ├── search/
│   │   │   ├── searchWeb.js
│   │   │   └── adapters/
│   │   │       └── googleSearch.js
│   │   ├── crawl/
│   │   │   ├── crawlDeep.js
│   │   │   └── mapSite.js
│   │   └── extract/
│   │       └── extractContent.js
│   ├── core/
│   │   ├── queue/
│   │   │   └── QueueManager.js
│   │   ├── workers/
│   │   │   └── WorkerPool.js
│   │   ├── cache/
│   │   │   └── CacheManager.js
│   │   └── crawlers/
│   │       └── BFSCrawler.js
│   ├── utils/
│   │   ├── rateLimiter.js
│   │   ├── robotsChecker.js
│   │   ├── urlNormalizer.js
│   │   └── contentRanker.js
│   └── constants/
│       └── config.js
├── tests/
│   ├── unit/
│   ├── integration/
│   └── performance/
└── docs/
    ├── ARCHITECTURE.md (created)
    └── API.md (to create)
```

### Environment Configuration
```env
# .env.example
# Search APIs
GOOGLE_API_KEY=your_api_key_here
GOOGLE_SEARCH_ENGINE_ID=your_engine_id_here

# Performance
MAX_WORKERS=10
QUEUE_CONCURRENCY=5
CACHE_TTL=3600
CACHE_MAX_SIZE=1000

# Rate Limiting
RATE_LIMIT_REQUESTS_PER_SECOND=10
RATE_LIMIT_PER_DOMAIN=true

# Crawling
MAX_CRAWL_DEPTH=5
MAX_PAGES_PER_CRAWL=100
RESPECT_ROBOTS_TXT=true
USER_AGENT=MCP-WebScraper/1.0

# Monitoring
ENABLE_METRICS=true
LOG_LEVEL=info
```

### Testing Checklist

#### Unit Tests
- [ ] Queue manager operations
- [ ] Cache hit/miss scenarios
- [ ] URL normalization
- [ ] robots.txt parsing
- [ ] Rate limiting logic
- [ ] BFS algorithm correctness

#### Integration Tests
- [ ] Search tool end-to-end
- [ ] Crawl tool with depth limits
- [ ] Cache persistence
- [ ] Worker pool under load
- [ ] Error recovery

#### Performance Tests
- [ ] 100 URLs in 30 seconds
- [ ] Memory usage under 512MB
- [ ] Cache hit rate > 80%
- [ ] Response time < 2s

### Risk Mitigation

1. **Bing API Retirement (Aug 2025)**
   - Primary: Use Google Custom Search
   - Fallback: Prepare Azure Cognitive Search adapter
   - Alternative: SerpAPI or similar service

2. **Rate Limiting Issues**
   - Implement exponential backoff
   - Circuit breaker pattern
   - Multiple API key rotation

3. **Memory Management**
   - Stream processing for large documents
   - Periodic cache cleanup
   - Worker recycling

4. **Performance Bottlenecks**
   - Profile with Node.js built-in profiler
   - Use Chrome DevTools for memory analysis
   - Implement request batching

### Success Metrics for Phase 2

✅ **Core Functionality**
- search_web tool returns relevant results
- crawl_deep respects depth limits
- Rate limiting prevents 429 errors
- Cache reduces duplicate requests

✅ **Performance**
- Meets all performance targets
- No memory leaks detected
- Handles concurrent operations

✅ **Quality**
- All tests passing
- Code coverage > 80%
- No critical security issues

✅ **Integration**
- Works with Claude Code
- MCP protocol compliance
- Proper error messages

## Appendix: Key Implementation Patterns

### Pattern 1: Async Queue Processing
```javascript
import PQueue from 'p-queue';

const queue = new PQueue({ 
  concurrency: 10,
  interval: 1000,
  intervalCap: 10 
});

queue.on('active', () => {
  console.log(`Working on item. Size: ${queue.size} Pending: ${queue.pending}`);
});
```

### Pattern 2: Circuit Breaker
```javascript
class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.failures = 0;
    this.threshold = threshold;
    this.timeout = timeout;
    this.state = 'CLOSED';
    this.nextAttempt = Date.now();
  }
  
  async call(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() > this.nextAttempt) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
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

### Pattern 3: Content Extraction
```javascript
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

function extractMainContent(html, url) {
  const doc = new JSDOM(html, { url });
  const reader = new Readability(doc.window.document);
  const article = reader.parse();
  
  return {
    title: article.title,
    content: article.textContent,
    excerpt: article.excerpt,
    byline: article.byline,
    length: article.length
  };
}
```

## Timeline

### Week 1 (Days 1-7)
- Days 1-2: Phase 1 Research & Architecture ✅
- Days 3-7: Phase 2 Core Implementation

### Week 2 (Days 8-14)
- Days 8-12: Phase 3 Advanced Processing
- Days 13-14: Performance optimization

### Week 3 (Days 15-21)
- Days 15-17: Phase 4 Testing & Optimization
- Days 18-21: Phase 5 Documentation & Deployment

## Conclusion

Phase 1 research and architecture design is complete. The system design balances performance, scalability, and maintainability while leveraging proven patterns from Firecrawl and modern search engines. The implementation plan provides a clear path forward with specific tasks, timelines, and success metrics.