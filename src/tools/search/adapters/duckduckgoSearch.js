import * as cheerio from 'cheerio';

export class DuckDuckGoSearchAdapter {
  constructor(options = {}) {
    this.timeout = options.timeout || 30000;
    this.maxRetries = options.maxRetries || 3;
    this.userAgent = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
    this.retryDelay = options.retryDelay || 1000;
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

    // Calculate pagination offset for DuckDuckGo
    const offset = (start - 1) * num;

    // Build form data for POST request to DuckDuckGo HTML endpoint
    const formData = new URLSearchParams({
      q: query,
      b: offset.toString(), // DuckDuckGo uses 'b' for pagination offset
      kl: 'us-en',         // Default language
      df: '',              // Date filter
      safe: 'moderate'     // Safe search setting
    });

    // Update safe search parameter
    if (safe === 'active') {
      formData.set('safe', 'strict');
    } else if (safe === 'off') {
      formData.set('safe', 'off');
    } else {
      formData.set('safe', 'moderate');
    }

    // Add language if specified
    if (lr && lr.startsWith('lang_')) {
      const lang = lr.replace('lang_', '');
      formData.set('kl', this.mapLanguageCode(lang));
    }

    // Add date filter if specified
    if (dateRestrict) {
      const timeFilter = this.mapDateRestrict(dateRestrict);
      if (timeFilter) {
        formData.set('df', timeFilter);
      }
    }

    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const htmlResponse = await this.makeRequest(formData);
        return this.parseHtmlResponse(htmlResponse, query, num, start);
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries) {
          // Exponential backoff
          await new Promise(resolve => 
            setTimeout(resolve, this.retryDelay * Math.pow(2, attempt - 1))
          );
        }
      }
    }

    throw new Error(`DuckDuckGo search failed after ${this.maxRetries} attempts: ${lastError.message}`);
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