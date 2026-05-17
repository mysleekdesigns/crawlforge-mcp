/**
 * batchScrape — queue module.
 * Semaphore-based concurrency runner that dispatches work to worker.js.
 */

import { scrapeUrl } from './worker.js';

/** Semaphore for concurrency limiting. */
class Semaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.queue = [];
  }

  async acquire(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this._tryNext();
    });
  }

  _tryNext() {
    if (this.current >= this.max || this.queue.length === 0) return;
    this.current++;
    const { task, resolve, reject } = this.queue.shift();
    task()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        this.current--;
        this._tryNext();
      });
  }
}

/**
 * Scrape a list of URL configs with controlled concurrency and optional delay.
 * @param {Array}  urlConfigs
 * @param {Object} options    — { maxConcurrency, delayBetweenRequests, formats, extractionSchema, ... }
 * @param {number} defaultTimeout
 * @returns {Promise<Array>} raw results array
 */
export async function scrapeUrlsBatch(urlConfigs, options, defaultTimeout) {
  const semaphore = new Semaphore(options.maxConcurrency);

  const promises = urlConfigs.map((config, index) =>
    semaphore.acquire(async () => {
      if (options.delayBetweenRequests > 0 && index > 0) {
        await new Promise(r => setTimeout(r, options.delayBetweenRequests));
      }
      return scrapeUrl(config, options, defaultTimeout);
    })
  );

  const settled = await Promise.allSettled(promises);

  return settled.map((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    return {
      success: false,
      url: urlConfigs[index].url,
      error: result.reason?.message || 'Unknown error',
      timestamp: Date.now()
    };
  });
}

/**
 * Filter and enrich results according to options.
 */
export function processResults(results, options) {
  let out = [...results];
  if (!options.includeFailed) out = out.filter(r => r.success);
  if (options.includeMetadata) {
    out = out.map(r => ({
      ...r,
      processingMetadata: {
        formats: options.formats,
        extractionApplied: !!options.extractionSchema,
        processedAt: Date.now()
      }
    }));
  }
  return out;
}

/** Return a page-sized slice of results. */
export function paginateResults(results, offset, limit) {
  return results.slice(offset, offset + limit);
}
