import * as cheerio from 'cheerio';
import { search as ddgSearch, SafeSearchType, SearchTimeType } from 'duck-duck-scrape';

export class DuckDuckGoSearchAdapter {
  constructor(options = {}) {
    this.timeout = options.timeout || 30000;
    this.maxRetries = options.maxRetries || 3;
    this.userAgent = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.retryDelay = options.retryDelay || 2000; // Increased base delay
    this.baseUrl = 'https://html.duckduckgo.com/html/';
  }

  async search(params) {
    const {
      query,
      num = 10,
      start = 1,
      lr,
      safe = 'moderate',
      dateRestrict
    } = params;

    // Try duck-duck-scrape library first (more reliable API access)
    try {
      const results = await this.searchWithLibrary(query, num, safe, dateRestrict);
      if (results.items && results.items.length > 0) {
        return results;
      }
    } catch (libraryError) {
      console.warn('DuckDuckGo library search failed:', libraryError.message);
      // Check if it's a CAPTCHA/anomaly error
      if (libraryError.message.includes('anomaly') || libraryError.message.includes('too quickly')) {
        throw new Error(
          'DuckDuckGo is blocking automated requests. ' +
          'To use web search reliably, please configure Google Custom Search API by setting ' +
          'GOOGLE_API_KEY and GOOGLE_SEARCH_ENGINE_ID environment variables. ' +
          'See: https://developers.google.com/custom-search/v1/introduction'
        );
      }
    }

    // Fallback to HTML scraping (legacy method)
    const offset = (start - 1) * num;

    const formData = new URLSearchParams({
      q: query,
      b: offset.toString(),
      kl: 'us-en',
      df: '',
      safe: 'moderate'
    });

    if (safe === 'active') {
      formData.set('safe', 'strict');
    } else if (safe === 'off') {
      formData.set('safe', 'off');
    } else {
      formData.set('safe', 'moderate');
    }

    if (lr && lr.startsWith('lang_')) {
      const lang = lr.replace('lang_', '');
      formData.set('kl', this.mapLanguageCode(lang));
    }

    if (dateRestrict) {
      const timeFilter = this.mapDateRestrict(dateRestrict);
      if (timeFilter) {
        formData.set('df', timeFilter);
      }
    }

    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // Add delay between attempts to avoid rate limiting
        if (attempt > 1) {
          await new Promise(resolve =>
            setTimeout(resolve, this.retryDelay * Math.pow(2, attempt - 1))
          );
        }

        const htmlResponse = await this.makeRequest(formData);
        return this.parseHtmlResponse(htmlResponse, query, num, start);
      } catch (error) {
        lastError = error;
        // If it's a CAPTCHA error, don't retry - it won't help
        if (error.message.includes('CAPTCHA') || error.message.includes('automated requests')) {
          throw error;
        }
      }
    }

    throw new Error(`DuckDuckGo search failed after ${this.maxRetries} attempts: ${lastError.message}`);
  }

  async searchWithLibrary(query, num, safe, dateRestrict) {
    // Map safe search settings
    let safeSearch = SafeSearchType.MODERATE;
    if (safe === 'active' || safe === 'strict') {
      safeSearch = SafeSearchType.STRICT;
    } else if (safe === 'off') {
      safeSearch = SafeSearchType.OFF;
    }

    // Map time filter
    let time = undefined;
    if (dateRestrict) {
      const timeMap = {
        'd1': SearchTimeType.DAY,
        'w1': SearchTimeType.WEEK,
        'm1': SearchTimeType.MONTH,
        'y1': SearchTimeType.YEAR
      };
      time = timeMap[dateRestrict];
    }

    const searchResults = await ddgSearch(query, {
      safeSearch,
      time,
      locale: 'en-us'
    });

    // Transform results to match expected format
    const items = (searchResults.results || []).slice(0, num).map(result => ({
      title: result.title || '',
      link: result.url || '',
      snippet: result.description || '',
      displayLink: this.extractDomain(result.url),
      formattedUrl: result.url || '',
      htmlSnippet: result.description || '',
      pagemap: {
        metatags: {
          title: result.title || '',
          description: result.description || ''
        }
      },
      metadata: {
        source: 'duckduckgo_api',
        type: 'web_result',
        hostname: result.hostname || '',
        icon: result.icon || ''
      }
    }));

    return {
      kind: 'duckduckgo#search',
      searchInformation: {
        searchTime: 0.1,
        formattedSearchTime: '0.10',
        totalResults: items.length.toString(),
        formattedTotalResults: items.length.toLocaleString()
      },
      items: items
    };
  }

  async makeRequest(formData) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': 'https://duckduckgo.com',
          'Referer': 'https://duckduckgo.com/',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'same-site'
        },
        body: formData.toString(),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      return html;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.timeout}ms`);
      }
      
      throw error;
    }
  }

  parseHtmlResponse(html, query, num, start) {
    try {
      const $ = cheerio.load(html);
      const items = [];

      // Check for CAPTCHA challenge (DuckDuckGo bot protection)
      const captchaIndicators = [
        'anomaly-modal',
        'Unfortunately, bots use DuckDuckGo too',
        'Select all squares containing a duck',
        'confirm this search was made by a human',
        'challenge-form'
      ];

      for (const indicator of captchaIndicators) {
        if (html.includes(indicator)) {
          throw new Error(
            'DuckDuckGo CAPTCHA detected - automated requests are being blocked. ' +
            'To use web search reliably, please configure Google Custom Search API by setting ' +
            'GOOGLE_API_KEY and GOOGLE_SEARCH_ENGINE_ID environment variables. ' +
            'See: https://developers.google.com/custom-search/v1/introduction'
          );
        }
      }

      // Look for search result containers - DuckDuckGo uses various selectors
      const resultSelectors = [
        '.result',           // Primary result class
        '.results_links',    // Alternative result class
        '.web-result',       // Another possible class
        '.result__body'      // Result body container
      ];

      let results = $();
      for (const selector of resultSelectors) {
        results = $(selector);
        if (results.length > 0) break;
      }

      // If no results found with standard selectors, try more generic approach
      if (results.length === 0) {
        results = $('div[data-domain]'); // DuckDuckGo sometimes uses data-domain attribute
      }

      results.each((index, element) => {
        if (items.length >= num) return false; // Stop if we have enough results

        const $result = $(element);
        
        // Extract title - try multiple selectors
        let title = '';
        const titleSelectors = [
          'a.result__a',
          '.result__title a',
          'h2 a',
          '.result-title a',
          'a[href^="http"]'
        ];

        for (const selector of titleSelectors) {
          const titleElement = $result.find(selector).first();
          if (titleElement.length > 0) {
            title = titleElement.text().trim();
            break;
          }
        }

        // Extract URL - try multiple selectors
        let url = '';
        const urlSelectors = [
          'a.result__a',
          '.result__title a', 
          'h2 a',
          '.result-title a',
          'a[href^="http"]'
        ];

        for (const selector of urlSelectors) {
          const urlElement = $result.find(selector).first();
          if (urlElement.length > 0) {
            url = urlElement.attr('href') || '';
            break;
          }
        }

        // Extract snippet - try multiple selectors
        let snippet = '';
        const snippetSelectors = [
          'a.result__snippet',
          '.result__snippet',
          '.result-snippet',
          '.snippet',
          '.result__body',
          'span.result__snippet'
        ];

        for (const selector of snippetSelectors) {
          const snippetElement = $result.find(selector).first();
          if (snippetElement.length > 0) {
            snippet = snippetElement.text().trim();
            break;
          }
        }

        // If no snippet found, try to get any text content
        if (!snippet) {
          const allText = $result.text().trim();
          // Remove title from text to get snippet
          snippet = allText.replace(title, '').trim().substring(0, 300);
        }

        // Clean and validate the extracted data
        if (title && url && this.isValidUrl(url)) {
          items.push({
            title: this.cleanText(title),
            link: url,
            snippet: this.cleanText(snippet),
            displayLink: this.extractDomain(url),
            formattedUrl: url,
            htmlSnippet: this.cleanText(snippet),
            pagemap: {
              metatags: {
                title: this.cleanText(title),
                description: this.cleanText(snippet)
              }
            },
            metadata: {
              source: 'duckduckgo_html',
              type: 'web_result'
            }
          });
        }
      });

      // If no results found, provide helpful feedback
      if (items.length === 0) {
        // Check if there's a "no results" message
        const noResultsIndicators = [
          'No results found',
          'no web results',
          'Try searching for'
        ];

        let hasNoResults = false;
        for (const indicator of noResultsIndicators) {
          if (html.toLowerCase().includes(indicator.toLowerCase())) {
            hasNoResults = true;
            break;
          }
        }

        if (hasNoResults) {
          throw new Error(`No search results found for query: "${query}"`);
        } else {
          throw new Error('Could not parse search results from DuckDuckGo response');
        }
      }

      return {
        kind: 'duckduckgo#search',
        searchInformation: {
          searchTime: 0.1,
          formattedSearchTime: '0.10',
          totalResults: items.length.toString(),
          formattedTotalResults: items.length.toLocaleString()
        },
        items: items
      };

    } catch (error) {
      if (error.message.includes('No search results found') || error.message.includes('Could not parse')) {
        throw error;
      }
      throw new Error(`Failed to parse DuckDuckGo HTML response: ${error.message}`);
    }
  }

  isValidUrl(url) {
    if (!url) return false;
    try {
      const urlObj = new URL(url);
      return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch {
      return false;
    }
  }

  cleanText(text) {
    if (!text) return '';
    // Remove HTML tags, normalize whitespace, and trim
    return text
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  extractDomain(url) {
    if (!url) return '';
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  mapLanguageCode(code) {
    // Map common language codes to DuckDuckGo's format
    const languageMap = {
      'en': 'us-en',
      'es': 'es-es',
      'fr': 'fr-fr',
      'de': 'de-de',
      'it': 'it-it',
      'pt': 'pt-br',
      'ru': 'ru-ru',
      'ja': 'jp-jp',
      'ko': 'kr-kr',
      'zh': 'cn-zh'
    };
    return languageMap[code] || 'us-en';
  }

  mapDateRestrict(dateRestrict) {
    // Map Google's dateRestrict format to DuckDuckGo's time filters
    const dateMap = {
      'd1': 'd',    // past day
      'w1': 'w',    // past week  
      'm1': 'm',    // past month
      'y1': 'y'     // past year
    };
    return dateMap[dateRestrict] || null;
  }

  async getSuggestions(query) {
    try {
      // DuckDuckGo's autocomplete endpoint
      const url = `https://duckduckgo.com/ac/?q=${encodeURIComponent(query)}&type=list`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // Shorter timeout for suggestions

      const response = await fetch(url, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/json',
          'Referer': 'https://duckduckgo.com/'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return Array.isArray(data) && data.length > 1 ? data[1] : [];
    } catch (error) {
      // Fail silently for suggestions
      return [];
    }
  }

  async getRelatedSearches(query) {
    // DuckDuckGo doesn't provide a direct related searches API
    // Return some common query variations
    const words = query.split(' ').filter(w => w.length > 2);
    const related = [];
    
    if (words.length > 0) {
      related.push(`${query} tutorial`);
      related.push(`${query} guide`);
      related.push(`${query} examples`);
      related.push(`how to ${query}`);
      related.push(`${query} best practices`);
    }
    
    return related.slice(0, 5);
  }

  async validateApiKey() {
    // DuckDuckGo doesn't require API keys, test HTML scraping functionality
    try {
      const result = await this.search({ query: 'test search', num: 1 });
      return result && result.items && result.items.length >= 0; // Even 0 results is valid
    } catch (error) {
      console.warn('DuckDuckGo validation failed:', error.message);
      return false;
    }
  }
}

export default DuckDuckGoSearchAdapter;