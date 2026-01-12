/**
 * CrawlForge Search Adapter
 * 
 * Proxies search requests through CrawlForge.dev API which uses Google Search.
 * Users only need their CrawlForge API key - no Google credentials required.
 * 
 * Credit Cost: 2 credits per search
 */

export class CrawlForgeSearchAdapter {
  constructor(apiKey, apiBaseUrl = 'https://api.crawlforge.dev') {
    if (!apiKey) {
      throw new Error('CrawlForge API key is required for search functionality');
    }
    
    this.apiKey = apiKey;
    this.apiBaseUrl = apiBaseUrl;
  }

  /**
   * Perform a web search via CrawlForge API
   * @param {Object} params - Search parameters
   * @param {string} params.query - Search query
   * @param {number} params.num - Number of results
   * @param {number} params.start - Starting position
   * @param {string} params.lr - Language restriction
   * @param {string} params.safe - Safe search setting
   * @param {string} params.dateRestrict - Date restriction
   * @param {string} params.cr - Country restriction
   * @param {string} params.uule - Location encoding
   * @returns {Promise<Object>} Search results in Google Search API format
   */
  async search(params) {
    try {
      const response = await fetch(`${this.apiBaseUrl}/api/v1/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey
        },
        body: JSON.stringify({
          query: params.query,
          num: params.num || 10,
          start: params.start || 1,
          lr: params.lr,
          safe: params.safe,
          dateRestrict: params.dateRestrict,
          cr: params.cr,
          uule: params.uule,
          // Forward any additional localization headers
          headers: params.headers
        })
      });

      if (!response.ok) {
        let errorMessage = 'Search request failed';
        
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
          
          // Handle specific error cases
          if (response.status === 401) {
            errorMessage = 'Invalid API key. Please check your CrawlForge API key.';
          } else if (response.status === 402) {
            errorMessage = 'Insufficient credits. Please upgrade your plan at https://www.crawlforge.dev/pricing';
          } else if (response.status === 429) {
            errorMessage = 'Rate limit exceeded. Please try again later.';
          }
        } catch (parseError) {
          // If we can't parse the error response, use the status text
          errorMessage = `Search failed with status ${response.status}: ${response.statusText}`;
        }
        
        throw new Error(errorMessage);
      }

      const data = await response.json();
      
      // Validate response format
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid response format from search API');
      }
      
      // Return data in Google Search API compatible format
      return {
        items: data.items || [],
        searchInformation: data.searchInformation || {
          totalResults: '0',
          searchTime: 0
        },
        queries: data.queries || {},
        context: data.context || {}
      };
    } catch (error) {
      // Network errors or fetch failures
      if (error.name === 'TypeError' || error.message.includes('fetch')) {
        throw new Error(`Network error connecting to CrawlForge API: ${error.message}`);
      }
      
      // Re-throw our formatted errors
      throw error;
    }
  }
}

export default CrawlForgeSearchAdapter;
