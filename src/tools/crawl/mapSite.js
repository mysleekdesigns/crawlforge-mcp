import { z } from 'zod';
import { load } from 'cheerio';
import { DomainFilter } from '../../utils/domainFilter.js';
import { normalizeUrl, getBaseUrl } from '../../utils/urlNormalizer.js';

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
  import_filter_config: z.string().optional() // JSON string of exported config
});

export class MapSiteTool {
  constructor(options = {}) {
    const {
      userAgent = 'MCP-WebScraper/1.0',
      timeout = 10000
    } = options;

    this.userAgent = userAgent;
    this.timeout = timeout;
  }

  async execute(params) {
    try {
      const validated = MapSiteSchema.parse(params);
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

      return {
        base_url: baseUrl,
        total_urls: urlArray.length,
        urls: organized,
        metadata: validated.include_metadata ? Object.fromEntries(metadata) : {},
        site_map: this.generateSiteMap(urlArray),
        statistics: this.generateStatistics(urlArray),
        domain_filter_config: domainFilter ? domainFilter.exportConfig() : null,
        filter_stats: domainFilter ? domainFilter.getStats() : null
      };
    } catch (error) {
      throw new Error(`Site mapping failed: ${error.message}`);
    }
  }

  async fetchSitemapUrls(baseUrl, domainFilter = null) {
    const urls = new Set();
    const sitemapUrls = [
      `${baseUrl}/sitemap.xml`,
      `${baseUrl}/sitemap_index.xml`,
      `${baseUrl}/sitemap-index.xml`,
      `${baseUrl}/sitemaps.xml`
    ];

    for (const sitemapUrl of sitemapUrls) {
      try {
        const response = await this.fetchWithTimeout(sitemapUrl);
        if (response.ok) {
          const xml = await response.text();
          const extractedUrls = this.parseSitemap(xml);
          
          // Apply domain filter if provided
          extractedUrls.forEach(url => {
            if (!domainFilter || domainFilter.isAllowed(url).allowed) {
              urls.add(url);
            }
          });
          
          // If we found a sitemap, don't try others
          if (urls.size > 0) break;
        }
      } catch {
        // Continue to next sitemap URL
      }
    }

    return Array.from(urls);
  }

  parseSitemap(xml) {
    const urls = new Set();
    
    // Extract URLs from sitemap
    const urlMatches = xml.match(/<loc>([^<]+)<\/loc>/g);
    if (urlMatches) {
      urlMatches.forEach(match => {
        const url = match.replace(/<\/?loc>/g, '').trim();
        if (url) urls.add(url);
      });
    }

    // Check for nested sitemaps (sitemap index)
    const sitemapMatches = xml.match(/<sitemap>[\s\S]*?<\/sitemap>/g);
    if (sitemapMatches) {
      for (const sitemapMatch of sitemapMatches) {
        const locMatch = sitemapMatch.match(/<loc>([^<]+)<\/loc>/);
        if (locMatch && locMatch[1]) {
          // We could recursively fetch nested sitemaps here
          // For now, just add the sitemap URL itself
          urls.add(locMatch[1]);
        }
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
        min: Infinity,
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
        stats.url_lengths.min = Math.min(stats.url_lengths.min, length);
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