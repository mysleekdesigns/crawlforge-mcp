import { LRUCache } from 'lru-cache';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

export class CacheManager {
  constructor(options = {}) {
    const {
      maxSize = 1000,
      ttl = 3600000, // 1 hour default
      diskCacheDir = './cache',
      enableDiskCache = true
    } = options;

    this.memoryCache = new LRUCache({
      max: maxSize,
      ttl,
      updateAgeOnGet: true,
      updateAgeOnHas: false
    });

    this.diskCacheDir = diskCacheDir;
    this.enableDiskCache = enableDiskCache;
    
    this.stats = {
      hits: 0,
      misses: 0,
      memoryHits: 0,
      diskHits: 0
    };

    if (this.enableDiskCache) {
      this.initDiskCache();
    }
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
    // Check memory cache first
    if (this.memoryCache.has(key)) {
      this.stats.hits++;
      this.stats.memoryHits++;
      return this.memoryCache.get(key);
    }

    // Check disk cache if enabled
    if (this.enableDiskCache) {
      const diskData = await this.getDiskCache(key);
      if (diskData) {
        this.stats.hits++;
        this.stats.diskHits++;
        // Promote to memory cache
        this.memoryCache.set(key, diskData);
        return diskData;
      }
    }

    this.stats.misses++;
    return null;
  }

  async set(key, value, ttl) {
    // Set in memory cache
    this.memoryCache.set(key, value, { ttl });

    // Set in disk cache if enabled
    if (this.enableDiskCache) {
      await this.setDiskCache(key, value, ttl);
    }
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
}

export default CacheManager;