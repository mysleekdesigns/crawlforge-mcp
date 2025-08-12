/**
 * Enhanced CacheManager Usage Examples
 * 
 * This file demonstrates the advanced features of the enhanced CacheManager
 * including cache invalidation strategies, cache warming, and monitoring.
 */

import { CacheManager } from './CacheManager.js';

// =============================================================================
// BASIC USAGE (BACKWARD COMPATIBLE)
// =============================================================================

export function basicUsageExample() {
  console.log('=== Basic Usage Example ===');
  
  // Create cache with basic options (existing API still works)
  const cache = new CacheManager({
    maxSize: 1000,
    ttl: 3600000, // 1 hour
    enableDiskCache: true
  });
  
  // Basic operations (unchanged)
  async function basicOperations() {
    // Set data (legacy API)
    await cache.set('user:123', { id: 123, name: 'John' }, 300000);
    
    // Get data
    const user = await cache.get('user:123');
    console.log('Retrieved user:', user);
    
    // Check existence
    console.log('User exists:', cache.has('user:123'));
    
    // Get basic stats
    console.log('Basic stats:', cache.getStats());
  }
  
  return basicOperations();
}

// =============================================================================
// ADVANCED CACHE INVALIDATION STRATEGIES
// =============================================================================

export function invalidationStrategiesExample() {
  console.log('=== Cache Invalidation Strategies Example ===');
  
  const cache = new CacheManager({
    maxSize: 1000,
    ttl: 3600000,
    dependencyTracking: true // Enable dependency tracking
  });
  
  async function demonstrateInvalidation() {
    // 1. TAG-BASED INVALIDATION
    console.log('\n1. Tag-based Invalidation:');
    
    // Set data with tags
    await cache.set('user:123', { id: 123, name: 'John' }, {
      ttl: 300000,
      tags: ['user', 'profile', 'active-users']
    });
    
    await cache.set('user:456', { id: 456, name: 'Jane' }, {
      ttl: 300000,
      tags: ['user', 'profile']
    });
    
    await cache.set('post:789', { id: 789, title: 'Hello World' }, {
      ttl: 300000,
      tags: ['post', 'content']
    });
    
    console.log('Before invalidation - Users exist:', 
      cache.has('user:123'), cache.has('user:456'));
    
    // Invalidate all entries with 'user' tag
    const invalidated = cache.invalidateByTag('user');
    console.log(`Invalidated ${invalidated} entries with 'user' tag`);
    
    console.log('After invalidation - Users exist:', 
      cache.has('user:123'), cache.has('user:456'));
    console.log('Post still exists:', cache.has('post:789'));
    
    // 2. DEPENDENCY-BASED INVALIDATION
    console.log('\n2. Dependency-based Invalidation:');
    
    // Set up dependency chain
    await cache.set('config:global', { theme: 'dark' }, { ttl: 300000 });
    
    await cache.set('user:settings:123', { userId: 123, theme: 'auto' }, {
      ttl: 300000,
      dependencies: ['config:global'] // Depends on global config
    });
    
    console.log('Before config change - User settings exist:', 
      cache.has('user:settings:123'));
    
    // When global config changes, dependent caches are invalidated
    cache.delete('config:global'); // This will cascade to user:settings:123
    
    console.log('After config deletion - User settings exist:', 
      cache.has('user:settings:123'));
    
    // 3. EVENT-BASED INVALIDATION
    console.log('\n3. Event-based Invalidation:');
    
    await cache.set('notifications:123', ['msg1', 'msg2'], {
      ttl: 300000,
      events: ['user-logout', 'session-expired']
    });
    
    console.log('Before event - Notifications exist:', 
      cache.has('notifications:123'));
    
    // Trigger event-based invalidation
    const eventInvalidated = cache.invalidateByEvent('user-logout');
    console.log(`Invalidated ${eventInvalidated} entries for 'user-logout' event`);
    
    console.log('After event - Notifications exist:', 
      cache.has('notifications:123'));
    
    // 4. PATTERN-BASED INVALIDATION
    console.log('\n4. Pattern-based Invalidation:');
    
    await cache.set('session:abc123', { token: 'abc123' }, { ttl: 300000 });
    await cache.set('session:def456', { token: 'def456' }, { ttl: 300000 });
    await cache.set('user:789', { id: 789 }, { ttl: 300000 });
    
    console.log('Before pattern invalidation:');
    console.log('Sessions exist:', cache.has('session:abc123'), cache.has('session:def456'));
    console.log('User exists:', cache.has('user:789'));
    
    // Invalidate all session keys
    const patternInvalidated = cache.invalidateByPattern('^session:');
    console.log(`Invalidated ${patternInvalidated} entries matching pattern '^session:'`);
    
    console.log('After pattern invalidation:');
    console.log('Sessions exist:', cache.has('session:abc123'), cache.has('session:def456'));
    console.log('User exists:', cache.has('user:789'));
    
    // 5. SELECTIVE CLEARING
    console.log('\n5. Selective Clearing:');
    
    // Set up test data
    await cache.set('temp:1', 'data1', { ttl: 300000, tags: ['temp'] });
    await cache.set('temp:2', 'data2', { ttl: 300000, tags: ['temp'] });
    await cache.set('perm:1', 'data3', { ttl: 300000, tags: ['permanent'] });
    
    // Selective clear with multiple criteria
    const cleared = cache.selectiveClear({
      tags: ['temp'],
      pattern: '^temp:',
      excludeKeys: ['perm:1']
    });
    
    console.log(`Selectively cleared ${cleared} entries`);
  }
  
  return demonstrateInvalidation();
}

