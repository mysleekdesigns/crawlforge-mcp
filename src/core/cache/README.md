# Enhanced CacheManager Documentation

## Overview

The Enhanced CacheManager is a powerful, feature-rich caching solution for the MCP WebScraper project. It provides advanced cache invalidation strategies, cache warming capabilities, comprehensive monitoring, and maintains full backward compatibility with existing code.

## Key Features

### 🔄 Advanced Cache Invalidation Strategies
- **Tag-based invalidation**: Group related cache entries with tags
- **Event-based invalidation**: Invalidate caches when specific events occur
- **Dependency-based invalidation**: Automatically invalidate dependent caches
- **Pattern-based invalidation**: Use regex patterns to invalidate multiple keys
- **Selective clearing**: Combine multiple invalidation strategies

### 🔥 Cache Warming
- **Preemptive cache loading**: Warm popular queries before they're requested
- **Scheduled warming jobs**: Automatic cache warming on intervals
- **Priority-based warming**: Execute warming jobs based on priority
- **Batch processing**: Efficient warming with configurable batch sizes

### 📊 Enhanced Monitoring & Statistics
- **Comprehensive metrics**: Hit rates, response times, memory usage
- **Performance reports**: Detailed analysis with recommendations
- **Real-time monitoring**: Event-driven statistics updates
- **Historical tracking**: Trend analysis and performance history

### ⚡ Performance Improvements
- **Response time tracking**: Monitor cache performance
- **Memory usage optimization**: Intelligent memory management
- **Automatic cleanup**: Scheduled expired entry removal
- **Eviction tracking**: Monitor cache evictions and capacity

## Installation & Basic Usage

### Backward Compatible Usage
```javascript
import { CacheManager } from './core/cache/CacheManager.js';

// Existing code continues to work unchanged
const cache = new CacheManager({
  maxSize: 1000,
  ttl: 3600000, // 1 hour
  enableDiskCache: true
});

// Legacy API
await cache.set('key', value, ttl);
const data = await cache.get('key');
console.log(cache.getStats());
```

### Enhanced Configuration
```javascript
const cache = new CacheManager({
  // Existing options
  maxSize: 1000,
  ttl: 3600000,
  diskCacheDir: './cache',
  enableDiskCache: true,
  
  // New advanced options
  enableCacheWarming: true,
  warmingBatchSize: 10,
  enableMonitoring: true,
  monitoringInterval: 60000,
  autoCleanupInterval: 300000,
  dependencyTracking: true
});
```

## Advanced Features

### 1. Cache Invalidation Strategies

#### Tag-based Invalidation
```javascript
// Set cache entries with tags
await cache.set('user:123', userData, {
  ttl: 3600000,
  tags: ['user', 'profile', 'active-users']
});

await cache.set('user:456', userData2, {
  ttl: 3600000,
  tags: ['user', 'profile']
});

// Invalidate all entries with 'user' tag
const invalidated = cache.invalidateByTag('user');
console.log(`Invalidated ${invalidated} user entries`);

// Invalidate multiple tags
cache.invalidateByTags(['user', 'profile']);
```

#### Event-based Invalidation
```javascript
// Set cache with event triggers
await cache.set('session:abc123', sessionData, {
  ttl: 1800000,
  events: ['user-logout', 'session-expired']
});

// Trigger invalidation
cache.invalidateByEvent('user-logout');
```

#### Dependency-based Invalidation
```javascript
// Enable dependency tracking
const cache = new CacheManager({ dependencyTracking: true });

// Set up dependency chain
await cache.set('config:global', globalConfig);
await cache.set('user:settings:123', userSettings, {
  dependencies: ['config:global']
});

// When global config changes, dependent caches are automatically invalidated
cache.delete('config:global'); // Also invalidates user:settings:123
```

#### Pattern-based Invalidation
```javascript
// Set various cache entries
await cache.set('session:abc123', data1);
await cache.set('session:def456', data2);
await cache.set('user:789', data3);

// Invalidate all session keys
const invalidated = cache.invalidateByPattern('^session:');
console.log(`Invalidated ${invalidated} session entries`);
```

#### Selective Clearing
```javascript
// Combine multiple invalidation strategies
const cleared = cache.selectiveClear({
  tags: ['temporary', 'cache'],
  events: ['data-update'],
  pattern: '^temp:',
  olderThan: 3600000, // 1 hour
  excludeKeys: ['important:data']
});
```

### 2. Cache Warming

