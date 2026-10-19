import { CacheManager } from '../../../core/cache/CacheManager.js';

/**
 * Advanced search result deduplication system using multiple similarity algorithms.
 * Accepts an optional `sharedCache` (SearchResultCache instance) to avoid
 * creating a duplicate CacheManager when used alongside ResultRanker.
 */
export class ResultDeduplicator {
  constructor(options = {}) {
    const { sharedCache, ...serializableOptions } = options;
    this.options = {
      // Similarity thresholds
      thresholds: {
        url: 0.9,           // URL similarity threshold
        title: 0.85,        // Title similarity threshold
        content: 0.85,      // Content similarity threshold
        combined: 0.8       // Combined similarity threshold for final decision
      },

      // Deduplication strategies
      strategies: {
        urlNormalization: true,    // Normalize URLs for comparison
        titleFuzzy: true,          // Use fuzzy title matching
        contentSimhash: true,      // Use SimHash for content comparison
        domainClustering: true     // Cluster results by domain
      },

      // URL normalization options
      urlNormalization: {
        removeProtocol: true,      // Remove http/https difference
        removeWww: true,           // Remove www prefix
        removeTrailingSlash: true, // Remove trailing slashes
        removeDefaultPorts: true,  // Remove default ports (80, 443)
        sortQueryParams: true,     // Sort query parameters
        removeEmptyParams: true,   // Remove empty query parameters
        lowercaseDomain: true      // Convert domain to lowercase
      },

      // Content similarity options
      contentSimilarity: {
        minLength: 10,             // Minimum content length to compare
        ngramSize: 3,              // N-gram size for comparison
        simhashBits: 64,           // SimHash bit size
        hammingThreshold: 16       // Hamming distance threshold for SimHash
      },

      // Merge strategy
      mergeStrategy: {
        preserveBestRank: true,    // Keep the best ranking result as primary
        combineMetadata: true,     // Combine metadata from duplicates
        preferHttps: true,         // Prefer HTTPS URLs when merging
        preferShorterUrl: true     // Prefer shorter, cleaner URLs
      },

      // Performance options
      cacheEnabled: true,
      cacheTTL: 3600000,          // 1 hour
      ...serializableOptions
    };

    // Use shared cache if provided, otherwise create own CacheManager instance.
    // sharedCache is held separately — never in this.options — because it holds
    // a setInterval Timer that would create a circular reference when the
    // options object is JSON.stringify'd to build a cache key (see generateKey).
    this.cache = sharedCache || (this.options.cacheEnabled
      ? new CacheManager({ ttl: this.options.cacheTTL })
      : null);

    // Statistics tracking
    this.stats = {
      totalProcessed: 0,
      duplicatesFound: 0,
      urlDuplicates: 0,
      titleDuplicates: 0,
      contentDuplicates: 0,
      merged: 0
    };
  }