// =============================================================================
// CACHE WARMING FEATURES
// =============================================================================

export function cacheWarmingExample() {
  console.log('=== Cache Warming Example ===');
  
  const cache = new CacheManager({
    maxSize: 1000,
    ttl: 3600000,
    enableCacheWarming: true,
    warmingBatchSize: 5
  });
  
  async function demonstrateWarming() {
    // 1. PREEMPTIVE CACHE WARMING
    console.log('\n1. Preemptive Cache Warming:');
    
    // Define popular queries to warm
    const popularQueries = [
      'trending-posts',
      'top-users',
      'latest-news',
      'popular-categories'
    ];
    
    // Data provider function
    const dataProvider = async (query) => {
      console.log(`Fetching data for: ${query}`);
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 100));
      return { query, data: `cached-${query}`, timestamp: Date.now() };
    };
    
    // Warm popular queries
    const warmed = await cache.warmPopularQueries(popularQueries, dataProvider);
    console.log(`Warmed ${warmed} popular queries`);
    
    // Verify cached data
    const trendingPosts = await cache.get(cache.generateKey('trending-posts'));
    console.log('Cached trending posts:', trendingPosts);
    
    // 2. SCHEDULED CACHE WARMING JOBS
    console.log('\n2. Scheduled Cache Warming Jobs:');
    
    // Add a warming job that runs every 30 seconds
    cache.addWarmingJob('daily-stats', async () => {
      console.log('Executing daily stats warming job...');
      return [
        {
          key: 'stats:daily',
          value: { views: 1000, users: 50, posts: 25 },
          options: { ttl: 86400000 } // 24 hours
        },
        {
          key: 'stats:weekly',
          value: { views: 7000, users: 350, posts: 175 },
          options: { ttl: 604800000 } // 7 days
        }
      ];
    }, {
      interval: 30000, // 30 seconds
      priority: 1,
      enabled: true
    });
    
    // Add another warming job for user data
    cache.addWarmingJob('user-profiles', async () => {
      console.log('Executing user profiles warming job...');
      const users = [123, 456, 789];
      return users.map(userId => ({
        key: `profile:${userId}`,
        value: { id: userId, name: `User${userId}`, active: true },
        options: { ttl: 1800000, tags: ['user', 'profile'] } // 30 minutes
      }));
    }, {
      interval: 60000, // 1 minute
      priority: 2
    });
    
    console.log('Added warming jobs. They will execute periodically.');
    
    // 3. MANUAL JOB EXECUTION
    console.log('\n3. Manual Job Execution:');
    
    // Execute a warming job immediately
    const executed = await cache.executeWarmingJob('daily-stats');
    console.log('Manually executed warming job:', executed);
    
    // Verify warmed data
    const dailyStats = await cache.get('stats:daily');
    console.log('Warmed daily stats:', dailyStats);
    
    // 4. WARMING JOB MANAGEMENT
    console.log('\n4. Warming Job Management:');
    
    // List all warming jobs
    console.log('Active warming jobs:', cache.warmingJobs.size);
    
    // Remove a warming job
    const removed = cache.removeWarmingJob('user-profiles');
    console.log('Removed warming job:', removed);
    
    console.log('Remaining warming jobs:', cache.warmingJobs.size);
  }
  
  return demonstrateWarming();
}

