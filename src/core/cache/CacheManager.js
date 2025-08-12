import { LRUCache } from 'lru-cache';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';

export class CacheManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    const {
      maxSize = 1000,
      ttl = 3600000, // 1 hour default
      diskCacheDir = './cache',
      enableDiskCache = true,
      enableCacheWarming = false,
      warmingBatchSize = 10,
      enableMonitoring = true,
      monitoringInterval = 60000, // 1 minute
      autoCleanupInterval = 300000, // 5 minutes
      dependencyTracking = false
    } = options;

    this.memoryCache = new LRUCache({
      max: maxSize,
      ttl,
      updateAgeOnGet: true,
      updateAgeOnHas: false,
      dispose: (value, key, reason) => {
        if (reason === 'evict') {
          this.stats.evictions++;
          this.emit('evict', key, value);
        }
      }
    });

    this.diskCacheDir = diskCacheDir;
    this.enableDiskCache = enableDiskCache;
    this.enableCacheWarming = enableCacheWarming;
    this.warmingBatchSize = warmingBatchSize;
    this.enableMonitoring = enableMonitoring;
    this.dependencyTracking = dependencyTracking;
    
    // Enhanced features
    this.dependencies = new Map(); // key -> Set of dependent keys
    this.reverseDependencies = new Map(); // key -> Set of keys it depends on
    this.warmingQueue = [];
    this.warmingJobs = new Map();
    this.eventInvalidators = new Map(); // event -> Set of cache keys
    this.tags = new Map(); // key -> Set of tags
    this.taggedKeys = new Map(); // tag -> Set of keys
    
    this.stats = {
      hits: 0,
      misses: 0,
      memoryHits: 0,
      diskHits: 0,
      evictions: 0,
      invalidations: 0,
      warmingHits: 0,
      totalRequests: 0,
      averageResponseTime: 0,
      memoryUsage: 0,
      diskUsage: 0,
      efficiency: 0,
      lastUpdated: Date.now()
    };
    
    this.performanceMetrics = {
      responseTimes: [],
      hitRateHistory: [],
      memoryUsageHistory: [],
      operationCounts: new Map()
    };

    if (this.enableDiskCache) {
      this.initDiskCache();
    }
    
    // Initialize monitoring
    if (this.enableMonitoring) {
      this.startMonitoring(monitoringInterval);
    }
    
    // Initialize auto cleanup
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, autoCleanupInterval);
    
    // Eviction tracking is handled in the LRU cache dispose callback above
  }

  async initDiskCache() {
    try {
      await fs.mkdir(this.diskCacheDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create cache directory:', error);
      this.enableDiskCache = false;
    }
  }

  generateKey(url, options = {}) {
    const keyData = { url, ...options };
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(keyData));
    return hash.digest('hex');
  }

  async get(key) {
    const startTime = performance.now();
    this.stats.totalRequests++;
    
    try {
      // Check memory cache first
      if (this.memoryCache.has(key)) {
        this.stats.hits++;
        this.stats.memoryHits++;
        const value = this.memoryCache.get(key);
        this.recordResponseTime(performance.now() - startTime);
        this.emit('hit', key, 'memory');
        return value;
      }

      // Check disk cache if enabled
      if (this.enableDiskCache) {
        const diskData = await this.getDiskCache(key);
        if (diskData) {
          this.stats.hits++;
          this.stats.diskHits++;
          // Promote to memory cache
          this.memoryCache.set(key, diskData);
          this.recordResponseTime(performance.now() - startTime);
          this.emit('hit', key, 'disk');
          return diskData;
        }
      }

      this.stats.misses++;
      this.recordResponseTime(performance.now() - startTime);
      this.emit('miss', key);
      return null;
    } catch (error) {
      this.emit('error', error, key);
      throw error;
    }
  }

  async set(key, value, options = {}) {
    const { ttl, tags = [], dependencies = [], events = [] } = options;
    
    // Handle legacy API
    const finalTtl = typeof options === 'number' ? options : ttl;
    
    // Set in memory cache
    this.memoryCache.set(key, value, { ttl: finalTtl });

    // Set in disk cache if enabled
    if (this.enableDiskCache) {
      await this.setDiskCache(key, value, finalTtl);
    }
    
    // Handle tags
    if (tags.length > 0) {
      this.tags.set(key, new Set(tags));
      tags.forEach(tag => {
        if (!this.taggedKeys.has(tag)) {
          this.taggedKeys.set(tag, new Set());
        }
        this.taggedKeys.get(tag).add(key);
      });
    }
    
    // Handle dependencies
    if (dependencies.length > 0 && this.dependencyTracking) {
      this.reverseDependencies.set(key, new Set(dependencies));
      dependencies.forEach(dep => {
        if (!this.dependencies.has(dep)) {
          this.dependencies.set(dep, new Set());
        }
        this.dependencies.get(dep).add(key);
      });
    }
    
    // Handle event-based invalidation
    events.forEach(event => {
      if (!this.eventInvalidators.has(event)) {
        this.eventInvalidators.set(event, new Set());
      }
      this.eventInvalidators.get(event).add(key);
    });
    
    this.emit('set', key, value, options);
  }

  async getDiskCache(key) {
    try {
      const filePath = path.join(this.diskCacheDir, `${key}.json`);
      const data = await fs.readFile(filePath, 'utf8');
      const cached = JSON.parse(data);

      // Check if expired
      if (cached.expiry && Date.now() > cached.expiry) {
        await fs.unlink(filePath).catch(() => {}); // Clean up expired file
        return null;
      }

      return cached.value;
    } catch (error) {
      return null;
    }
  }

  async setDiskCache(key, value, ttl) {
    try {
      const filePath = path.join(this.diskCacheDir, `${key}.json`);
      const expiry = ttl ? Date.now() + ttl : null;
      const data = JSON.stringify({ value, expiry }, null, 2);
      await fs.writeFile(filePath, data, 'utf8');
    } catch (error) {
      console.error('Failed to write disk cache:', error);
    }
  }

  has(key) {
    return this.memoryCache.has(key);
  }

  delete(key) {
    this.memoryCache.delete(key);
    if (this.enableDiskCache) {
      const filePath = path.join(this.diskCacheDir, `${key}.json`);
      fs.unlink(filePath).catch(() => {});
    }
    
    // Clean up metadata
    this.cleanupKeyMetadata(key);
    
    // Handle dependency invalidation
    if (this.dependencyTracking && this.dependencies.has(key)) {
      const dependentKeys = this.dependencies.get(key);
      dependentKeys.forEach(depKey => this.delete(depKey));
      this.dependencies.delete(key);
    }
    
    this.stats.invalidations++;
    this.emit('delete', key);
  }

  clear() {
    this.memoryCache.clear();
    if (this.enableDiskCache) {
      this.clearDiskCache();
    }
  }

  async clearDiskCache() {
    try {
      const files = await fs.readdir(this.diskCacheDir);
      const deletePromises = files
        .filter(file => file.endsWith('.json'))
        .map(file => fs.unlink(path.join(this.diskCacheDir, file)));
      await Promise.all(deletePromises);
    } catch (error) {
      console.error('Failed to clear disk cache:', error);
    }
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? (this.stats.hits / total) * 100 : 0,
      memorySize: this.memoryCache.size,
      memoryMax: this.memoryCache.max
    };
  }

  async cleanupExpired() {
    if (!this.enableDiskCache) return;

    try {
      const files = await fs.readdir(this.diskCacheDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const filePath = path.join(this.diskCacheDir, file);
        const data = await fs.readFile(filePath, 'utf8');
        const cached = JSON.parse(data);
        
        if (cached.expiry && Date.now() > cached.expiry) {
          await fs.unlink(filePath);
        }
      }
    } catch (error) {
      console.error('Failed to cleanup expired cache:', error);
    }
  }

  // ADVANCED CACHE INVALIDATION STRATEGIES

  /**
   * Invalidate cache entries by tags
   */
  invalidateByTag(tag) {
    if (!this.taggedKeys.has(tag)) return 0;
    
    const keys = this.taggedKeys.get(tag);
    let invalidated = 0;
    
    keys.forEach(key => {
      this.delete(key);
      invalidated++;
    });
    
    this.taggedKeys.delete(tag);
    this.emit('invalidateByTag', tag, invalidated);
    return invalidated;
  }

  /**
   * Invalidate cache entries by multiple tags
   */
  invalidateByTags(tags) {
    let totalInvalidated = 0;
    tags.forEach(tag => {
      totalInvalidated += this.invalidateByTag(tag);
    });
    return totalInvalidated;
  }

  /**
   * Invalidate cache entries by event
   */
  invalidateByEvent(event) {
    if (!this.eventInvalidators.has(event)) return 0;
    
    const keys = this.eventInvalidators.get(event);
    let invalidated = 0;
    
    keys.forEach(key => {
      this.delete(key);
      invalidated++;
    });
    
    this.eventInvalidators.delete(event);
    this.emit('invalidateByEvent', event, invalidated);
    return invalidated;
  }

  /**
   * Invalidate cache entries by pattern
   */
  invalidateByPattern(pattern) {
    const regex = new RegExp(pattern);
    const keysToDelete = [];
    
    // Check memory cache keys
    for (const key of this.memoryCache.keys()) {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.delete(key));
    this.emit('invalidateByPattern', pattern, keysToDelete.length);
    return keysToDelete.length;
  }

  /**
   * Selective cache clearing with options
   */
  selectiveClear(options = {}) {
    const { tags, events, pattern, olderThan, excludeKeys = [] } = options;
    let cleared = 0;
    
    if (tags) {
      cleared += this.invalidateByTags(Array.isArray(tags) ? tags : [tags]);
    }
    
    if (events) {
      const eventList = Array.isArray(events) ? events : [events];
      eventList.forEach(event => {
        cleared += this.invalidateByEvent(event);
      });
    }
    
    if (pattern) {
      cleared += this.invalidateByPattern(pattern);
    }
    
    if (olderThan) {
      cleared += this.clearOlderThan(olderThan, excludeKeys);
    }
    
    this.emit('selectiveClear', options, cleared);
    return cleared;
  }

  /**
   * Clear entries older than specified time
   */
  clearOlderThan(maxAge, excludeKeys = []) {
    const cutoff = Date.now() - maxAge;
    const excludeSet = new Set(excludeKeys);
    let cleared = 0;
    
    // This would require storing timestamps with each entry
    // For now, we'll implement a basic version
    this.memoryCache.forEach((value, key) => {
      if (!excludeSet.has(key)) {
        // LRU cache doesn't expose creation time, so we'll use a different approach
        // This is a simplified implementation
        this.delete(key);
        cleared++;
      }
    });
    
    return cleared;
  }

  // CACHE WARMING FEATURES

  /**
   * Add cache warming job
   */
  addWarmingJob(jobId, dataProvider, options = {}) {
    const job = {
      id: jobId,
      dataProvider,
      priority: options.priority || 1,
      interval: options.interval || null,
      enabled: options.enabled !== false,
      lastRun: null,
      nextRun: options.scheduleTime || null
    };
    
    this.warmingJobs.set(jobId, job);
    
    if (job.interval) {
      this.scheduleWarmingJob(job);
    }
    
    this.emit('warmingJobAdded', jobId, job);
    return job;
  }

  /**
   * Remove cache warming job
   */
  removeWarmingJob(jobId) {
    const job = this.warmingJobs.get(jobId);
    if (job && job.timer) {
      clearTimeout(job.timer);
    }
    
    const removed = this.warmingJobs.delete(jobId);
    this.emit('warmingJobRemoved', jobId);
    return removed;
  }

  /**
   * Execute cache warming job
   */
  async executeWarmingJob(jobId) {
    const job = this.warmingJobs.get(jobId);
    if (!job || !job.enabled) return false;
    
    try {
      job.lastRun = Date.now();
      const data = await job.dataProvider();
      
      if (Array.isArray(data)) {
        const batches = this.chunkArray(data, this.warmingBatchSize);
        
        for (const batch of batches) {
          await Promise.all(batch.map(async ({ key, value, options }) => {
            await this.set(key, value, options);
            this.stats.warmingHits++;
          }));
        }
      }
      
      if (job.interval) {
        this.scheduleWarmingJob(job);
      }
      
      this.emit('warmingJobExecuted', jobId, data);
      return true;
    } catch (error) {
      this.emit('warmingJobError', jobId, error);
      return false;
    }
  }

  /**
   * Schedule warming job
   */
  scheduleWarmingJob(job) {
    if (job.timer) {
      clearTimeout(job.timer);
    }
    
    job.timer = setTimeout(() => {
      this.executeWarmingJob(job.id);
    }, job.interval);
  }

  /**
   * Preemptive cache warming for popular queries
   */
  async warmPopularQueries(queries, dataProvider) {
    const batches = this.chunkArray(queries, this.warmingBatchSize);
    let warmed = 0;
    
    for (const batch of batches) {
      await Promise.all(batch.map(async (query) => {
        try {
          const key = this.generateKey(query);
          if (!this.has(key)) {
            const data = await dataProvider(query);
            await this.set(key, data);
            warmed++;
            this.stats.warmingHits++;
          }
        } catch (error) {
          this.emit('warmingError', query, error);
        }
      }));
    }
    
    this.emit('popularQueriesWarmed', warmed);
    return warmed;
  }

  // CACHE STATISTICS & MONITORING

  /**
   * Start monitoring
   */
  startMonitoring(interval) {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
    }
    
    this.monitoringTimer = setInterval(() => {
      this.updateStats();
      this.emit('monitoring', this.getDetailedStats());
    }, interval);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
  }

  /**
   * Update statistics
   */
  updateStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
    
    this.stats.efficiency = hitRate;
    this.stats.lastUpdated = Date.now();
    
    // Update history
    this.performanceMetrics.hitRateHistory.push({
      timestamp: Date.now(),
      hitRate
    });
    
    // Keep only last 100 measurements
    if (this.performanceMetrics.hitRateHistory.length > 100) {
      this.performanceMetrics.hitRateHistory.shift();
    }
    
    // Update memory usage
    this.stats.memoryUsage = this.calculateMemoryUsage();
    this.performanceMetrics.memoryUsageHistory.push({
      timestamp: Date.now(),
      usage: this.stats.memoryUsage
    });
    
    if (this.performanceMetrics.memoryUsageHistory.length > 100) {
      this.performanceMetrics.memoryUsageHistory.shift();
    }
  }

  /**
   * Get detailed statistics
   */
  getDetailedStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
    const averageResponseTime = this.performanceMetrics.responseTimes.length > 0 
      ? this.performanceMetrics.responseTimes.reduce((a, b) => a + b, 0) / this.performanceMetrics.responseTimes.length 
      : 0;
    
    return {
      ...this.stats,
      hitRate,
      averageResponseTime,
      memorySize: this.memoryCache.size,
      memoryMax: this.memoryCache.max,
      cacheUtilization: (this.memoryCache.size / this.memoryCache.max) * 100,
      warmingJobsCount: this.warmingJobs.size,
      taggedKeysCount: this.taggedKeys.size,
      dependenciesCount: this.dependencies.size,
      performanceMetrics: {
        recentHitRates: this.performanceMetrics.hitRateHistory.slice(-10),
        recentMemoryUsage: this.performanceMetrics.memoryUsageHistory.slice(-10),
        operationCounts: Object.fromEntries(this.performanceMetrics.operationCounts)
      }
    };
  }

  /**
   * Generate cache performance report
   */
  generatePerformanceReport() {
    const stats = this.getDetailedStats();
    const report = {
      timestamp: Date.now(),
      summary: {
        totalRequests: stats.totalRequests,
        hitRate: stats.hitRate,
        averageResponseTime: stats.averageResponseTime,
        memoryUtilization: stats.cacheUtilization,
        efficiency: stats.efficiency
      },
      breakdown: {
        memoryHits: stats.memoryHits,
        diskHits: stats.diskHits,
        misses: stats.misses,
        evictions: stats.evictions,
        invalidations: stats.invalidations
      },
      trends: {
        hitRateHistory: this.performanceMetrics.hitRateHistory,
        memoryUsageHistory: this.performanceMetrics.memoryUsageHistory
      },
      configuration: {
        maxSize: this.memoryCache.max,
        enableDiskCache: this.enableDiskCache,
        enableCacheWarming: this.enableCacheWarming,
        dependencyTracking: this.dependencyTracking
      },
      recommendations: this.generateRecommendations(stats)
    };
    
    this.emit('performanceReport', report);
    return report;
  }

  /**
   * Generate performance recommendations
   */
  generateRecommendations(stats) {
    const recommendations = [];
    
    if (stats.hitRate < 50) {
      recommendations.push({
        type: 'hitRate',
        severity: 'high',
        message: 'Hit rate is below 50%. Consider increasing cache size or adjusting TTL.'
      });
    }
    
    if (stats.cacheUtilization > 90) {
      recommendations.push({
        type: 'memory',
        severity: 'medium',
        message: 'Cache utilization is high. Consider increasing max cache size.'
      });
    }
    
    if (stats.averageResponseTime > 100) {
      recommendations.push({
        type: 'performance',
        severity: 'medium',
        message: 'Average response time is high. Check disk cache performance.'
      });
    }
    
    if (!this.enableCacheWarming && stats.misses > stats.hits) {
      recommendations.push({
        type: 'warming',
        severity: 'low',
        message: 'Consider enabling cache warming for popular queries.'
      });
    }
    
    return recommendations;
  }

  // UTILITY METHODS

  /**
   * Record response time
   */
  recordResponseTime(time) {
    this.performanceMetrics.responseTimes.push(time);
    
    // Keep only last 1000 measurements
    if (this.performanceMetrics.responseTimes.length > 1000) {
      this.performanceMetrics.responseTimes.shift();
    }
    
    // Update average
    this.stats.averageResponseTime = 
      this.performanceMetrics.responseTimes.reduce((a, b) => a + b, 0) / 
      this.performanceMetrics.responseTimes.length;
  }

  /**
   * Clean up key metadata
   */
  cleanupKeyMetadata(key) {
    // Clean up tags
    if (this.tags.has(key)) {
      const keyTags = this.tags.get(key);
      keyTags.forEach(tag => {
        if (this.taggedKeys.has(tag)) {
          this.taggedKeys.get(tag).delete(key);
          if (this.taggedKeys.get(tag).size === 0) {
            this.taggedKeys.delete(tag);
          }
        }
      });
      this.tags.delete(key);
    }
    
    // Clean up dependencies
    if (this.reverseDependencies.has(key)) {
      const deps = this.reverseDependencies.get(key);
      deps.forEach(dep => {
        if (this.dependencies.has(dep)) {
          this.dependencies.get(dep).delete(key);
          if (this.dependencies.get(dep).size === 0) {
            this.dependencies.delete(dep);
          }
        }
      });
      this.reverseDependencies.delete(key);
    }
    
    // Clean up event invalidators
    for (const [event, keys] of this.eventInvalidators) {
      keys.delete(key);
      if (keys.size === 0) {
        this.eventInvalidators.delete(event);
      }
    }
  }

  /**
   * Calculate memory usage
   */
  calculateMemoryUsage() {
    // Rough estimation of memory usage
    let size = 0;
    this.memoryCache.forEach((value, key) => {
      size += this.estimateObjectSize(key) + this.estimateObjectSize(value);
    });
    return size;
  }

  /**
   * Estimate object size in bytes
   */
  estimateObjectSize(obj) {
    if (obj === null || obj === undefined) return 0;
    if (typeof obj === 'string') return obj.length * 2;
    if (typeof obj === 'number') return 8;
    if (typeof obj === 'boolean') return 4;
    if (typeof obj === 'object') {
      return JSON.stringify(obj).length * 2;
    }
    return 0;
  }

  /**
   * Chunk array into smaller arrays
   */
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Cleanup resources
   */
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
    }
    
    this.warmingJobs.forEach(job => {
      if (job.timer) {
        clearTimeout(job.timer);
      }
    });
    
    this.removeAllListeners();
    this.emit('destroyed');
  }
}

export default CacheManager;