import { z } from 'zod';
import { SearchProviderFactory } from './adapters/searchProviderFactory.js';
import { CacheManager } from '../../core/cache/CacheManager.js';
import { QueryExpander } from './queryExpander.js';
import { ResultRanker } from './ranking/ResultRanker.js';
import { ResultDeduplicator } from './ranking/ResultDeduplicator.js';
import LocalizationManager from '../../core/LocalizationManager.js';

const SearchWebSchema = z.object({
  query: z.string().min(1),
  limit: z.number().min(1).max(100).optional().default(10),
  offset: z.number().min(0).optional().default(0),
  lang: z.string().optional().default('en'),
  safe_search: z.boolean().optional().default(true),
  time_range: z.enum(['day', 'week', 'month', 'year', 'all']).optional().default('all'),
  site: z.string().optional(),
  file_type: z.string().optional(),
  expand_query: z.boolean().optional().default(true),
  expansion_options: z.object({
    enableSynonyms: z.boolean().optional(),
    enableSpellCheck: z.boolean().optional(),
    enableStemming: z.boolean().optional(),
    enablePhraseDetection: z.boolean().optional(),
    enableBooleanOperators: z.boolean().optional(),
    maxExpansions: z.number().min(1).max(10).optional()
  }).optional(),
  
  // Ranking options
  enable_ranking: z.boolean().optional().default(true),
  ranking_weights: z.object({
    bm25: z.number().min(0).max(1).optional(),
    semantic: z.number().min(0).max(1).optional(),
    authority: z.number().min(0).max(1).optional(),
    freshness: z.number().min(0).max(1).optional()
  }).optional(),
  
  // Deduplication options
  enable_deduplication: z.boolean().optional().default(true),
  deduplication_thresholds: z.object({
    url: z.number().min(0).max(1).optional(),
    title: z.number().min(0).max(1).optional(),
    content: z.number().min(0).max(1).optional(),
    combined: z.number().min(0).max(1).optional()
  }).optional(),
  
  // Output options
  include_ranking_details: z.boolean().optional().default(false),
  include_deduplication_details: z.boolean().optional().default(false),
  
  // Localization options
  localization: z.object({
    countryCode: z.string().length(2).optional(),
    language: z.string().optional(),
    timezone: z.string().optional(),
    enableGeoTargeting: z.boolean().default(false),
    customLocation: z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180)
    }).optional()
  }).optional()
});

export class SearchWebTool {
  constructor(options = {}) {
    const {
      apiKey,
      apiBaseUrl,
      cacheEnabled = true,
      cacheTTL = 3600000, // 1 hour
      expanderOptions = {},
      rankingOptions = {},
      deduplicationOptions = {}
    } = options;

    if (!apiKey) {
      throw new Error('CrawlForge API key is required for search functionality');
    }

    // Create the CrawlForge search adapter
    try {
      this.searchAdapter = SearchProviderFactory.createAdapter(apiKey, {
        apiBaseUrl
      });
    } catch (error) {
      throw new Error(`Failed to initialize search adapter: ${error.message}`);
    }

    this.cache = cacheEnabled ? new CacheManager({ ttl: cacheTTL }) : null;
    
    // Initialize query expander
    this.queryExpander = new QueryExpander(expanderOptions);
    
    // Initialize ranking and deduplication systems
    this.resultRanker = new ResultRanker({ cacheEnabled, cacheTTL, ...rankingOptions });
    this.resultDeduplicator = new ResultDeduplicator({ cacheEnabled, cacheTTL, ...deduplicationOptions });
    
    // Initialize localization manager
    this.localizationManager = new LocalizationManager({
      enableGeoBlockingBypass: options.enableGeoBlockingBypass !== false,
      dynamicFingerprinting: options.dynamicFingerprinting !== false
    });
  }

