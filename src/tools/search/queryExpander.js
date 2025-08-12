import { createHash } from 'crypto';

/**
 * QueryExpander - Advanced query expansion and refinement capabilities
 * Provides synonym expansion, misspelling correction, stemming, phrase detection, and boolean operators
 */
export class QueryExpander {
  constructor(options = {}) {
    this.options = {
      enableSynonyms: options.enableSynonyms !== false,
      enableSpellCheck: options.enableSpellCheck !== false,
      enableStemming: options.enableStemming !== false,
      enablePhraseDetection: options.enablePhraseDetection !== false,
      enableBooleanOperators: options.enableBooleanOperators !== false,
      maxExpansions: options.maxExpansions || 5,
      ...options
    };

    // Initialize dictionaries
    this.synonymDict = this._initializeSynonyms();
    this.spellingDict = this._initializeSpellingCorrections();
    this.stopWords = this._initializeStopWords();
  }

  /**
   * Main expansion method - orchestrates all expansion techniques
   * @param {string} query - The original search query
   * @param {Object} options - Optional expansion preferences
   * @returns {Array<string>} - Array of expanded query variations
   */
  async expandQuery(query, options = {}) {
    if (!query || typeof query !== 'string') {
      throw new Error('Query must be a non-empty string');
    }

    const expansionOptions = { ...this.options, ...options };
    const expansions = new Set();
    
    try {
      // Always include the original query
      expansions.add(query.trim());

      // Apply different expansion strategies
      if (expansionOptions.enableSynonyms) {
        const synonymExpansions = this.expandWithSynonyms(query);
        synonymExpansions.forEach(exp => expansions.add(exp));
      }

      if (expansionOptions.enableSpellCheck) {
        const correctedExpansions = this.correctSpelling(query);
        correctedExpansions.forEach(exp => expansions.add(exp));
      }

      if (expansionOptions.enableStemming) {
        const stemmedExpansions = this.expandWithStemming(query);
        stemmedExpansions.forEach(exp => expansions.add(exp));
      }

      if (expansionOptions.enablePhraseDetection) {
        const phraseExpansions = this.expandWithPhrases(query);
        phraseExpansions.forEach(exp => expansions.add(exp));
      }

      if (expansionOptions.enableBooleanOperators) {
        const booleanExpansions = this.expandWithBooleanOperators(query);
        booleanExpansions.forEach(exp => expansions.add(exp));
      }

      // Convert to array and limit results
      const result = Array.from(expansions)
        .filter(exp => exp.length > 0)
        .slice(0, expansionOptions.maxExpansions);

      return result;
    } catch (error) {
      console.error('Query expansion error:', error);
      return [query]; // Fallback to original query
    }
  }

  /**
   * Expand query with synonyms
   * @param {string} query 
   * @returns {Array<string>}
   */
  expandWithSynonyms(query) {
    const expansions = [];
    const words = this._tokenize(query);
    
    // Replace individual words with synonyms
    words.forEach((word, index) => {
      const synonyms = this.synonymDict[word.toLowerCase()];
      if (synonyms && synonyms.length > 0) {
        synonyms.forEach(synonym => {
          const newWords = [...words];
          newWords[index] = synonym;
          expansions.push(newWords.join(' '));
        });
      }
    });

    // Create OR variations with synonyms
    const synonymGroups = words.map(word => {
      const synonyms = this.synonymDict[word.toLowerCase()];
      return synonyms && synonyms.length > 0 ? [word, ...synonyms.slice(0, 2)] : [word];
    });

    if (synonymGroups.some(group => group.length > 1)) {
      // Create combinations with most relevant synonyms
      const combinations = this._generateCombinations(synonymGroups, 3);
      combinations.forEach(combo => {
        if (combo.join(' ') !== query) {
          expansions.push(combo.join(' '));
        }
      });
    }

    return expansions;
  }

  /**
   * Correct common misspellings
   * @param {string} query 
   * @returns {Array<string>}
   */
  correctSpelling(query) {
    const expansions = [];
    const words = this._tokenize(query);
    let hasCorrections = false;

    const correctedWords = words.map(word => {
      const correction = this.spellingDict[word.toLowerCase()];
      if (correction && correction !== word.toLowerCase()) {
        hasCorrections = true;
        return correction;
      }
      return word;
    });

    if (hasCorrections) {
      expansions.push(correctedWords.join(' '));
    }

    return expansions;
  }

  /**
   * Apply word stemming for broader matches
   * @param {string} query 
   * @returns {Array<string>}
   */
  expandWithStemming(query) {
    const expansions = [];
    const words = this._tokenize(query);

    // Apply simple stemming rules
    const stemmedWords = words.map(word => this._applyStemming(word));
    const stemmedQuery = stemmedWords.join(' ');

    if (stemmedQuery !== query) {
      expansions.push(stemmedQuery);
    }

    // Create variations with stemmed and original words
    const mixedVariations = this._createStemMixVariations(words, stemmedWords);
    expansions.push(...mixedVariations);

    return expansions;
  }

