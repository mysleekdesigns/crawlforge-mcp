/**
 * Performance Manager Usage Example
 * Demonstrates how to use the performance optimization components
 */

import PerformanceManager from '../src/core/PerformanceManager.js';

// Example usage of the PerformanceManager
async function demonstratePerformanceManager() {
  console.log('Starting Performance Manager demonstration...\n');

  // Initialize the performance manager
  const performanceManager = new PerformanceManager({
    workerPoolOptions: {
      maxWorkers: 8,
      taskTimeout: 30000
    },
    connectionPoolOptions: {
      maxSockets: 50,
      maxFreeSockets: 10
    },
    streamProcessorOptions: {
      chunkSize: 500,
      memoryLimit: 50 * 1024 * 1024 // 50MB
    },
    enableMetrics: true,
    metricsInterval: 5000
  });

  // Setup event listeners to monitor performance
  performanceManager.on('taskCompleted', (data) => {
    console.log(`✅ Task completed: ${data.taskType} (${data.duration}ms)`);
  });

  performanceManager.on('workerTaskCompleted', (data) => {
    console.log(`🔧 Worker task completed: ${data.taskType}`);
  });

  performanceManager.on('connectionRequestCompleted', (data) => {
    console.log(`🌐 Connection request completed: ${data.requestId}`);
  });

  performanceManager.on('streamItemProcessed', (data) => {
    if (data.index % 100 === 0) {
      console.log(`📊 Stream processed: ${data.index} items`);
    }
  });

  performanceManager.on('metricsCollected', (metrics) => {
    console.log(`📈 Metrics - Operations: ${metrics.completedOperations}, Memory: ${Math.round(metrics.memoryUsage.current / 1024 / 1024)}MB`);
  });

  try {
    // Example 1: CPU-intensive HTML parsing task
    console.log('1. Demonstrating CPU-intensive task (HTML parsing)...');
    const htmlContent = '<html><body><h1>Test</h1><p>Sample content for parsing</p></body></html>';
    const parseResult = await performanceManager.executeTask('parseHtml', {
      html: htmlContent,
      options: {
        extractText: true,
        extractLinks: true,
        extractImages: true
      }
    });
    console.log('HTML parsing completed:', parseResult ? 'Success' : 'Failed');

    // Example 2: Network request task
    console.log('\n2. Demonstrating network request task...');
    try {
      const networkResult = await performanceManager.executeTask('fetchUrl', {
        url: 'https://httpbin.org/json',
        method: 'GET',
        headers: { 'User-Agent': 'MCP-WebScraper/1.0' }
      });
      console.log('Network request completed:', networkResult.status);
    } catch (error) {
      console.log('Network request failed (expected in test environment):', error.message);
    }

    // Example 3: Batch processing
    console.log('\n3. Demonstrating batch processing...');
    const batchTasks = [
      { taskType: 'parseHtml', data: { html: '<div>Content 1</div>' }, options: {} },
      { taskType: 'parseHtml', data: { html: '<div>Content 2</div>' }, options: {} },
      { taskType: 'parseHtml', data: { html: '<div>Content 3</div>' }, options: {} },
      { taskType: 'calculateSimilarity', data: { text1: 'Hello world', text2: 'Hello universe' }, options: {} },
      { taskType: 'analyzeText', data: { text: 'This is a sample text for analysis.' }, options: {} }
    ];

    const batchResults = await performanceManager.executeBatch(batchTasks, {
      strategy: 'auto',
      maxConcurrency: 3,
      enableOptimization: true
    });
    console.log(`Batch processing completed: ${batchResults.length} tasks processed`);

    // Example 4: Large dataset processing with streaming
    console.log('\n4. Demonstrating large dataset processing...');
    const largeDataset = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      content: `Sample content item ${i}`,
      timestamp: Date.now()
    }));

    const processor = async (item, index) => {
      // Simulate some processing
      await new Promise(resolve => setTimeout(resolve, 1));
      return {
        ...item,
        processed: true,
        processedAt: Date.now()
      };
    };

    const streamResult = await performanceManager.processLargeDataset(largeDataset, processor, {
      enableWorkerPool: true,
      enablePagination: true,
      chunkSize: 100,
      parallel: false
    });

    console.log(`Large dataset processing completed: ${streamResult.processedItems} items processed`);
    console.log(`Processing rate: ${streamResult.itemsPerSecond.toFixed(2)} items/second`);

    // Example 5: Mixed batch with different strategies
    console.log('\n5. Demonstrating mixed batch processing...');
    const mixedTasks = [
      // CPU-intensive tasks
      { taskType: 'parseHtml', data: { html: '<html><body>CPU Task 1</body></html>' }, options: {} },
      { taskType: 'extractContent', data: { html: '<html><body>CPU Task 2</body></html>' }, options: {} },
      
      // Similarity calculations
      { taskType: 'calculateSimilarity', data: { text1: 'Sample text A', text2: 'Sample text B' }, options: {} },
      { taskType: 'calculateSimilarity', data: { text1: 'Another text X', text2: 'Another text Y' }, options: {} },
      
      // Text analysis
      { taskType: 'analyzeText', data: { text: 'This is sample text for analysis.' }, options: {} }
    ];

    const mixedResults = await performanceManager.executeBatch(mixedTasks, {
      strategy: 'mixed',
      groupBySimilarity: true,
      maxConcurrency: 4
    });
    console.log(`Mixed batch processing completed: ${mixedResults.length} tasks processed`);

    // Example 6: Performance metrics
    console.log('\n6. Performance metrics:');
    const metrics = performanceManager.getMetrics();
    console.log(`Total operations: ${metrics.totalOperations}`);
    console.log(`Completed operations: ${metrics.completedOperations}`);
    console.log(`Failed operations: ${metrics.failedOperations}`);
    console.log(`Average operation time: ${metrics.avgOperationTime.toFixed(2)}ms`);
    console.log(`Operations per second: ${metrics.operationsPerSecond.toFixed(2)}`);
    console.log(`Peak memory usage: ${Math.round(metrics.memoryUsage.peak / 1024 / 1024)}MB`);
    console.log(`Current memory usage: ${Math.round(metrics.memoryUsage.current / 1024 / 1024)}MB`);

    // Component-specific stats
    if (metrics.componentStats.workerPool) {
      const workerStats = metrics.componentStats.workerPool;
      console.log(`Worker pool - Active: ${workerStats.activeWorkers}, Tasks: ${workerStats.tasksCompleted}`);
    }

    if (metrics.componentStats.connectionPool) {
      const connStats = metrics.componentStats.connectionPool;
      console.log(`Connection pool - Active: ${connStats.activeConnections}, Completed: ${connStats.completedRequests}`);
    }

    if (metrics.componentStats.streamProcessor) {
      const streamStats = metrics.componentStats.streamProcessor;
      console.log(`Stream processor - Processed: ${streamStats.processedItems}, Pages in memory: ${streamStats.pagesInMemory}`);
    }

  } catch (error) {
    console.error('Error during demonstration:', error);
  } finally {
    // Clean shutdown
    console.log('\n🔄 Shutting down performance manager...');
    await performanceManager.shutdown();
    console.log('✅ Performance manager shutdown completed');
  }
}

