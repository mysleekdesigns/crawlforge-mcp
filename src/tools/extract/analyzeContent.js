/**
 * Analyze Content MCP Tool
 * Comprehensive content analysis including language detection, topic analysis, sentiment, and more
 */

import { z } from 'zod';
import { ContentAnalyzer } from '../../core/analysis/ContentAnalyzer.js';

const AnalyzeContentSchema = z.object({
  text: z.string().min(10),
  options: z.object({
    detectLanguage: z.boolean().default(true),
    extractTopics: z.boolean().default(true),
    extractEntities: z.boolean().default(true),
    extractKeywords: z.boolean().default(true),
    analyzeSentiment: z.boolean().default(true),
    calculateReadability: z.boolean().default(true),
    includeStatistics: z.boolean().default(true),
    
    // Analysis depth options
    maxTopics: z.number().min(1).max(20).default(10),
    maxKeywords: z.number().min(1).max(50).default(15),
    minConfidence: z.number().min(0).max(1).default(0.1),
    
    // Output options
    includeAdvancedMetrics: z.boolean().default(false),
    groupEntitiesByType: z.boolean().default(true),
    rankByRelevance: z.boolean().default(true)
  }).optional().default({})
});

const AnalyzeContentResult = z.object({
  text: z.string(),
  language: z.object({
    code: z.string(),
    name: z.string(),
    confidence: z.number(),
    alternatives: z.array(z.object({
      code: z.string(),
      name: z.string(),
      confidence: z.number()
    }))
  }).optional(),
  topics: z.array(z.object({
    topic: z.string(),
    confidence: z.number(),
    keywords: z.array(z.string()),
    category: z.string().optional()
  })).optional(),
  entities: z.object({
    people: z.array(z.string()),
    places: z.array(z.string()),
    organizations: z.array(z.string()),
    dates: z.array(z.string()),
    money: z.array(z.string()),
    other: z.array(z.string()),
    summary: z.object({
      totalEntities: z.number(),
      uniqueEntities: z.number(),
      entityDensity: z.number()
    })
  }).optional(),
  keywords: z.array(z.object({
    keyword: z.string(),
    frequency: z.number(),
    relevance: z.number(),
    type: z.string(),
    category: z.string().optional()
  })).optional(),
  sentiment: z.object({
    polarity: z.number(),
    subjectivity: z.number(),
    label: z.string(),
    confidence: z.number(),
    emotions: z.array(z.object({
      emotion: z.string(),
      intensity: z.number()
    })).optional()
  }).optional(),
  readability: z.object({
    score: z.number(),
    level: z.string(),
    metrics: z.object({
      sentences: z.number(),
      words: z.number(),
      characters: z.number(),
      avgWordsPerSentence: z.number(),
      avgCharsPerWord: z.number(),
      complexWords: z.number(),
      syllables: z.number()
    })
  }).optional(),
  statistics: z.object({
    characters: z.number(),
    charactersNoSpaces: z.number(),
    words: z.number(),
    sentences: z.number(),
    paragraphs: z.number(),
    readingTime: z.number(),
    vocabulary: z.object({
      uniqueWords: z.number(),
      vocabularyRichness: z.number(),
      lexicalDiversity: z.number()
    }).optional()
  }).optional(),
  themes: z.array(z.object({
    theme: z.string(),
    confidence: z.number(),
    supportingTopics: z.array(z.string())
  })).optional(),
  analyzedAt: z.string(),
  processingTime: z.number(),
  success: z.boolean(),
  error: z.string().optional()
});

export class AnalyzeContentTool {
  constructor() {
    this.contentAnalyzer = new ContentAnalyzer();
  }

  /**
   * Get tool definition for MCP server
   * @returns {Object} Tool definition
   */
  getDefinition() {
    return {
      name: 'analyze_content',
      description: 'Perform comprehensive content analysis including language detection, topic extraction, entity recognition, sentiment analysis, keyword extraction, and readability assessment.',
      inputSchema: AnalyzeContentSchema
    };
  }

