import { GoogleSearchAdapter } from './googleSearch.js';
import { DuckDuckGoSearchAdapter } from './duckduckgoSearch.js';

export class SearchProviderFactory {
  static createAdapter(provider, options = {}) {
    switch (provider.toLowerCase()) {
      case 'google':
        if (!options.google?.apiKey || !options.google?.searchEngineId) {
          throw new Error('Google Search adapter requires apiKey and searchEngineId');
        }
        return new GoogleSearchAdapter(
          options.google.apiKey,
          options.google.searchEngineId
        );
        
      case 'duckduckgo':
        return new DuckDuckGoSearchAdapter(options.duckduckgo || {});
        
      default:
        throw new Error(`Unsupported search provider: ${provider}`);
    }
  }

  static getSupportedProviders() {
    return ['google', 'duckduckgo'];
  }

  static isProviderAvailable(provider, options = {}) {
    try {
      SearchProviderFactory.createAdapter(provider, options);
      return true;
    } catch {
      return false;
    }
  }

  static getProviderCapabilities(provider) {
    const capabilities = {
      google: {
        requiresApiKey: true,
        supportsPagination: true,
        supportsLanguageFilter: true,
        supportsDateFilter: true,
        supportsSiteFilter: true,
        supportsFileTypeFilter: true,
        supportsSafeSearch: true,
        maxResultsPerRequest: 100,
        rateLimit: '100 queries per day (free tier)',
        features: [
          'Web search',
          'Image search',
          'Exact phrase matching',
          'Boolean operators',
          'Site-specific search',
          'File type filtering',
          'Date range filtering',
          'Language filtering',
          'Safe search',
          'Related searches'
        ]
      },
      duckduckgo: {
        requiresApiKey: false,
        supportsPagination: false, // Limited by API
        supportsLanguageFilter: true,
        supportsDateFilter: true,
        supportsSiteFilter: false, // Not directly supported
        supportsFileTypeFilter: false, // Not directly supported
        supportsSafeSearch: true,
        maxResultsPerRequest: 10, // Limited by instant answer API
        rateLimit: 'No explicit limit (be respectful)',
        features: [
          'Privacy-focused search',
          'Instant answers',
          'No tracking',
          'Language filtering',
          'Date filtering',
          'Safe search',
          'Autocomplete suggestions'
        ]
      }
    };

    return capabilities[provider.toLowerCase()] || null;
  }

  static compareProviders() {
    const providers = SearchProviderFactory.getSupportedProviders();
    return providers.map(provider => ({
      name: provider,
      ...SearchProviderFactory.getProviderCapabilities(provider)
    }));
  }
}

export default SearchProviderFactory;