// Integration example with existing MCP tools
async function demonstrateIntegrationWithMCPTools() {
  console.log('\n📋 Integration with MCP Tools Example\n');

  const performanceManager = new PerformanceManager();

  // Example: Enhanced web scraping with performance optimization
  const scrapingTasks = [
    {
      taskType: 'fetchUrl',
      data: { url: 'https://example.com/page1' },
      options: { timeout: 10000 }
    },
    {
      taskType: 'fetchUrl', 
      data: { url: 'https://example.com/page2' },
      options: { timeout: 10000 }
    },
    {
      taskType: 'fetchUrl',
      data: { url: 'https://example.com/page3' },
      options: { timeout: 10000 }
    }
  ];

  try {
    // Execute scraping tasks with connection pooling
    console.log('Executing optimized web scraping...');
    const scrapingResults = await performanceManager.executeBatch(scrapingTasks, {
      strategy: 'parallel',
      maxConcurrency: 3
    });

    console.log(`Scraping completed: ${scrapingResults.length} pages processed`);

    // Process the scraped content with worker pool
    const processingTasks = scrapingResults
      .filter(result => result && !result.error)
      .map((result, index) => ({
        taskType: 'parseHtml',
        data: {
          html: result.body || '<html></html>',
          options: {
            extractText: true,
            extractLinks: true,
            extractMeta: true
          }
        },
        options: {}
      }));

    if (processingTasks.length > 0) {
      console.log('Processing scraped content...');
      const processingResults = await performanceManager.executeBatch(processingTasks, {
        strategy: 'auto'
      });

      console.log(`Content processing completed: ${processingResults.length} pages processed`);
    }

  } catch (error) {
    console.error('Integration example error:', error);
  } finally {
    await performanceManager.shutdown();
  }
}

// Run demonstrations if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🚀 MCP WebScraper Performance Manager Demo\n');
  
  try {
    await demonstratePerformanceManager();
    await demonstrateIntegrationWithMCPTools();
    
    console.log('\n✅ All demonstrations completed successfully!');
  } catch (error) {
    console.error('❌ Demonstration failed:', error);
    process.exit(1);
  }
}

export { demonstratePerformanceManager, demonstrateIntegrationWithMCPTools };