  /**
   * Execute content analysis
   * @param {Object} params - Analysis parameters
   * @returns {Promise<Object>} Analysis result
   */
  async execute(params) {
    const startTime = Date.now();
    
    try {
      const validated = AnalyzeContentSchema.parse(params);
      const { text, options } = validated;

      const result = {
        text: text.substring(0, 500) + (text.length > 500 ? '...' : ''),
        analyzedAt: new Date().toISOString(),
        success: false,
        processingTime: 0
      };

      // Execute comprehensive analysis using ContentAnalyzer
      const analysisResult = await this.contentAnalyzer.analyzeContent({
        text,
        options: {
          summarize: false, // We don't need summary for analysis
          detectLanguage: options.detectLanguage,
          extractTopics: options.extractTopics,
          extractEntities: options.extractEntities,
          extractKeywords: options.extractKeywords,
          includeSentiment: options.analyzeSentiment,
          includeReadabilityMetrics: options.calculateReadability,
          maxTopics: options.maxTopics,
          maxKeywords: options.maxKeywords,
          minConfidence: options.minConfidence
        }
      });

      // Step 1: Language detection
      if (options.detectLanguage && analysisResult.language) {
        result.language = {
          code: analysisResult.language.code,
          name: analysisResult.language.name,
          confidence: analysisResult.language.confidence,
          alternatives: analysisResult.language.alternative || []
        };
      }

      // Step 2: Topic extraction with categorization
      if (options.extractTopics && analysisResult.topics) {
        result.topics = analysisResult.topics.map(topic => ({
          ...topic,
          category: this.categorizeTopicByKeywords(topic.keywords)
        }));

        // Extract themes from topics if advanced metrics requested
        if (options.includeAdvancedMetrics) {
          result.themes = this.extractThemes(result.topics);
        }
      }

      // Step 3: Entity extraction with enhanced grouping
      if (options.extractEntities && analysisResult.entities) {
        result.entities = {
          ...analysisResult.entities,
          summary: this.calculateEntitySummary(analysisResult.entities, text)
        };
      }

      // Step 4: Keyword extraction with categorization
      if (options.extractKeywords && analysisResult.keywords) {
        result.keywords = analysisResult.keywords.map(keyword => ({
          ...keyword,
          category: this.categorizeKeyword(keyword.keyword, keyword.type)
        }));

        // Sort by relevance if requested
        if (options.rankByRelevance) {
          result.keywords.sort((a, b) => b.relevance - a.relevance);
        }
      }

      // Step 5: Sentiment analysis with emotion detection
      if (options.analyzeSentiment && analysisResult.sentiment) {
        result.sentiment = {
          ...analysisResult.sentiment,
          emotions: options.includeAdvancedMetrics ? this.detectEmotions(text) : undefined
        };
      }

      // Step 6: Readability metrics
      if (options.calculateReadability && analysisResult.readability) {
        result.readability = analysisResult.readability;
      }

      // Step 7: Text statistics with vocabulary analysis
      if (options.includeStatistics && analysisResult.statistics) {
        result.statistics = {
          ...analysisResult.statistics,
          vocabulary: options.includeAdvancedMetrics ? this.calculateVocabularyMetrics(text) : undefined
        };
      }

      result.processingTime = Date.now() - startTime;
      result.success = true;

      return result;

    } catch (error) {
      return {
        text: params.text?.substring(0, 100) || 'unknown',
        analyzedAt: new Date().toISOString(),
        success: false,
        error: `Content analysis failed: ${error.message}`,
        processingTime: Date.now() - startTime
      };
    }
  }

