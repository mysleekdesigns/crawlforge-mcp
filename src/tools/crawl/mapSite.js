import { z } from 'zod';
import { load } from 'cheerio';
import { DomainFilter } from '../../utils/domainFilter.js';
import { normalizeUrl, getBaseUrl } from '../../utils/urlNormalizer.js';
import { CacheManager } from '../../core/cache/CacheManager.js';
import { SitemapParser } from '../../utils/sitemapParser.js';
import { ResultRanker } from '../search/ranking/ResultRanker.js';

// Lazy singleton — avoids creating a CacheManager timer per request
let _ranker = null;
function getRanker() {
  if (!_ranker) _ranker = new ResultRanker({ cacheEnabled: false });
  return _ranker;
}

const MapSiteSchema = z.object({
  url: z.string().url(),
  include_sitemap: z.boolean().optional().default(true),
  max_urls: z.number().min(1).max(10000).optional().default(1000),
  group_by_path: z.boolean().optional().default(true),
  include_metadata: z.boolean().optional().default(false),
  // New domain filtering options
  domain_filter: z.object({
    whitelist: z.array(z.string()).optional().default([]),
    blacklist: z.array(z.string()).optional().default([]),
    include_patterns: z.array(z.string()).optional().default([]),
    exclude_patterns: z.array(z.string()).optional().default([])
  }).optional(),
  import_filter_config: z.string().optional(), // JSON string of exported config
  search: z.string().optional() // when set, rank URLs by relevance and emit ranked_urls
});

export class MapSiteTool {
  constructor(options = {}) {
    const {
      userAgent = 'MCP-WebScraper/1.0',
      timeout = 10000,
      cacheEnabled = true,
      cacheTTL = 3600000
    } = options;

    this.userAgent = userAgent;
    this.timeout = timeout;
    // Per-session result cache: avoids redundant site maps for the same root URL
    this.cache = cacheEnabled ? new CacheManager({ ttl: cacheTTL }) : null;
    this.sitemapParser = new SitemapParser({ userAgent, timeout, enableCaching: cacheEnabled, cacheTTL });
  }

  async execute(params) {
    try {
      const validated = MapSiteSchema.parse(params);

      // Cache dedup: skip re-mapping the same site within the TTL window
      if (this.cache) {
        const cacheKey = this.cache.generateKey('map_site', { url: validated.url, maxUrls: validated.max_urls });
        const cached = await this.cache.get(cacheKey);
        if (cached) return cached;
      }

      const baseUrl = getBaseUrl(validated.url);
      const urls = new Set();
      const metadata = new Map();

      // Create domain filter if configuration provided
      let domainFilter = null;
      if (validated.import_filter_config) {
        // Import from exported configuration
        domainFilter = new DomainFilter();
        try {
          const importConfig = JSON.parse(validated.import_filter_config);
          domainFilter.importConfig(importConfig);
        } catch (error) {
          throw new Error(`Invalid filter configuration: ${error.message}`);
        }
      } else if (validated.domain_filter) {
        // Create from inline configuration
        domainFilter = new DomainFilter({ allowSubdomains: true });
        
        // Configure domain filter
        for (const domain of validated.domain_filter.whitelist) {
          domainFilter.addWhitelistDomain(domain);
        }
        for (const domain of validated.domain_filter.blacklist) {
          domainFilter.addBlacklistDomain(domain);
        }
        for (const pattern of validated.domain_filter.include_patterns) {
          domainFilter.addPattern(pattern, 'include');
        }
        for (const pattern of validated.domain_filter.exclude_patterns) {
          domainFilter.addPattern(pattern, 'exclude');
        }
      }

      // Try to fetch sitemap first
      if (validated.include_sitemap) {
        const sitemapUrls = await this.fetchSitemapUrls(baseUrl, domainFilter);
        sitemapUrls.forEach(url => urls.add(normalizeUrl(url)));
      }

      // Fetch and parse the main page for additional URLs
      const pageUrls = await this.fetchPageUrls(validated.url, domainFilter);
      pageUrls.forEach(url => {
        if (urls.size < validated.max_urls) {
          urls.add(normalizeUrl(url));
        }
      });

      // Convert to array and limit
      const urlArray = Array.from(urls).slice(0, validated.max_urls);

      // Fetch metadata if requested
      if (validated.include_metadata) {
        await this.fetchMetadata(urlArray.slice(0, 50), metadata); // Limit metadata fetching
      }

      // Organize results
      const organized = validated.group_by_path 
        ? this.groupByPath(urlArray)
        : urlArray;

      const result = {
        base_url: baseUrl,
        total_urls: urlArray.length,
        urls: organized,
        metadata: validated.include_metadata ? Object.fromEntries(metadata) : {},
        site_map: this.generateSiteMap(urlArray),
        statistics: this.generateStatistics(urlArray),
        domain_filter_config: domainFilter ? domainFilter.exportConfig() : null,
        filter_stats: domainFilter ? domainFilter.getStats() : null
      };

      // Optional: rank URLs by relevance to a search string
      if (validated.search) {
        try {
          const rankerInput = urlArray.map(url => {
            let title = url;
            try {
              const { pathname } = new URL(url);
              title = decodeURIComponent(pathname).replace(/[-_/]/g, ' ').trim();
            } catch { /* keep raw url */ }
            return { link: url, title, snippet: '' };
          });
          const ranked = await getRanker().rankResults(rankerInput, validated.search);
          result.ranked_urls = ranked.map(r => ({ url: r.link, score: r.finalScore ?? 0 }));
        } catch {
          // ranking is best-effort; don't fail the whole call
          result.ranked_urls = urlArray.map(u => ({ url: u, score: 0 }));
        }
      }

      // Store in cache before returning
      if (this.cache) {
        const cacheKey = this.cache.generateKey('map_site', { url: validated.url, maxUrls: validated.max_urls });
        await this.cache.set(cacheKey, result);
      }

      return result;
    } catch (error) {
      throw new Error(`Site mapping failed: ${error.message}`);
    }
  }

