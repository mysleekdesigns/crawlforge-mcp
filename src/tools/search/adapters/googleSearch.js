/**
 * Google Custom Search API Adapter
 *
 * Direct integration with Google Custom Search API.
 * Used by Creator Mode when GOOGLE_API_KEY and GOOGLE_SEARCH_ENGINE_ID are configured.
 *
 * Requirements:
 * - GOOGLE_API_KEY: Your Google Cloud API key
 * - GOOGLE_SEARCH_ENGINE_ID: Your Custom Search Engine ID (cx)
 *
 * Get credentials at:
 * - API Key: https://console.cloud.google.com/apis/credentials
 * - Search Engine ID: https://programmablesearchengine.google.com/
 */

export class GoogleSearchAdapter {
  constructor(apiKey, searchEngineId) {
    if (!apiKey) {
      throw new Error('Google API key is required');
    }
    if (!searchEngineId) {
      throw new Error('Google Search Engine ID (cx) is required');
    }

    this.apiKey = apiKey;
    this.searchEngineId = searchEngineId;
    this.baseUrl = 'https://www.googleapis.com/customsearch/v1';
  }

  /**
   * Perform a web search via Google Custom Search API
   * @param {Object} params - Search parameters
   * @param {string} params.query - Search query
   * @param {number} params.num - Number of results (1-10 per request)
   * @param {number} params.start - Starting position (1-based)
   * @param {string} params.lr - Language restriction (e.g., 'lang_en')
   * @param {string} params.safe - Safe search setting ('active' or 'off')
   * @param {string} params.dateRestrict - Date restriction (e.g., 'd1', 'w1', 'm1', 'y1')
   * @param {string} params.cr - Country restriction
   * @param {string} params.siteSearch - Restrict to specific site
   * @param {string} params.fileType - Restrict to file type
   * @returns {Promise<Object>} Search results
   */
  async search(params) {
    try {
      // Build query parameters
      const searchParams = new URLSearchParams({
        key: this.apiKey,
        cx: this.searchEngineId,
        q: params.query,
        num: Math.min(params.num || 10, 10), // Google API max is 10 per request
        start: params.start || 1,
      });

      // Add optional parameters
      if (params.lr) {
        searchParams.set('lr', params.lr);
      }
      if (params.safe) {
        searchParams.set('safe', params.safe);
      }
      if (params.dateRestrict) {
        searchParams.set('dateRestrict', params.dateRestrict);
      }
      if (params.cr) {
        searchParams.set('cr', params.cr);
      }
      if (params.siteSearch) {
        searchParams.set('siteSearch', params.siteSearch);
      }
      if (params.fileType) {
        searchParams.set('fileType', params.fileType);
      }

      const response = await fetch(`${this.baseUrl}?${searchParams.toString()}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        }
      });

      if (!response.ok) {
        let errorMessage = 'Google Search API request failed';

        try {
          const errorData = await response.json();
          if (errorData.error) {
            errorMessage = errorData.error.message || errorMessage;

            // Handle specific error cases
            if (response.status === 400) {
              errorMessage = `Invalid request: ${errorMessage}`;
            } else if (response.status === 401) {
              errorMessage = 'Invalid Google API key';
            } else if (response.status === 403) {
              errorMessage = 'Google API access forbidden. Check API key permissions or quota.';
            } else if (response.status === 429) {
              errorMessage = 'Google API quota exceeded. Try again later.';
            }
          }
        } catch (parseError) {
          errorMessage = `Google Search failed with status ${response.status}: ${response.statusText}`;
        }

        throw new Error(errorMessage);
      }

      const data = await response.json();

      // Return in standard format
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
      // Network errors
      if (error.name === 'TypeError' || error.message.includes('fetch')) {
        throw new Error(`Network error connecting to Google Search API: ${error.message}`);
      }

      throw error;
    }
  }
}

export default GoogleSearchAdapter;
