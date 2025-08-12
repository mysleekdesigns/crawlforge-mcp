/**
 * ContentAnalyzer - Content analysis with summarization, language detection, and topic identification
 * Uses multiple NLP libraries for comprehensive content analysis
 */

import { SummarizerManager } from 'node-summarizer';
import { franc } from 'franc';
import nlp from 'compromise';
import { z } from 'zod';

const ContentAnalyzerSchema = z.object({
  text: z.string().min(1),
  options: z.object({
    summarize: z.boolean().default(true),
    detectLanguage: z.boolean().default(true),
    extractTopics: z.boolean().default(true),
    extractEntities: z.boolean().default(true),
    extractKeywords: z.boolean().default(true),
    summaryLength: z.enum(['short', 'medium', 'long']).default('medium'),
    summaryType: z.enum(['extractive', 'abstractive']).default('extractive'),
    minConfidence: z.number().min(0).max(1).default(0.1),
    maxTopics: z.number().min(1).max(20).default(10),
    maxKeywords: z.number().min(1).max(50).default(15),
    includeReadabilityMetrics: z.boolean().default(true),
    includeSentiment: z.boolean().default(true)
  }).optional().default({})
});

const AnalysisResult = z.object({
  text: z.string(),
  language: z.object({
    code: z.string(),
    name: z.string(),
    confidence: z.number(),
    alternative: z.array(z.object({
      code: z.string(),
      name: z.string(),
      confidence: z.number()
    }))
  }).optional(),
  summary: z.object({
    type: z.string(),
    length: z.string(),
    sentences: z.array(z.string()),
    text: z.string(),
    compressionRatio: z.number()
  }).optional(),
  topics: z.array(z.object({
    topic: z.string(),
    confidence: z.number(),
    keywords: z.array(z.string())
  })).optional(),
  entities: z.object({
    people: z.array(z.string()),
    places: z.array(z.string()),
    organizations: z.array(z.string()),
    dates: z.array(z.string()),
    money: z.array(z.string()),
    other: z.array(z.string())
  }).optional(),
  keywords: z.array(z.object({
    keyword: z.string(),
    frequency: z.number(),
    relevance: z.number(),
    type: z.string()
  })).optional(),
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
  sentiment: z.object({
    polarity: z.number(),
    subjectivity: z.number(),
    label: z.string(),
    confidence: z.number()
  }).optional(),
  statistics: z.object({
    characters: z.number(),
    charactersNoSpaces: z.number(),
    words: z.number(),
    sentences: z.number(),
    paragraphs: z.number(),
    readingTime: z.number()
  }),
  analyzedAt: z.string(),
  processingTime: z.number()
});

// Language code to name mapping
const LANGUAGE_NAMES = {
  'eng': 'English',
  'spa': 'Spanish',
  'fra': 'French',
  'deu': 'German',
  'ita': 'Italian',
  'por': 'Portuguese',
  'rus': 'Russian',
  'jpn': 'Japanese',
  'kor': 'Korean',
  'chi': 'Chinese',
  'ara': 'Arabic',
  'hin': 'Hindi',
  'nld': 'Dutch',
  'swe': 'Swedish',
  'nor': 'Norwegian',
  'dan': 'Danish',
  'fin': 'Finnish',
  'pol': 'Polish',
  'ces': 'Czech',
  'hun': 'Hungarian',
  'tur': 'Turkish',
  'gre': 'Greek',
  'heb': 'Hebrew',
  'tha': 'Thai',
  'vie': 'Vietnamese',
  'ind': 'Indonesian',
  'msa': 'Malay',
  'tgl': 'Tagalog',
  'ukr': 'Ukrainian',
  'bul': 'Bulgarian',
  'hrv': 'Croatian',
  'slv': 'Slovenian',
  'ron': 'Romanian',
  'lit': 'Lithuanian',
  'lav': 'Latvian',
  'est': 'Estonian',
  'slk': 'Slovak',
  'cat': 'Catalan',
  'eus': 'Basque',
  'glg': 'Galician',
  'gle': 'Irish',
  'cym': 'Welsh',
  'isl': 'Icelandic',
  'mlt': 'Maltese',
  'sqi': 'Albanian',
  'mkd': 'Macedonian',
  'srp': 'Serbian',
  'bos': 'Bosnian',
  'mon': 'Mongolian',
  'uzb': 'Uzbek',
  'kaz': 'Kazakh',
  'aze': 'Azerbaijani',
  'geo': 'Georgian',
  'arm': 'Armenian',
  'fas': 'Persian',
  'urd': 'Urdu',
  'ben': 'Bengali',
  'tam': 'Tamil',
  'tel': 'Telugu',
  'kan': 'Kannada',
  'mal': 'Malayalam',
  'guj': 'Gujarati',
  'pan': 'Punjabi',
  'ori': 'Odia',
  'mar': 'Marathi',
  'nep': 'Nepali',
  'sin': 'Sinhala',
  'mya': 'Burmese',
  'khm': 'Khmer',
  'lao': 'Lao',
  'amh': 'Amharic',
  'som': 'Somali',
  'swa': 'Swahili',
  'hau': 'Hausa',
  'yor': 'Yoruba',
  'ibo': 'Igbo',
  'afr': 'Afrikaans'
};