  async fetchSitemapUrls(baseUrl, domainFilter = null) {
    // Discover sitemaps via robots.txt and common paths, then parse with full
    // SitemapParser support (sitemap-index recursion, gzip, CDATA/entities).
    const discovered = await this.sitemapParser.discoverSitemaps(baseUrl, {
      checkRobotsTxt: true,
      checkCommonPaths: true,
      checkSitemapIndex: false
    });

    const urls = new Set();
    for (const sitemapUrl of discovered) {
      try {
        const parsed = await this.sitemapParser.parseSitemap(sitemapUrl, {
          includeMetadata: false,
          followIndexes: true
        });
        if (parsed.success) {
          for (const entry of parsed.urls) {
            const url = entry.loc || entry;
            if (!domainFilter || domainFilter.isAllowed(url).allowed) {
              urls.add(url);
            }
          }
        }
        if (urls.size > 0) break;
      } catch {
        // Continue to next discovered sitemap
      }
    }

    return Array.from(urls);
  }

  async fetchPageUrls(url, domainFilter = null) {
    try {
      const response = await this.fetchWithTimeout(url);
      if (!response.ok) {
        return [];
      }

      const html = await response.text();
      const $ = load(html);
      const urls = new Set();
      const baseUrl = getBaseUrl(url);

      // Extract all links
      $('a[href]').each((_, element) => {
        const href = $(element).attr('href');
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          try {
            const absoluteUrl = new URL(href, url);
            // Only include URLs from the same domain
            if (absoluteUrl.origin === new URL(baseUrl).origin) {
              const urlString = absoluteUrl.toString();
              
              // Apply domain filter if provided
              if (!domainFilter || domainFilter.isAllowed(urlString).allowed) {
                urls.add(urlString);
              }
            }
          } catch {
            // Invalid URL, skip
          }
        }
      });

      return Array.from(urls);
    } catch {
      return [];
    }
  }

  async fetchMetadata(urls, metadataMap) {
    const promises = urls.slice(0, 10).map(async (url) => {
      try {
        const response = await this.fetchWithTimeout(url);
        if (response.ok) {
          const html = await response.text();
          const $ = load(html);
          
          metadataMap.set(url, {
            title: $('title').text().trim(),
            description: $('meta[name="description"]').attr('content') || '',
            keywords: $('meta[name="keywords"]').attr('content') || '',
            h1: $('h1').first().text().trim(),
            canonical: $('link[rel="canonical"]').attr('href') || ''
          });
        }
      } catch {
        // Skip metadata for failed URLs
      }
    });

    await Promise.allSettled(promises);
  }

  async fetchWithTimeout(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': this.userAgent
        }
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  groupByPath(urls) {
    const grouped = {};

    for (const url of urls) {
      try {
        const urlObj = new URL(url);
        const pathSegments = urlObj.pathname.split('/').filter(s => s);
        
        if (pathSegments.length === 0) {
          if (!grouped['/']) grouped['/'] = [];
          grouped['/'].push(url);
        } else {
          const firstSegment = '/' + pathSegments[0];
          if (!grouped[firstSegment]) grouped[firstSegment] = [];
          grouped[firstSegment].push(url);
        }
      } catch {
        // Skip invalid URLs
      }
    }

    // Sort URLs within each group
    for (const path in grouped) {
      grouped[path].sort();
    }

    return grouped;
  }

  generateSiteMap(urls) {
    const siteMap = {
      root: [],
      sections: {},
      depth_levels: {}
    };

    for (const url of urls) {
      try {
        const urlObj = new URL(url);
        const pathSegments = urlObj.pathname.split('/').filter(s => s);
        const depth = pathSegments.length;

        // Add to depth levels
        if (!siteMap.depth_levels[depth]) {
          siteMap.depth_levels[depth] = [];
        }
        siteMap.depth_levels[depth].push(url);

        // Add to sections
        if (depth === 0) {
          siteMap.root.push(url);
        } else {
          const section = pathSegments[0];
          if (!siteMap.sections[section]) {
            siteMap.sections[section] = {
              urls: [],
              subsections: {}
            };
          }
          siteMap.sections[section].urls.push(url);

          // Add subsections
          if (depth > 1) {
            const subsection = pathSegments[1];
            if (!siteMap.sections[section].subsections[subsection]) {
              siteMap.sections[section].subsections[subsection] = [];
            }
            siteMap.sections[section].subsections[subsection].push(url);
          }
        }
      } catch {
        // Skip invalid URLs
      }
    }

    return siteMap;
  }

  generateStatistics(urls) {
    const stats = {
      total_urls: urls.length,
      unique_paths: new Set(),
      file_extensions: {},
      query_parameters: 0,
      secure_urls: 0,
      max_depth: 0,
      average_depth: 0,
      url_lengths: {
        min: null,
        max: 0,
        average: 0
      }
    };

    let totalDepth = 0;
    let totalLength = 0;

    for (const url of urls) {
      try {
        const urlObj = new URL(url);

        // Count secure URLs
        if (urlObj.protocol === 'https:') {
          stats.secure_urls++;
        }

        // Count query parameters
        if (urlObj.search) {
          stats.query_parameters++;
        }

        // Track unique paths
        stats.unique_paths.add(urlObj.pathname);

        // Calculate depth
        const depth = urlObj.pathname.split('/').filter(s => s).length;
        totalDepth += depth;
        stats.max_depth = Math.max(stats.max_depth, depth);

        // Track URL lengths
        const length = url.length;
        totalLength += length;
        stats.url_lengths.min = stats.url_lengths.min === null ? length : Math.min(stats.url_lengths.min, length);
        stats.url_lengths.max = Math.max(stats.url_lengths.max, length);

        // Track file extensions
        const match = urlObj.pathname.match(/\.([a-z0-9]+)$/i);
        if (match) {
          const ext = match[1].toLowerCase();
          stats.file_extensions[ext] = (stats.file_extensions[ext] || 0) + 1;
        }
      } catch {
        // Skip invalid URLs
      }
    }

    stats.unique_paths = stats.unique_paths.size;
    stats.average_depth = urls.length > 0 ? totalDepth / urls.length : 0;
    stats.url_lengths.average = urls.length > 0 ? totalLength / urls.length : 0;

    return stats;
  }
}

export default MapSiteTool;