// =============================================================================
// CACHE MONITORING & STATISTICS
// =============================================================================

export function monitoringExample() {
  console.log('=== Cache Monitoring & Statistics Example ===');
  
  const cache = new CacheManager({
    maxSize: 100,
    ttl: 300000,
    enableMonitoring: true,
    monitoringInterval: 5000 // 5 seconds
  });
  
  async function demonstrateMonitoring() {
    // Set up event listeners
    cache.on('hit', (key, source) => {
      console.log(`Cache HIT: ${key} (${source})`);
    });
    
    cache.on('miss', (key) => {
      console.log(`Cache MISS: ${key}`);
    });
    
    cache.on('monitoring', (stats) => {
      console.log('Monitoring update:', {
        hitRate: stats.hitRate.toFixed(2) + '%',
        totalRequests: stats.totalRequests,
        memoryUtilization: stats.cacheUtilization.toFixed(2) + '%'
      });
    });
    
    // Generate some cache activity
    console.log('\n1. Generating Cache Activity:');
    
    // Cache misses
    await cache.get('non-existent-1');
    await cache.get('non-existent-2');
    
    // Cache sets and hits
    await cache.set('item:1', { data: 'value1' }, { ttl: 300000 });
    await cache.set('item:2', { data: 'value2' }, { ttl: 300000 });
    await cache.get('item:1'); // Hit
    await cache.get('item:2'); // Hit
    await cache.get('item:1'); // Hit again
    
    // 2. BASIC STATISTICS
    console.log('\n2. Basic Statistics:');
    const basicStats = cache.getStats();
    console.log('Basic stats:', {
      hits: basicStats.hits,
      misses: basicStats.misses,
      hitRate: basicStats.hitRate.toFixed(2) + '%',
      memorySize: basicStats.memorySize
    });
    
    // 3. DETAILED STATISTICS
    console.log('\n3. Detailed Statistics:');
    const detailedStats = cache.getDetailedStats();
    console.log('Detailed stats:', {
      totalRequests: detailedStats.totalRequests,
      averageResponseTime: detailedStats.averageResponseTime.toFixed(2) + 'ms',
      cacheUtilization: detailedStats.cacheUtilization.toFixed(2) + '%',
      memoryUsage: detailedStats.memoryUsage + ' bytes'
    });
    
    // 4. PERFORMANCE REPORT
    console.log('\n4. Performance Report:');
    
    // Add more activity for a meaningful report
    for (let i = 0; i < 20; i++) {
      await cache.set(`bulk:${i}`, { index: i, data: `value${i}` });
      await cache.get(`bulk:${i}`);
      if (i % 3 === 0) {
        await cache.get('non-existent-' + i); // Some misses
      }
    }
    
    const report = cache.generatePerformanceReport();
    console.log('Performance Report Summary:', {
      totalRequests: report.summary.totalRequests,
      hitRate: report.summary.hitRate.toFixed(2) + '%',
      averageResponseTime: report.summary.averageResponseTime.toFixed(2) + 'ms',
      memoryUtilization: report.summary.memoryUtilization.toFixed(2) + '%'
    });
    
    console.log('Recommendations:', report.recommendations);
    
    // 5. MEMORY USAGE TRACKING
    console.log('\n5. Memory Usage Tracking:');
    
    // Fill cache to demonstrate memory tracking
    for (let i = 0; i < 50; i++) {
      const largeData = { 
        id: i, 
        content: 'x'.repeat(1000),
        metadata: { created: Date.now(), tags: ['large', 'test'] }
      };
      await cache.set(`large:${i}`, largeData);
    }
    
    const memoryStats = cache.getDetailedStats();
    console.log('Memory usage after bulk load:', {
      memoryUsage: memoryStats.memoryUsage + ' bytes',
      utilization: memoryStats.cacheUtilization.toFixed(2) + '%',
      entries: memoryStats.memorySize
    });
  }
  
  return demonstrateMonitoring();
}