  /**
   * Categorize topic based on keywords
   * @param {Array} keywords - Topic keywords
   * @returns {string} - Topic category
   */
  categorizeTopicByKeywords(keywords) {
    const categories = {
      technology: ['technology', 'software', 'computer', 'digital', 'internet', 'app', 'system', 'data', 'code', 'development'],
      business: ['business', 'company', 'market', 'sales', 'revenue', 'profit', 'customer', 'service', 'management', 'strategy'],
      science: ['science', 'research', 'study', 'analysis', 'experiment', 'theory', 'discovery', 'scientific', 'academic'],
      health: ['health', 'medical', 'disease', 'treatment', 'patient', 'doctor', 'medicine', 'hospital', 'therapy', 'care'],
      politics: ['politics', 'government', 'policy', 'election', 'politician', 'vote', 'democracy', 'law', 'congress', 'president'],
      sports: ['sports', 'game', 'team', 'player', 'match', 'competition', 'championship', 'athletic', 'training', 'coach'],
      entertainment: ['movie', 'music', 'entertainment', 'film', 'show', 'celebrity', 'actor', 'artist', 'performance', 'media'],
      education: ['education', 'school', 'student', 'teacher', 'university', 'learning', 'course', 'academic', 'knowledge', 'study']
    };

    const keywordStr = keywords.join(' ').toLowerCase();
    
    for (const [category, categoryKeywords] of Object.entries(categories)) {
      const matches = categoryKeywords.filter(word => keywordStr.includes(word));
      if (matches.length > 0) {
        return category;
      }
    }

    return 'general';
  }

  /**
   * Categorize individual keyword
   * @param {string} keyword - Keyword to categorize
   * @param {string} type - Grammatical type
   * @returns {string} - Keyword category
   */
  categorizeKeyword(keyword, type) {
    const lowerKeyword = keyword.toLowerCase();
    
    // Technical terms
    if (/^(api|sdk|framework|library|database|algorithm|protocol|server|client|interface)$/i.test(keyword)) {
      return 'technical';
    }
    
    // Business terms
    if (/^(revenue|profit|market|customer|client|sales|business|company|organization)$/i.test(keyword)) {
      return 'business';
    }
    
    // Academic terms
    if (/^(research|study|analysis|theory|method|approach|findings|results|conclusion)$/i.test(keyword)) {
      return 'academic';
    }
    
    // Time-related terms
    if (/^(year|month|week|day|time|period|date|today|yesterday|tomorrow)$/i.test(keyword)) {
      return 'temporal';
    }
    
    // Location terms
    if (/^(country|city|state|region|area|location|place|world|global|international)$/i.test(keyword)) {
      return 'geographical';
    }

    // Default to grammatical type
    return type || 'general';
  }