#### Preemptive Cache Warming
```javascript
const popularQueries = ['trending-posts', 'top-users', 'latest-news'];

const dataProvider = async (query) => {
  // Fetch data from API/database
  const response = await fetchDataForQuery(query);
  return response.data;
};

// Warm popular queries
const warmed = await cache.warmPopularQueries(popularQueries, dataProvider);
console.log(`Warmed ${warmed} popular queries`);
```

#### Scheduled Warming Jobs
```javascript
// Add periodic warming job
cache.addWarmingJob('daily-stats', async () => {
  return [
    {
      key: 'stats:daily',
      value: await fetchDailyStats(),
      options: { ttl: 86400000, tags: ['stats'] }
    },
    {
      key: 'stats:weekly',
      value: await fetchWeeklyStats(),
      options: { ttl: 604800000, tags: ['stats'] }
    }
  ];
}, {
  interval: 3600000, // Run every hour
  priority: 1,
  enabled: true
});

// Execute warming job manually
await cache.executeWarmingJob('daily-stats');

// Remove warming job
cache.removeWarmingJob('daily-stats');
```

### 3. Enhanced Monitoring

#### Event Listeners
```javascript
// Monitor cache operations
cache.on('hit', (key, source) => {
  console.log(`Cache HIT: ${key} (${source})`);
});

cache.on('miss', (key) => {
  console.log(`Cache MISS: ${key}`);
});

cache.on('evict', (key, value) => {
  console.log(`Cache EVICTION: ${key}`);
});

cache.on('invalidateByTag', (tag, count) => {
  console.log(`Tag invalidation: ${tag} (${count} entries)`);
});

cache.on('warmingJobExecuted', (jobId, data) => {
  console.log(`Warming job completed: ${jobId}`);
});
```

#### Detailed Statistics
```javascript
// Get comprehensive statistics
const stats = cache.getDetailedStats();
console.log({
  totalRequests: stats.totalRequests,
  hitRate: stats.hitRate,
  averageResponseTime: stats.averageResponseTime,
  memoryUtilization: stats.cacheUtilization,
  warmingJobsCount: stats.warmingJobsCount,
  dependenciesCount: stats.dependenciesCount
});
```

#### Performance Reports
```javascript
// Generate detailed performance report
const report = cache.generatePerformanceReport();

console.log('Performance Summary:', report.summary);
console.log('Cache Breakdown:', report.breakdown);
console.log('Performance Trends:', report.trends);
console.log('Recommendations:', report.recommendations);

// Example recommendations:
// - "Hit rate is below 50%. Consider increasing cache size or adjusting TTL."
// - "Cache utilization is high. Consider increasing max cache size."
// - "Consider enabling cache warming for popular queries."
```

#### Real-time Monitoring
```javascript
// Start automatic monitoring
cache.startMonitoring(30000); // Every 30 seconds

cache.on('monitoring', (stats) => {
  console.log('Monitoring update:', {
    hitRate: stats.hitRate.toFixed(2) + '%',
    memoryUtilization: stats.cacheUtilization.toFixed(2) + '%',
    responseTime: stats.averageResponseTime.toFixed(2) + 'ms'
  });
});

// Stop monitoring
cache.stopMonitoring();
```

## Real-World Integration Example

### Web Scraping Application
```javascript
const cache = new CacheManager({
  maxSize: 5000,
  ttl: 3600000,
  enableDiskCache: true,
  enableCacheWarming: true,
  enableMonitoring: true,
  dependencyTracking: true
});

// Cache scraped content with metadata
await cache.set('page:https://example.com', {
  url: 'https://example.com',
  content: scrapedContent,
  lastModified: Date.now()
}, {
  ttl: 1800000, // 30 minutes
  tags: ['webpage', 'html', 'example.com'],
  dependencies: ['robots:https://example.com'],
  events: ['site-updated']
});

// Cache extracted metadata
await cache.set('metadata:https://example.com', extractedMetadata, {
  ttl: 3600000,
  tags: ['metadata', 'seo'],
  dependencies: ['page:https://example.com']
});

// Set up warming for popular search queries
cache.addWarmingJob('popular-searches', async () => {
  const queries = ['web scraping', 'data extraction', 'html parsing'];
  return queries.map(query => ({
    key: `search:${query}`,
    value: await performSearch(query),
    options: { ttl: 900000, tags: ['search'] }
  }));
}, { interval: 1800000 }); // Every 30 minutes

// Handle site updates
cache.on('siteUpdate', () => {
  cache.invalidateByEvent('site-updated');
});
```

## Migration Guide

### From Basic CacheManager
All existing code continues to work without changes:

