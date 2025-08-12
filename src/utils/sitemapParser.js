import { load } from 'cheerio';
import zlib from 'zlib';
import { promisify } from 'util';
import { CacheManager } from '../core/cache/CacheManager.js';
import { normalizeUrl } from './urlNormalizer.js';

const gunzip = promisify(zlib.gunzip);

export class SitemapParser {
  constructor(options = {}) {
    const {
      userAgent = 'MCP-WebScraper/1.0',
      timeout = 10000,
      maxRecursionDepth = 3,
      maxUrlsPerSitemap = 50000,
      enableCaching = true,
      cacheTTL = 3600000, // 1 hour
      validateUrls = true
    } = options;

    this.userAgent = userAgent;
    this.timeout = timeout;
    this.maxRecursionDepth = maxRecursionDepth;
    this.maxUrlsPerSitemap = maxUrlsPerSitemap;
    this.validateUrls = validateUrls;
    
    // Initialize cache if enabled
    this.cache = enableCaching ? new CacheManager({
      maxSize: 500,
      ttl: cacheTTL,
      diskCacheDir: './cache/sitemaps',
      enableDiskCache: true
    }) : null;

    // Track processed sitemaps to avoid infinite loops
    this.processedSitemaps = new Set();
    
    // Statistics
    this.stats = {
      sitemapsProcessed: 0,
      urlsFound: 0,
      errors: 0,
      cacheHits: 0,
      compressionSavings: 0
    };
  }