export class ContentAnalyzer {
  constructor() {
    this.summarizer = new SummarizerManager();
    this.defaultOptions = {
      summarize: true,
      detectLanguage: true,
      extractTopics: true,
      extractEntities: true,
      extractKeywords: true,
      summaryLength: 'medium',
      summaryType: 'extractive',
      minConfidence: 0.1,
      maxTopics: 10,
      maxKeywords: 15,
      includeReadabilityMetrics: true,
      includeSentiment: true
    };
  }

  /**
   * Analyze text content with multiple NLP techniques
   * @param {Object} params - Analysis parameters
   * @param {string} params.text - Text to analyze
   * @param {Object} params.options - Analysis options
   * @returns {Promise<Object>} - Analysis results
   */
  async analyzeContent(params) {
    const startTime = Date.now();
    
    try {
      const validated = ContentAnalyzerSchema.parse(params);
      const { text, options } = validated;
      const analysisOptions = { ...this.defaultOptions, ...options };

      const result = {
        text: text.substring(0, 1000), // Store truncated text for reference
        analyzedAt: new Date().toISOString(),
        processingTime: 0
      };

      // Calculate basic statistics
      result.statistics = this.calculateStatistics(text);

      // Language detection
      if (analysisOptions.detectLanguage) {
        result.language = await this.detectLanguage(text, analysisOptions);
      }

      // Text summarization
      if (analysisOptions.summarize) {
        result.summary = await this.summarizeText(text, analysisOptions);
      }

      // Topic extraction
      if (analysisOptions.extractTopics) {
        result.topics = await this.extractTopics(text, analysisOptions);
      }

      // Entity extraction
      if (analysisOptions.extractEntities) {
        result.entities = await this.extractEntities(text, analysisOptions);
      }

      // Keyword extraction
      if (analysisOptions.extractKeywords) {
        result.keywords = await this.extractKeywords(text, analysisOptions);
      }

      // Readability metrics
      if (analysisOptions.includeReadabilityMetrics) {
        result.readability = await this.calculateReadability(text);
      }

      // Sentiment analysis
      if (analysisOptions.includeSentiment) {
        result.sentiment = await this.analyzeSentiment(text);
      }

      result.processingTime = Date.now() - startTime;
      return result;

    } catch (error) {
      return {
        text: params.text?.substring(0, 100) || 'unknown',
        analyzedAt: new Date().toISOString(),
        processingTime: Date.now() - startTime,
        error: `Content analysis failed: ${error.message}`,
        statistics: {
          characters: 0,
          charactersNoSpaces: 0,
          words: 0,
          sentences: 0,
          paragraphs: 0,
          readingTime: 0
        }
      };
    }
  }

