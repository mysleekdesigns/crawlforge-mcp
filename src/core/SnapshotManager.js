/**
 * SnapshotManager - Snapshot Storage and Management
 * Handles snapshot storage with compression, delta storage for efficiency,
 * retention policies, cleanup, and change history querying
 */

import { promises as fs } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import { z } from 'zod';
import { EventEmitter } from 'events';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const SnapshotSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  content: z.string(),
  metadata: z.object({
    timestamp: z.number(),
    contentHash: z.string(),
    contentLength: z.number(),
    contentType: z.string().optional(),
    userAgent: z.string().optional(),
    statusCode: z.number().optional(),
    headers: z.record(z.string()).optional(),
    extractionOptions: z.object({}).optional()
  }),
  compression: z.object({
    enabled: z.boolean().default(true),
    algorithm: z.enum(['gzip', 'none']).default('gzip'),
    originalSize: z.number().optional(),
    compressedSize: z.number().optional(),
    compressionRatio: z.number().optional()
  }).optional(),
  delta: z.object({
    enabled: z.boolean().default(false),
    baseSnapshotId: z.string().optional(),
    deltaData: z.string().optional(),
    deltaSize: z.number().optional()
  }).optional()
});

const RetentionPolicySchema = z.object({
  maxSnapshots: z.number().min(1).default(100),
  maxAge: z.number().min(3600000).default(30 * 24 * 3600 * 1000), // 30 days
  maxStorageSize: z.number().min(10 * 1024 * 1024).default(1 * 1024 * 1024 * 1024), // 1GB
  compressionThreshold: z.number().min(1024).default(10 * 1024), // 10KB
  enableDeltaStorage: z.boolean().default(true),
  deltaThreshold: z.number().min(0).max(1).default(0.8), // Similarity threshold for delta storage
  autoCleanup: z.boolean().default(true),
  cleanupInterval: z.number().min(60000).default(24 * 3600 * 1000) // 24 hours
});

