import { customsearch } from '@googleapis/customsearch';
import { RetryManager } from '../../../utils/RetryManager.js';
import { createCircuitBreaker } from '../../../utils/CircuitBreaker.js';
import { logger } from '../../../utils/Logger.js';

export class GoogleSearchAdapter {
  constructor(apiKey, searchEngineId, options = {}) {
    if (!apiKey || !searchEngineId) {
      throw new Error('Google API key and Search Engine ID are required');
    }

    this.apiKey = apiKey;
    this.searchEngineId = searchEngineId;
    this.customsearch = customsearch('v1');

    // Initialize error handling components
    this.retryManager = options.retryManager || RetryManager.createPreset('api');
    this.circuitBreaker = options.circuitBreaker || createCircuitBreaker('api');
    this.logger = logger.child({ component: 'GoogleSearchAdapter' });

    // Service identifier for circuit breaker
    this.serviceId = 'google-search-api';
  }

  async search(params) {
    const requestId = this.logger.startRequest({ 
      operation: 'search',
      query: params.query,
      parameters: { ...params, query: '[REDACTED]' } // Don't log sensitive query data
    });

    try {
      const result = await this.retryManager.executeWithCircuitBreaker(
        async () => {
          this.logger.debug('Executing Google search API call', { params }, requestId);
          
          const response = await this.customsearch.cse.list({
            auth: this.apiKey,
            cx: this.searchEngineId,
            q: params.query,
            num: params.num || 10,
            start: params.start || 1,
            lr: params.lr,
            safe: params.safe,
            dateRestrict: params.dateRestrict,
            siteSearch: params.siteSearch,
            siteSearchFilter: params.siteSearchFilter,
            fileType: params.fileType,
            rights: params.rights,
            imgSize: params.imgSize,
            imgType: params.imgType,
            imgColorType: params.imgColorType,
            imgDominantColor: params.imgDominantColor
          });

          this.logger.info('Google search API call successful', {
            resultsCount: response.data?.items?.length || 0,
            searchTime: response.data?.searchInformation?.searchTime
          }, requestId);

          return response.data;
        },
        this.circuitBreaker,
        this.serviceId,
        { operation: 'search', query: params.query }
      );

      this.logger.endRequest(requestId, { 
        success: true,
        resultsCount: result?.items?.length || 0 
      });

      return result;
    } catch (error) {
      this.logger.requestError(requestId, error, { 
        operation: 'search',
        query: params.query 
      });

      // Enhanced error handling with detailed logging
      if (error.response) {
        const status = error.response.status;
        const message = error.response.data?.error?.message || error.message;
        
        this.logger.warn('Google Search API error response', {
          status,
          message,
          query: params.query
        }, requestId);
        
        if (status === 429) {
          throw new Error('API rate limit exceeded. Please try again later.');
        } else if (status === 403) {
          throw new Error('API access forbidden. Check your API key and permissions.');
        } else if (status === 400) {
          throw new Error(`Invalid search parameters: ${message}`);
        } else if (status >= 500) {
          throw new Error(`Google Search API server error (${status}): ${message}`);
        }
      }
      
      throw new Error(`Google Search API error: ${error.message}`);
    }
  }

  async getSuggestions(query) {
    // Google doesn't provide suggestions through the Custom Search API
    // This could be implemented with a separate API or service
    return [];
  }

  async getRelatedSearches(query) {
    try {
      // Perform a search and extract related searches from the response
      const response = await this.search({
        query,
        num: 1
      });

      if (response.queries && response.queries.related) {
        return response.queries.related.map(r => r.searchTerms);
      }

      return [];
    } catch {
      return [];
    }
  }

  async validateApiKey() {
    const requestId = this.logger.startRequest({ operation: 'validateApiKey' });
    
    try {
      await this.search({
        query: 'test',
        num: 1
      });
      
      this.logger.endRequest(requestId, { success: true, valid: true });
      return true;
    } catch (error) {
      this.logger.requestError(requestId, error, { operation: 'validateApiKey' });
      return false;
    }
  }

  /**
   * Get error handling statistics
   * @returns {Object} Statistics from retry manager and circuit breaker
   */
  getStats() {
    return {
      retryStats: this.retryManager.getStats(),
      circuitBreakerStats: this.circuitBreaker.getStats(),
      loggerStats: this.logger.getStats()
    };
  }

  /**
   * Reset error handling statistics
   */
  resetStats() {
    this.retryManager.resetStats();
    this.circuitBreaker.reset(this.serviceId);
  }

  /**
   * Get health status of the service
   * @returns {Object} Health status information
   */
  getHealthStatus() {
    const circuitStats = this.circuitBreaker.getServiceMetrics(this.serviceId);
    const retryStats = this.retryManager.getStats();
    
    return {
      status: circuitStats.state === 'CLOSED' ? 'healthy' : 'degraded',
      circuitState: circuitStats.state,
      errorRate: circuitStats.errorRate,
      successRate: retryStats.successRate,
      lastFailure: circuitStats.lastFailure,
      nextAttempt: circuitStats.nextAttempt
    };
  }
}

export class MockSearchAdapter {
  // Mock adapter for testing without API keys
  async search(params) {
    return {
      kind: 'customsearch#search',
      searchInformation: {
        searchTime: 0.123,
        formattedSearchTime: '0.12',
        totalResults: '1000',
        formattedTotalResults: '1,000'
      },
      items: [
        {
          title: `Mock result for: ${params.query}`,
          link: `https://example.com/mock/${params.query.replace(/\s+/g, '-')}`,
          displayLink: 'example.com',
          snippet: `This is a mock search result for the query "${params.query}". It demonstrates the search functionality without requiring API credentials.`,
          htmlSnippet: `This is a mock search result for the query "<b>${params.query}</b>". It demonstrates the search functionality without requiring API credentials.`,
          formattedUrl: 'https://example.com/mock',
          pagemap: {
            metatags: [{
              'og:title': `Mock: ${params.query}`,
              'og:description': 'Mock search result description',
              'og:image': 'https://example.com/image.jpg'
            }]
          }
        }
      ]
    };
  }

  async getSuggestions(query) {
    return [`${query} tutorial`, `${query} examples`, `${query} documentation`];
  }

  async getRelatedSearches(query) {
    return [`${query} best practices`, `${query} alternatives`, `how to ${query}`];
  }

  async validateApiKey() {
    return true;
  }
}

export default GoogleSearchAdapter;