  /**
   * Detect and handle phrases
   * @param {string} query 
   * @returns {Array<string>}
   */
  expandWithPhrases(query) {
    const expansions = [];

    // Add quoted phrases if not already present
    if (!query.includes('"') && query.includes(' ')) {
      expansions.push(`"${query}"`);
    }

    // Detect potential phrases (consecutive capitalized words, common phrase patterns)
    const phrases = this._detectPhrases(query);
    phrases.forEach(phrase => {
      if (phrase.length > query.length * 0.5) { // Only for substantial phrases
        expansions.push(`"${phrase}"`);
      }
    });

    // Break down complex queries into sub-phrases
    if (query.split(' ').length > 3) {
      const subPhrases = this._generateSubPhrases(query);
      subPhrases.forEach(phrase => {
        if (phrase !== query) {
          expansions.push(phrase);
        }
      });
    }

    return expansions;
  }

  /**
   * Add boolean operator variations
   * @param {string} query 
   * @returns {Array<string>}
   */
  expandWithBooleanOperators(query) {
    const expansions = [];
    const words = this._tokenize(query).filter(word => !this.stopWords.has(word.toLowerCase()));

    if (words.length > 1) {
      // AND variations (explicit)
      expansions.push(words.join(' AND '));

      // OR variations
      expansions.push(words.join(' OR '));

      // Mixed AND/OR for longer queries
      if (words.length > 2) {
        const primaryTerms = words.slice(0, 2);
        const secondaryTerms = words.slice(2);
        
        if (secondaryTerms.length > 0) {
          expansions.push(`(${primaryTerms.join(' AND ')}) OR (${secondaryTerms.join(' OR ')})`);
        }
      }

      // Proximity searches (if supported by search engine)
      if (words.length === 2) {
        expansions.push(`"${words.join(' ')}"~5`); // Within 5 words
      }
    }

    return expansions;
  }

  /**
   * Generate query suggestions based on common patterns
   * @param {string} query 
   * @returns {Array<string>}
   */
  generateSuggestions(query) {
    const suggestions = [];
    const words = this._tokenize(query);

    // Common search patterns
    const patterns = [
      `${query} tutorial`,
      `${query} guide`,
      `${query} examples`,
      `${query} best practices`,
      `${query} documentation`,
      `how to ${query}`,
      `${query} vs alternatives`,
      `${query} tips`,
      `learn ${query}`,
      `${query} review`
    ];

    // Add contextual suggestions based on query type
    if (this._isProductQuery(query)) {
      patterns.push(
        `${query} price`,
        `${query} review`,
        `buy ${query}`,
        `${query} comparison`
      );
    }

    if (this._isTechnicalQuery(query)) {
      patterns.push(
        `${query} API`,
        `${query} configuration`,
        `${query} troubleshooting`,
        `${query} installation`
      );
    }

    return patterns.slice(0, 8); // Limit suggestions
  }

  /**
   * Initialize synonym dictionary
   * @private
   */
  _initializeSynonyms() {
    return {
      // Technology synonyms
      'web': ['website', 'internet', 'online'],
      'website': ['web', 'site', 'portal'],
      'app': ['application', 'software', 'program'],
      'mobile': ['smartphone', 'phone', 'cellular'],
      'computer': ['pc', 'desktop', 'machine'],
      'software': ['program', 'app', 'application'],
      'development': ['programming', 'coding', 'dev'],
      'programming': ['coding', 'development', 'dev'],
      'database': ['db', 'data storage', 'repository'],
      'server': ['host', 'backend', 'service'],
      'api': ['interface', 'endpoint', 'service'],
      
      // Business synonyms
      'company': ['business', 'organization', 'firm', 'corporation'],
      'business': ['company', 'enterprise', 'firm'],
      'customer': ['client', 'user', 'consumer'],
      'product': ['item', 'good', 'service'],
      'service': ['offering', 'solution', 'product'],
      
      // General synonyms
      'big': ['large', 'huge', 'massive'],
      'small': ['little', 'tiny', 'mini'],
      'fast': ['quick', 'rapid', 'speedy'],
      'slow': ['sluggish', 'gradual', 'delayed'],
      'good': ['excellent', 'great', 'quality'],
      'bad': ['poor', 'terrible', 'awful'],
      'new': ['recent', 'latest', 'modern'],
      'old': ['vintage', 'classic', 'legacy'],
      'free': ['gratis', 'complimentary', 'no cost'],
      'cheap': ['affordable', 'budget', 'economical'],
      'expensive': ['costly', 'premium', 'high-end']
    };
  }

  /**
   * Initialize common misspelling corrections
   * @private
   */
  _initializeSpellingCorrections() {
    return {
      // Common technology misspellings
      'javascirpt': 'javascript',
      'javscript': 'javascript',
      'phyton': 'python',
      'pyhton': 'python',
      'databse': 'database',
      'developement': 'development',
      'progamming': 'programming',
      'algoritm': 'algorithm',
      'machien': 'machine',
      'compuer': 'computer',
      'webiste': 'website',
      'appliation': 'application',
      'sofware': 'software',
      'programing': 'programming',
      
      // Common word misspellings
      'recieve': 'receive',
      'seperate': 'separate',
      'definately': 'definitely',
      'occured': 'occurred',
      'begining': 'beginning',
      'achievment': 'achievement',
      'beleive': 'believe',
      'freind': 'friend',
      'wierd': 'weird',
      'speach': 'speech',
      'realy': 'really',
      'alot': 'a lot',
      'wich': 'which',
      'thier': 'their',
      'lenght': 'length'
    };
  }