  async execute(params) {
    try {
      const validated = SearchWebSchema.parse(params);
      
      // Apply localization if specified
      let localizedParams = validated;
      if (validated.localization) {
        try {
          localizedParams = await this.localizationManager.localizeSearchQuery(
            validated,
            validated.localization.countryCode
          );
        } catch (localizationError) {
          console.warn('Localization failed, using original parameters:', localizationError.message);
          // Continue with original parameters
        }
      }
      
      // Expand query if enabled
      let searchQueries = [localizedParams.query];
      let expandedQueries = [];
      
      if (localizedParams.expand_query) {
        try {
          expandedQueries = await this.queryExpander.expandQuery(
            localizedParams.query,
            localizedParams.expansion_options || {}
          );
          
          // Use the best expanded query as primary, keep original as fallback
          if (expandedQueries.length > 1) {
            searchQueries = expandedQueries;
          }
        } catch (expansionError) {
          console.warn('Query expansion failed, using original query:', expansionError.message);
          // Continue with original query
        }
      }
      
      // Generate cache key (include expansion and localization info for accurate caching)
      const cacheKey = this.cache ? this.cache.generateKey('search', {
        ...localizedParams,
        expandedQueries: localizedParams.expand_query ? expandedQueries : undefined,
        localization: validated.localization
      }) : null;
      
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
      
      // Try searches with expanded queries, starting with the best one
      let bestResults = null;
      let usedQuery = validated.query;
      let searchError = null;
      
      for (let i = 0; i < searchQueries.length; i++) {
        try {
          // Build search query with modifiers
          let searchQuery = searchQueries[i];
          
          if (validated.site) {
            searchQuery = `site:${validated.site} ${searchQuery}`;
          }
          
          if (validated.file_type) {
            searchQuery = `filetype:${validated.file_type} ${searchQuery}`;
          }
          
          // Perform search with localized parameters
          const searchParams = {
            query: searchQuery,
            num: localizedParams.limit,
            start: localizedParams.offset + 1, // Google uses 1-based indexing
            lr: localizedParams.lr || `lang_${localizedParams.lang}`,
            safe: localizedParams.safe_search ? 'active' : 'off',
            dateRestrict: this.getDateRestrict(localizedParams.time_range),
            // Add localization-specific parameters
            ...localizedParams.headers && { headers: localizedParams.headers },
            cr: localizedParams.cr, // Country restrict
            uule: localizedParams.uule // Location encoding
          };
          
          const results = await this.searchAdapter.search(searchParams);
          
          // Check if we got good results
          if (results.items && results.items.length > 0) {
            bestResults = results;
            usedQuery = searchQueries[i];
            break;
          } else if (i === 0) {
            // Save results from first query even if no items (might be the original query)
            bestResults = results;
            usedQuery = searchQueries[i];
          }
        } catch (error) {
          searchError = error;
          console.warn(`Search failed for query "${searchQueries[i]}":`, error.message);
          
          // If this is the last query and we haven't found results, throw the error
          if (i === searchQueries.length - 1 && !bestResults) {
            throw error;
          }
        }
      }
      
      if (!bestResults) {
        throw searchError || new Error('All search queries failed');
      }
      
      // Process and enrich results
      let processedResults = await this.processResults(bestResults);
      
      // Apply deduplication if enabled
      let deduplicationInfo = null;
      if (validated.enable_deduplication && processedResults.length > 1) {
        const dedupeOptions = validated.deduplication_thresholds ? 
          { thresholds: validated.deduplication_thresholds } : {};
        
        const originalCount = processedResults.length;
        processedResults = await this.resultDeduplicator.deduplicateResults(
          processedResults, 
          dedupeOptions
        );
        
        deduplicationInfo = {
          originalCount,
          finalCount: processedResults.length,
          duplicatesRemoved: originalCount - processedResults.length,
          deduplicationRate: ((originalCount - processedResults.length) / originalCount * 100).toFixed(1) + '%'
        };
      }
      
      // Apply ranking if enabled
      let rankingInfo = null;
      if (validated.enable_ranking && processedResults.length > 1) {
        const rankingOptions = validated.ranking_weights ? 
          { weights: validated.ranking_weights } : {};
        
        processedResults = await this.resultRanker.rankResults(
          processedResults,
          validated.query,
          rankingOptions
        );
        
        rankingInfo = {
          algorithmsUsed: ['bm25', 'semantic', 'authority', 'freshness'],
          weightsApplied: this.resultRanker.options.weights,
          totalResults: processedResults.length
        };
      }
      
      // Clean up results based on detail level requested
      if (!validated.include_ranking_details) {
        processedResults = processedResults.map(result => {
          const { rankingDetails, ...cleanResult } = result;
          return cleanResult;
        });
      }
      
      if (!validated.include_deduplication_details) {
        processedResults = processedResults.map(result => {
          const { deduplicationInfo, ...cleanResult } = result;
          return cleanResult;
        });
      }
      
      const response = {
        query: validated.query,
        effective_query: usedQuery !== validated.query ? usedQuery : undefined,
        expanded_queries: localizedParams.expand_query && expandedQueries.length > 1 ? expandedQueries : undefined,
        results: processedResults,
        total_results: bestResults.searchInformation?.totalResults || 0,
        search_time: bestResults.searchInformation?.searchTime || 0,
        offset: localizedParams.offset,
        limit: localizedParams.limit,
        cached: false,
        
        // Add provider information
        provider: {
          name: 'crawlforge',
          backend: 'Google Search',
          capabilities: SearchProviderFactory.getProviderCapabilities('crawlforge')
        },
        
        // Add localization information
        localization: validated.localization ? {
          applied: true,
          countryCode: validated.localization.countryCode,
          language: localizedParams.lang,
          searchDomain: localizedParams.searchDomain,
          geoTargeting: validated.localization.enableGeoTargeting
        } : null,
        
        // Add processing information
        processing: {
          ranking: rankingInfo,
          deduplication: deduplicationInfo,
          query_expansion: localizedParams.expand_query && expandedQueries.length > 1 ? {
            original_query: validated.query,
            expanded_count: expandedQueries.length,
            used_query: usedQuery
          } : null,
          localization_applied: !!validated.localization
        }
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

  async expandQuery(query, options = {}) {
    // Enhanced query expansion using QueryExpander
    try {
      return await this.queryExpander.expandQuery(query, options);
    } catch (error) {
      console.warn('Advanced query expansion failed, falling back to simple expansion:', error.message);
      
      // Fallback to simple expansion for backward compatibility
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
  }

  /**
   * Generate query suggestions
   * @param {string} query 
   * @returns {Array<string>}
   */
  async generateSuggestions(query) {
    try {
      return this.queryExpander.generateSuggestions(query);
    } catch (error) {
      console.warn('Suggestion generation failed:', error.message);
      return [];
    }
  }

  getStats() {
    return {
      provider: {
        name: 'crawlforge',
        backend: 'Google Search',
        capabilities: SearchProviderFactory.getProviderCapabilities('crawlforge')
      },
      cacheStats: this.cache ? this.cache.getStats() : null,
      queryExpanderStats: this.queryExpander ? this.queryExpander.getStats() : null,
      rankingStats: this.resultRanker ? this.resultRanker.getStats() : null,
      deduplicationStats: this.resultDeduplicator ? this.resultDeduplicator.getStats() : null
    };
  }

  getProviderInfo() {
    return {
      activeProvider: 'crawlforge',
      backend: 'Google Search via CrawlForge API',
      capabilities: SearchProviderFactory.getProviderCapabilities('crawlforge'),
      supportedProviders: SearchProviderFactory.getSupportedProviders()
    };
  }
}

export default SearchWebTool;
