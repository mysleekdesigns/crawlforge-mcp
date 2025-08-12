import { CacheManager } from '../../../core/cache/CacheManager.js';

/**
 * Advanced search result ranking system with multiple scoring algorithms
 */
export class ResultRanker {
  constructor(options = {}) {
    this.options = {
      // Ranking weight configuration
      weights: {
        bm25: 0.4,           // BM25 keyword relevance
        semantic: 0.3,       // Semantic similarity
        authority: 0.2,      // URL/domain authority
        freshness: 0.1       // Content freshness
      },
      
      // BM25 parameters
      bm25: {
        k1: 1.5,             // Term frequency saturation parameter
        b: 0.75              // Length normalization parameter
      },
      
      // Authority scoring parameters
      authority: {
        domainBoosts: {      // Domain authority boosts
          'wikipedia.org': 1.0,
          'github.com': 0.9,
          'stackoverflow.com': 0.9,
          'mozilla.org': 0.8,
          'w3.org': 0.8
        },
        httpsBoost: 0.1,     // HTTPS boost
        pathDepthPenalty: 0.02 // Penalty per path segment
      },
      
      // Freshness parameters
      freshness: {
        maxAgeMonths: 24,    // Content older than this gets 0 freshness score
        decayRate: 0.1       // Exponential decay rate per month
      },
      
      // Performance options
      cacheEnabled: true,
      cacheTTL: 3600000,     // 1 hour
      ...options
    };

    // Initialize cache for score computation
    this.cache = this.options.cacheEnabled ? 
      new CacheManager({ ttl: this.options.cacheTTL }) : null;
    
    // Precompute domain authority scores
    this.domainAuthorityMap = new Map();
    this.initializeDomainAuthority();
  }

  /**
   * Rank search results using combined scoring algorithm
   * @param {Array} results - Array of search results
   * @param {string} query - Original search query
   * @param {Object} options - Ranking options
   * @returns {Promise<Array>} Ranked results with scores
   */
  async rankResults(results, query, options = {}) {
    if (!results || results.length === 0) {
      return [];
    }

    const rankingOptions = { ...this.options, ...options };
    
    // Generate cache key for ranking computation
    const cacheKey = this.cache ? this.cache.generateKey('ranking', {
      query,
      resultsHash: this.hashResults(results),
      options: rankingOptions
    }) : null;

    // Check cache
    if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    try {
      // Compute individual scores for each result
      const scoredResults = await Promise.all(
        results.map(async (result, index) => ({
          ...result,
          originalIndex: index,
          scores: await this.computeScores(result, query, results, rankingOptions)
        }))
      );

      // Compute final combined scores
      const rankedResults = scoredResults.map(result => ({
        ...result,
        finalScore: this.computeFinalScore(result.scores, rankingOptions.weights),
        rankingDetails: {
          scores: result.scores,
          weights: rankingOptions.weights,
          originalIndex: result.originalIndex
        }
      }));

      // Sort by final score (descending)
      rankedResults.sort((a, b) => b.finalScore - a.finalScore);

      // Add ranking positions
      rankedResults.forEach((result, index) => {
        result.rankingDetails.newRank = index + 1;
        result.rankingDetails.rankChange = result.originalIndex - index;
      });

      // Cache the results
      if (this.cache) {
        await this.cache.set(cacheKey, rankedResults);
      }

      return rankedResults;
    } catch (error) {
      console.error('Ranking failed:', error);
      // Return original results with default scores
      return results.map((result, index) => ({
        ...result,
        originalIndex: index,
        finalScore: 1.0 - (index * 0.1), // Simple fallback scoring
        rankingDetails: {
          error: error.message,
          originalIndex: index,
          newRank: index + 1,
          rankChange: 0
        }
      }));
    }
  }

  /**
   * Compute individual scoring components for a result
   */
  async computeScores(result, query, allResults, options) {
    const scores = {};

    // BM25 Score
    scores.bm25 = this.computeBM25Score(result, query, allResults, options.bm25);

    // Semantic Similarity Score
    scores.semantic = this.computeSemanticScore(result, query);

    // Authority Score
    scores.authority = this.computeAuthorityScore(result, options.authority);

    // Freshness Score
    scores.freshness = this.computeFreshnessScore(result, options.freshness);

    return scores;
  }

