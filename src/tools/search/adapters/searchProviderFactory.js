/**
 * Search Provider Factory
 * 
 * Creates search adapter instances. Now uses only CrawlForge proxy for all searches.
 * All search requests go through CrawlForge.dev API which uses Google Search backend.
 */

import { CrawlForgeSearchAdapter } from './crawlforgeSearch.js';

export class SearchProviderFactory {
  /**
   * Create a search adapter
   * @param {string} apiKey - CrawlForge API key
   * @param {Object} options - Configuration options
   * @param {string} options.apiBaseUrl - Custom API base URL (optional)
   * @returns {CrawlForgeSearchAdapter} Search adapter instance
   */
  static createAdapter(apiKey, options = {}) {
    if (!apiKey) {
      throw new Error('CrawlForge API key is required for search functionality');
    }
    
    return new CrawlForgeSearchAdapter(
      apiKey,
      options.apiBaseUrl || 'https://api.crawlforge.dev'
    );
  }

  /**
   * Get supported providers (now only CrawlForge)
   * @returns {Array<string>} List of supported providers
   */
  static getSupportedProviders() {
    return ['crawlforge'];
  }

  /**
   * Check if provider is available
   * @param {string} apiKey - CrawlForge API key
   * @param {Object} options - Configuration options
   * @returns {boolean} Always true if API key is provided
   */
  static isProviderAvailable(apiKey, options = {}) {
    return !!apiKey;
  }

  /**
   * Get provider capabilities
   * @param {string} provider - Provider name (always 'crawlforge')
   * @returns {Object} Provider capabilities
   */
  static getProviderCapabilities(provider = 'crawlforge') {
    return {
      requiresApiKey: true,
      apiKeyType: 'CrawlForge API key',
      supportsPagination: true,
      supportsLanguageFilter: true,
      supportsDateFilter: true,
      supportsSiteFilter: true,
      supportsFileTypeFilter: true,
      supportsSafeSearch: true,
      supportsLocalization: true,
      supportsCountryTargeting: true,
      maxResultsPerRequest: 100,
      rateLimit: 'Based on your CrawlForge plan',
      creditCost: '2 credits per search',
      features: [
        'Google Search results via CrawlForge proxy',
        'No Google API credentials needed',
        'Full text search',
        'Image metadata',
        'Exact phrase matching',
        'Boolean operators',
        'Site-specific search',
        'File type filtering',
        'Date range filtering',
        'Language filtering',
        'Country targeting',
        'Safe search',
        'Localization support',
        'Related searches',
        'Rich snippets'
      ],
      benefits: [
        'Simplified authentication (one API key)',
        'Unified billing through CrawlForge',
        'Enterprise-grade reliability',
        'No Google API quota management',
        'Built-in rate limiting',
        'Credit-based pricing'
      ]
    };
  }

  /**
   * Compare providers (legacy method for backward compatibility)
   * @returns {Array<Object>} Provider comparison
   */
  static compareProviders() {
    return [{
      name: 'crawlforge',
      ...SearchProviderFactory.getProviderCapabilities('crawlforge')
    }];
  }
}

export default SearchProviderFactory;
