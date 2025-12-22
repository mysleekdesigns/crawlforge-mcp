/**
 * PerformanceIntegration - Simple integration layer for existing tools
 * Provides optional performance enhancements without breaking existing functionality
 */

import PerformanceManager from '../PerformanceManager.js';
import WorkerPool from '../workers/WorkerPool.js';
import ConnectionPool from '../connections/ConnectionPool.js';
import StreamProcessor from '../processing/StreamProcessor.js';
import { config } from '../../constants/config.js';

let performanceManagerInstance = null;
let workerPoolInstance = null;
let connectionPoolInstance = null;
let streamProcessorInstance = null;

/**
 * Initialize performance components (lazy initialization)
 * @param {Object} options - Initialization options
 * @returns {PerformanceManager} - Performance manager instance
 */
export function initializePerformance(options = {}) {
  if (performanceManagerInstance) {
    return performanceManagerInstance;
  }

  const {
    enableWorkerPool = true,
    enableConnectionPool = true,
    enableStreamProcessor = true,
    enableFullManager = false
  } = options;

  if (enableFullManager) {
    performanceManagerInstance = new PerformanceManager(options);
    return performanceManagerInstance;
  }

  // Initialize individual components as needed
  if (enableWorkerPool && !workerPoolInstance) {
    workerPoolInstance = new WorkerPool({
      maxWorkers: config.performance.maxWorkers,
      ...options.workerPoolOptions
    });
  }

  if (enableConnectionPool && !connectionPoolInstance) {
    connectionPoolInstance = new ConnectionPool({
      maxSockets: config.performance.maxWorkers * 2,
      ...options.connectionPoolOptions
    });
  }

  if (enableStreamProcessor && !streamProcessorInstance) {
    streamProcessorInstance = new StreamProcessor({
      chunkSize: 1000,
      memoryLimit: 100 * 1024 * 1024,
      ...options.streamProcessorOptions
    });
  }

  return {
    workerPool: workerPoolInstance,
    connectionPool: connectionPoolInstance,
    streamProcessor: streamProcessorInstance
  };
}

/**
 * Get performance manager instance
 * @returns {PerformanceManager|null} - Performance manager instance
 */
export function getPerformanceManager() {
  return performanceManagerInstance;
}

/**
 * Get worker pool instance
 * @returns {WorkerPool|null} - Worker pool instance
 */
export function getWorkerPool() {
  return workerPoolInstance;
}

/**
 * Get connection pool instance
 * @returns {ConnectionPool|null} - Connection pool instance
 */
export function getConnectionPool() {
  return connectionPoolInstance;
}

/**
 * Get stream processor instance
 * @returns {StreamProcessor|null} - Stream processor instance
 */
export function getStreamProcessor() {
  return streamProcessorInstance;
}

/**
 * Enhanced fetch function with connection pooling
 * @param {string|Object} url - URL or request options
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>} - Fetch response
 */
export async function enhancedFetch(url, options = {}) {
  if (connectionPoolInstance) {
    const requestOptions = typeof url === 'string' ? { url, ...options } : url;
    return await connectionPoolInstance.request(requestOptions);
  } else {
    // Fallback to native fetch (Node.js 18+)
    return await fetch(url, options);
  }
}

/**
 * Enhanced HTML parsing with worker pool
 * @param {string} html - HTML content
 * @param {Object} options - Parsing options
 * @returns {Promise<Object>} - Parsed HTML data
 */
export async function enhancedParseHtml(html, options = {}) {
  if (workerPoolInstance && html.length > 50000) { // Use worker for large HTML
    return await workerPoolInstance.execute('parseHtml', { html, options });
  } else {
    // Fallback to synchronous parsing
    return await parseHtmlSync(html, options);
  }
}

/**
 * Enhanced content extraction with worker pool
 * @param {string} html - HTML content
 * @param {string} url - Source URL
 * @param {Object} options - Extraction options
 * @returns {Promise<Object>} - Extracted content
 */
export async function enhancedExtractContent(html, url, options = {}) {
  if (workerPoolInstance && html.length > 30000) { // Use worker for large content
    return await workerPoolInstance.execute('extractContent', { html, url, options });
  } else {
    // Fallback to synchronous extraction
    return await extractContentSync(html, url, options);
  }
}

/**
 * Enhanced batch processing with streaming
 * @param {Array} items - Items to process
 * @param {Function} processor - Processing function
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - Processing results
 */
export async function enhancedBatchProcess(items, processor, options = {}) {
  const { useStreaming = items.length > 1000, useWorkers = false } = options;

  if (useStreaming && streamProcessorInstance) {
    return await streamProcessorInstance.processStream(items, processor, options);
  } else if (useWorkers && workerPoolInstance && items.length > 100) {
    const tasks = items.map(item => ({ taskType: 'processItem', data: item, options }));
    return await workerPoolInstance.executeBatch(tasks, options);
  } else {
    // Fallback to sequential processing
    const results = [];
    for (let i = 0; i < items.length; i++) {
      const result = await processor(items[i], i);
      results.push(result);
    }
    return { results, processedItems: items.length };
  }
}

