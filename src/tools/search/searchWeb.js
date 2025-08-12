import { z } from 'zod';
import { GoogleSearchAdapter } from './adapters/googleSearch.js';
import { CacheManager } from '../../core/cache/CacheManager.js';

const SearchWebSchema = z.object({
  query: z.string().min(1),
  limit: z.number().min(1).max(100).optional().default(10),
  offset: z.number().min(0).optional().default(0),
  lang: z.string().optional().default('en'),
  safe_search: z.boolean().optional().default(true),
  time_range: z.enum(['day', 'week', 'month', 'year', 'all']).optional().default('all'),
  site: z.string().optional(),
  file_type: z.string().optional()
});

export class SearchWebTool {
  constructor(options = {}) {
    const {
      apiKey,
      searchEngineId,
      cacheEnabled = true,
      cacheTTL = 3600000 // 1 hour
    } = options;

    if (!apiKey || !searchEngineId) {
      throw new Error('Google API key and Search Engine ID are required');
    }

    this.searchAdapter = new GoogleSearchAdapter(apiKey, searchEngineId);
    this.cache = cacheEnabled ? new CacheManager({ ttl: cacheTTL }) : null;
  }

  async execute(params) {
    try {
      const validated = SearchWebSchema.parse(params);
      
      // Generate cache key
      const cacheKey = this.cache ? this.cache.generateKey('search', validated) : null;
      
      // Check cache
      if (this.cache) {
        const cached = await this.cache.get(cacheKey);
        if (cached) {
          return {
            ...cached,
            cached: true
          };
        }
      }
      
      // Build search query with modifiers
      let searchQuery = validated.query;
      
      if (validated.site) {
        searchQuery = `site:${validated.site} ${searchQuery}`;
      }
      
      if (validated.file_type) {
        searchQuery = `filetype:${validated.file_type} ${searchQuery}`;
      }
      
      // Perform search
      const results = await this.searchAdapter.search({
        query: searchQuery,
        num: validated.limit,
        start: validated.offset + 1, // Google uses 1-based indexing
        lr: `lang_${validated.lang}`,
        safe: validated.safe_search ? 'active' : 'off',
        dateRestrict: this.getDateRestrict(validated.time_range)
      });
      
      // Process and enrich results
      const processedResults = await this.processResults(results);
      
      const response = {
        query: validated.query,
        results: processedResults,
        total_results: results.searchInformation?.totalResults || 0,
        search_time: results.searchInformation?.searchTime || 0,
        offset: validated.offset,
        limit: validated.limit,
        cached: false
      };
      
      // Cache the results
      if (this.cache) {
        await this.cache.set(cacheKey, response);
      }
      
      return response;
    } catch (error) {
      throw new Error(`Search failed: ${error.message}`);
    }
  }

  async processResults(searchResults) {
    if (!searchResults.items || searchResults.items.length === 0) {
      return [];
    }

    return searchResults.items.map(item => ({
      title: item.title || '',
      link: item.link || '',
      snippet: item.snippet || '',
      displayLink: item.displayLink || '',
      formattedUrl: item.formattedUrl || '',
      htmlSnippet: item.htmlSnippet || '',
      pagemap: this.extractPagemap(item.pagemap),
      metadata: {
        mime: item.mime,
        fileFormat: item.fileFormat,
        cacheId: item.cacheId
      }
    }));
  }

  extractPagemap(pagemap) {
    if (!pagemap) return {};
    
    const extracted = {};
    
    // Extract metatags
    if (pagemap.metatags && pagemap.metatags[0]) {
      const meta = pagemap.metatags[0];
      extracted.metatags = {
        title: meta['og:title'] || meta['twitter:title'] || '',
        description: meta['og:description'] || meta['twitter:description'] || meta.description || '',
        image: meta['og:image'] || meta['twitter:image'] || '',
        author: meta.author || '',
        publishedTime: meta['article:published_time'] || '',
        modifiedTime: meta['article:modified_time'] || ''
      };
    }
    
    // Extract CSE thumbnail
    if (pagemap.cse_thumbnail && pagemap.cse_thumbnail[0]) {
      extracted.thumbnail = {
        src: pagemap.cse_thumbnail[0].src,
        width: pagemap.cse_thumbnail[0].width,
        height: pagemap.cse_thumbnail[0].height
      };
    }
    
    // Extract CSE image
    if (pagemap.cse_image && pagemap.cse_image[0]) {
      extracted.image = pagemap.cse_image[0].src;
    }
    
    return extracted;
  }

  getDateRestrict(timeRange) {
    const ranges = {
      'day': 'd1',
      'week': 'w1',
      'month': 'm1',
      'year': 'y1',
      'all': ''
    };
    
    return ranges[timeRange] || '';
  }

  async expandQuery(query) {
    // Simple query expansion with synonyms and related terms
    const expansions = [];
    
    // Add common variations
    expansions.push(query);
    
    // Add quoted exact match
    if (!query.includes('"')) {
      expansions.push(`"${query}"`);
    }
    
    // Add OR variations for multi-word queries
    const words = query.split(' ').filter(w => w.length > 2);
    if (words.length > 1) {
      expansions.push(words.join(' OR '));
    }
    
    return expansions;
  }

  getStats() {
    return {
      cacheStats: this.cache ? this.cache.getStats() : null
    };
  }
}

export default SearchWebTool;