  /**
   * Parse a sitemap from a URL with full feature support
   * @param {string} url - Sitemap URL
   * @param {Object} options - Parsing options
   * @returns {Promise<Object>} Parsed sitemap data
   */
  async parseSitemap(url, options = {}) {
    const {
      includeMetadata = true,
      followIndexes = true,
      maxDepth = this.maxRecursionDepth
    } = options;

    // Reset stats for new parsing session
    this.stats = {
      sitemapsProcessed: 0,
      urlsFound: 0,
      errors: 0,
      cacheHits: 0,
      compressionSavings: 0
    };
    this.processedSitemaps.clear();

    try {
      const result = await this._parseSitemapRecursive(url, 0, maxDepth, {
        includeMetadata,
        followIndexes
      });

      return {
        success: true,
        urls: result.urls,
        metadata: includeMetadata ? result.metadata : {},
        sitemaps: result.sitemaps,
        statistics: this.getStatistics(),
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      this.stats.errors++;
      return {
        success: false,
        error: error.message,
        urls: [],
        metadata: {},
        sitemaps: [],
        statistics: this.getStatistics()
      };
    }
  }

  /**
   * Parse sitemap index files and return all contained sitemaps
   * @param {string} indexUrl - Sitemap index URL
   * @returns {Promise<Array>} Array of sitemap URLs with metadata
   */
  async parseSitemapIndex(indexUrl) {
    try {
      const content = await this._fetchSitemapContent(indexUrl);
      if (!content) return [];

      const $ = load(content, { xmlMode: true });
      const sitemaps = [];

      // Parse sitemap index entries
      $('sitemap').each((_, element) => {
        const $sitemap = $(element);
        const loc = $sitemap.find('loc').text().trim();
        
        if (loc) {
          const sitemap = {
            url: normalizeUrl(loc),
            lastmod: $sitemap.find('lastmod').text().trim() || null
          };
          sitemaps.push(sitemap);
        }
      });

      return sitemaps;
    } catch (error) {
      console.warn(`Failed to parse sitemap index ${indexUrl}:`, error.message);
      return [];
    }
  }

  /**
   * Extract all URLs from parsed sitemap data
   * @param {Object} sitemapData - Parsed sitemap result
   * @param {Object} filters - URL filtering options
   * @returns {Array} Filtered URLs with metadata
   */
  extractUrls(sitemapData, filters = {}) {
    const {
      includeImages = false,
      includeVideos = false,
      includeNews = false,
      domainFilter = null,
      pathFilter = null,
      changeFreqFilter = null,
      priorityFilter = null,
      lastModAfter = null,
      lastModBefore = null
    } = filters;

    if (!sitemapData.success || !sitemapData.urls) {
      return [];
    }

    let urls = [...sitemapData.urls];

    // Apply domain filter
    if (domainFilter) {
      const domain = domainFilter.toLowerCase();
      urls = urls.filter(url => {
        try {
          return new URL(url.loc).hostname.toLowerCase().includes(domain);
        } catch {
          return false;
        }
      });
    }

    // Apply path filter
    if (pathFilter) {
      const regex = new RegExp(pathFilter, 'i');
      urls = urls.filter(url => {
        try {
          return regex.test(new URL(url.loc).pathname);
        } catch {
          return false;
        }
      });
    }

    // Apply change frequency filter
    if (changeFreqFilter) {
      urls = urls.filter(url => url.changefreq === changeFreqFilter);
    }

    // Apply priority filter
    if (priorityFilter) {
      const { min = 0, max = 1 } = priorityFilter;
      urls = urls.filter(url => {
        const priority = parseFloat(url.priority || 0.5);
        return priority >= min && priority <= max;
      });
    }

    // Apply date filters
    if (lastModAfter || lastModBefore) {
      urls = urls.filter(url => {
        if (!url.lastmod) return true;
        
        const urlDate = new Date(url.lastmod);
        if (isNaN(urlDate.getTime())) return true;

        if (lastModAfter && urlDate < new Date(lastModAfter)) return false;
        if (lastModBefore && urlDate > new Date(lastModBefore)) return false;
        
        return true;
      });
    }

    // Include additional content types if requested
    const result = urls.map(url => ({
      url: url.loc,
      lastmod: url.lastmod,
      changefreq: url.changefreq,
      priority: url.priority,
      type: 'standard'
    }));

    // Add images, videos, news if requested and available
    if (includeImages && sitemapData.metadata.images) {
      sitemapData.metadata.images.forEach(img => {
        result.push({
          url: img.loc,
          caption: img.caption,
          title: img.title,
          type: 'image'
        });
      });
    }

    if (includeVideos && sitemapData.metadata.videos) {
      sitemapData.metadata.videos.forEach(vid => {
        result.push({
          url: vid.content_loc || vid.player_loc,
          title: vid.title,
          description: vid.description,
          duration: vid.duration,
          type: 'video'
        });
      });
    }

    if (includeNews && sitemapData.metadata.news) {
      sitemapData.metadata.news.forEach(news => {
        result.push({
          url: news.loc,
          title: news.title,
          publication: news.publication,
          publication_date: news.publication_date,
          type: 'news'
        });
      });
    }

    return result;
  }

  /**
   * Discover sitemap URLs from various sources
   * @param {string} baseUrl - Base URL of the website
   * @param {Object} sources - Sources to check
   * @returns {Promise<Array>} Array of discovered sitemap URLs
   */
  async discoverSitemaps(baseUrl, sources = {}) {
    const {
      checkRobotsTxt = true,
      checkCommonPaths = true,
      checkSitemapIndex = true
    } = sources;

    const discovered = new Set();
    const urlObj = new URL(baseUrl);
    const baseOrigin = `${urlObj.protocol}//${urlObj.host}`;

    // Check robots.txt for sitemap declarations
    if (checkRobotsTxt) {
      try {
        const robotsUrl = `${baseOrigin}/robots.txt`;
        const robotsContent = await this._fetchWithTimeout(robotsUrl);
        if (robotsContent) {
          const sitemapMatches = robotsContent.match(/^Sitemap:\s*(.+)$/gmi);
          if (sitemapMatches) {
            sitemapMatches.forEach(match => {
              const url = match.replace(/^Sitemap:\s*/i, '').trim();
              if (url) discovered.add(url);
            });
          }
        }
      } catch (error) {
        console.warn('Failed to check robots.txt for sitemaps:', error.message);
      }
    }

    // Check common sitemap paths
    if (checkCommonPaths) {
      const commonPaths = [
        '/sitemap.xml',
        '/sitemap_index.xml',
        '/sitemap-index.xml',
        '/sitemaps.xml',
        '/sitemap1.xml',
        '/feeds/all.xml',
        '/rss.xml',
        '/atom.xml'
      ];

      for (const path of commonPaths) {
        const sitemapUrl = `${baseOrigin}${path}`;
        try {
          const response = await this._fetchWithTimeoutResponse(sitemapUrl);
          if (response && response.ok) {
            discovered.add(sitemapUrl);
          }
        } catch {
          // Continue checking other paths
        }
      }
    }

    return Array.from(discovered);
  }

  /**
   * Recursive sitemap parsing with depth control
   * @private
   */
  async _parseSitemapRecursive(url, currentDepth, maxDepth, options) {
    if (currentDepth >= maxDepth || this.processedSitemaps.has(url)) {
      return { urls: [], metadata: {}, sitemaps: [] };
    }

    this.processedSitemaps.add(url);
    this.stats.sitemapsProcessed++;

    // Check cache first
    const cacheKey = this.cache?.generateKey(url, { depth: currentDepth });
    if (this.cache && cacheKey) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        this.stats.cacheHits++;
        return cached;
      }
    }

