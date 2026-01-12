/**
 * Search Provider Factory
 *
 * Creates search adapter instances.
 * - Production: Uses CrawlForge proxy for Google Search (users with CrawlForge API key)
 * - Creator Mode: Uses Google Search API directly (requires GOOGLE_API_KEY & GOOGLE_SEARCH_ENGINE_ID)
 */

import { CrawlForgeSearchAdapter } from './crawlforgeSearch.js';
import { GoogleSearchAdapter } from './googleSearch.js';

export class SearchProviderFactory {
  /**
   * Create a search adapter
   * @param {string} apiKey - CrawlForge API key (optional for Creator Mode)
   * @param {Object} options - Configuration options
   * @param {string} options.apiBaseUrl - Custom API base URL (optional)
   * @param {boolean} options.creatorMode - Whether Creator Mode is enabled
   * @param {string} options.googleApiKey - Google API key (for Creator Mode)
   * @param {string} options.googleSearchEngineId - Google Search Engine ID (for Creator Mode)
   * @returns {CrawlForgeSearchAdapter|GoogleSearchAdapter} Search adapter instance
   */
  static createAdapter(apiKey, options = {}) {
    // In Creator Mode without CrawlForge API key, use Google Search API directly
    if (!apiKey && options.creatorMode) {
      const googleApiKey = options.googleApiKey || process.env.GOOGLE_API_KEY;
      const googleSearchEngineId = options.googleSearchEngineId || process.env.GOOGLE_SEARCH_ENGINE_ID;

      if (!googleApiKey || !googleSearchEngineId) {
        throw new Error(
          'Creator Mode requires Google Search API credentials. ' +
          'Set GOOGLE_API_KEY and GOOGLE_SEARCH_ENGINE_ID environment variables.\n' +
          'Get credentials at:\n' +
          '  - API Key: https://console.cloud.google.com/apis/credentials\n' +
          '  - Search Engine ID: https://programmablesearchengine.google.com/'
        );
      }

      console.log('🔍 Creator Mode: Using Google Search API directly');
      return new GoogleSearchAdapter(googleApiKey, googleSearchEngineId);
    }

    // Production mode requires CrawlForge API key
    if (!apiKey) {
      throw new Error('CrawlForge API key is required for search functionality');
    }

    return new CrawlForgeSearchAdapter(
      apiKey,
      options.apiBaseUrl || 'https://api.crawlforge.dev'
    );
  }

  /**
   * Get supported providers
   * @returns {Array<string>} List of supported providers
   */
  static getSupportedProviders() {
    return ['crawlforge', 'google'];
  }

  /**
   * Check if provider is available
   * @param {string} apiKey - CrawlForge API key
   * @param {Object} options - Configuration options
   * @returns {boolean} True if a provider is available
   */
  static isProviderAvailable(apiKey, options = {}) {
    // CrawlForge API key available
    if (apiKey) return true;

    // Creator Mode with Google credentials
    if (options.creatorMode) {
      const googleApiKey = options.googleApiKey || process.env.GOOGLE_API_KEY;
      const googleSearchEngineId = options.googleSearchEngineId || process.env.GOOGLE_SEARCH_ENGINE_ID;
      return !!(googleApiKey && googleSearchEngineId);
    }

    return false;
  }

  /**
   * Get provider capabilities
   * @param {string} provider - Provider name ('crawlforge' or 'google')
   * @returns {Object} Provider capabilities
   */
  static getProviderCapabilities(provider = 'crawlforge') {
    if (provider === 'google') {
      return {
        requiresApiKey: true,
        apiKeyType: 'Google API key + Search Engine ID',
        supportsPagination: true,
        supportsLanguageFilter: true,
        supportsDateFilter: true,
        supportsSiteFilter: true,
        supportsFileTypeFilter: true,
        supportsSafeSearch: true,
        supportsLocalization: true,
        supportsCountryTargeting: true,
        maxResultsPerRequest: 10,
        rateLimit: 'Based on Google API quota',
        creditCost: 'N/A (direct API)',
        features: [
          'Google Custom Search API',
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
          'Rich snippets'
        ],
        benefits: [
          'Direct Google API access',
          'No proxy overhead',
          'Full Google Search capabilities',
          'Creator Mode only'
        ]
      };
    }

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
   * Compare providers
   * @returns {Array<Object>} Provider comparison
   */
  static compareProviders() {
    return [
      {
        name: 'crawlforge',
        ...SearchProviderFactory.getProviderCapabilities('crawlforge')
      },
      {
        name: 'google',
        ...SearchProviderFactory.getProviderCapabilities('google')
      }
    ];
  }
}

export default SearchProviderFactory;