  /**
   * Deduplicate search results using multiple similarity algorithms
   * @param {Array} results - Array of search results
   * @param {Object} options - Deduplication options
   * @returns {Promise<Array>} Deduplicated results
   */
  async deduplicateResults(results, options = {}) {
    if (!results || results.length <= 1) {
      return results;
    }

    // Deep-merge thresholds instead of replacing wholesale — a caller
    // passing a partial thresholds object (e.g. {url: 0.8}) previously wiped
    // out the other thresholds, leaving them `undefined` and silently
    // disabling title/content/combined duplicate detection.
    const dedupeOptions = {
      ...this.options,
      ...options,
      thresholds: { ...this.options.thresholds, ...(options.thresholds || {}) }
    };
    this.stats.totalProcessed += results.length;
    
    // Generate cache key for deduplication computation
    const cacheKey = this.cache ? this.cache.generateKey('deduplication', {
      resultsHash: this.hashResults(results),
      options: dedupeOptions
    }) : null;

    // Check cache
    if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return cached.results;
      }
    }

    try {
      // Step 1: Normalize URLs for all results
      const normalizedResults = results.map((result, index) => ({
        ...result,
        originalIndex: index,
        normalizedUrl: this.normalizeUrl(result.link || result.url, dedupeOptions.urlNormalization),
        titleTokens: this.tokenizeTitle(result.title || ''),
        deduplicationInfo: {
          originalUrl: result.link || result.url,
          duplicateOf: null,
          duplicateReasons: [],
          merged: false
        }
      }));

      // Step 2: Find duplicate groups
      const duplicateGroups = this.findDuplicateGroups(normalizedResults, dedupeOptions);
      
      // Step 3: Merge duplicates within each group
      const mergedResults = this.mergeDuplicateGroups(duplicateGroups, dedupeOptions.mergeStrategy);
      
      // Step 4: Add deduplication metadata
      const finalResults = mergedResults.map(result => ({
        ...result,
        deduplicationInfo: {
          ...result.deduplicationInfo,
          totalDuplicatesFound: duplicateGroups.find(group => 
            group.some(r => r.originalIndex === result.originalIndex)
          )?.length - 1 || 0
        }
      }));

      // Update statistics
      this.stats.duplicatesFound += results.length - finalResults.length;

      // Cache the results
      if (this.cache) {
        await this.cache.set(cacheKey, {
          results: finalResults,
          stats: this.getDeduplicationStats(results.length, finalResults.length)
        });
      }

      return finalResults;
    } catch (error) {
      console.error('Deduplication failed:', error);
      // Return original results with error info
      return results.map(result => ({
        ...result,
        deduplicationInfo: {
          error: error.message,
          originalUrl: result.link || result.url,
          duplicateOf: null,
          duplicateReasons: [],
          merged: false,
          totalDuplicatesFound: 0
        }
      }));
    }
  }

  /**
   * Find groups of duplicate results
   */
  findDuplicateGroups(results, options) {
    const groups = [];
    const processed = new Set();

    for (let i = 0; i < results.length; i++) {
      if (processed.has(i)) continue;

      const currentGroup = [results[i]];
      processed.add(i);

      // Find all duplicates of current result. A result joins the group only
      // when it duplicates EVERY member, so a hub page (e.g. MDN `Array`)
      // cannot pull in its children one by one.
      for (let j = i + 1; j < results.length; j++) {
        if (processed.has(j)) continue;

        if (currentGroup.every(member => this.areDuplicates(member, results[j], options))) {
          currentGroup.push(results[j]);
          processed.add(j);
          
          // Track duplicate reasons
          results[j].deduplicationInfo.duplicateOf = results[i].originalIndex;
          results[j].deduplicationInfo.duplicateReasons = this.getDuplicateReasons(
            results[i], results[j], options
          );
        }
      }

      groups.push(currentGroup);
    }

    return groups;
  }

  /**
   * Check if two results are duplicates
   */
  areDuplicates(result1, result2, options) {
    const similarities = this.computeSimilarities(result1, result2, options);

    // The same page written differently (protocol, www, trailing slash,
    // index.html, tracking parameters) normalizes to the same URL.
    if (result1.normalizedUrl && result1.normalizedUrl === result2.normalizedUrl) {
      this.stats.urlDuplicates++;
      return true;
    }

    // Different URLs merge only on similar content. Sibling pages share a
    // URL prefix and a site title template (" - JavaScript | MDN"), so URL
    // and title similarity alone never prove two pages are the same.
    if (similarities.content < options.thresholds.content) {
      return false;
    }

    // Content plus one more high-similarity signal
    if (similarities.url >= options.thresholds.url || similarities.title >= options.thresholds.title) {
      if (similarities.title >= options.thresholds.title) this.stats.titleDuplicates++;
      this.stats.contentDuplicates++;
      return true;
    }

    // Combined similarity score (still requires high threshold)
    const combinedScore = this.computeCombinedSimilarity(similarities);
    if (combinedScore >= options.thresholds.combined) {
      return true;
    }

    return false;
  }

  /**
   * Compute similarity scores between two results
   */
  computeSimilarities(result1, result2, options) {
    return {
      url: this.computeUrlSimilarity(result1, result2),
      title: this.computeTitleSimilarity(result1, result2),
      content: this.computeContentSimilarity(result1, result2, options.contentSimilarity)
    };
  }

  /**
   * Compute URL similarity
   */
  computeUrlSimilarity(result1, result2) {
    const url1 = result1.normalizedUrl;
    const url2 = result2.normalizedUrl;
    
    if (url1 === url2) return 1.0;
    
    // Use edit distance for URL comparison
    return 1 - (this.editDistance(url1, url2) / Math.max(url1.length, url2.length));
  }

  /**
   * Compute title similarity using fuzzy matching
   */
  computeTitleSimilarity(result1, result2) {
    const title1 = (result1.title || '').toLowerCase().trim();
    const title2 = (result2.title || '').toLowerCase().trim();
    
    if (!title1 || !title2) return 0;
    if (title1 === title2) return 1.0;
    
    // Compute Jaccard similarity on title tokens
    const tokens1 = new Set(result1.titleTokens);
    const tokens2 = new Set(result2.titleTokens);
    
    const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
    const union = new Set([...tokens1, ...tokens2]);
    
    const jaccardSimilarity = intersection.size / union.size;
    
    // Also compute edit distance similarity
    const editSimilarity = 1 - (this.editDistance(title1, title2) / Math.max(title1.length, title2.length));
    
    // Return weighted combination
    return (jaccardSimilarity * 0.7) + (editSimilarity * 0.3);
  }

  /**
   * Compute content similarity: Jaccard over the snippets' words. A 64-bit
   * SimHash of a ~30-word snippet is too noisy here: unrelated MDN sibling
   * snippets scored up to 0.86 against the 0.85 threshold (R25 1.3).
   */
  computeContentSimilarity(result1, result2, contentOptions) {
    const content1 = this.extractContent(result1);
    const content2 = this.extractContent(result2);

    if (content1.length < contentOptions.minLength || content2.length < contentOptions.minLength) {
      return 0;
    }

    const words1 = new Set(content1.split(' '));
    const words2 = new Set(content2.split(' '));
    const intersection = [...words1].filter(word => words2.has(word)).length;

    return intersection / new Set([...words1, ...words2]).size;
  }

  /**
   * Compute combined similarity score
   */
  computeCombinedSimilarity(similarities) {
    // Weighted combination of similarity scores
    return (
      similarities.url * 0.4 +
      similarities.title * 0.35 +
      similarities.content * 0.25
    );
  }

  /**
   * Get reasons why two results are considered duplicates
   */
  getDuplicateReasons(result1, result2, options) {
    const reasons = [];
    const similarities = this.computeSimilarities(result1, result2, options);
    
    if (similarities.url >= options.thresholds.url) {
      reasons.push(`URL similarity: ${(similarities.url * 100).toFixed(1)}%`);
    }
    
    if (similarities.title >= options.thresholds.title) {
      reasons.push(`Title similarity: ${(similarities.title * 100).toFixed(1)}%`);
    }
    
    if (similarities.content >= options.thresholds.content) {
      reasons.push(`Content similarity: ${(similarities.content * 100).toFixed(1)}%`);
    }
    
    const combined = this.computeCombinedSimilarity(similarities);
    if (combined >= options.thresholds.combined) {
      reasons.push(`Combined similarity: ${(combined * 100).toFixed(1)}%`);
    }
    
    return reasons;
  }

  /**
   * Merge duplicate groups, keeping the best result as primary
   */
  mergeDuplicateGroups(groups, mergeStrategy) {
    return groups.map(group => {
      if (group.length === 1) {
        return group[0]; // No duplicates to merge
      }
      
      // Find the best result in the group to keep as primary
      const primaryResult = this.selectPrimaryResult(group, mergeStrategy);
      const duplicates = group.filter(r => r !== primaryResult);
      
      // Merge metadata from duplicates
      if (mergeStrategy.combineMetadata) {
        this.mergeMetadata(primaryResult, duplicates);
      }
      
      // Update deduplication info
      primaryResult.deduplicationInfo.merged = true;
      primaryResult.deduplicationInfo.mergedDuplicates = duplicates.length;
      primaryResult.deduplicationInfo.duplicateUrls = duplicates.map(d => d.deduplicationInfo.originalUrl);
      
      this.stats.merged += duplicates.length;
      
      return primaryResult;
    });
  }

  /**
   * Select the primary result from a duplicate group
   */
  selectPrimaryResult(group, mergeStrategy) {
    // Sort by multiple criteria
    return group.sort((a, b) => {
      // 1. Prefer results with better ranking (if available)
      if (mergeStrategy.preserveBestRank) {
        const rankA = a.finalScore || a.rankingDetails?.finalScore || 0;
        const rankB = b.finalScore || b.rankingDetails?.finalScore || 0;
        if (rankA !== rankB) return rankB - rankA;
      }
      
      // 2. Prefer HTTPS URLs
      if (mergeStrategy.preferHttps) {
        const httpsA = a.link?.startsWith('https://') ? 1 : 0;
        const httpsB = b.link?.startsWith('https://') ? 1 : 0;
        if (httpsA !== httpsB) return httpsB - httpsA;
      }
      
      // 3. Prefer shorter URLs (often more canonical)
      if (mergeStrategy.preferShorterUrl) {
        const lengthA = (a.link || '').length;
        const lengthB = (b.link || '').length;
        if (lengthA !== lengthB) return lengthA - lengthB;
      }
      
      // 4. Prefer original order
      return a.originalIndex - b.originalIndex;
    })[0];
  }

  /**
   * Merge metadata from duplicate results
   */
  mergeMetadata(primaryResult, duplicates) {
    // Combine unique information from duplicates
    const allSnippets = [primaryResult.snippet || ''];
    const allTitles = [primaryResult.title || ''];
    const allUrls = [primaryResult.link || ''];
    
    duplicates.forEach(duplicate => {
      if (duplicate.snippet && !allSnippets.includes(duplicate.snippet)) {
        allSnippets.push(duplicate.snippet);
      }
      if (duplicate.title && !allTitles.includes(duplicate.title)) {
        allTitles.push(duplicate.title);
      }
      if (duplicate.link && !allUrls.includes(duplicate.link)) {
        allUrls.push(duplicate.link);
      }
    });
    
    // Store additional information
    if (!primaryResult.deduplicationInfo) {
      primaryResult.deduplicationInfo = {};
    }
    
    primaryResult.deduplicationInfo.alternateSnippets = allSnippets.slice(1);
    primaryResult.deduplicationInfo.alternateTitles = allTitles.slice(1);
    primaryResult.deduplicationInfo.alternateUrls = allUrls.slice(1);
  }

  /**
   * Normalize URL for comparison
   */
  normalizeUrl(url, normalizationOptions) {
    if (!url) return '';
    
    try {
      // Parse URL
      const urlObj = new URL(url);

      // A fragment points into the same page
      urlObj.hash = '';

      // Remove www prefix
      if (normalizationOptions.removeWww) {
        urlObj.hostname = urlObj.hostname.replace(/^www\./, '');
      }
      
      // Convert domain to lowercase
      if (normalizationOptions.lowercaseDomain) {
        urlObj.hostname = urlObj.hostname.toLowerCase();
      }
      
      // Remove default ports
      if (normalizationOptions.removeDefaultPorts) {
        if ((urlObj.protocol === 'http:' && urlObj.port === '80') ||
            (urlObj.protocol === 'https:' && urlObj.port === '443')) {
          urlObj.port = '';
        }
      }
      
      // A directory index is the directory itself
      urlObj.pathname = urlObj.pathname.replace(/\/index\.(html?|php)$/i, '/');

      // Remove trailing slash
      if (normalizationOptions.removeTrailingSlash) {
        urlObj.pathname = urlObj.pathname.replace(/\/$/, '') || '/';
      }

      // Sort and clean query parameters
      if (normalizationOptions.sortQueryParams || normalizationOptions.removeEmptyParams) {
        const params = new URLSearchParams(urlObj.search);
        const sortedParams = new URLSearchParams();

        // Get sorted parameter names, without tracking parameters
        const paramNames = Array.from(params.keys())
          .filter(name => !/^(utm_.*|gclid|fbclid|msclkid|mc_cid|mc_eid)$/i.test(name))
          .sort();

        for (const name of paramNames) {
          const value = params.get(name);
          if (!normalizationOptions.removeEmptyParams || (value && value.trim())) {
            sortedParams.set(name, value);
          }
        }
        
        urlObj.search = sortedParams.toString();
      }

      // Remove protocol if specified (http vs https of the same page)
      const normalized = urlObj.toString();
      return normalizationOptions.removeProtocol
        ? normalized.replace(/^https?:\/\//, '')
        : normalized;
    } catch (error) {
      // If URL parsing fails, return cleaned original
      return url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '');
    }
  }

  /**
   * Extract content from result for comparison. The snippet only: the title
   * and domain are shared by a site's pages (a title template), so they made
   * sibling pages look alike; the title is compared on its own anyway.
   */
  extractContent(result) {
    return (result.snippet || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Tokenize title for similarity comparison
   */
  tokenizeTitle(title) {
    return title
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 1);
  }

  /**
   * SimHash implementation for content similarity.
   * Uses two independent 32-bit FNV-1a hashes (seeded differently) to produce
   * independent high/low 32-bit words, giving a true 64-bit fingerprint so that
   * bits 32-63 are not a duplicate of bits 0-31.
   */
  simHash(text, bits = 64) {
    const tokens = text.split(/\s+/);
    const hashBits = new Array(bits).fill(0);

    for (const token of tokens) {
      const lo = this._fnv1a32(token, 0x811c9dc5);
      const hi = this._fnv1a32(token, 0x84222325); // different seed

      for (let i = 0; i < 32; i++) {
        hashBits[i]      += ((lo >>> i) & 1) ? 1 : -1;
      }
      for (let i = 0; i < 32; i++) {
        hashBits[32 + i] += ((hi >>> i) & 1) ? 1 : -1;
      }
    }

    // Convert to binary string
    return hashBits.map(bit => bit > 0 ? '1' : '0').join('');
  }

  /**
   * FNV-1a 32-bit hash with a configurable offset basis (seed).
   * @param {string} str
   * @param {number} seed - 32-bit unsigned offset basis
   * @returns {number} 32-bit unsigned integer
   */
  _fnv1a32(str, seed) {
    const FNV_PRIME = 0x01000193;
    let hash = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      // Multiply by FNV prime using 32-bit arithmetic
      hash = Math.imul(hash, FNV_PRIME) >>> 0;
    }
    return hash;
  }

  /**
   * String hash function (kept for hashResults / cache-key use)
   */
  stringHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }

  /**
   * Compute Hamming distance between two binary strings
   */
  hammingDistance(hash1, hash2) {
    if (hash1.length !== hash2.length) return Math.max(hash1.length, hash2.length);
    
    let distance = 0;
    for (let i = 0; i < hash1.length; i++) {
      if (hash1[i] !== hash2[i]) distance++;
    }
    return distance;
  }

  /**
   * Compute edit distance (Levenshtein) between two strings
   */
  editDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * Generate hash of results for caching
   */
  hashResults(results) {
    const key = results.map(r => (r.link || r.url) + (r.title || '')).join('|');
    return this.stringHash(key).toString();
  }

  /**
   * Get deduplication statistics
   */
  getDeduplicationStats(originalCount, finalCount) {
    return {
      originalCount,
      finalCount,
      duplicatesRemoved: originalCount - finalCount,
      deduplicationRate: ((originalCount - finalCount) / originalCount * 100).toFixed(1) + '%'
    };
  }

  /**
   * Get comprehensive statistics
   */
  getStats() {
    return {
      ...this.stats,
      cacheStats: this.cache ? this.cache.getStats() : null,
      configuration: {
        thresholds: this.options.thresholds,
        strategies: this.options.strategies,
        urlNormalization: this.options.urlNormalization,
        contentSimilarity: this.options.contentSimilarity,
        mergeStrategy: this.options.mergeStrategy
      }
    };
  }

  /**
   * Update similarity thresholds dynamically
   */
  updateThresholds(newThresholds) {
    this.options.thresholds = { ...this.options.thresholds, ...newThresholds };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalProcessed: 0,
      duplicatesFound: 0,
      urlDuplicates: 0,
      titleDuplicates: 0,
      contentDuplicates: 0,
      merged: 0
    };
  }
}

export default ResultDeduplicator;