```javascript
// OLD CODE (still works)
const cache = new CacheManager({ maxSize: 1000, ttl: 3600000 });
await cache.set('key', value, ttl);
const data = await cache.get('key');

// NEW FEATURES (optional upgrades)
await cache.set('key', value, {
  ttl: 3600000,
  tags: ['user', 'profile'],
  dependencies: ['config:global']
});

cache.invalidateByTag('user');
const report = cache.generatePerformanceReport();
```

### Best Practices

1. **Use tags for logical grouping**
   ```javascript
   // Group related cache entries
   tags: ['user', 'profile', 'session']
   ```

2. **Set up dependencies for data relationships**
   ```javascript
   // User data depends on global config
   dependencies: ['config:global', 'user:permissions']
   ```

3. **Implement cache warming for critical data**
   ```javascript
   // Warm frequently accessed data
   cache.addWarmingJob('critical-data', dataProvider, { interval: 300000 });
   ```

4. **Monitor performance regularly**
   ```javascript
   // Set up monitoring and alerts
   cache.on('monitoring', (stats) => {
     if (stats.hitRate < 80) {
       console.warn('Low cache hit rate:', stats.hitRate);
     }
   });
   ```

5. **Clean up resources**
   ```javascript
   // Always clean up on shutdown
   process.on('SIGTERM', () => {
     cache.destroy();
     process.exit(0);
   });
   ```

## API Reference

### Constructor Options
```javascript
new CacheManager({
  // Basic options
  maxSize: 1000,              // Maximum number of entries
  ttl: 3600000,               // Default TTL in milliseconds
  diskCacheDir: './cache',    // Disk cache directory
  enableDiskCache: true,      // Enable disk persistence
  
  // Advanced options
  enableCacheWarming: false,  // Enable cache warming features
  warmingBatchSize: 10,       // Batch size for warming operations
  enableMonitoring: true,     // Enable performance monitoring
  monitoringInterval: 60000,  // Monitoring update interval
  autoCleanupInterval: 300000,// Auto cleanup interval
  dependencyTracking: false   // Enable dependency tracking
})
```

### Core Methods
- `async get(key)` - Retrieve cached value
- `async set(key, value, options)` - Store value with advanced options
- `delete(key)` - Remove cached value
- `has(key)` - Check if key exists
- `clear()` - Clear all cached values
- `getStats()` - Get basic statistics
- `getDetailedStats()` - Get comprehensive statistics

### Invalidation Methods
- `invalidateByTag(tag)` - Invalidate by single tag
- `invalidateByTags(tags)` - Invalidate by multiple tags
- `invalidateByEvent(event)` - Invalidate by event
- `invalidateByPattern(pattern)` - Invalidate by regex pattern
- `selectiveClear(options)` - Advanced selective clearing

### Warming Methods
- `addWarmingJob(id, provider, options)` - Add warming job
- `removeWarmingJob(id)` - Remove warming job
- `executeWarmingJob(id)` - Execute warming job manually
- `warmPopularQueries(queries, provider)` - Warm popular queries

### Monitoring Methods
- `startMonitoring(interval)` - Start automatic monitoring
- `stopMonitoring()` - Stop monitoring
- `generatePerformanceReport()` - Generate detailed report
- `destroy()` - Clean up all resources

### Events
- `hit` - Cache hit occurred
- `miss` - Cache miss occurred
- `evict` - Entry evicted from cache
- `set` - Entry added to cache
- `delete` - Entry removed from cache
- `invalidateByTag` - Tag-based invalidation
- `invalidateByEvent` - Event-based invalidation
- `warmingJobExecuted` - Warming job completed
- `monitoring` - Monitoring update
- `error` - Error occurred

## Performance Considerations

1. **Memory Usage**: Monitor memory utilization and adjust `maxSize` accordingly
2. **Disk I/O**: Enable disk cache only when necessary for persistence
3. **Warming Frequency**: Balance warming job frequency with system resources
4. **Monitoring Overhead**: Adjust monitoring interval based on performance needs
5. **Dependency Tracking**: Use only when needed as it adds overhead

## Troubleshooting

### Common Issues

1. **High Memory Usage**
   - Reduce `maxSize` or enable more aggressive TTL
   - Check for memory leaks in cached objects

2. **Low Hit Rate**
   - Increase cache size
   - Adjust TTL values
   - Implement cache warming for popular queries

3. **Performance Issues**
   - Disable monitoring in production if not needed
   - Optimize disk cache directory location
   - Review warming job frequency

### Debug Mode
```javascript
const cache = new CacheManager({ enableMonitoring: true });

cache.on('error', (error, context) => {
  console.error('Cache error:', error, context);
});

cache.on('evict', (key, value) => {
  console.log('Evicted:', key);
});
```

## License

This enhanced CacheManager is part of the MCP WebScraper project and follows the same MIT license.