// =============================================================================
// REAL-WORLD INTEGRATION EXAMPLE
// =============================================================================

export function realWorldExample() {
  console.log('=== Real-World Integration Example ===');
  
  // Configuration for a web scraping application
  const cache = new CacheManager({
    maxSize: 5000,
    ttl: 3600000, // 1 hour default
    enableDiskCache: true,
    enableCacheWarming: true,
    enableMonitoring: true,
    dependencyTracking: true,
    monitoringInterval: 30000, // 30 seconds
    autoCleanupInterval: 300000 // 5 minutes
  });
  
  async function webScrapingCacheExample() {
    console.log('\n1. Web Scraping Cache Setup:');
    
    // Cache scraped webpage content with dependencies and tags
    await cache.set('page:https://example.com', {
      url: 'https://example.com',
      content: '<html>...</html>',
      lastModified: Date.now(),
      headers: { 'content-type': 'text/html' }
    }, {
      ttl: 1800000, // 30 minutes
      tags: ['webpage', 'html', 'example.com'],
      dependencies: ['robots:https://example.com'],
      events: ['site-updated']
    });
    
    // Cache extracted metadata
    await cache.set('metadata:https://example.com', {
      title: 'Example Domain',
      description: 'This domain is for use in examples',
      keywords: ['example', 'domain'],
      openGraph: { title: 'Example Domain', type: 'website' }
    }, {
      ttl: 3600000, // 1 hour
      tags: ['metadata', 'seo', 'example.com'],
      dependencies: ['page:https://example.com']
    });
    
    // Cache search results
    await cache.set('search:web scraping tools', {
      query: 'web scraping tools',
      results: [
        { title: 'Scrapy', url: 'https://scrapy.org' },
        { title: 'Beautiful Soup', url: 'https://www.crummy.com/software/BeautifulSoup/' }
      ],
      timestamp: Date.now(),
      provider: 'google'
    }, {
      ttl: 900000, // 15 minutes
      tags: ['search', 'results'],
      events: ['search-algorithm-update']
    });
    
    console.log('Cached web scraping data with tags and dependencies');
    
    // 2. Cache Warming for Popular Queries
    console.log('\n2. Setting up Cache Warming:');
    
    const popularSearchQueries = [
      'web scraping',
      'data extraction',
      'html parsing',
      'automation tools'
    ];
    
    // Add warming job for search results
    cache.addWarmingJob('popular-searches', async () => {
      console.log('Warming popular search queries...');
      return popularSearchQueries.map(query => ({
        key: `search:${query}`,
        value: {
          query,
          results: [], // Would be populated by actual search
          timestamp: Date.now(),
          warmed: true
        },
        options: {
          ttl: 900000,
          tags: ['search', 'warmed']
        }
      }));
    }, {
      interval: 1800000, // 30 minutes
      priority: 1
    });
    
    // Add warming job for robots.txt files
    cache.addWarmingJob('robots-files', async () => {
      console.log('Warming robots.txt files...');
      const domains = ['example.com', 'google.com', 'github.com'];
      return domains.map(domain => ({
        key: `robots:https://${domain}`,
        value: {
          domain,
          rules: ['User-agent: *', 'Disallow: /private/'],
          lastFetched: Date.now()
        },
        options: {
          ttl: 86400000, // 24 hours
          tags: ['robots', 'compliance']
        }
      }));
    }, {
      interval: 86400000, // 24 hours
      priority: 2
    });
    
    // 3. Event-based Cache Invalidation
    console.log('\n3. Demonstrating Event-based Invalidation:');
    
    // Simulate site update event
    setTimeout(() => {
      console.log('Site updated - invalidating related caches...');
      const invalidated = cache.invalidateByEvent('site-updated');
      console.log(`Invalidated ${invalidated} entries due to site update`);
    }, 2000);
    
    // 4. Monitoring and Performance
    console.log('\n4. Setting up Monitoring:');
    
    cache.on('hit', (key, source) => {
      if (key.startsWith('search:')) {
        console.log(`⚡ Search cache hit: ${key.substring(7)} (${source})`);
      }
    });
    
    cache.on('warmingJobExecuted', (jobId, data) => {
      console.log(`🔥 Warming job completed: ${jobId} (${data?.length || 0} items)`);
    });
    
    cache.on('invalidateByEvent', (event, count) => {
      console.log(`🔄 Event invalidation: ${event} (${count} items)`);
    });
    
    // Generate performance report after some activity
    setTimeout(async () => {
      // Simulate some cache activity
      await cache.get('search:web scraping tools'); // Hit
      await cache.get('search:non-existent'); // Miss
      await cache.get('metadata:https://example.com'); // Hit
      
      const report = cache.generatePerformanceReport();
      console.log('\n5. Performance Report:');
      console.log('Summary:', {
        requests: report.summary.totalRequests,
        hitRate: report.summary.hitRate.toFixed(1) + '%',
        avgResponseTime: report.summary.averageResponseTime.toFixed(1) + 'ms'
      });
      
      if (report.recommendations.length > 0) {
        console.log('Recommendations:');
        report.recommendations.forEach(rec => {
          console.log(`  - ${rec.severity.toUpperCase()}: ${rec.message}`);
        });
      }
    }, 3000);
  }
  
  return webScrapingCacheExample();
}

