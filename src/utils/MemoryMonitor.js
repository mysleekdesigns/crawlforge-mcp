/**
 * Memory Monitoring and Leak Detection Utility
 * Tracks memory usage patterns and detects potential leaks
 */

export class MemoryMonitor {
  constructor(options = {}) {
    this.options = {
      sampleInterval: options.sampleInterval || 30000, // 30 seconds
      maxSamples: options.maxSamples || 100,
      leakThreshold: options.leakThreshold || 50 * 1024 * 1024, // 50MB
      enableLogging: options.enableLogging !== false,
      alertCallback: options.alertCallback || null,
      ...options
    };
    
    this.samples = [];
    this.isMonitoring = false;
    this.intervalId = null;
    this.leakWarnings = 0;
  }
  
  /**
   * Start memory monitoring
   */
  start() {
    if (this.isMonitoring) {
      return;
    }
    
    this.isMonitoring = true;
    this.log('Starting memory monitoring...');
    
    this.intervalId = setInterval(() => {
      this.takeSample();
      this.analyzeMemoryTrend();
    }, this.options.sampleInterval);
    
    // Take initial sample
    this.takeSample();
  }
  
  /**
   * Stop memory monitoring
   */
  stop() {
    if (!this.isMonitoring) {
      return;
    }
    
    this.isMonitoring = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    this.log('Memory monitoring stopped');
  }
  
  /**
   * Take a memory usage sample
   */
  takeSample() {
    const usage = process.memoryUsage();
    const timestamp = Date.now();
    
    const sample = {
      timestamp,
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      rss: usage.rss,
      heapUsedMB: Math.round(usage.heapUsed / 1024 / 1024 * 100) / 100,
      heapTotalMB: Math.round(usage.heapTotal / 1024 / 1024 * 100) / 100
    };
    
    this.samples.push(sample);
    
    // Keep only the last N samples
    if (this.samples.length > this.options.maxSamples) {
      this.samples.shift();
    }
    
    return sample;
  }
  
  /**
   * Get current memory statistics
   */
  getStats() {
    if (this.samples.length === 0) {
      return null;
    }
    
    const latest = this.samples[this.samples.length - 1];
    const peak = Math.max(...this.samples.map(s => s.heapUsed));
    const average = this.samples.reduce((sum, s) => sum + s.heapUsed, 0) / this.samples.length;
    
    return {
      current: {
        heapUsedMB: latest.heapUsedMB,
        heapTotalMB: latest.heapTotalMB,
        timestamp: latest.timestamp
      },
      peak: {
        heapUsedMB: Math.round(peak / 1024 / 1024 * 100) / 100
      },
      average: {
        heapUsedMB: Math.round(average / 1024 / 1024 * 100) / 100
      },
      samples: this.samples.length,
      leakWarnings: this.leakWarnings,
      isMonitoring: this.isMonitoring
    };
  }
  
  /**
   * Analyze memory trend for potential leaks
   */
  analyzeMemoryTrend() {
    if (this.samples.length < 5) {
      return; // Need at least 5 samples for trend analysis
    }
    
    // Check if memory is consistently increasing
    const recentSamples = this.samples.slice(-10); // Last 10 samples
    let increasingCount = 0;
    
    for (let i = 1; i < recentSamples.length; i++) {
      if (recentSamples[i].heapUsed > recentSamples[i - 1].heapUsed) {
        increasingCount++;
      }
    }
    
    // If memory increased in 80% of recent samples, potential leak
    if (increasingCount > recentSamples.length * 0.8) {
      const memoryGrowth = recentSamples[recentSamples.length - 1].heapUsed - recentSamples[0].heapUsed;
      
      if (memoryGrowth > this.options.leakThreshold) {
        this.leakWarnings++;
        const growthMB = Math.round(memoryGrowth / 1024 / 1024 * 100) / 100;
        
        this.log(`Warning: Potential memory leak detected. Memory grew by ${growthMB}MB over ${recentSamples.length} samples`);
        
        if (this.options.alertCallback) {
          this.options.alertCallback({
            type: 'memory_leak',
            growthMB,
            samples: recentSamples.length,
            warnings: this.leakWarnings
          });
        }
      }
    }
  }
  
  /**
   * Log messages if logging is enabled
   */
  log(message) {
    if (this.options.enableLogging) {
      console.error(`[MemoryMonitor] ${message}`);
    }
  }
}

// Export singleton instance for global use
export const memoryMonitor = new MemoryMonitor({
  enableLogging: process.env.NODE_ENV === 'development',
  sampleInterval: 30000, // 30 seconds
  leakThreshold: 100 * 1024 * 1024 // 100MB
});