  /**
   * Detect language using franc library
   * @param {string} text - Text to analyze
   * @param {Object} options - Detection options
   * @returns {Promise<Object>} - Language detection result
   */
  async detectLanguage(text, options = {}) {
    try {
      // Use franc for language detection
      const detected = franc(text, {
        minLength: 10,
        whitelist: Object.keys(LANGUAGE_NAMES)
      });

      if (detected === 'und') {
        return null; // Undetermined language
      }

      // Get confidence score (simplified approach)
      const confidence = Math.min(1, text.length / 100 * 0.01 + 0.5);

      // Get alternative languages using franc.all
      const alternatives = franc.all(text, {
        minLength: 10,
        whitelist: Object.keys(LANGUAGE_NAMES)
      })
      .slice(1, 4) // Top 3 alternatives
      .map(([code, score]) => ({
        code,
        name: LANGUAGE_NAMES[code] || code,
        confidence: Math.round((1 - score) * 100) / 100
      }));

      return {
        code: detected,
        name: LANGUAGE_NAMES[detected] || detected,
        confidence: Math.round(confidence * 100) / 100,
        alternative: alternatives
      };

    } catch (error) {
      console.warn('Language detection failed:', error.message);
      return null;
    }
  }

  /**
   * Summarize text content
   * @param {string} text - Text to summarize
   * @param {Object} options - Summarization options
   * @returns {Promise<Object>} - Summarization result
   */
  async summarizeText(text, options = {}) {
    try {
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
      
      if (sentences.length < 3) {
        return {
          type: options.summaryType,
          length: options.summaryLength,
          sentences: sentences,
          text: text.trim(),
          compressionRatio: 1.0
        };
      }

      // Determine number of sentences based on length preference
      let targetSentences;
      switch (options.summaryLength) {
        case 'short':
          targetSentences = Math.max(1, Math.ceil(sentences.length * 0.1));
          break;
        case 'medium':
          targetSentences = Math.max(2, Math.ceil(sentences.length * 0.3));
          break;
        case 'long':
          targetSentences = Math.max(3, Math.ceil(sentences.length * 0.5));
          break;
        default:
          targetSentences = Math.max(2, Math.ceil(sentences.length * 0.3));
      }

      targetSentences = Math.min(targetSentences, sentences.length);

      let summarySentences;
      
      if (options.summaryType === 'extractive') {
        // Use node-summarizer for extractive summarization
        const summary = await this.summarizer.getSummaryByRanking(text, targetSentences);
        summarySentences = summary.split(/[.!?]+/).filter(s => s.trim().length > 0);
      } else {
        // Simple abstractive approach (for demonstration)
        summarySentences = await this.createAbstractiveSummary(text, targetSentences);
      }

      const summaryText = summarySentences.join('. ').trim() + '.';
      const compressionRatio = summaryText.length / text.length;

      return {
        type: options.summaryType,
        length: options.summaryLength,
        sentences: summarySentences,
        text: summaryText,
        compressionRatio: Math.round(compressionRatio * 100) / 100
      };

    } catch (error) {
      console.warn('Text summarization failed:', error.message);
      
      // Fallback: return first few sentences
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
      const fallbackSentences = sentences.slice(0, 2);
      
      return {
        type: 'fallback',
        length: 'short',
        sentences: fallbackSentences,
        text: fallbackSentences.join('. ').trim() + '.',
        compressionRatio: fallbackSentences.join('. ').length / text.length
      };
    }
  }

  /**
   * Create abstractive summary (simplified approach)
   * @param {string} text - Text to summarize
   * @param {number} targetSentences - Target number of sentences
   * @returns {Promise<Array>} - Array of summary sentences
   */
  async createAbstractiveSummary(text, targetSentences) {
    // This is a simplified abstractive approach
    // In production, you might use a transformer model or API
    
    const doc = nlp(text);
    const sentences = doc.sentences().out('array');
    
    // Score sentences by importance (simplified scoring)
    const scoredSentences = sentences.map(sentence => {
      const doc = nlp(sentence);
      const score = doc.nouns().length + doc.verbs().length * 0.8 + doc.adjectives().length * 0.5;
      return { sentence, score };
    });

    // Sort by score and take top sentences
    return scoredSentences
      .sort((a, b) => b.score - a.score)
      .slice(0, targetSentences)
      .map(item => item.sentence.trim());
  }