    try {
      const content = await this._fetchSitemapContent(url);
      if (!content) {
        throw new Error(`Failed to fetch sitemap content from ${url}`);
      }

      const result = await this._parseSitemapContent(content, url, options);
      
      // Handle sitemap indexes recursively
      if (options.followIndexes && result.sitemaps && result.sitemaps.length > 0) {
        for (const sitemapUrl of result.sitemaps.slice(0, 50)) { // Limit to prevent abuse
          if (currentDepth < maxDepth - 1) {
            const childResult = await this._parseSitemapRecursive(
              sitemapUrl, 
              currentDepth + 1, 
              maxDepth, 
              options
            );
            
            result.urls.push(...childResult.urls);
            Object.assign(result.metadata, childResult.metadata);
          }
        }
      }

      // Cache the result
      if (this.cache && cacheKey) {
        await this.cache.set(cacheKey, result);
      }

      return result;
    } catch (error) {
      this.stats.errors++;
      console.warn(`Failed to parse sitemap ${url}:`, error.message);
      return { urls: [], metadata: {}, sitemaps: [] };
    }
  }

  /**
   * Fetch and decompress sitemap content
   * @private
   */
  async _fetchSitemapContent(url) {
    try {
      const response = await this._fetchWithTimeoutResponse(url);
      if (!response || !response.ok) {
        return null;
      }

      const contentType = response.headers.get('content-type') || '';
      const contentEncoding = response.headers.get('content-encoding') || '';
      
      let content;
      
      // Handle compressed content
      if (url.endsWith('.gz') || contentEncoding.includes('gzip')) {
        const buffer = await response.arrayBuffer();
        const decompressed = await gunzip(Buffer.from(buffer));
        content = decompressed.toString('utf8');
        this.stats.compressionSavings += buffer.byteLength - decompressed.length;
      } else {
        content = await response.text();
      }

      return content;
    } catch (error) {
      console.warn(`Failed to fetch sitemap content from ${url}:`, error.message);
      return null;
    }
  }

  /**
   * Parse sitemap content with format detection
   * @private
   */
  async _parseSitemapContent(content, url, options) {
    const result = {
      urls: [],
      metadata: {},
      sitemaps: []
    };

    try {
      // Detect format and parse accordingly
      if (content.includes('<sitemapindex')) {
        return this._parseSitemapIndex(content, url);
      } else if (content.includes('<urlset') || content.includes('<url>')) {
        return this._parseStandardSitemap(content, url, options);
      } else if (content.includes('<rss') || content.includes('<feed')) {
        return this._parseRSSAtomFeed(content, url);
      } else {
        throw new Error(`Unrecognized sitemap format for ${url}`);
      }
    } catch (error) {
      console.warn(`Failed to parse sitemap content:`, error.message);
      return result;
    }
  }

  /**
   * Parse standard XML sitemap
   * @private
   */
  _parseStandardSitemap(content, url, options) {
    const $ = load(content, { xmlMode: true });
    const result = {
      urls: [],
      metadata: {},
      sitemaps: []
    };

    // Parse standard URLs
    $('url').each((_, element) => {
      const $url = $(element);
      const loc = $url.find('loc').text().trim();
      
      if (loc && result.urls.length < this.maxUrlsPerSitemap) {
        const urlData = {
          loc: normalizeUrl(loc),
          lastmod: $url.find('lastmod').text().trim() || null,
          changefreq: $url.find('changefreq').text().trim() || null,
          priority: $url.find('priority').text().trim() || null
        };

        if (this.validateUrls) {
          try {
            new URL(urlData.loc);
            result.urls.push(urlData);
            this.stats.urlsFound++;
          } catch {
            // Skip invalid URLs
          }
        } else {
          result.urls.push(urlData);
          this.stats.urlsFound++;
        }
      }
    });

    // Parse additional metadata if requested
    if (options.includeMetadata) {
      // Parse image sitemaps
      result.metadata.images = [];
      $('image\\:image, image').each((_, element) => {
        const $img = $(element);
        const loc = $img.find('image\\:loc, loc').text().trim();
        if (loc) {
          result.metadata.images.push({
            loc,
            caption: $img.find('image\\:caption, caption').text().trim(),
            title: $img.find('image\\:title, title').text().trim(),
            geo_location: $img.find('image\\:geo_location').text().trim()
          });
        }
      });

      // Parse video sitemaps
      result.metadata.videos = [];
      $('video\\:video, video').each((_, element) => {
        const $vid = $(element);
        const contentLoc = $vid.find('video\\:content_loc, content_loc').text().trim();
        const playerLoc = $vid.find('video\\:player_loc, player_loc').text().trim();
        
        if (contentLoc || playerLoc) {
          result.metadata.videos.push({
            content_loc: contentLoc,
            player_loc: playerLoc,
            title: $vid.find('video\\:title, title').text().trim(),
            description: $vid.find('video\\:description, description').text().trim(),
            thumbnail_loc: $vid.find('video\\:thumbnail_loc, thumbnail_loc').text().trim(),
            duration: $vid.find('video\\:duration, duration').text().trim()
          });
        }
      });

      // Parse news sitemaps
      result.metadata.news = [];
      $('news\\:news, news').each((_, element) => {
        const $news = $(element);
        const title = $news.find('news\\:title, title').text().trim();
        const publication = $news.find('news\\:publication news\\:name, publication name').text().trim();
        
        if (title) {
          result.metadata.news.push({
            title,
            publication,
            publication_date: $news.find('news\\:publication_date, publication_date').text().trim(),
            keywords: $news.find('news\\:keywords, keywords').text().trim()
          });
        }
      });
    }

    return result;
  }

  /**
   * Parse sitemap index
   * @private
   */
  _parseSitemapIndex(content, url) {
    const $ = load(content, { xmlMode: true });
    const result = {
      urls: [],
      metadata: {},
      sitemaps: []
    };

    $('sitemap').each((_, element) => {
      const $sitemap = $(element);
      const loc = $sitemap.find('loc').text().trim();
      
      if (loc) {
        result.sitemaps.push(normalizeUrl(loc));
      }
    });

    return result;
  }

  /**
   * Parse RSS/Atom feeds as fallback
   * @private
   */
  _parseRSSAtomFeed(content, url) {
    const $ = load(content, { xmlMode: true });
    const result = {
      urls: [],
      metadata: { feedType: null },
      sitemaps: []
    };

    // Detect feed type
    if (content.includes('<rss')) {
      result.metadata.feedType = 'rss';
      $('item').each((_, element) => {
        const $item = $(element);
        const link = $item.find('link').text().trim();
        const pubDate = $item.find('pubDate').text().trim();
        
        if (link && result.urls.length < this.maxUrlsPerSitemap) {
          result.urls.push({
            loc: normalizeUrl(link),
            lastmod: pubDate ? new Date(pubDate).toISOString() : null,
            changefreq: 'weekly',
            priority: '0.5'
          });
          this.stats.urlsFound++;
        }
      });
    } else if (content.includes('<feed')) {
      result.metadata.feedType = 'atom';
      $('entry').each((_, element) => {
        const $entry = $(element);
        const link = $entry.find('link').attr('href') || $entry.find('link').text().trim();
        const updated = $entry.find('updated').text().trim();
        
        if (link && result.urls.length < this.maxUrlsPerSitemap) {
          result.urls.push({
            loc: normalizeUrl(link),
            lastmod: updated || null,
            changefreq: 'weekly',
            priority: '0.5'
          });
          this.stats.urlsFound++;
        }
      });
    }

    return result;
  }

  /**
   * Fetch with timeout
   * @private
   */
  async _fetchWithTimeout(url) {
    const response = await this._fetchWithTimeoutResponse(url);
    return response ? await response.text() : null;
  }

  /**
   * Fetch with timeout returning response object
   * @private
   */
  async _fetchWithTimeoutResponse(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/xml,text/xml,text/plain,*/*',
          'Accept-Encoding': 'gzip, deflate'
        }
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Get parsing statistics
   */
  getStatistics() {
    return {
      ...this.stats,
      cacheHitRate: this.stats.sitemapsProcessed > 0 
        ? (this.stats.cacheHits / this.stats.sitemapsProcessed) * 100 
        : 0,
      averageUrlsPerSitemap: this.stats.sitemapsProcessed > 0 
        ? this.stats.urlsFound / this.stats.sitemapsProcessed 
        : 0,
      compressionSavingsKB: Math.round(this.stats.compressionSavings / 1024)
    };
  }

  /**
   * Clear all caches
   */
  async clearCache() {
    this.processedSitemaps.clear();
    if (this.cache) {
      await this.cache.clear();
    }
  }
}

export default SitemapParser;