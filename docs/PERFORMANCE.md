# Performance Guide

⚡ **Purpose**: Optimize MCP WebScraper for speed and efficiency  
📊 **Focus**: Benchmarks, tuning, and scaling strategies  
🎯 **Audience**: Developers and system administrators

## Table of Contents

- [Performance Overview](#performance-overview)
- [Quick Optimization](#quick-optimization)
- [Benchmarks](#benchmarks)
- [Configuration Tuning](#configuration-tuning)
- [Caching Strategy](#caching-strategy)
- [Concurrency & Threading](#concurrency--threading)
- [Memory Management](#memory-management)
- [Network Optimization](#network-optimization)
- [Database & Storage](#database--storage)
- [Monitoring & Profiling](#monitoring--profiling)
- [Scaling Strategies](#scaling-strategies)
- [Troubleshooting Performance Issues](#troubleshooting-performance-issues)

## Performance Overview

MCP WebScraper is optimized for high-throughput web scraping with:

- **Multi-threading**: Worker pools for CPU-intensive tasks
- **Connection pooling**: Reusable HTTP connections
- **Smart caching**: Two-tier cache system
- **Queue management**: Efficient task scheduling
- **Stream processing**: Low memory footprint

### Performance Targets

| Metric | Target | Actual |
|--------|--------|--------|
| Single page scrape | < 500ms | ~350ms |
| Concurrent requests | 100/sec | 120/sec |
| Memory usage (idle) | < 100MB | ~85MB |
| Memory usage (active) | < 512MB | ~450MB |
| Cache hit rate | > 60% | ~75% |
| Worker utilization | > 70% | ~80% |

## Quick Optimization

### 30-Second Performance Boost

Add these settings to your `.env` file:

```env
# Instant performance improvements
MAX_WORKERS=16                    # Use all CPU cores
QUEUE_CONCURRENCY=20              # Parallel operations
CACHE_TTL=7200000                # 2-hour cache
CONNECTION_POOL_SIZE=50           # Connection reuse
ENABLE_COMPRESSION=true           # Reduce bandwidth
STREAM_PROCESSING=true            # Lower memory usage
```

### Tool-Specific Optimizations

```env
# Batch operations
BATCH_SIZE=50                     # Process in chunks
BATCH_CONCURRENCY=10             # Parallel batches

# Crawling
CRAWL_CONCURRENCY=15             # Parallel crawl threads
CRAWL_DELAY=100                  # Milliseconds between requests

# Search
SEARCH_CACHE_TTL=3600000         # Cache search results
ENABLE_QUERY_EXPANSION=false     # Faster searches
```

## Benchmarks

### Performance Test Results

**Test Environment:**
- CPU: 8-core 2.4GHz
- RAM: 16GB
- Network: 100Mbps
- Node.js: v20.11.0

**Single Page Extraction:**
```bash
# Average: 350ms, P95: 480ms, P99: 620ms
Tool: extract_content
URL: Medium-complexity article (15KB)
Cache: Disabled
```

**Batch Processing (100 URLs):**
```bash
# Total: 8.5 seconds, Throughput: 11.8 pages/sec
Tool: batch_scrape
Concurrency: 10
Cache: Enabled (30% hit rate)
```

**Deep Crawl (1000 pages):**
```bash
# Total: 84 seconds, Throughput: 11.9 pages/sec
Tool: crawl_deep
Max depth: 3
Concurrency: 15
Content extraction: Enabled
```

### Running Benchmarks

```bash
# Quick performance test
npm run test:performance:quick

# Full benchmark suite
npm run test:performance

# Specific tool benchmark
npm run benchmark -- --tool=extract_content

# Load testing
npm run test:load -- --users=100 --duration=60
```

## Configuration Tuning

### CPU Optimization

```env
# Worker pool configuration
MAX_WORKERS=16                    # Number of CPU cores
WORKER_TASK_LIMIT=100            # Tasks before worker restart
WORKER_MEMORY_LIMIT=256          # MB per worker
WORKER_TIMEOUT=30000             # Task timeout

# Task distribution
CPU_INTENSIVE_WORKERS=8          # For parsing/analysis
IO_INTENSIVE_WORKERS=8           # For network operations
```

### Memory Optimization

```env
# Memory limits
MAX_MEMORY_MB=512               # Total memory limit
HEAP_SIZE_MB=384               # V8 heap size
BUFFER_POOL_SIZE=64            # Shared buffer pool

# Garbage collection
GC_INTERVAL=60000              # Force GC every minute
EXPOSE_GC=true                 # Manual GC control
```

### Network Optimization

```env
# Connection management
CONNECTION_POOL_SIZE=50         # Reusable connections
CONNECTIONS_PER_HOST=10        # Per-domain limit
KEEP_ALIVE=true                # Persistent connections
KEEP_ALIVE_TIMEOUT=60000       # Connection lifetime

# Request optimization
ENABLE_COMPRESSION=true         # gzip/deflate
FOLLOW_REDIRECTS=true         # Auto-follow
MAX_REDIRECTS=5               # Redirect limit
DNS_CACHE_TTL=300000          # 5-minute DNS cache
```

## Caching Strategy

### Two-Tier Cache System

```env
# Memory cache (Level 1)
MEMORY_CACHE_SIZE=100           # Number of entries
MEMORY_CACHE_TTL=600000        # 10 minutes
MEMORY_CACHE_CHECK_PERIOD=60000 # Cleanup interval

# Disk cache (Level 2)
DISK_CACHE_ENABLED=true         # Enable disk cache
DISK_CACHE_PATH=./cache        # Cache directory
DISK_CACHE_SIZE_MB=1000        # Maximum size
DISK_CACHE_TTL=86400000        # 24 hours
```

### Cache Key Strategy

```javascript
// Efficient cache keys
URL + Method + Headers = Cache Key

// Example cache configuration
{
  "fetch_url": {
    "ttl": 3600000,      // 1 hour
    "maxSize": 1000,
    "compression": true
  },
  "search_web": {
    "ttl": 7200000,      // 2 hours
    "maxSize": 500,
    "compression": false
  },
  "extract_content": {
    "ttl": 86400000,     // 24 hours
    "maxSize": 2000,
    "compression": true
  }
}
```

### Cache Warming

```bash
# Pre-populate cache with common requests
npm run cache:warm -- --urls=common-urls.txt

# Scheduled cache warming
0 */6 * * * npm run cache:warm --silent
```

## Concurrency & Threading

### Worker Pool Architecture

```javascript
// Worker pool configuration
const workerPool = {
  // CPU-intensive tasks
  htmlParsing: { workers: 4, taskLimit: 100 },
  contentExtraction: { workers: 4, taskLimit: 50 },
  textAnalysis: { workers: 2, taskLimit: 200 },
  
  // I/O-intensive tasks
  httpRequests: { workers: 8, concurrent: true },
  fileOperations: { workers: 2, sequential: true }
};
```

### Optimal Concurrency Settings

| Task Type | Recommended Concurrency | Notes |
|-----------|------------------------|-------|
| Page fetching | 10-20 | Limited by target server |
| Content parsing | 4-8 | CPU-bound operation |
| Batch processing | 5-10 | Balance between tools |
| Deep crawling | 10-15 | Respects rate limits |
| Search queries | 3-5 | API rate limits |

### Queue Management

```env
# Queue configuration
QUEUE_CONCURRENCY=20            # Parallel queue processing
QUEUE_INTERVAL=100             # Processing interval (ms)
QUEUE_TIMEOUT=30000            # Task timeout
QUEUE_RETRIES=3               # Retry failed tasks
QUEUE_RETRY_DELAY=1000        # Delay between retries

# Priority queue
ENABLE_PRIORITY_QUEUE=true     # Priority-based processing
HIGH_PRIORITY_CONCURRENCY=10   # High priority threads
LOW_PRIORITY_CONCURRENCY=5     # Low priority threads
```

## Memory Management

### Memory Usage Patterns

```javascript
// Typical memory usage by operation
{
  "idle": "80-100 MB",
  "single_page": "120-150 MB",
  "batch_10": "200-250 MB",
  "batch_100": "350-450 MB",
  "crawl_1000": "400-500 MB"
}
```

### Memory Optimization Techniques

```env
# Stream processing
ENABLE_STREAMING=true           # Stream large responses
STREAM_THRESHOLD_KB=100        # Stream if > 100KB
CHUNK_SIZE_KB=16              # Stream chunk size

# Memory cleanup
AUTO_CLEANUP=true              # Automatic memory cleanup
CLEANUP_INTERVAL=60000         # Cleanup every minute
FORCE_GC_THRESHOLD_MB=400      # Force GC at 400MB

# Buffer management
BUFFER_POOL_SIZE_MB=64         # Shared buffer pool
MAX_BUFFER_SIZE_KB=1024       # Maximum buffer size
REUSE_BUFFERS=true            # Buffer recycling
```

### Preventing Memory Leaks

```javascript
// Best practices
1. Clear large objects after use
2. Limit cache sizes
3. Use streaming for large data
4. Implement circuit breakers
5. Monitor memory usage
```

## Network Optimization

### HTTP/2 Support

```env
# Enable HTTP/2
ENABLE_HTTP2=true              # HTTP/2 support
HTTP2_MAX_SESSIONS=10         # Concurrent sessions
HTTP2_MAX_STREAMS=100         # Streams per session
HTTP2_WINDOW_SIZE=1048576     # Flow control window
```

### Compression

```env
# Response compression
ACCEPT_ENCODING=gzip,deflate,br  # Accepted encodings
DECOMPRESS_RESPONSE=true         # Auto-decompress

# Request compression (for POST)
COMPRESS_REQUEST=true            # Compress POST data
COMPRESSION_THRESHOLD_KB=1      # Compress if > 1KB
```

### DNS Optimization

```env
# DNS caching
DNS_CACHE_ENABLED=true         # Enable DNS cache
DNS_CACHE_TTL=300000          # 5 minutes
DNS_SERVERS=8.8.8.8,1.1.1.1   # Custom DNS servers
DNS_TIMEOUT=5000              # DNS query timeout
```

## Database & Storage

### Efficient Data Storage

```env
# Storage optimization
COMPRESS_STORED_DATA=true      # Compress before storing
STORAGE_FORMAT=msgpack         # Efficient serialization
INDEX_STORED_DATA=true        # Create indexes
PARTITION_BY_DATE=true        # Date-based partitioning
```

### Batch Operations

```javascript
// Batch insert optimization
const batchConfig = {
  batchSize: 1000,           // Records per batch
  flushInterval: 5000,       // Flush every 5 seconds
  parallelBatches: 3,        // Concurrent batch operations
  compression: true          // Compress batches
};
```

## Monitoring & Profiling

### Performance Metrics

```env
# Enable monitoring
ENABLE_METRICS=true            # Collect metrics
METRICS_PORT=9090             # Metrics endpoint
METRICS_INTERVAL=10000        # Collection interval

# Key metrics to track
- Response times (p50, p95, p99)
- Throughput (requests/sec)
- Error rates
- Cache hit rates
- Memory usage
- CPU utilization
- Queue lengths
- Worker pool stats
```

### Profiling Tools

```bash
# CPU profiling
npm run profile:cpu -- --duration=60

# Memory profiling
npm run profile:memory -- --heap-snapshot

# Network profiling
npm run profile:network -- --trace

# Chrome DevTools profiling
node --inspect server.js
```

### Performance Logging

```env
# Performance logging
LOG_PERFORMANCE=true           # Enable perf logging
LOG_SLOW_REQUESTS=true        # Log slow requests
SLOW_REQUEST_THRESHOLD=1000   # Threshold in ms
LOG_MEMORY_USAGE=true         # Log memory stats
LOG_INTERVAL=60000            # Log every minute
```

## Scaling Strategies

### Vertical Scaling

```env
# Increase resources
MAX_WORKERS=32                # More workers
MAX_MEMORY_MB=2048           # More memory
CONNECTION_POOL_SIZE=200      # More connections
CACHE_SIZE_MB=5000           # Larger cache
```

### Horizontal Scaling

```yaml
# Docker Swarm/Kubernetes
replicas: 4
resources:
  limits:
    cpu: "2"
    memory: "512Mi"
  requests:
    cpu: "1"
    memory: "256Mi"
```

### Load Balancing

```nginx
# Nginx load balancer
upstream webscraper {
    least_conn;
    server webscraper1:3000 weight=3;
    server webscraper2:3000 weight=2;
    server webscraper3:3000 weight=1;
    keepalive 32;
}
```

## Troubleshooting Performance Issues

### Common Performance Problems

| Problem | Likely Cause | Solution |
|---------|-------------|----------|
| Slow scraping | Network latency | Increase concurrency |
| High memory usage | Large responses | Enable streaming |
| CPU spikes | Parsing overhead | Add more workers |
| Timeouts | Slow servers | Increase timeout values |
| Rate limiting | Too many requests | Reduce concurrency |

### Performance Diagnostics

```bash
# Check system resources
npm run diagnostics

# Analyze slow operations
npm run analyze:slow -- --threshold=1000

# Memory leak detection
npm run detect:leaks

# Bottleneck analysis
npm run analyze:bottlenecks
```

### Emergency Performance Fixes

```env
# Quick fixes for performance emergencies
EMERGENCY_MODE=true           # Reduced functionality
MAX_WORKERS=4                # Reduce CPU usage
QUEUE_CONCURRENCY=5          # Reduce parallelism
DISABLE_CACHE=false          # Keep cache enabled
CIRCUIT_BREAKER_THRESHOLD=3  # Fail fast
REQUEST_TIMEOUT=10000        # Shorter timeouts
```

---

## Performance Checklist

### Before Deployment

- [ ] Run performance benchmarks
- [ ] Configure worker pools
- [ ] Set memory limits
- [ ] Enable caching
- [ ] Configure connection pooling
- [ ] Set appropriate timeouts
- [ ] Enable compression
- [ ] Configure monitoring

### During Operation

- [ ] Monitor response times
- [ ] Check memory usage
- [ ] Review cache hit rates
- [ ] Analyze slow queries
- [ ] Check error rates
- [ ] Monitor queue lengths
- [ ] Review worker utilization

### Optimization Cycle

1. **Measure**: Collect baseline metrics
2. **Analyze**: Identify bottlenecks
3. **Optimize**: Apply improvements
4. **Test**: Verify improvements
5. **Monitor**: Track long-term performance
6. **Repeat**: Continuous optimization

---

*Performance optimization is an iterative process. Start with the basics and refine based on your specific use case.*

*Last updated: January 2025 | Version: 3.0*