  /**
   * Initialize stop words
   * @private
   */
  _initializeStopWords() {
    return new Set([
      'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
      'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
      'to', 'was', 'were', 'will', 'with', 'would', 'could', 'should',
      'this', 'these', 'they', 'them', 'their', 'there', 'then', 'than'
    ]);
  }

  /**
   * Tokenize query into words
   * @private
   */
  _tokenize(query) {
    return query.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 0);
  }

  /**
   * Apply simple stemming rules
   * @private
   */
  _applyStemming(word) {
    const stemRules = [
      { suffix: 'ies', replacement: 'y', minLength: 4 },
      { suffix: 'ied', replacement: 'y', minLength: 4 },
      { suffix: 'ing', replacement: '', minLength: 4 },
      { suffix: 'ed', replacement: '', minLength: 3 },
      { suffix: 's', replacement: '', minLength: 3 },
      { suffix: 'ly', replacement: '', minLength: 4 },
      { suffix: 'er', replacement: '', minLength: 3 },
      { suffix: 'est', replacement: '', minLength: 4 }
    ];

    const lowerWord = word.toLowerCase();
    
    for (const rule of stemRules) {
      if (lowerWord.length >= rule.minLength && lowerWord.endsWith(rule.suffix)) {
        return lowerWord.slice(0, -rule.suffix.length) + rule.replacement;
      }
    }
    
    return lowerWord;
  }

  /**
   * Generate combinations from synonym groups
   * @private
   */
  _generateCombinations(groups, maxCombinations) {
    const combinations = [];
    const maxGroups = Math.min(groups.length, 3); // Limit complexity
    
    // Generate simple combinations
    for (let i = 0; i < Math.min(maxCombinations, maxGroups); i++) {
      const combo = groups.map((group, index) => 
        index === i && group.length > 1 ? group[1] : group[0]
      );
      combinations.push(combo);
    }
    
    return combinations;
  }

  /**
   * Create mixed variations of stemmed and original words
   * @private
   */
  _createStemMixVariations(originalWords, stemmedWords) {
    const variations = [];
    
    // Mix original and stemmed words
    for (let i = 0; i < originalWords.length; i++) {
      if (originalWords[i] !== stemmedWords[i]) {
        const mixed = [...originalWords];
        mixed[i] = stemmedWords[i];
        variations.push(mixed.join(' '));
      }
    }
    
    return variations;
  }

  /**
   * Detect potential phrases in query
   * @private
   */
  _detectPhrases(query) {
    const phrases = [];
    const words = query.split(' ');
    
    // Look for consecutive capitalized words
    let currentPhrase = [];
    words.forEach(word => {
      if (word.charAt(0) === word.charAt(0).toUpperCase() && word.length > 1) {
        currentPhrase.push(word);
      } else {
        if (currentPhrase.length > 1) {
          phrases.push(currentPhrase.join(' '));
        }
        currentPhrase = [];
      }
    });
    
    if (currentPhrase.length > 1) {
      phrases.push(currentPhrase.join(' '));
    }
    
    return phrases;
  }

  /**
   * Generate sub-phrases from complex queries
   * @private
   */
  _generateSubPhrases(query) {
    const words = this._tokenize(query);
    const phrases = [];
    
    // Generate 2-word and 3-word phrases
    for (let i = 0; i < words.length - 1; i++) {
      // 2-word phrases
      phrases.push(`${words[i]} ${words[i + 1]}`);
      
      // 3-word phrases
      if (i < words.length - 2) {
        phrases.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
      }
    }
    
    return phrases;
  }

  /**
   * Check if query is product-related
   * @private
   */
  _isProductQuery(query) {
    const productKeywords = ['buy', 'purchase', 'price', 'cost', 'shop', 'store', 'product', 'item'];
    return productKeywords.some(keyword => query.toLowerCase().includes(keyword));
  }

  /**
   * Check if query is technical
   * @private
   */
  _isTechnicalQuery(query) {
    const techKeywords = ['api', 'code', 'programming', 'development', 'software', 'app', 'web', 'database', 'server'];
    return techKeywords.some(keyword => query.toLowerCase().includes(keyword));
  }

  /**
   * Get statistics about expansion capabilities
   */
  getStats() {
    return {
      synonymCount: Object.keys(this.synonymDict).length,
      spellingCorrectionCount: Object.keys(this.spellingDict).length,
      stopWordCount: this.stopWords.size,
      capabilities: {
        synonyms: this.options.enableSynonyms,
        spellCheck: this.options.enableSpellCheck,
        stemming: this.options.enableStemming,
        phrases: this.options.enablePhraseDetection,
        booleanOperators: this.options.enableBooleanOperators
      }
    };
  }
}

export default QueryExpander;