/**
 * StreamProcessor - Streaming data processing with memory monitoring and pagination
 * Handles large datasets efficiently through streaming and chunked processing
 */

import { Readable, Transform, Writable, pipeline } from 'stream';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { config } from '../../constants/config.js';

const pipelineAsync = promisify(pipeline);

export class StreamProcessor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    const {
      chunkSize = 1000,
      memoryLimit = 100 * 1024 * 1024, // 100MB
      memoryCheckInterval = 5000,
      bufferHighWaterMark = 16 * 1024, // 16KB
      objectMode = false,
      enableBackpressure = true,
      maxPagesInMemory = 10,
      pageSize = 100
    } = options;

    this.chunkSize = chunkSize;
    this.memoryLimit = memoryLimit;
    this.memoryCheckInterval = memoryCheckInterval;
    this.bufferHighWaterMark = bufferHighWaterMark;
    this.objectMode = objectMode;
    this.enableBackpressure = enableBackpressure;
    this.maxPagesInMemory = maxPagesInMemory;
    this.pageSize = pageSize;

    // Memory monitoring
    this.memoryUsage = {
      current: 0,
      peak: 0,
      limit: this.memoryLimit,
      checkInterval: null
    };

    // Processing state
    this.isProcessing = false;
    this.processedItems = 0;
    this.totalItems = 0;
    this.startTime = null;
    this.endTime = null;

    // Pagination state
    this.pages = new Map();
    this.currentPage = 0;
    this.pageAccess = new Map(); // Track page access times for LRU

    this.startMemoryMonitoring();
    this.setupGracefulShutdown();
  }

  /**
   * Process large dataset using streaming with chunked processing
   * @param {Array|AsyncIterable} data - Data to process
   * @param {Function} processor - Processing function
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - Processing results
   */
  async processStream(data, processor, options = {}) {
    const {
      parallel = false,
      maxConcurrency = 5,
      yieldEvery = 100,
      enablePagination = false,
      collectResults = true
    } = options;

    this.isProcessing = true;
    this.startTime = Date.now();
    this.processedItems = 0;
    this.totalItems = Array.isArray(data) ? data.length : 0;

    const results = collectResults ? [] : null;
    const errors = [];

    try {
      if (enablePagination) {
        return await this.processWithPagination(data, processor, options);
      } else if (parallel) {
        return await this.processParallel(data, processor, maxConcurrency, options);
      } else {
        return await this.processSequential(data, processor, yieldEvery, collectResults, results, errors);
      }
    } finally {
      this.isProcessing = false;
      this.endTime = Date.now();
    }
  }

  /**
   * Process data sequentially with memory monitoring
   * @param {Array|AsyncIterable} data - Data to process
   * @param {Function} processor - Processing function
   * @param {number} yieldEvery - Yield control every N items
   * @param {boolean} collectResults - Whether to collect results
   * @param {Array} results - Results array
   * @param {Array} errors - Errors array
   * @returns {Promise<Object>} - Processing results
   */
  async processSequential(data, processor, yieldEvery, collectResults, results, errors) {
    const chunks = this.createChunks(data, this.chunkSize);
    
    for (const chunk of chunks) {
      await this.checkMemoryPressure();
      
      for (let i = 0; i < chunk.length; i++) {
        const item = chunk[i];
        
        try {
          const result = await processor(item, this.processedItems);
          
          if (collectResults && result !== undefined) {
            results.push(result);
          }
          
          this.processedItems++;
          
          // Yield control periodically
          if (this.processedItems % yieldEvery === 0) {
            await this.yield();
          }
          
          this.emit('itemProcessed', {
            index: this.processedItems,
            total: this.totalItems,
            result: collectResults ? result : undefined
          });
          
        } catch (error) {
          errors.push({
            index: this.processedItems,
            item,
            error: error.message
          });
          
          this.emit('itemError', {
            index: this.processedItems,
            error: error.message
          });
        }
      }
      
      // Check memory after each chunk
      await this.checkMemoryPressure();
    }

    return this.createProcessingResult(results, errors);
  }

  /**
   * Process data in parallel with concurrency control
   * @param {Array|AsyncIterable} data - Data to process
   * @param {Function} processor - Processing function
   * @param {number} maxConcurrency - Maximum concurrent operations
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - Processing results
   */
  async processParallel(data, processor, maxConcurrency, options) {
    const { collectResults = true } = options;
    const dataArray = Array.isArray(data) ? data : Array.from(data);
    const chunks = this.createChunks(dataArray, maxConcurrency);
    
    const results = collectResults ? [] : null;
    const errors = [];

    for (const chunk of chunks) {
      await this.checkMemoryPressure();
      
      const chunkPromises = chunk.map(async (item, index) => {
        try {
          const result = await processor(item, this.processedItems + index);
          return { success: true, result, index: this.processedItems + index };
        } catch (error) {
          return { 
            success: false, 
            error: error.message, 
            item, 
            index: this.processedItems + index 
          };
        }
      });

      const chunkResults = await Promise.all(chunkPromises);
      
      for (const chunkResult of chunkResults) {
        if (chunkResult.success) {
          if (collectResults && chunkResult.result !== undefined) {
            results.push(chunkResult.result);
          }
          
          this.emit('itemProcessed', {
            index: chunkResult.index,
            total: this.totalItems,
            result: collectResults ? chunkResult.result : undefined
          });
        } else {
          errors.push({
            index: chunkResult.index,
            item: chunkResult.item,
            error: chunkResult.error
          });
          
          this.emit('itemError', {
            index: chunkResult.index,
            error: chunkResult.error
          });
        }
      }
      
      this.processedItems += chunk.length;
    }

    return this.createProcessingResult(results, errors);
  }

  /**
   * Process data with pagination for memory efficiency
   * @param {Array|AsyncIterable} data - Data to process
   * @param {Function} processor - Processing function
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - Processing results with pagination
   */
  async processWithPagination(data, processor, options) {
    const dataArray = Array.isArray(data) ? data : Array.from(data);
    const totalPages = Math.ceil(dataArray.length / this.pageSize);
    
    const paginatedResult = {
      totalItems: dataArray.length,
      totalPages,
      pageSize: this.pageSize,
      pages: new Map(),
      errors: []
    };

    // Process each page
    for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
      await this.checkMemoryPressure();
      
      const startIndex = pageIndex * this.pageSize;
      const endIndex = Math.min(startIndex + this.pageSize, dataArray.length);
      const pageData = dataArray.slice(startIndex, endIndex);
      
      const pageResults = [];
      const pageErrors = [];
      
      for (let i = 0; i < pageData.length; i++) {
        const globalIndex = startIndex + i;
        const item = pageData[i];
        
        try {
          const result = await processor(item, globalIndex);
          pageResults.push(result);
          
          this.emit('itemProcessed', {
            index: globalIndex,
            total: dataArray.length,
            page: pageIndex,
            result
          });
          
        } catch (error) {
          pageErrors.push({
            index: globalIndex,
            item,
            error: error.message
          });
          
          this.emit('itemError', {
            index: globalIndex,
            page: pageIndex,
            error: error.message
          });
        }
      }
      
      // Store page results
      this.storePage(pageIndex, {
        data: pageResults,
        errors: pageErrors,
        startIndex,
        endIndex,
        processedAt: Date.now()
      });
      
      this.processedItems += pageData.length;
      paginatedResult.errors.push(...pageErrors);
      
      this.emit('pageProcessed', {
        pageIndex,
        totalPages,
        itemsInPage: pageData.length,
        errorsInPage: pageErrors.length
      });
    }

    paginatedResult.pages = this.getAllPages();
    return paginatedResult;
  }

  /**
   * Create a transform stream for processing data
   * @param {Function} transformer - Transform function
   * @param {Object} options - Stream options
   * @returns {Transform} - Transform stream
   */
  createTransformStream(transformer, options = {}) {
    const {
      objectMode = this.objectMode,
      highWaterMark = this.bufferHighWaterMark,
      parallel = false,
      maxConcurrency = 5
    } = options;

    let processedCount = 0;
    let pendingOperations = 0;

    return new Transform({
      objectMode,
      highWaterMark,
      transform: async function(chunk, encoding, callback) {
        try {
          await this.checkMemoryPressure();
          
          if (parallel && pendingOperations < maxConcurrency) {
            pendingOperations++;
            
            transformer(chunk, processedCount++)
              .then(result => {
                pendingOperations--;
                this.push(result);
                this.emit('itemProcessed', { index: processedCount, result });
              })
              .catch(error => {
                pendingOperations--;
                this.emit('error', error);
              });
              
            callback();
          } else {
            const result = await transformer(chunk, processedCount++);
            this.push(result);
            this.emit('itemProcessed', { index: processedCount, result });
            callback();
          }
        } catch (error) {
          this.emit('itemError', { index: processedCount, error: error.message });
          callback(error);
        }
      }.bind(this)
    });
  }

  /**
   * Create a readable stream from data
   * @param {Array|AsyncIterable} data - Data to stream
   * @param {Object} options - Stream options
   * @returns {Readable} - Readable stream
   */
  createReadableStream(data, options = {}) {
    const {
      objectMode = this.objectMode,
      highWaterMark = this.bufferHighWaterMark
    } = options;

    const dataArray = Array.isArray(data) ? data : Array.from(data);
    let index = 0;

    return new Readable({
      objectMode,
      highWaterMark,
      read() {
        if (index < dataArray.length) {
          this.push(dataArray[index++]);
        } else {
          this.push(null); // End of stream
        }
      }
    });
  }

  /**
   * Create a writable stream for collecting results
   * @param {Function} writer - Write function
   * @param {Object} options - Stream options
   * @returns {Writable} - Writable stream
   */
  createWritableStream(writer, options = {}) {
    const {
      objectMode = this.objectMode,
      highWaterMark = this.bufferHighWaterMark
    } = options;

    let writeCount = 0;

    return new Writable({
      objectMode,
      highWaterMark,
      write: async function(chunk, encoding, callback) {
        try {
          await this.checkMemoryPressure();
          await writer(chunk, writeCount++);
          this.emit('itemWritten', { index: writeCount, chunk });
          callback();
        } catch (error) {
          this.emit('writeError', { index: writeCount, error: error.message });
          callback(error);
        }
      }.bind(this)
    });
  }

  /**
   * Process data using stream pipeline
   * @param {Readable} readable - Readable stream
   * @param {Array<Transform>} transforms - Transform streams
   * @param {Writable} writable - Writable stream
   * @returns {Promise<void>}
   */
  async processPipeline(readable, transforms, writable) {
    const streams = [readable, ...transforms, writable];
    
    this.isProcessing = true;
    this.startTime = Date.now();
    
    try {
      await pipelineAsync(...streams);
    } finally {
      this.isProcessing = false;
      this.endTime = Date.now();
    }
  }

  /**
   * Store page data with LRU eviction
   * @param {number} pageIndex - Page index
   * @param {Object} pageData - Page data
   */
  storePage(pageIndex, pageData) {
    // Update access time
    this.pageAccess.set(pageIndex, Date.now());
    
    // Store page
    this.pages.set(pageIndex, pageData);
    
    // Evict pages if over limit
    if (this.pages.size > this.maxPagesInMemory) {
      this.evictOldestPage();
    }
  }

  /**
   * Get page data
   * @param {number} pageIndex - Page index
   * @returns {Object|null} - Page data
   */
  getPage(pageIndex) {
    if (this.pages.has(pageIndex)) {
      // Update access time
      this.pageAccess.set(pageIndex, Date.now());
      return this.pages.get(pageIndex);
    }
    return null;
  }

  /**
   * Get all stored pages
   * @returns {Map} - All pages
   */
  getAllPages() {
    return new Map(this.pages);
  }

  /**
   * Evict oldest accessed page
   */
  evictOldestPage() {
    let oldestPage = null;
    let oldestTime = Date.now();
    
    for (const [pageIndex, accessTime] of this.pageAccess.entries()) {
      if (accessTime < oldestTime) {
        oldestTime = accessTime;
        oldestPage = pageIndex;
      }
    }
    
    if (oldestPage !== null) {
      this.pages.delete(oldestPage);
      this.pageAccess.delete(oldestPage);
      
      this.emit('pageEvicted', { pageIndex: oldestPage });
    }
  }

  /**
   * Create chunks from data
   * @param {Array|AsyncIterable} data - Data to chunk
   * @param {number} chunkSize - Size of each chunk
   * @returns {Array} - Array of chunks
   */
  createChunks(data, chunkSize) {
    const dataArray = Array.isArray(data) ? data : Array.from(data);
    const chunks = [];
    
    for (let i = 0; i < dataArray.length; i += chunkSize) {
      chunks.push(dataArray.slice(i, i + chunkSize));
    }
    
    return chunks;
  }

  /**
   * Check memory pressure and trigger GC if needed
   */
  async checkMemoryPressure() {
    const memUsage = process.memoryUsage();
    this.memoryUsage.current = memUsage.heapUsed;
    this.memoryUsage.peak = Math.max(this.memoryUsage.peak, memUsage.heapUsed);
    
    if (memUsage.heapUsed > this.memoryLimit) {
      this.emit('memoryPressure', {
        current: memUsage.heapUsed,
        limit: this.memoryLimit,
        percentage: (memUsage.heapUsed / this.memoryLimit) * 100
      });
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      // Evict some pages if using pagination
      if (this.pages.size > this.maxPagesInMemory / 2) {
        const pagesToEvict = Math.ceil(this.pages.size / 4);
        for (let i = 0; i < pagesToEvict; i++) {
          this.evictOldestPage();
        }
      }
      
      // Yield control to allow other operations
      await this.yield();
    }
  }

  /**
   * Start memory monitoring
   */
  startMemoryMonitoring() {
    if (this.memoryUsage.checkInterval) {
      return; // Already monitoring
    }
    
    this.memoryUsage.checkInterval = setInterval(() => {
      this.checkMemoryPressure();
    }, this.memoryCheckInterval);
  }

  /**
   * Stop memory monitoring
   */
  stopMemoryMonitoring() {
    if (this.memoryUsage.checkInterval) {
      clearInterval(this.memoryUsage.checkInterval);
      this.memoryUsage.checkInterval = null;
    }
  }

  /**
   * Yield control to event loop
   */
  async yield() {
    return new Promise(resolve => setImmediate(resolve));
  }

  /**
   * Create processing result object
   * @param {Array} results - Processing results
   * @param {Array} errors - Processing errors
   * @returns {Object} - Result object
   */
  createProcessingResult(results, errors) {
    const duration = this.endTime - this.startTime;
    const itemsPerSecond = this.processedItems / (duration / 1000);
    
    return {
      processedItems: this.processedItems,
      totalItems: this.totalItems,
      results: results || [],
      errors,
      duration,
      itemsPerSecond: Math.round(itemsPerSecond * 100) / 100,
      memoryUsage: {
        peak: this.memoryUsage.peak,
        current: this.memoryUsage.current,
        limit: this.memoryUsage.limit
      },
      success: errors.length === 0
    };
  }

  /**
   * Get processing statistics
   * @returns {Object} - Statistics
   */
  getStats() {
    const duration = this.isProcessing ? 
      Date.now() - this.startTime : 
      (this.endTime || Date.now()) - (this.startTime || Date.now());
      
    return {
      isProcessing: this.isProcessing,
      processedItems: this.processedItems,
      totalItems: this.totalItems,
      duration,
      itemsPerSecond: this.processedItems / (duration / 1000),
      memoryUsage: this.memoryUsage,
      pagesInMemory: this.pages.size,
      maxPagesInMemory: this.maxPagesInMemory
    };
  }

  /**
   * Reset processor state
   */
  reset() {
    this.processedItems = 0;
    this.totalItems = 0;
    this.startTime = null;
    this.endTime = null;
    this.pages.clear();
    this.pageAccess.clear();
    this.currentPage = 0;
    
    // Reset memory tracking
    this.memoryUsage.current = 0;
    this.memoryUsage.peak = 0;
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    this.emit('shutdown');
    
    this.stopMemoryMonitoring();
    this.pages.clear();
    this.pageAccess.clear();
  }

  /**
   * Setup graceful shutdown handlers
   */
  setupGracefulShutdown() {
    const shutdown = async () => {
      console.log('StreamProcessor: Graceful shutdown initiated');
      await this.shutdown();
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
}

export default StreamProcessor;