/**
 * Enhanced concurrent requests with connection pooling
 * @param {Array} requests - Request configurations
 * @param {Object} options - Request options
 * @returns {Promise<Array>} - Request results
 */
export async function enhancedConcurrentRequests(requests, options = {}) {
  if (connectionPoolInstance) {
    return await connectionPoolInstance.requestBatch(requests, options);
  } else {
    // Fallback to Promise.all with native fetch (Node.js 18+)
    const promises = requests.map(request => fetch(request.url || request, request));
    return await Promise.all(promises);
  }
}

/**
 * Check if performance optimization is available
 * @param {string} component - Component name ('worker', 'connection', 'stream', 'full')
 * @returns {boolean} - Whether component is available
 */
export function isPerformanceAvailable(component) {
  switch (component) {
    case 'worker':
      return !!workerPoolInstance;
    case 'connection':
      return !!connectionPoolInstance;
    case 'stream':
      return !!streamProcessorInstance;
    case 'full':
      return !!performanceManagerInstance;
    default:
      return !!(workerPoolInstance || connectionPoolInstance || streamProcessorInstance || performanceManagerInstance);
  }
}

/**
 * Get performance statistics
 * @returns {Object} - Performance statistics
 */
export function getPerformanceStats() {
  const stats = {};

  if (performanceManagerInstance) {
    stats.full = performanceManagerInstance.getMetrics();
  }

  if (workerPoolInstance) {
    stats.workerPool = workerPoolInstance.getStats();
  }

  if (connectionPoolInstance) {
    stats.connectionPool = connectionPoolInstance.getStats();
  }

  if (streamProcessorInstance) {
    stats.streamProcessor = streamProcessorInstance.getStats();
  }

  return stats;
}

/**
 * Graceful shutdown of all performance components
 * @returns {Promise<void>}
 */
export async function shutdownPerformance() {
  const shutdownPromises = [];

  if (performanceManagerInstance) {
    shutdownPromises.push(performanceManagerInstance.shutdown());
    performanceManagerInstance = null;
  } else {
    if (workerPoolInstance) {
      shutdownPromises.push(workerPoolInstance.shutdown());
      workerPoolInstance = null;
    }

    if (connectionPoolInstance) {
      shutdownPromises.push(connectionPoolInstance.shutdown());
      connectionPoolInstance = null;
    }

    if (streamProcessorInstance) {
      shutdownPromises.push(streamProcessorInstance.shutdown());
      streamProcessorInstance = null;
    }
  }

  await Promise.all(shutdownPromises);
}

// Fallback implementations for when performance components are not available

/**
 * Synchronous HTML parsing fallback
 * @param {string} html - HTML content
 * @param {Object} options - Parsing options
 * @returns {Promise<Object>} - Parsed HTML data
 */
async function parseHtmlSync(html, options = {}) {
  const cheerio = await import('cheerio');
  const $ = cheerio.load(html);

  const result = {};

  if (options.extractText !== false) {
    result.text = $('body').text().trim();
    result.title = $('title').text().trim();
  }

  if (options.extractLinks) {
    result.links = [];
    $('a[href]').each((_, element) => {
      const $link = $(element);
      result.links.push({
        href: $link.attr('href'),
        text: $link.text().trim(),
        title: $link.attr('title') || null
      });
    });
  }

  if (options.extractImages) {
    result.images = [];
    $('img[src]').each((_, element) => {
      const $img = $(element);
      result.images.push({
        src: $img.attr('src'),
        alt: $img.attr('alt') || null,
        title: $img.attr('title') || null
      });
    });
  }

  return result;
}

/**
 * Synchronous content extraction fallback
 * @param {string} html - HTML content
 * @param {string} url - Source URL
 * @param {Object} options - Extraction options
 * @returns {Promise<Object>} - Extracted content
 */
async function extractContentSync(html, url, options = {}) {
  const { Readability } = await import('@mozilla/readability');
  const { JSDOM } = await import('jsdom');

  const dom = new JSDOM(html, { url });
  const document = dom.window.document;

  const reader = new Readability(document);
  const article = reader.parse();

  return {
    url,
    title: article?.title || null,
    content: article?.content || null,
    textContent: article?.textContent || null,
    length: article?.length || 0,
    excerpt: article?.excerpt || null,
    byline: article?.byline || null,
    processed_at: new Date().toISOString()
  };
}

// Setup graceful shutdown
let shutdownRegistered = false;

function registerShutdown() {
  if (shutdownRegistered) return;
  shutdownRegistered = true;

  const shutdown = async () => {
    console.log('PerformanceIntegration: Graceful shutdown initiated');
    await shutdownPerformance();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('beforeExit', shutdown);
}

// Auto-register shutdown handlers
registerShutdown();

export default {
  initializePerformance,
  getPerformanceManager,
  getWorkerPool,
  getConnectionPool,
  getStreamProcessor,
  enhancedFetch,
  enhancedParseHtml,
  enhancedExtractContent,
  enhancedBatchProcess,
  enhancedConcurrentRequests,
  isPerformanceAvailable,
  getPerformanceStats,
  shutdownPerformance
};