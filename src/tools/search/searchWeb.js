import { z } from 'zod';
import { SearchProviderFactory } from './adapters/searchProviderFactory.js';
import { CacheManager } from '../../core/cache/CacheManager.js';
import { QueryExpander } from './queryExpander.js';
import { ResultRanker } from './ranking/ResultRanker.js';
import { ResultDeduplicator } from './ranking/ResultDeduplicator.js';
import { SearchResultCache } from './ranking/SearchResultCache.js';
import LocalizationManager from '../../core/LocalizationManager.js';
import { isCreatorModeVerified } from '../../core/creatorMode.js';
import { searchViaSearxng } from './providers/searxng.js';
import { MAX_SEARCH_QUERIES, SEARCH_WEB_CREDITS, EXACTLY_ONE_QUERY_MESSAGE } from './batchSearch.js';
import { setActualCost } from '../../server/requestContext.js';

const BatchQueriesSchema = z.array(z.string().min(1)).min(1).max(MAX_SEARCH_QUERIES);

const SearchWebSchema = z.object({
  query: z.string().min(1),
  provider: z.enum(['crawlforge', 'searxng']).optional().default('crawlforge'),
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

// Deduplication runs after the backend search, so asking the provider for
// exactly `limit` items returns short whenever that page contains duplicates.
// Over-fetch a small margin once and trim back to `limit` after dedup. Google
// returns at most 10 items per request and bills per request, so the margin
// never costs an extra backend search.
const DEDUPE_OVERFETCH = 4;
const GOOGLE_MAX_RESULTS_PER_REQUEST = 10;

/**
 * Index, in the provider's page, of the first item this response does not
 * show. Deduplication tags each kept result with its provider index
 * (`originalIndex`); without deduplication result i IS provider item i.
 *
 * @param {object[]} deduped results after deduplication, before the trim to `limit`
 * @param {number} limit results shown
 * @param {number} fetchedCount items the provider returned
 * @returns {number}
 */
export function firstUnshownIndex(deduped, limit, fetchedCount) {
  const unshown = deduped.slice(limit);
  if (unshown.length === 0) return fetchedCount;
  return Math.min(...unshown.map((r, i) => r.originalIndex ?? limit + i));
}

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

    // Check for Creator Mode - allows search without API key for development/testing
    const isCreatorMode = isCreatorModeVerified();

    // The server can start without a key so the MCP client can list tools, so
    // construction must not throw here. Every tool is metered and the key
    // requirement is enforced before execute() runs (withAuth credit check)
    // and again at execute() time below.
    if (!apiKey && !isCreatorMode) {
      this.searchAdapter = null;
      this.isCreatorModeFallback = false;
    } else {
      // Create the search adapter (CrawlForge API proxy or Google Search API direct in Creator Mode)
      try {
        this.searchAdapter = SearchProviderFactory.createAdapter(apiKey, {
          apiBaseUrl,
          creatorMode: isCreatorMode
        });
        this.isCreatorModeFallback = !apiKey && isCreatorMode;
      } catch (error) {
        throw new Error(`Failed to initialize search adapter: ${error.message}`);
      }
    }

    this.cache = cacheEnabled ? new CacheManager({ ttl: cacheTTL }) : null;

    // Initialize query expander
    this.queryExpander = new QueryExpander(expanderOptions);

    // Shared cache for ranking + deduplication — avoids two separate LRU instances
    const sharedRankingCache = new SearchResultCache({ ttl: cacheTTL, enabled: cacheEnabled });

    // Initialize ranking and deduplication systems (both share the same cache)
    this.resultRanker = new ResultRanker({ cacheEnabled, cacheTTL, sharedCache: sharedRankingCache, ...rankingOptions });
    this.resultDeduplicator = new ResultDeduplicator({ cacheEnabled, cacheTTL, sharedCache: sharedRankingCache, ...deduplicationOptions });
    
    // Initialize localization manager
    this.localizationManager = new LocalizationManager({
      enableGeoBlockingBypass: options.enableGeoBlockingBypass !== false,
      dynamicFingerprinting: options.dynamicFingerprinting !== false
    });
  }

  /**
   * Run 1-10 queries through the single-query pipeline and key the results by
   * query (5.1). Sequential: each entry is a separate billed backend search,
   * and firing ten at once at the provider buys nothing but rate limits.
   *
   * @param {object} params the call's params, `queries` included
   * @returns {Promise<{queries: string[], count: number, results_by_query: object[]}>}
   */
  async _executeBatch(params) {
    const { queries, query: _ignored, ...rest } = params;
    const parsed = BatchQueriesSchema.parse(queries);

    const results_by_query = [];
    let ran = 0;
    for (const query of parsed) {
      try {
        results_by_query.push({ query, ...await this.execute({ ...rest, query }) });
        ran++;
      } catch (error) {
        // One failed query does not sink the other nine.
        results_by_query.push({ query, error: error.message });
      }
    }

    // The projection is 5 per query; a query that failed before it reached a
    // backend did no work and must not be billed for one (G4). The projection
    // is the ceiling, so this only ever lowers the charge.
    setActualCost(SEARCH_WEB_CREDITS * ran);

    return { queries: parsed, count: parsed.length, results_by_query };
  }

  async execute(params) {
    // Batch form (5.1). Handled above the provider short-circuit below, so
    // the SearXNG branch runs each query through the same path the default
    // provider does.
    const hasQuery = params?.query !== undefined;
    const hasQueries = params?.queries !== undefined;
    if (hasQuery === hasQueries) throw new Error(EXACTLY_ONE_QUERY_MESSAGE);
    if (hasQueries) return await this._executeBatch(params);

    try {
      const validated = SearchWebSchema.parse(params);

      // --- SearXNG provider short-circuit ---
      if (validated.provider === 'searxng') {
        return await this._executeViaSearxng(validated);
      }
      // --- end SearXNG short-circuit ---

      // Search via the CrawlForge proxy needs an API key
      if (!this.searchAdapter) {
        throw new Error('CrawlForge API key is required for search functionality. Get one at https://www.crawlforge.dev/signup');
      }

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
      
      // The original query is always searched first. Query expansion is only a
      // zero-result fallback: the expanded form is computed and searched (one
      // more billed backend search) only when the original returned nothing.
      const queriesToTry = [localizedParams.query];

      // Generate cache key (include localization info for accurate caching)
      const cacheKey = this.cache ? this.cache.generateKey('search', {
        ...localizedParams,
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
      
      // Each retry (triggered when the previous query returned zero items) is
      // a separate billed backend search — at most one expanded fallback, so
      // one search_web call can't fan out into maxExpansions backend requests.
      let bestResults = null;
      let usedQuery = validated.query;
      let searchError = null;
      let searchAttempts = 0;

      for (let i = 0; i < queriesToTry.length; i++) {
        try {
          // Build search query with modifiers
          let searchQuery = queriesToTry[i];
          
          if (validated.site) {
            searchQuery = `site:${validated.site} ${searchQuery}`;
          }
          
          if (validated.file_type) {
            searchQuery = `filetype:${validated.file_type} ${searchQuery}`;
          }
          
          // Perform search with localized parameters
          const searchParams = {
            query: searchQuery,
            num: Math.min(
              GOOGLE_MAX_RESULTS_PER_REQUEST,
              localizedParams.limit + DEDUPE_OVERFETCH
            ),
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
          searchAttempts++;

          // Check if we got good results
          if (results.items && results.items.length > 0) {
            bestResults = results;
            usedQuery = queriesToTry[i];
            break;
          } else if (i === 0) {
            // Save results from first query even if no items (might be the original query)
            bestResults = results;
            usedQuery = queriesToTry[i];
          }
        } catch (error) {
          searchError = error;
          searchAttempts++;
          console.warn(`Search failed for query "${queriesToTry[i]}":`, error.message);
        }

        // The original query found nothing: try its first expanded form once.
        if (i === 0 && !bestResults?.items?.length && localizedParams.expand_query) {
          try {
            const expansions = await this.queryExpander.expandQuery(
              localizedParams.query,
              localizedParams.expansion_options || {}
            );
            // expansions[0] is the original query itself
            if (expansions.length > 1) queriesToTry.push(expansions[1]);
          } catch (expansionError) {
            console.warn('Query expansion failed, using original query:', expansionError.message);
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

      // Where the next page starts. Deduplication backfills this page from
      // the over-fetched margin, so the next page begins after the first
      // provider item NOT shown here, not at offset + limit (which repeated
      // the backfilled items on the next page).
      const nextOffset = localizedParams.offset + firstUnshownIndex(
        processedResults,
        localizedParams.limit,
        bestResults.items?.length || 0
      );

      // Drop the over-fetched margin. Runs unconditionally because the extra
      // items are requested whether or not deduplication is enabled.
      if (processedResults.length > localizedParams.limit) {
        processedResults = processedResults.slice(0, localizedParams.limit);
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
          // rankingDetails.weights carries the actually-applied (merged) weights
          // for this call; this.resultRanker.options.weights is only the
          // constructor default and previously misreported partial overrides.
          weightsApplied: processedResults[0]?.rankingDetails?.weights || this.resultRanker.options.weights,
          totalResults: processedResults.length
        };
      }
      
      // Clean up results based on detail level requested
      if (!validated.include_ranking_details) {
        processedResults = processedResults.map(result => {
          const { rankingDetails, finalScore, originalIndex, scores, ...cleanResult } = result;
          return cleanResult;
        });
      }

      if (!validated.include_deduplication_details) {
        processedResults = processedResults.map(result => {
          const { deduplicationInfo, contentHash, normalizedUrl, titleTokens, ...cleanResult } = result;
          return cleanResult;
        });
      }
      
      const response = {
        query: validated.query,
        effective_query: usedQuery !== validated.query ? usedQuery : undefined,
        expanded_queries: queriesToTry.length > 1 ? queriesToTry : undefined,
        results: processedResults,
        total_results: bestResults.searchInformation?.totalResults || 0,
        search_time: bestResults.searchInformation?.searchTime || 0,
        offset: localizedParams.offset,
        limit: localizedParams.limit,
        next_offset: nextOffset,
        cached: false,
        
        // Add provider information
        provider: this.isCreatorModeFallback ? {
          name: 'google',
          backend: 'Google Custom Search API (Creator Mode)',
          note: 'Using Google Search API directly. Production users use CrawlForge API.',
          capabilities: SearchProviderFactory.getProviderCapabilities('google')
        } : {
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
          // Present only when the original found nothing and an expanded
          // form was searched as well.
          query_expansion: queriesToTry.length > 1 ? {
            original_query: validated.query,
            used_query: usedQuery,
            // Backend searches actually issued for this call (at most 2) —
            // surfaces the retry/billing cost that was previously invisible.
            search_attempts: searchAttempts
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

  /**
   * Execute search via a self-hosted SearXNG instance.
   * Results are normalised to the same shape as the CrawlForge/Google path.
   *
   * @param {Object} validated - Parsed & validated parameters from SearchWebSchema
   * @returns {Promise<Object>} Standard search_web response object
   */
  async _executeViaSearxng(validated) {
    // page is 1-based; offset is 0-based items, so map via limit
    const page = Math.floor(validated.offset / validated.limit) + 1;

    const adapterResult = await searchViaSearxng({
      query: validated.query,
      // SearXNG returns a whole page per request, so the dedup margin is free.
      limit: validated.limit + DEDUPE_OVERFETCH,
      page,
      safeSearch: validated.safe_search,
      language: validated.lang
    });

    // Run through shared post-processing (deduplication, ranking)
    let processedResults = await this.processResults(adapterResult);

    let deduplicationInfo = null;
    if (validated.enable_deduplication && processedResults.length > 1) {
      const dedupeOptions = validated.deduplication_thresholds
        ? { thresholds: validated.deduplication_thresholds }
        : {};
      const originalCount = processedResults.length;
      processedResults = await this.resultDeduplicator.deduplicateResults(
        processedResults,
        dedupeOptions
      );
      deduplicationInfo = {
        originalCount,
        finalCount: processedResults.length,
        duplicatesRemoved: originalCount - processedResults.length,
        deduplicationRate:
          ((originalCount - processedResults.length) / originalCount * 100).toFixed(1) + '%'
      };
    }

    // Drop the over-fetched margin (see execute()).
    if (processedResults.length > validated.limit) {
      processedResults = processedResults.slice(0, validated.limit);
    }

    let rankingInfo = null;
    if (validated.enable_ranking && processedResults.length > 1) {
      const rankingOptions = validated.ranking_weights
        ? { weights: validated.ranking_weights }
        : {};
      processedResults = await this.resultRanker.rankResults(
        processedResults,
        validated.query,
        rankingOptions
      );
      rankingInfo = {
        algorithmsUsed: ['bm25', 'semantic', 'authority', 'freshness'],
        // See execute()'s equivalent block: rankingDetails.weights carries the
        // actually-applied (merged) weights for this call.
        weightsApplied: processedResults[0]?.rankingDetails?.weights || this.resultRanker.options.weights,
        totalResults: processedResults.length
      };
    }

    if (!validated.include_ranking_details) {
      processedResults = processedResults.map(({ rankingDetails, finalScore, originalIndex, scores, ...r }) => r);
    }
    if (!validated.include_deduplication_details) {
      processedResults = processedResults.map(({ deduplicationInfo: _d, contentHash, normalizedUrl, titleTokens, ...r }) => r);
    }

    return {
      query: validated.query,
      results: processedResults,
      total_results: adapterResult.searchInformation?.totalResults || 0,
      search_time: adapterResult.searchInformation?.searchTime || 0,
      offset: validated.offset,
      limit: validated.limit,
      // SearXNG is paged (offset maps to page floor(offset/limit)+1), so the
      // next page starts at the next multiple of limit.
      next_offset: page * validated.limit,
      cached: false,
      provider: {
        name: 'searxng',
        backend: 'SearXNG (self-hosted)',
        instanceUrl: process.env.CRAWLFORGE_SEARXNG_URL || null,
        capabilities: {
          requiresApiKey: false,
          supportsPagination: true,
          supportsLanguageFilter: true,
          supportsSafeSearch: true
        }
      },
      localization: null,
      processing: {
        ranking: rankingInfo,
        deduplication: deduplicationInfo,
        query_expansion: null,
        localization_applied: false
      }
    };
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
      provider: this.isCreatorModeFallback ? {
        name: 'google',
        backend: 'Google Custom Search API (Creator Mode)',
        note: 'Using Google Search API directly'
      } : {
        name: 'crawlforge',
        backend: 'Google Search',
        capabilities: SearchProviderFactory.getProviderCapabilities('crawlforge')
      },
      creatorMode: this.isCreatorModeFallback || false,
      cacheStats: this.cache ? this.cache.getStats() : null,
      queryExpanderStats: this.queryExpander ? this.queryExpander.getStats() : null,
      rankingStats: this.resultRanker ? this.resultRanker.getStats() : null,
      deduplicationStats: this.resultDeduplicator ? this.resultDeduplicator.getStats() : null
    };
  }

  getProviderInfo() {
    return {
      activeProvider: this.isCreatorModeFallback ? 'google' : 'crawlforge',
      backend: this.isCreatorModeFallback
        ? 'Google Custom Search API (Creator Mode)'
        : 'Google Search via CrawlForge API',
      capabilities: SearchProviderFactory.getProviderCapabilities(
        this.isCreatorModeFallback ? 'google' : 'crawlforge'
      ),
      supportedProviders: SearchProviderFactory.getSupportedProviders(),
      isCreatorMode: this.isCreatorModeFallback || false
    };
  }
}

export default SearchWebTool;