  /**
   * Extract topics from text
   * @param {string} text - Text to analyze
   * @param {Object} options - Extraction options
   * @returns {Promise<Array>} - Array of topics
   */
  async extractTopics(text, options = {}) {
    try {
      const doc = nlp(text);
      
      // Extract noun phrases as potential topics
      const nounPhrases = doc.nouns().out('array');
      const adjNounPhrases = doc.match('#Adjective+ #Noun+').out('array');
      
      // Combine and count frequency
      const allPhrases = [...nounPhrases, ...adjNounPhrases];
      const phraseCount = {};
      
      allPhrases.forEach(phrase => {
        const cleaned = phrase.toLowerCase().trim();
        if (cleaned.length > 2) {
          phraseCount[cleaned] = (phraseCount[cleaned] || 0) + 1;
        }
      });

      // Score and rank topics
      const topics = Object.entries(phraseCount)
        .map(([topic, frequency]) => ({
          topic,
          confidence: Math.min(1, frequency / Math.max(allPhrases.length, 1)),
          keywords: topic.split(' ').filter(w => w.length > 2)
        }))
        .filter(topic => topic.confidence >= options.minConfidence)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, options.maxTopics);

      return topics;

    } catch (error) {
      console.warn('Topic extraction failed:', error.message);
      return [];
    }
  }

  /**
   * Extract named entities from text
   * @param {string} text - Text to analyze
   * @param {Object} options - Extraction options
   * @returns {Promise<Object>} - Named entities by category
   */
  async extractEntities(text, options = {}) {
    try {
      const doc = nlp(text);

      return {
        people: doc.people().out('array'),
        places: doc.places().out('array'),
        organizations: doc.organizations().out('array'),
        dates: doc.dates().out('array'),
        money: doc.money().out('array'),
        other: doc.topics().out('array').slice(0, 10) // Limit other entities
      };

    } catch (error) {
      console.warn('Entity extraction failed:', error.message);
      return {
        people: [],
        places: [],
        organizations: [],
        dates: [],
        money: [],
        other: []
      };
    }
  }

  /**
   * Extract keywords from text
   * @param {string} text - Text to analyze
   * @param {Object} options - Extraction options
   * @returns {Promise<Array>} - Array of keywords with metadata
   */
  async extractKeywords(text, options = {}) {
    try {
      const doc = nlp(text);
      
      // Extract different types of terms
      const nouns = doc.nouns().out('array');
      const verbs = doc.verbs().out('array');
      const adjectives = doc.adjectives().out('array');
      
      // Count frequency for all terms
      const termFreq = {};
      const termTypes = {};
      
      [...nouns, ...verbs, ...adjectives].forEach(term => {
        const cleaned = term.toLowerCase().trim();
        if (cleaned.length > 2 && !this.isStopWord(cleaned)) {
          termFreq[cleaned] = (termFreq[cleaned] || 0) + 1;
          
          if (!termTypes[cleaned]) {
            if (nouns.includes(term)) termTypes[cleaned] = 'noun';
            else if (verbs.includes(term)) termTypes[cleaned] = 'verb';
            else if (adjectives.includes(term)) termTypes[cleaned] = 'adjective';
          }
        }
      });

      const totalTerms = Object.values(termFreq).reduce((sum, freq) => sum + freq, 0);

      // Calculate relevance and create keyword objects
      const keywords = Object.entries(termFreq)
        .map(([keyword, frequency]) => ({
          keyword,
          frequency,
          relevance: frequency / totalTerms,
          type: termTypes[keyword] || 'unknown'
        }))
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, options.maxKeywords);

      return keywords;

    } catch (error) {
      console.warn('Keyword extraction failed:', error.message);
      return [];
    }
  }

  /**
   * Calculate readability metrics
   * @param {string} text - Text to analyze
   * @returns {Promise<Object>} - Readability metrics
   */
  async calculateReadability(text) {
    try {
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
      const words = text.split(/\s+/).filter(w => w.length > 0);
      const characters = text.length;
      const charactersNoSpaces = text.replace(/\s/g, '').length;
      
      // Count syllables and complex words
      let totalSyllables = 0;
      let complexWords = 0;
      
      words.forEach(word => {
        const syllables = this.countSyllables(word);
        totalSyllables += syllables;
        if (syllables >= 3) complexWords++;
      });

      const avgWordsPerSentence = words.length / Math.max(sentences.length, 1);
      const avgCharsPerWord = charactersNoSpaces / Math.max(words.length, 1);
      const avgSyllablesPerWord = totalSyllables / Math.max(words.length, 1);

      // Flesch Reading Ease Score
      const fleschScore = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);

      return {
        score: Math.round(Math.max(0, Math.min(100, fleschScore)) * 100) / 100,
        level: this.getReadabilityLevel(fleschScore),
        metrics: {
          sentences: sentences.length,
          words: words.length,
          characters,
          avgWordsPerSentence: Math.round(avgWordsPerSentence * 100) / 100,
          avgCharsPerWord: Math.round(avgCharsPerWord * 100) / 100,
          complexWords,
          syllables: totalSyllables
        }
      };

    } catch (error) {
      console.warn('Readability calculation failed:', error.message);
      return null;
    }
  }

  /**
   * Analyze sentiment of text
   * @param {string} text - Text to analyze
   * @returns {Promise<Object>} - Sentiment analysis result
   */
  async analyzeSentiment(text) {
    try {
      const doc = nlp(text);
      
      // Simple sentiment analysis using compromise
      // This is basic - for production use a dedicated sentiment library
      const positiveWords = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'awesome', 'perfect', 'love', 'like', 'happy', 'pleased', 'satisfied'];
      const negativeWords = ['bad', 'terrible', 'awful', 'horrible', 'hate', 'dislike', 'angry', 'sad', 'disappointed', 'frustrated', 'annoyed', 'upset'];
      
      const words = doc.terms().out('array').map(w => w.toLowerCase());
      
      let positiveCount = 0;
      let negativeCount = 0;
      
      words.forEach(word => {
        if (positiveWords.includes(word)) positiveCount++;
        if (negativeWords.includes(word)) negativeCount++;
      });

      const totalSentimentWords = positiveCount + negativeCount;
      
      if (totalSentimentWords === 0) {
        return {
          polarity: 0,
          subjectivity: 0,
          label: 'neutral',
          confidence: 0.5
        };
      }

      const polarity = (positiveCount - negativeCount) / Math.max(words.length, 1);
      const subjectivity = totalSentimentWords / Math.max(words.length, 1);
      
      let label = 'neutral';
      if (polarity > 0.1) label = 'positive';
      else if (polarity < -0.1) label = 'negative';

      const confidence = Math.min(1, totalSentimentWords / 10);

      return {
        polarity: Math.round(polarity * 100) / 100,
        subjectivity: Math.round(subjectivity * 100) / 100,
        label,
        confidence: Math.round(confidence * 100) / 100
      };

    } catch (error) {
      console.warn('Sentiment analysis failed:', error.message);
      return null;
    }
  }

  /**
   * Calculate basic text statistics
   * @param {string} text - Text to analyze
   * @returns {Object} - Text statistics
   */
  calculateStatistics(text) {
    const characters = text.length;
    const charactersNoSpaces = text.replace(/\s/g, '').length;
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    
    // Estimate reading time (average 200 words per minute)
    const readingTime = Math.ceil(words.length / 200);

    return {
      characters,
      charactersNoSpaces,
      words: words.length,
      sentences: sentences.length,
      paragraphs: paragraphs.length,
      readingTime
    };
  }

  /**
   * Count syllables in a word
   * @param {string} word - Word to count syllables for
   * @returns {number} - Syllable count
   */
  countSyllables(word) {
    if (!word || word.length <= 3) return 1;
    
    const vowels = 'aeiouy';
    let count = 0;
    let prevIsVowel = false;

    for (let i = 0; i < word.length; i++) {
      const isVowel = vowels.includes(word[i].toLowerCase());
      if (isVowel && !prevIsVowel) {
        count++;
      }
      prevIsVowel = isVowel;
    }

    // Adjust for silent 'e'
    if (word.toLowerCase().endsWith('e')) {
      count--;
    }

    return Math.max(1, count);
  }

  /**
   * Get readability level from score
   * @param {number} score - Readability score
   * @returns {string} - Readability level
   */
  getReadabilityLevel(score) {
    if (score >= 90) return 'Very Easy';
    if (score >= 80) return 'Easy';
    if (score >= 70) return 'Fairly Easy';
    if (score >= 60) return 'Standard';
    if (score >= 50) return 'Fairly Difficult';
    if (score >= 30) return 'Difficult';
    return 'Very Difficult';
  }

  /**
   * Check if word is a stop word
   * @param {string} word - Word to check
   * @returns {boolean} - True if stop word
   */
  isStopWord(word) {
    const stopWords = [
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'from', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
      'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can',
      'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me',
      'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their'
    ];
    
    return stopWords.includes(word.toLowerCase());
  }
}

export default ContentAnalyzer;