const QuerySchema = z.object({
  url: z.string().url().optional(),
  startTime: z.number().optional(),
  endTime: z.number().optional(),
  limit: z.number().min(1).max(1000).default(50),
  offset: z.number().min(0).default(0),
  includeDelta: z.boolean().default(true),
  includeContent: z.boolean().default(false),
  sortBy: z.enum(['timestamp', 'size', 'similarity']).default('timestamp'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  filters: z.object({
    minSize: z.number().optional(),
    maxSize: z.number().optional(),
    contentType: z.string().optional(),
    hasChanges: z.boolean().optional()
  }).optional()
});

export class SnapshotManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      storageDir: options.storageDir || './snapshots',
      metadataDir: options.metadataDir || './snapshots/metadata',
      tempDir: options.tempDir || './snapshots/temp',
      enableCompression: options.enableCompression !== false,
      enableDeltaStorage: options.enableDeltaStorage !== false,
      enableEncryption: options.enableEncryption || false,
      encryptionKey: options.encryptionKey,
      maxConcurrentOperations: options.maxConcurrentOperations || 10,
      cacheEnabled: options.cacheEnabled !== false,
      cacheSize: options.cacheSize || 100,
      ...options
    };
    
    this.retentionPolicy = RetentionPolicySchema.parse(options.retentionPolicy || {});
    
    // In-memory cache for frequently accessed snapshots
    this.snapshotCache = new Map();
    this.metadataCache = new Map();
    
    // Storage statistics
    this.stats = {
      totalSnapshots: 0,
      totalStorageSize: 0,
      compressedSnapshots: 0,
      deltaSnapshots: 0,
      averageCompressionRatio: 0,
      averageDeltaSize: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cleanupOperations: 0,
      lastCleanup: null,
      operationCounts: {
        store: 0,
        retrieve: 0,
        delete: 0,
        query: 0
      }
    };
    
    // Active operations tracking
    this.activeOperations = new Map();
    this.operationQueue = [];
    
    // Cleanup timer
    this.cleanupTimer = null;
    
    this.initialize();
  }
  
  async initialize() {
    try {
      // Create storage directories
      await this.createDirectories();
      
      // Load existing snapshot metadata
      await this.loadMetadata();
      
      // Start cleanup timer if enabled
      if (this.retentionPolicy.autoCleanup) {
        this.startCleanupTimer();
      }
      
      // Initialize cache
      if (this.options.cacheEnabled) {
        await this.initializeCache();
      }
      
      this.emit('initialized', {
        totalSnapshots: this.stats.totalSnapshots,
        storageSize: this.stats.totalStorageSize
      });
      
    } catch (error) {
      this.emit('error', { operation: 'initialize', error: error.message });
      throw error;
    }
  }
  
  /**
   * Store a new snapshot
   * @param {string} url - URL of the snapshot
   * @param {string} content - Content to store
   * @param {Object} metadata - Additional metadata
   * @param {Object} options - Storage options
   * @returns {Object} - Stored snapshot information
   */
  async storeSnapshot(url, content, metadata = {}, options = {}) {
    const operationId = this.generateOperationId();

    try {
      // Validate content is not null/undefined
      if (content === null || content === undefined) {
        throw new Error('Content cannot be null or undefined');
      }

      // Ensure content is a string
      if (typeof content !== 'string') {
        content = String(content);
      }

      this.activeOperations.set(operationId, { type: 'store', url, startTime: Date.now() });

      const snapshotId = this.generateSnapshotId(url, metadata.timestamp || Date.now());
      const contentHash = this.hashContent(content);
      
      // Check for similar existing snapshots for delta storage
      let deltaInfo = null;
      if (this.retentionPolicy.enableDeltaStorage) {
        deltaInfo = await this.findSimilarSnapshot(url, contentHash, content);
      }
      
      // Prepare snapshot data
      const snapshot = {
        id: snapshotId,
        url,
        content,
        metadata: {
          timestamp: Date.now(),
          contentHash,
          contentLength: content.length,
          contentType: metadata.contentType || 'text/html',
          userAgent: metadata.userAgent,
          statusCode: metadata.statusCode,
          headers: metadata.headers,
          extractionOptions: metadata.extractionOptions,
          ...metadata
        },
        compression: {
          enabled: false,
          algorithm: 'none',
          originalSize: content.length
        },
        delta: {
          enabled: false
        }
      };
      
      let finalContent = content;
      let isCompressed = false;
      let isDelta = false;
      
      // Apply delta storage if similar snapshot found
      if (deltaInfo && deltaInfo.similarity > this.retentionPolicy.deltaThreshold) {
        const deltaData = this.createDelta(deltaInfo.content, content);
        if (deltaData.length < content.length * 0.7) { // Only use delta if it's significantly smaller
          finalContent = deltaData;
          isDelta = true;
          
          snapshot.delta = {
            enabled: true,
            baseSnapshotId: deltaInfo.snapshotId,
            deltaData: deltaData,
            deltaSize: deltaData.length
          };
          
          this.stats.deltaSnapshots++;
        }
      }
      
      // Apply compression if enabled and above threshold
      if (this.options.enableCompression && 
          finalContent.length > this.retentionPolicy.compressionThreshold) {
        
        const compressed = await gzipAsync(finalContent);
        const compressionRatio = compressed.length / finalContent.length;
        
        if (compressionRatio < 0.8) { // Only compress if it reduces size by at least 20%
          finalContent = compressed;
          isCompressed = true;
          
          snapshot.compression = {
            enabled: true,
            algorithm: 'gzip',
            originalSize: content.length,
            compressedSize: compressed.length,
            compressionRatio
          };
          
          this.stats.compressedSnapshots++;
          this.updateCompressionStats(compressionRatio);
        }
      }
      
      // Store snapshot to disk
      const filePath = await this.writeSnapshotFile(snapshotId, finalContent);
      
      // Store metadata
      await this.storeMetadata(snapshotId, snapshot);
      
      // Update cache
      if (this.options.cacheEnabled) {
        this.updateCache(snapshotId, snapshot);
      }
      
      // Update statistics
      this.updateStorageStats(snapshot, isDelta);
      this.stats.operationCounts.store++;
      
      this.activeOperations.delete(operationId);
      
      this.emit('snapshotStored', {
        snapshotId,
        url,
        size: finalContent.length,
        originalSize: content.length,
        compressed: isCompressed,
        delta: isDelta,
        filePath
      });
      
      return {
        snapshotId,
        url,
        timestamp: snapshot.metadata.timestamp,
        contentHash,
        size: finalContent.length,
        originalSize: content.length,
        compressed: isCompressed,
        compressionRatio: snapshot.compression.compressionRatio,
        delta: isDelta,
        deltaSize: snapshot.delta.deltaSize
      };
      
    } catch (error) {
      this.activeOperations.delete(operationId);
      this.emit('error', { operation: 'storeSnapshot', url, error: error.message });
      throw new Error(`Failed to store snapshot: ${error.message}`);
    }
  }
  
  /**
   * Retrieve a snapshot by ID
   * @param {string} snapshotId - Snapshot ID
   * @param {Object} options - Retrieval options
   * @returns {Object} - Retrieved snapshot
   */
  async retrieveSnapshot(snapshotId, options = {}) {
    const operationId = this.generateOperationId();
    
    try {
      this.activeOperations.set(operationId, { 
        type: 'retrieve', 
        snapshotId, 
        startTime: Date.now() 
      });
      
      // Check cache first
      if (this.options.cacheEnabled && this.snapshotCache.has(snapshotId)) {
        this.stats.cacheHits++;
        const cached = this.snapshotCache.get(snapshotId);
        this.activeOperations.delete(operationId);
        return cached;
      }
      
      this.stats.cacheMisses++;
      
      // Load metadata
      const metadata = await this.loadSnapshotMetadata(snapshotId);
      if (!metadata) {
        throw new Error(`Snapshot not found: ${snapshotId}`);
      }
      
      // Read snapshot file
      let content = await this.readSnapshotFile(snapshotId);
      
      // Decompress if needed
      if (metadata.compression && metadata.compression.enabled) {
        if (metadata.compression.algorithm === 'gzip') {
          content = await gunzipAsync(content);
          content = content.toString();
        }
      }
      
      // Reconstruct from delta if needed
      if (metadata.delta && metadata.delta.enabled) {
        const baseSnapshot = await this.retrieveSnapshot(metadata.delta.baseSnapshotId, options);
        content = this.applyDelta(baseSnapshot.content, content);
      }
      
      const snapshot = {
        ...metadata,
        content: options.includeContent !== false ? content : undefined,
        retrievedAt: Date.now()
      };
      
      // Update cache
      if (this.options.cacheEnabled) {
        this.updateCache(snapshotId, snapshot);
      }
      
      this.stats.operationCounts.retrieve++;
      this.activeOperations.delete(operationId);
      
      this.emit('snapshotRetrieved', {
        snapshotId,
        url: metadata.url,
        size: content.length,
        fromCache: false
      });
      
      return snapshot;
      
    } catch (error) {
      this.activeOperations.delete(operationId);
      this.emit('error', { operation: 'retrieveSnapshot', snapshotId, error: error.message });
      throw new Error(`Failed to retrieve snapshot: ${error.message}`);
    }
  }
  
  /**
   * Query snapshots with filters
   * @param {Object} query - Query parameters
   * @returns {Array} - Matching snapshots
   */
  async querySnapshots(query = {}) {
    try {
      const validated = QuerySchema.parse(query);
      
      // Load all metadata that matches URL filter
      let snapshots = [];
      
      for (const [snapshotId, metadata] of this.metadataCache) {
        if (validated.url && metadata.url !== validated.url) continue;
        
        if (validated.startTime && metadata.metadata.timestamp < validated.startTime) continue;
        if (validated.endTime && metadata.metadata.timestamp > validated.endTime) continue;
        
        if (validated.filters) {
          const filters = validated.filters;
          
          if (filters.minSize && metadata.metadata.contentLength < filters.minSize) continue;
          if (filters.maxSize && metadata.metadata.contentLength > filters.maxSize) continue;
          if (filters.contentType && metadata.metadata.contentType !== filters.contentType) continue;
        }
        
        snapshots.push({
          ...metadata,
          content: undefined // Don't include content by default
        });
      }
      
      // Sort snapshots
      snapshots.sort((a, b) => {
        const aValue = this.getSortValue(a, validated.sortBy);
        const bValue = this.getSortValue(b, validated.sortBy);
        
        if (validated.sortOrder === 'desc') {
          return bValue - aValue;
        } else {
          return aValue - bValue;
        }
      });
      
      // Apply pagination
      const start = validated.offset;
      const end = start + validated.limit;
      snapshots = snapshots.slice(start, end);
      
      // Include content if requested
      if (validated.includeContent) {
        snapshots = await Promise.all(
          snapshots.map(async (snapshot) => {
            const fullSnapshot = await this.retrieveSnapshot(snapshot.id, { includeContent: true });
            return fullSnapshot;
          })
        );
      }
      
      this.stats.operationCounts.query++;
      
      this.emit('snapshotsQueried', {
        query: validated,
        resultCount: snapshots.length,
        totalMatching: snapshots.length + validated.offset
      });
      
      return {
        snapshots,
        totalCount: snapshots.length,
        query: validated,
        executedAt: Date.now()
      };
      
    } catch (error) {
      this.emit('error', { operation: 'querySnapshots', query, error: error.message });
      throw new Error(`Failed to query snapshots: ${error.message}`);
    }
  }
  
  /**
   * Get change history for a URL
   * @param {string} url - URL to get history for
   * @param {Object} options - History options
   * @returns {Array} - Change history
   */
  async getChangeHistory(url, options = {}) {
    try {
      const snapshots = await this.querySnapshots({
        url,
        limit: options.limit || 100,
        sortBy: 'timestamp',
        sortOrder: 'desc',
        includeContent: false
      });
      
      const history = [];
      const snapshotList = snapshots.snapshots;
      
      for (let i = 0; i < snapshotList.length - 1; i++) {
        const current = snapshotList[i];
        const previous = snapshotList[i + 1];
        
        // Calculate change metrics
        const changeMetrics = await this.calculateChangeMetrics(previous, current);
        
        history.push({
          timestamp: current.metadata.timestamp,
          snapshotId: current.id,
          previousSnapshotId: previous.id,
          changes: changeMetrics,
          timeDelta: current.metadata.timestamp - previous.metadata.timestamp,
          sizeDelta: current.metadata.contentLength - previous.metadata.contentLength
        });
      }
      
      return {
        url,
        history,
        totalSnapshots: snapshotList.length,
        timespan: snapshotList.length > 0 ? 
          snapshotList[0].metadata.timestamp - snapshotList[snapshotList.length - 1].metadata.timestamp : 0
      };
      
    } catch (error) {
      this.emit('error', { operation: 'getChangeHistory', url, error: error.message });
      throw new Error(`Failed to get change history: ${error.message}`);
    }
  }
  
  /**
   * Delete snapshots
   * @param {string|Array} snapshotIds - Snapshot ID(s) to delete
   * @returns {Object} - Deletion results
   */
  async deleteSnapshots(snapshotIds) {
    const ids = Array.isArray(snapshotIds) ? snapshotIds : [snapshotIds];
    const results = {
      deleted: [],
      failed: [],
      totalSize: 0
    };
    
    try {
      for (const snapshotId of ids) {
        try {
          const metadata = await this.loadSnapshotMetadata(snapshotId);
          if (!metadata) {
            results.failed.push({ snapshotId, error: 'Snapshot not found' });
            continue;
          }
          
          // Delete file
          await this.deleteSnapshotFile(snapshotId);
          
          // Delete metadata
          await this.deleteSnapshotMetadata(snapshotId);
          
          // Remove from cache
          this.snapshotCache.delete(snapshotId);
          this.metadataCache.delete(snapshotId);
          
          // Update statistics
          this.stats.totalSnapshots--;
          this.stats.totalStorageSize -= metadata.metadata.contentLength;
          
          results.deleted.push(snapshotId);
          results.totalSize += metadata.metadata.contentLength;
          
          this.emit('snapshotDeleted', { snapshotId, size: metadata.metadata.contentLength });
          
        } catch (error) {
          results.failed.push({ snapshotId, error: error.message });
        }
      }
      
      this.stats.operationCounts.delete += results.deleted.length;
      
      return results;
      
    } catch (error) {
      this.emit('error', { operation: 'deleteSnapshots', snapshotIds, error: error.message });
      throw new Error(`Failed to delete snapshots: ${error.message}`);
    }
  }
  
  /**
   * Clean up old snapshots based on retention policy
   * @returns {Object} - Cleanup results
   */
  async cleanupSnapshots() {
    const startTime = Date.now();
    
    try {
      const cleanupResults = {
        deletedCount: 0,
        freedSpace: 0,
        errors: []
      };
      
      const allSnapshots = Array.from(this.metadataCache.values());
      const now = Date.now();
      
      // Group snapshots by URL for intelligent cleanup
      const snapshotsByUrl = new Map();
      allSnapshots.forEach(snapshot => {
        const url = snapshot.url;
        if (!snapshotsByUrl.has(url)) {
          snapshotsByUrl.set(url, []);
        }
        snapshotsByUrl.get(url).push(snapshot);
      });
      
      // Cleanup by retention policy rules
      for (const [url, snapshots] of snapshotsByUrl) {
        const sortedSnapshots = snapshots.sort((a, b) => 
          b.metadata.timestamp - a.metadata.timestamp
        );
        
        const toDelete = [];
        
        // Rule 1: Respect maximum snapshot limit per URL
        if (sortedSnapshots.length > this.retentionPolicy.maxSnapshots) {
          toDelete.push(...sortedSnapshots.slice(this.retentionPolicy.maxSnapshots));
        }
        
        // Rule 2: Delete snapshots older than maxAge
        const ageThreshold = now - this.retentionPolicy.maxAge;
        sortedSnapshots.forEach(snapshot => {
          if (snapshot.metadata.timestamp < ageThreshold && !toDelete.includes(snapshot)) {
            toDelete.push(snapshot);
          }
        });
        
        // Delete marked snapshots
        if (toDelete.length > 0) {
          const deleteResult = await this.deleteSnapshots(toDelete.map(s => s.id));
          cleanupResults.deletedCount += deleteResult.deleted.length;
          cleanupResults.freedSpace += deleteResult.totalSize;
          cleanupResults.errors.push(...deleteResult.failed);
        }
      }
      
      // Rule 3: Check total storage size
      if (this.stats.totalStorageSize > this.retentionPolicy.maxStorageSize) {
        const excess = this.stats.totalStorageSize - this.retentionPolicy.maxStorageSize;
        const additionalCleanup = await this.cleanupBySize(excess);
        
        cleanupResults.deletedCount += additionalCleanup.deletedCount;
        cleanupResults.freedSpace += additionalCleanup.freedSpace;
      }
      
      const cleanupTime = Date.now() - startTime;
      
      this.stats.cleanupOperations++;
      this.stats.lastCleanup = Date.now();
      
      this.emit('cleanupCompleted', {
        ...cleanupResults,
        cleanupTime,
        remainingSnapshots: this.stats.totalSnapshots,
        remainingSize: this.stats.totalStorageSize
      });
      
      return {
        ...cleanupResults,
        cleanupTime
      };
      
    } catch (error) {
      this.emit('error', { operation: 'cleanupSnapshots', error: error.message });
      throw new Error(`Failed to cleanup snapshots: ${error.message}`);
    }
  }
  
  // File system operations
  
  async createDirectories() {
    const dirs = [
      this.options.storageDir,
      this.options.metadataDir,
      this.options.tempDir
    ];
    
    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }
  
  async writeSnapshotFile(snapshotId, content) {
    const filePath = path.join(this.options.storageDir, `${snapshotId}.snap`);
    
    if (Buffer.isBuffer(content)) {
      await fs.writeFile(filePath, content);
    } else {
      await fs.writeFile(filePath, content, 'utf8');
    }
    
    return filePath;
  }
  
  async readSnapshotFile(snapshotId) {
    const filePath = path.join(this.options.storageDir, `${snapshotId}.snap`);
    return await fs.readFile(filePath);
  }
  
  async deleteSnapshotFile(snapshotId) {
    const filePath = path.join(this.options.storageDir, `${snapshotId}.snap`);
    await fs.unlink(filePath);
  }
  
  async storeMetadata(snapshotId, metadata) {
    const filePath = path.join(this.options.metadataDir, `${snapshotId}.meta`);
    await fs.writeFile(filePath, JSON.stringify(metadata, null, 2), 'utf8');
    
    // Update in-memory cache
    this.metadataCache.set(snapshotId, metadata);
  }
  
  async loadSnapshotMetadata(snapshotId) {
    // Check cache first
    if (this.metadataCache.has(snapshotId)) {
      return this.metadataCache.get(snapshotId);
    }
    
    // Load from disk
    try {
      const filePath = path.join(this.options.metadataDir, `${snapshotId}.meta`);
      const content = await fs.readFile(filePath, 'utf8');
      const metadata = JSON.parse(content);
      
      // Cache it
      this.metadataCache.set(snapshotId, metadata);
      
      return metadata;
    } catch (error) {
      return null;
    }
  }
  
  async deleteSnapshotMetadata(snapshotId) {
    const filePath = path.join(this.options.metadataDir, `${snapshotId}.meta`);
    await fs.unlink(filePath);
    
    this.metadataCache.delete(snapshotId);
  }
  
  async loadMetadata() {
    try {
      const metadataFiles = await fs.readdir(this.options.metadataDir);
      let totalSize = 0;
      let totalSnapshots = 0;
      
      for (const file of metadataFiles) {
        if (file.endsWith('.meta')) {
          const snapshotId = file.replace('.meta', '');
          const metadata = await this.loadSnapshotMetadata(snapshotId);
          
          if (metadata) {
            totalSnapshots++;
            totalSize += metadata.metadata.contentLength || 0;
          }
        }
      }
      
      this.stats.totalSnapshots = totalSnapshots;
      this.stats.totalStorageSize = totalSize;
      
    } catch (error) {
      // Directory doesn't exist yet, that's okay
      this.stats.totalSnapshots = 0;
      this.stats.totalStorageSize = 0;
    }
  }
  
  // Utility methods
  
  generateSnapshotId(url, timestamp) {
    const hash = createHash('sha256');
    hash.update(`${url}-${timestamp}-${Math.random()}`);
    return hash.digest('hex').substring(0, 16);
  }
  
  generateOperationId() {
    return `op-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
  
  hashContent(content) {
    const hash = createHash('sha256');
    hash.update(content);
    return hash.digest('hex');
  }
  
  async findSimilarSnapshot(url, contentHash, content) {
    // Find recent snapshots for the same URL
    const recentSnapshots = await this.querySnapshots({
      url,
      limit: 10,
      sortBy: 'timestamp',
      sortOrder: 'desc',
      includeContent: false
    });
    
    for (const snapshot of recentSnapshots.snapshots) {
      if (snapshot.metadata.contentHash === contentHash) {
        // Exact match
        return {
          snapshotId: snapshot.id,
          similarity: 1.0,
          content: null
        };
      }
      
      // Load content for similarity comparison
      const fullSnapshot = await this.retrieveSnapshot(snapshot.id, { includeContent: true });
      const similarity = this.calculateContentSimilarity(content, fullSnapshot.content);
      
      if (similarity > this.retentionPolicy.deltaThreshold) {
        return {
          snapshotId: snapshot.id,
          similarity,
          content: fullSnapshot.content
        };
      }
    }
    
    return null;
  }
  
  calculateContentSimilarity(content1, content2) {
    // Simple similarity calculation based on content length difference
    // In production, you might want to use more sophisticated algorithms
    const len1 = content1.length;
    const len2 = content2.length;
    
    if (len1 === 0 && len2 === 0) return 1.0;
    if (len1 === 0 || len2 === 0) return 0.0;
    
    const lengthSimilarity = 1 - Math.abs(len1 - len2) / Math.max(len1, len2);
    
    // Additional similarity checks can be added here
    // For example, using diff algorithms or content hashing
    
    return lengthSimilarity;
  }
  
  createDelta(baseContent, currentContent) {
    // Simple delta implementation - in production, consider using proper diff libraries
    // This is a placeholder that would create a compressed diff
    const deltaObject = {
      type: 'diff',
      base: baseContent.length,
      current: currentContent.length,
      // In a real implementation, you'd store the actual diff data
      operations: [] // diff operations would go here
    };
    
    return JSON.stringify(deltaObject);
  }
  
  applyDelta(baseContent, deltaData) {
    try {
      const delta = JSON.parse(deltaData);
      
      // In a real implementation, you'd apply the diff operations
      // For now, return the base content as a fallback
      return baseContent;
    } catch (error) {
      throw new Error(`Failed to apply delta: ${error.message}`);
    }
  }
  
  async calculateChangeMetrics(previousSnapshot, currentSnapshot) {
    // Calculate various change metrics between snapshots
    const metrics = {
      sizeDelta: currentSnapshot.metadata.contentLength - previousSnapshot.metadata.contentLength,
      timeDelta: currentSnapshot.metadata.timestamp - previousSnapshot.metadata.timestamp,
      hashChanged: currentSnapshot.metadata.contentHash !== previousSnapshot.metadata.contentHash,
      contentTypeChanged: currentSnapshot.metadata.contentType !== previousSnapshot.metadata.contentType,
      similarity: 0
    };
    
    // Calculate content similarity if different hashes
    if (metrics.hashChanged) {
      // This would require loading both snapshots' content
      // For now, estimate based on size difference
      metrics.similarity = 1 - Math.abs(metrics.sizeDelta) / Math.max(
        currentSnapshot.metadata.contentLength,
        previousSnapshot.metadata.contentLength
      );
    } else {
      metrics.similarity = 1.0;
    }
    
    return metrics;
  }
  
  getSortValue(snapshot, sortBy) {
    switch (sortBy) {
      case 'timestamp':
        return snapshot.metadata.timestamp;
      case 'size':
        return snapshot.metadata.contentLength;
      case 'similarity':
        return snapshot.similarity || 0;
      default:
        return snapshot.metadata.timestamp;
    }
  }
  
  updateCache(snapshotId, snapshot) {
    // Simple LRU-like cache management
    if (this.snapshotCache.size >= this.options.cacheSize) {
      const firstKey = this.snapshotCache.keys().next().value;
      this.snapshotCache.delete(firstKey);
    }
    
    this.snapshotCache.set(snapshotId, snapshot);
  }
  
  async initializeCache() {
    // Pre-load recent snapshots into cache
    const recentSnapshots = await this.querySnapshots({
      limit: Math.min(this.options.cacheSize, 50),
      sortBy: 'timestamp',
      sortOrder: 'desc',
      includeContent: false
    });
    
    for (const snapshot of recentSnapshots.snapshots) {
      this.metadataCache.set(snapshot.id, snapshot);
    }
  }
  
  updateStorageStats(snapshot, isDelta) {
    this.stats.totalSnapshots++;
    this.stats.totalStorageSize += snapshot.metadata.contentLength;
    
    if (isDelta) {
      this.updateDeltaStats(snapshot.delta.deltaSize);
    }
  }
  
  updateCompressionStats(ratio) {
    const currentAvg = this.stats.averageCompressionRatio;
    const count = this.stats.compressedSnapshots;
    
    this.stats.averageCompressionRatio = 
      (currentAvg * (count - 1) + ratio) / count;
  }
  
  updateDeltaStats(deltaSize) {
    const currentAvg = this.stats.averageDeltaSize;
    const count = this.stats.deltaSnapshots;
    
    this.stats.averageDeltaSize = 
      (currentAvg * (count - 1) + deltaSize) / count;
  }
  
  async cleanupBySize(targetReduction) {
    // Clean up oldest snapshots to free up space
    const allSnapshots = Array.from(this.metadataCache.values());
    const sorted = allSnapshots.sort((a, b) => 
      a.metadata.timestamp - b.metadata.timestamp
    );
    
    let freedSpace = 0;
    const toDelete = [];
    
    for (const snapshot of sorted) {
      if (freedSpace >= targetReduction) break;
      
      toDelete.push(snapshot.id);
      freedSpace += snapshot.metadata.contentLength;
    }
    
    const deleteResult = await this.deleteSnapshots(toDelete);
    
    return {
      deletedCount: deleteResult.deleted.length,
      freedSpace: deleteResult.totalSize
    };
  }
  
  startCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    this.cleanupTimer = setInterval(async () => {
      try {
        await this.cleanupSnapshots();
      } catch (error) {
        this.emit('error', { operation: 'scheduledCleanup', error: error.message });
      }
    }, this.retentionPolicy.cleanupInterval);
  }
  
  stopCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
  
  // Public API methods
  
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.snapshotCache.size,
      metadataCacheSize: this.metadataCache.size,
      activeOperations: this.activeOperations.size,
      averageSnapshotSize: this.stats.totalSnapshots > 0 ? 
        this.stats.totalStorageSize / this.stats.totalSnapshots : 0,
      storageEfficiency: {
        compressionRatio: this.stats.averageCompressionRatio,
        deltaRatio: this.stats.averageDeltaSize,
        compressedPercentage: this.stats.totalSnapshots > 0 ? 
          (this.stats.compressedSnapshots / this.stats.totalSnapshots) * 100 : 0,
        deltaPercentage: this.stats.totalSnapshots > 0 ? 
          (this.stats.deltaSnapshots / this.stats.totalSnapshots) * 100 : 0
      }
    };
  }
  
  getRetentionPolicy() {
    return { ...this.retentionPolicy };
  }
  
  updateRetentionPolicy(newPolicy) {
    this.retentionPolicy = RetentionPolicySchema.parse({
      ...this.retentionPolicy,
      ...newPolicy
    });
    
    this.emit('retentionPolicyUpdated', this.retentionPolicy);
  }
  
  async shutdown() {
    this.stopCleanupTimer();
    
    // Wait for active operations to complete
    const maxWaitTime = 30000; // 30 seconds
    const startTime = Date.now();
    
    while (this.activeOperations.size > 0 && (Date.now() - startTime) < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    this.emit('shutdown', {
      pendingOperations: this.activeOperations.size,
      shutdownTime: Date.now() - startTime
    });
  }
}

export default SnapshotManager;