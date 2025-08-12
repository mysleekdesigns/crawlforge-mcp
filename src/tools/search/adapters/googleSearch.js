import { customsearch } from '@googleapis/customsearch';

export class GoogleSearchAdapter {
  constructor(apiKey, searchEngineId) {
    if (!apiKey || !searchEngineId) {
      throw new Error('Google API key and Search Engine ID are required');
    }

    this.apiKey = apiKey;
    this.searchEngineId = searchEngineId;
    this.customsearch = customsearch('v1');
  }

  async search(params) {
    try {
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

      return response.data;
    } catch (error) {
      if (error.response) {
        const status = error.response.status;
        const message = error.response.data?.error?.message || error.message;
        
        if (status === 429) {
          throw new Error('API rate limit exceeded. Please try again later.');
        } else if (status === 403) {
          throw new Error('API access forbidden. Check your API key and permissions.');
        } else if (status === 400) {
          throw new Error(`Invalid search parameters: ${message}`);
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

  validateApiKey() {
    // Test the API key with a simple search
    return this.search({
      query: 'test',
      num: 1
    }).then(() => true)
      .catch(() => false);
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