// =============================================================================
// MIGRATION GUIDE FOR EXISTING CODE
// =============================================================================

export function migrationGuideExample() {
  console.log('=== Migration Guide Example ===');
  
  console.log(`
MIGRATION GUIDE: Upgrading to Enhanced CacheManager

1. BACKWARD COMPATIBILITY
   All existing code continues to work without changes:
   
   // OLD CODE (still works)
   const cache = new CacheManager({ maxSize: 1000, ttl: 3600000 });
   await cache.set('key', value, ttl);
   const data = await cache.get('key');
   
2. ENHANCED FEATURES (optional upgrades)
   
   // NEW: Tags and dependencies
   await cache.set('key', value, {
     ttl: 3600000,
     tags: ['user', 'profile'],
     dependencies: ['config:global'],
     events: ['user-logout']
   });
   
   // NEW: Advanced invalidation
   cache.invalidateByTag('user');
   cache.invalidateByEvent('user-logout');
   cache.invalidateByPattern('^temp:');
   
   // NEW: Cache warming
   cache.addWarmingJob('popular-data', dataProvider, { interval: 3600000 });
   await cache.warmPopularQueries(queries, dataProvider);
   
   // NEW: Enhanced monitoring
   const detailedStats = cache.getDetailedStats();
   const report = cache.generatePerformanceReport();
   
   cache.on('hit', (key, source) => console.log('Cache hit:', key));
   cache.on('miss', (key) => console.log('Cache miss:', key));

3. CONFIGURATION OPTIONS
   
   // NEW OPTIONS (all optional, with sensible defaults)
   const cache = new CacheManager({
     // Existing options (unchanged)
     maxSize: 1000,
     ttl: 3600000,
     enableDiskCache: true,
     
     // New options
     enableCacheWarming: true,
     warmingBatchSize: 10,
     enableMonitoring: true,
     monitoringInterval: 60000,
     autoCleanupInterval: 300000,
     dependencyTracking: true
   });

4. PERFORMANCE IMPROVEMENTS
   - Response time tracking
   - Memory usage monitoring
   - Hit rate optimization
   - Automatic recommendations
   
5. CLEANUP
   Don't forget to call cache.destroy() when shutting down:
   
   process.on('SIGTERM', () => {
     cache.destroy();
     process.exit(0);
   });
`);
}

// =============================================================================
// EXPORT ALL EXAMPLES
// =============================================================================

export async function runAllExamples() {
  console.log('🚀 Running Enhanced CacheManager Examples\n');
  
  try {
    await basicUsageExample();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await invalidationStrategiesExample();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await cacheWarmingExample();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await monitoringExample();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await realWorldExample();
    await new Promise(resolve => setTimeout(resolve, 4000));
    
    migrationGuideExample();
    
    console.log('\n✅ All examples completed successfully!');
  } catch (error) {
    console.error('❌ Example failed:', error);
  }
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples();
}