  /**
   * BM25 algorithm implementation for keyword relevance
   */
  computeBM25Score(result, query, allResults, bm25Options) {
    const { k1, b } = bm25Options;
    
    // Prepare text content for analysis
    const content = [
      result.title || '',
      result.snippet || '',
      result.htmlSnippet || ''
    ].join(' ').toLowerCase();

    // Tokenize query and content
    const queryTerms = this.tokenize(query.toLowerCase());
    const contentTerms = this.tokenize(content);
    const contentLength = contentTerms.length;

    // Calculate average document length across all results
    const avgDocLength = allResults.reduce((sum, r) => {
      const rContent = [r.title || '', r.snippet || '', r.htmlSnippet || ''].join(' ');
      return sum + this.tokenize(rContent).length;
    }, 0) / allResults.length;

    // Calculate term frequencies
    const termFreqs = this.getTermFrequencies(contentTerms);

    let score = 0;
    for (const term of queryTerms) {
      const tf = termFreqs[term] || 0;
      if (tf > 0) {
        // Document frequency (simplified - assume term appears in some docs)
        const df = Math.min(allResults.length * 0.1, 1); // Conservative estimate
        const idf = Math.log((allResults.length - df + 0.5) / (df + 0.5));
        
        // BM25 formula
        const numerator = tf * (k1 + 1);
        const denominator = tf + k1 * (1 - b + b * (contentLength / avgDocLength));
        
        score += idf * (numerator / denominator);
      }
    }

    return Math.max(0, Math.min(1, score / queryTerms.length));
  }

  /**
   * Semantic similarity scoring using cosine similarity
   */
  computeSemanticScore(result, query) {
    // Prepare text content
    const content = [
      result.title || '',
      result.snippet || '',
      result.htmlSnippet || ''
    ].join(' ').toLowerCase();

    // Simple word embedding approximation using term vectors
    const queryVector = this.createTermVector(this.tokenize(query.toLowerCase()));
    const contentVector = this.createTermVector(this.tokenize(content));

    // Compute cosine similarity
    const similarity = this.cosineSimilarity(queryVector, contentVector);
    
    // Boost for exact phrase matches
    const phraseBoost = content.includes(query.toLowerCase()) ? 0.2 : 0;
    
    return Math.min(1, similarity + phraseBoost);
  }