  /**
   * Extract themes from topics
   * @param {Array} topics - Analyzed topics
   * @returns {Array} - Extracted themes
   */
  extractThemes(topics) {
    if (!topics || topics.length === 0) return [];

    // Group topics by category
    const topicsByCategory = {};
    topics.forEach(topic => {
      const category = topic.category || 'general';
      if (!topicsByCategory[category]) {
        topicsByCategory[category] = [];
      }
      topicsByCategory[category].push(topic);
    });

    // Create themes from categories with multiple topics
    const themes = [];
    for (const [category, categoryTopics] of Object.entries(topicsByCategory)) {
      if (categoryTopics.length >= 2) {
        const avgConfidence = categoryTopics.reduce((sum, topic) => sum + topic.confidence, 0) / categoryTopics.length;
        const supportingTopics = categoryTopics.map(topic => topic.topic);
        
        themes.push({
          theme: category,
          confidence: Math.round(avgConfidence * 100) / 100,
          supportingTopics
        });
      }
    }

    return themes.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Calculate entity summary statistics
   * @param {Object} entities - Extracted entities
   * @param {string} text - Original text
   * @returns {Object} - Entity summary
   */
  calculateEntitySummary(entities, text) {
    const allEntities = [
      ...entities.people,
      ...entities.places,
      ...entities.organizations,
      ...entities.dates,
      ...entities.money,
      ...entities.other
    ];

    const uniqueEntities = new Set(allEntities.map(e => e.toLowerCase()));
    const textWords = text.split(/\s+/).filter(w => w.length > 0);
    
    return {
      totalEntities: allEntities.length,
      uniqueEntities: uniqueEntities.size,
      entityDensity: Math.round((allEntities.length / textWords.length) * 100) / 100
    };
  }

  /**
   * Detect emotions in text (simplified approach)
   * @param {string} text - Text to analyze
   * @returns {Array} - Detected emotions with intensity
   */
  detectEmotions(text) {
    const emotionWords = {
      joy: ['happy', 'joy', 'excited', 'pleased', 'delighted', 'cheerful', 'glad', 'elated'],
      anger: ['angry', 'mad', 'furious', 'rage', 'annoyed', 'frustrated', 'irritated'],
      sadness: ['sad', 'depressed', 'unhappy', 'grief', 'sorrow', 'melancholy', 'down'],
      fear: ['afraid', 'scared', 'terrified', 'anxious', 'worried', 'nervous', 'fearful'],
      surprise: ['surprised', 'amazed', 'shocked', 'astonished', 'stunned', 'startled'],
      disgust: ['disgusted', 'revolted', 'repulsed', 'sickened', 'appalled'],
      trust: ['trust', 'confident', 'secure', 'certain', 'assured', 'reliable'],
      anticipation: ['excited', 'eager', 'looking forward', 'anticipating', 'expecting']
    };

    const words = text.toLowerCase().split(/\s+/);
    const emotions = [];

    for (const [emotion, emotionKeywords] of Object.entries(emotionWords)) {
      const matches = words.filter(word => emotionKeywords.some(keyword => word.includes(keyword)));
      if (matches.length > 0) {
        const intensity = Math.min(1, matches.length / Math.max(words.length / 100, 1));
        emotions.push({
          emotion,
          intensity: Math.round(intensity * 100) / 100
        });
      }
    }

    return emotions.sort((a, b) => b.intensity - a.intensity).slice(0, 5);
  }

  /**
   * Calculate vocabulary richness metrics
   * @param {string} text - Text to analyze
   * @returns {Object} - Vocabulary metrics
   */
  calculateVocabularyMetrics(text) {
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const uniqueWords = new Set(words);
    
    // Type-Token Ratio (vocabulary richness)
    const vocabularyRichness = uniqueWords.size / Math.max(words.length, 1);
    
    // Simple lexical diversity measure
    const wordFreq = {};
    words.forEach(word => {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    });
    
    const hapaxLegomena = Object.values(wordFreq).filter(freq => freq === 1).length;
    const lexicalDiversity = hapaxLegomena / Math.max(uniqueWords.size, 1);

    return {
      uniqueWords: uniqueWords.size,
      vocabularyRichness: Math.round(vocabularyRichness * 100) / 100,
      lexicalDiversity: Math.round(lexicalDiversity * 100) / 100
    };
  }

  /**
   * Analyze content for specific domain
   * @param {string} text - Text to analyze
   * @param {string} domain - Domain to focus on (e.g., 'academic', 'business', 'technical')
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>} - Domain-specific analysis
   */
  async analyzeDomainSpecific(text, domain, options = {}) {
    const domainOptions = {
      ...options,
      extractTopics: true,
      extractKeywords: true,
      maxKeywords: 20,
      includeAdvancedMetrics: true
    };

    const result = await this.execute({ text, options: domainOptions });

    if (!result.success) return result;

    // Filter and enhance results for specific domain
    if (result.topics) {
      result.topics = result.topics.filter(topic => 
        topic.category === domain || topic.category === 'general'
      );
    }

    if (result.keywords) {
      result.keywords = result.keywords.filter(keyword => 
        keyword.category === domain || keyword.category === 'general'
      );
    }

    return result;
  }

  /**
   * Compare content analysis between multiple texts
   * @param {Array} texts - Array of texts to compare
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>} - Comparative analysis result
   */
  async compareContent(texts, options = {}) {
    const results = await Promise.all(
      texts.map(text => this.execute({ text, options }))
    );

    const comparison = {
      individual: results,
      comparison: {
        languages: this.compareLanguages(results),
        sentiments: this.compareSentiments(results),
        readability: this.compareReadability(results),
        commonTopics: this.findCommonTopics(results),
        uniqueTopics: this.findUniqueTopics(results)
      }
    };

    return comparison;
  }

  /**
   * Compare languages across results
   * @param {Array} results - Analysis results
   * @returns {Object} - Language comparison
   */
  compareLanguages(results) {
    const languages = results
      .filter(r => r.success && r.language)
      .map(r => r.language.code);
    
    const languageCount = {};
    languages.forEach(lang => {
      languageCount[lang] = (languageCount[lang] || 0) + 1;
    });

    return {
      detected: languageCount,
      primary: Object.entries(languageCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown',
      diversity: Object.keys(languageCount).length
    };
  }

  /**
   * Compare sentiments across results
   * @param {Array} results - Analysis results
   * @returns {Object} - Sentiment comparison
   */
  compareSentiments(results) {
    const sentiments = results
      .filter(r => r.success && r.sentiment)
      .map(r => r.sentiment);

    if (sentiments.length === 0) return null;

    const avgPolarity = sentiments.reduce((sum, s) => sum + s.polarity, 0) / sentiments.length;
    const avgSubjectivity = sentiments.reduce((sum, s) => sum + s.subjectivity, 0) / sentiments.length;

    return {
      averagePolarity: Math.round(avgPolarity * 100) / 100,
      averageSubjectivity: Math.round(avgSubjectivity * 100) / 100,
      range: {
        polarity: {
          min: Math.min(...sentiments.map(s => s.polarity)),
          max: Math.max(...sentiments.map(s => s.polarity))
        }
      }
    };
  }

  /**
   * Compare readability across results
   * @param {Array} results - Analysis results
   * @returns {Object} - Readability comparison
   */
  compareReadability(results) {
    const readabilityScores = results
      .filter(r => r.success && r.readability)
      .map(r => r.readability.score);

    if (readabilityScores.length === 0) return null;

    const avgScore = readabilityScores.reduce((sum, score) => sum + score, 0) / readabilityScores.length;

    return {
      averageScore: Math.round(avgScore * 100) / 100,
      range: {
        min: Math.min(...readabilityScores),
        max: Math.max(...readabilityScores)
      },
      consistency: Math.max(...readabilityScores) - Math.min(...readabilityScores) < 20
    };
  }

  /**
   * Find common topics across results
   * @param {Array} results - Analysis results
   * @returns {Array} - Common topics
   */
  findCommonTopics(results) {
    const allTopics = results
      .filter(r => r.success && r.topics)
      .flatMap(r => r.topics.map(t => t.topic.toLowerCase()));

    const topicCount = {};
    allTopics.forEach(topic => {
      topicCount[topic] = (topicCount[topic] || 0) + 1;
    });

    return Object.entries(topicCount)
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .map(([topic, count]) => ({ topic, occurrences: count }));
  }

  /**
   * Find unique topics across results
   * @param {Array} results - Analysis results
   * @returns {Array} - Unique topics by text
   */
  findUniqueTopics(results) {
    const allTopics = results
      .filter(r => r.success && r.topics)
      .flatMap(r => r.topics.map(t => t.topic.toLowerCase()));

    const topicCount = {};
    allTopics.forEach(topic => {
      topicCount[topic] = (topicCount[topic] || 0) + 1;
    });

    return results.map((result, index) => {
      if (!result.success || !result.topics) return { textIndex: index, uniqueTopics: [] };

      const uniqueTopics = result.topics
        .filter(topic => topicCount[topic.topic.toLowerCase()] === 1)
        .map(topic => topic.topic);

      return { textIndex: index, uniqueTopics };
    });
  }
}

export default AnalyzeContentTool;