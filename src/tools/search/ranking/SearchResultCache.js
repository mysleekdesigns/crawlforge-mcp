/**
 * SearchResultCache — unified cache layer for search ranking and deduplication.
 *
 * Both ResultRanker and ResultDeduplicator previously held separate CacheManager
 * instances with identical TTL configuration. This module provides a single
 * shared cache they can both use, halving the number of LRU cache instances
 * created per SearchWebTool instantiation.
 *
 * Usage:
 *   const cache = new SearchResultCache({ ttl: 3600000 });
 *   // pass to ResultRanker and ResultDeduplicator via options.sharedCache
 */

import { CacheManager } from '../../../core/cache/CacheManager.js';

export class SearchResultCache {
  /**
   * @param {Object} [options]
   * @param {number} [options.ttl=3600000]  — cache TTL in milliseconds
   * @param {boolean} [options.enabled=true] — disable to skip caching
   */
  constructor(options = {}) {
    const { ttl = 3600000, enabled = true } = options;
    this.enabled = enabled;
    this._cache = enabled ? new CacheManager({ ttl }) : null;
  }

  /** Retrieve a cached value by key (returns undefined on miss or when disabled). */
  async get(key) {
    if (!this.enabled || !this._cache) return undefined;
    return this._cache.get(key);
  }

  /** Store a value under the given key. */
  async set(key, value) {
    if (!this.enabled || !this._cache) return;
    return this._cache.set(key, value);
  }

  /** Generate a deterministic cache key from an arbitrary descriptor object. */
  generateKey(namespace, descriptor) {
    if (!this._cache) return null;
    return this._cache.generateKey(namespace, descriptor);
  }

  /** Return underlying cache stats (or null when disabled). */
  getStats() {
    return this._cache ? this._cache.getStats() : null;
  }
}

export default SearchResultCache;