  /**
   * URL and domain authority scoring
   */
  computeAuthorityScore(result, authorityOptions) {
    let score = 0;
    
    try {
      const url = new URL(result.link);
      const domain = url.hostname.toLowerCase();
      
      // Domain authority boost
      const domainAuthority = this.getDomainAuthority(domain);
      score += domainAuthority * 0.6;
      
      // HTTPS boost
      if (url.protocol === 'https:') {
        score += authorityOptions.httpsBoost;
      }
      
      // Path depth penalty (shorter paths are generally more authoritative)
      const pathSegments = url.pathname.split('/').filter(s => s.length > 0);
      score -= Math.min(0.3, pathSegments.length * authorityOptions.pathDepthPenalty);
      
      // URL cleanliness bonus (no query params, clean structure)
      if (!url.search && pathSegments.length <= 3) {
        score += 0.1;
      }
      
      // Subdomain penalty (www is ok)
      const subdomains = domain.split('.');
      if (subdomains.length > 2 && subdomains[0] !== 'www') {
        score -= 0.1;
      }
      
    } catch (error) {
      // Invalid URL, give default low score
      score = 0.1;
    }
    
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Content freshness scoring
   */
  computeFreshnessScore(result, freshnessOptions) {
    // Extract date information from various sources
    const dateString = this.extractDate(result);
    
    if (!dateString) {
      return 0.5; // Neutral score for unknown dates
    }
    
    try {
      const contentDate = new Date(dateString);
      const now = new Date();
      const ageInMonths = (now - contentDate) / (1000 * 60 * 60 * 24 * 30.44);
      
      if (ageInMonths < 0) {
        return 1; // Future dates get max score
      }
      
      if (ageInMonths > freshnessOptions.maxAgeMonths) {
        return 0; // Very old content gets 0 score
      }
      
      // Exponential decay
      return Math.exp(-freshnessOptions.decayRate * ageInMonths);
      
    } catch (error) {
      return 0.5; // Invalid date, neutral score
    }
  }

  /**
   * Combine individual scores into final score
   */
  computeFinalScore(scores, weights) {
    return (
      scores.bm25 * weights.bm25 +
      scores.semantic * weights.semantic +
      scores.authority * weights.authority +
      scores.freshness * weights.freshness
    );
  }

  /**
   * Initialize domain authority mapping
   */
  initializeDomainAuthority() {
    // Precompute normalized domain authority scores
    Object.entries(this.options.authority.domainBoosts).forEach(([domain, boost]) => {
      this.domainAuthorityMap.set(domain, boost);
    });
  }

  /**
   * Get domain authority score
   */
  getDomainAuthority(domain) {
    // Check exact match
    if (this.domainAuthorityMap.has(domain)) {
      return this.domainAuthorityMap.get(domain);
    }
    
    // Check for parent domain matches
    const parts = domain.split('.');
    if (parts.length > 2) {
      const parentDomain = parts.slice(-2).join('.');
      if (this.domainAuthorityMap.has(parentDomain)) {
        return this.domainAuthorityMap.get(parentDomain) * 0.8; // Subdomain penalty
      }
    }
    
    // Default score based on domain characteristics
    let score = 0.3; // Base score
    
    // Educational institutions
    if (domain.endsWith('.edu')) score = 0.8;
    // Government sites
    else if (domain.endsWith('.gov')) score = 0.9;
    // Organization sites
    else if (domain.endsWith('.org')) score = 0.6;
    // Commercial sites
    else if (domain.endsWith('.com')) score = 0.4;
    
    return score;
  }

  /**
   * Extract date from result metadata
   */
  extractDate(result) {
    // Try various date sources
    const sources = [
      result.pagemap?.metatags?.publishedTime,
      result.pagemap?.metatags?.modifiedTime,
      result.metadata?.lastModified,
      result.pubDate,
      result.publishedDate
    ];
    
    for (const source of sources) {
      if (source && typeof source === 'string') {
        return source;
      }
    }
    
    return null;
  }

  /**
   * Tokenize text into terms
   */
  tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(term => term.length > 1);
  }

  /**
   * Get term frequencies
   */
  getTermFrequencies(terms) {
    const freqs = {};
    for (const term of terms) {
      freqs[term] = (freqs[term] || 0) + 1;
    }
    return freqs;
  }

  /**
   * Create term vector for similarity calculation
   */
  createTermVector(terms) {
    const freqs = this.getTermFrequencies(terms);
    const vector = {};
    
    // Simple TF-IDF approximation
    for (const [term, freq] of Object.entries(freqs)) {
      vector[term] = freq / terms.length; // Normalized frequency
    }
    
    return vector;
  }

  /**
   * Compute cosine similarity between two term vectors
   */
  cosineSimilarity(vectorA, vectorB) {
    const allTerms = new Set([...Object.keys(vectorA), ...Object.keys(vectorB)]);
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (const term of allTerms) {
      const a = vectorA[term] || 0;
      const b = vectorB[term] || 0;
      
      dotProduct += a * b;
      normA += a * a;
      normB += b * b;
    }
    
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Generate hash of results for caching
   */
  hashResults(results) {
    const key = results.map(r => r.link || r.url).join('|');
    return this.simpleHash(key);
  }

  /**
   * Simple hash function
   */
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }

  /**
   * Get ranking statistics
   */
  getStats() {
    return {
      cacheStats: this.cache ? this.cache.getStats() : null,
      domainAuthorityEntries: this.domainAuthorityMap.size,
      configuration: {
        weights: this.options.weights,
        bm25: this.options.bm25,
        authority: {
          ...this.options.authority,
          domainBoosts: Object.keys(this.options.authority.domainBoosts).length
        },
        freshness: this.options.freshness
      }
    };
  }

  /**
   * Update ranking weights dynamically
   */
  updateWeights(newWeights) {
    this.options.weights = { ...this.options.weights, ...newWeights };
    
    // Ensure weights sum to 1
    const total = Object.values(this.options.weights).reduce((sum, w) => sum + w, 0);
    if (total !== 1) {
      Object.keys(this.options.weights).forEach(key => {
        this.options.weights[key] /= total;
      });
    }
  }
}

export default ResultRanker;