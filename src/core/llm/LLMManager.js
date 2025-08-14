import { OpenAIProvider } from './OpenAIProvider.js';
import { AnthropicProvider } from './AnthropicProvider.js';
import { Logger } from '../../utils/Logger.js';

/**
 * LLM Manager
 * Manages multiple LLM providers and provides unified interface
 */
export class LLMManager {
  constructor(options = {}) {
    this.logger = new Logger({ component: 'LLMManager' });
    this.providers = new Map();
    this.defaultProvider = null;
    this.fallbackProvider = null;
    
    this.initializeProviders(options);
  }

  /**
   * Initialize available LLM providers
   */
  initializeProviders(options) {
    const {
      openai = {},
      anthropic = {},
      defaultProvider = 'auto'
    } = options;

    // Initialize OpenAI provider
    if (openai.apiKey || process.env.OPENAI_API_KEY) {
      const openaiProvider = new OpenAIProvider(openai);
      this.providers.set('openai', openaiProvider);
      this.logger.info('OpenAI provider initialized');
    }

    // Initialize Anthropic provider
    if (anthropic.apiKey || process.env.ANTHROPIC_API_KEY) {
      const anthropicProvider = new AnthropicProvider(anthropic);
      this.providers.set('anthropic', anthropicProvider);
      this.logger.info('Anthropic provider initialized');
    }

    // Set default provider
    this.setDefaultProvider(defaultProvider);
  }

  /**
   * Set the default provider
   */
  setDefaultProvider(providerName) {
    if (providerName === 'auto') {
      // Auto-select: prefer OpenAI for embeddings, fallback to Anthropic
      if (this.providers.has('openai')) {
        this.defaultProvider = 'openai';
        this.fallbackProvider = this.providers.has('anthropic') ? 'anthropic' : null;
      } else if (this.providers.has('anthropic')) {
        this.defaultProvider = 'anthropic';
        this.fallbackProvider = null;
      }
    } else if (this.providers.has(providerName)) {
      this.defaultProvider = providerName;
      // Set fallback to other available provider
      for (const [name, provider] of this.providers) {
        if (name !== providerName) {
          this.fallbackProvider = name;
          break;
        }
      }
    }

    if (this.defaultProvider) {
      this.logger.info(`Default LLM provider set to: ${this.defaultProvider}`);
      if (this.fallbackProvider) {
        this.logger.info(`Fallback LLM provider: ${this.fallbackProvider}`);
      }
    } else {
      this.logger.warn('No LLM providers available');
    }
  }

  /**
   * Get a provider instance
   */
  getProvider(name = null) {
    const providerName = name || this.defaultProvider;
    if (!providerName) {
      throw new Error('No LLM provider available');
    }
    
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`LLM provider '${providerName}' not found`);
    }
    
    return provider;
  }

  /**
   * Generate completion with fallback support
   */
  async generateCompletion(prompt, options = {}) {
    const { provider = null, ...llmOptions } = options;
    
    try {
      const llmProvider = this.getProvider(provider);
      return await llmProvider.generateCompletion(prompt, llmOptions);
    } catch (error) {
      this.logger.warn(`Primary provider failed: ${error.message}`);
      
      // Try fallback provider if available
      if (this.fallbackProvider && (!provider || provider === this.defaultProvider)) {
        try {
          this.logger.info(`Trying fallback provider: ${this.fallbackProvider}`);
          const fallbackLLM = this.getProvider(this.fallbackProvider);
          return await fallbackLLM.generateCompletion(prompt, llmOptions);
        } catch (fallbackError) {
          this.logger.error(`Fallback provider also failed: ${fallbackError.message}`);
        }
      }
      
      throw error;
    }
  }

  /**
   * Generate embeddings with fallback support
   */
  async generateEmbedding(text, options = {}) {
    const { provider = null } = options;
    
    try {
      const llmProvider = this.getProvider(provider);
      return await llmProvider.generateEmbedding(text);
    } catch (error) {
      this.logger.warn(`Primary provider embedding failed: ${error.message}`);
      
      // Try fallback provider if available
      if (this.fallbackProvider && (!provider || provider === this.defaultProvider)) {
        try {
          this.logger.info(`Trying fallback provider for embedding: ${this.fallbackProvider}`);
          const fallbackLLM = this.getProvider(this.fallbackProvider);
          return await fallbackLLM.generateEmbedding(text);
        } catch (fallbackError) {
          this.logger.error(`Fallback provider embedding also failed: ${fallbackError.message}`);
        }
      }
      
      throw error;
    }
  }

  /**
   * Calculate semantic similarity
   */
  async calculateSimilarity(text1, text2, options = {}) {
    const { provider = null } = options;
    
    try {
      const llmProvider = this.getProvider(provider);
      return await llmProvider.calculateSimilarity(text1, text2);
    } catch (error) {
      this.logger.warn(`Primary provider similarity failed: ${error.message}`);
      
      // Try fallback provider if available
      if (this.fallbackProvider && (!provider || provider === this.defaultProvider)) {
        try {
          this.logger.info(`Trying fallback provider for similarity: ${this.fallbackProvider}`);
          const fallbackLLM = this.getProvider(this.fallbackProvider);
          return await fallbackLLM.calculateSimilarity(text1, text2);
        } catch (fallbackError) {
          this.logger.error(`Fallback provider similarity also failed: ${fallbackError.message}`);
        }
      }
      
      throw error;
    }
  }

  /**
   * Generate query expansion suggestions
   */
  async expandQuery(query, options = {}) {
    const {
      maxExpansions = 5,
      includeContextual = true,
      includeSynonyms = true,
      includeRelated = true
    } = options;

    const systemPrompt = `You are a query expansion expert. Generate relevant search query variations for research purposes.

Rules:
1. Return only the query variations, one per line
2. Focus on research-oriented variations
3. Include different perspectives and angles
4. Maintain semantic relevance
5. Keep queries concise and searchable
6. Maximum ${maxExpansions} variations`;

    let prompt = `Original query: "${query}"\n\nGenerate ${maxExpansions} research-focused query variations:`;

    if (includeContextual) {
      prompt += '\n- Include contextual variations';
    }
    if (includeSynonyms) {
      prompt += '\n- Include synonym-based variations';
    }
    if (includeRelated) {
      prompt += '\n- Include related concept variations';
    }

    try {
      const response = await this.generateCompletion(prompt, {
        systemPrompt,
        maxTokens: 300,
        temperature: 0.8
      });

      return response
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('-') && !line.includes(':'))
        .slice(0, maxExpansions);
    } catch (error) {
      this.logger.warn('LLM query expansion failed, using fallback', { error: error.message });
      return this.fallbackQueryExpansion(query, maxExpansions);
    }
  }

  /**
   * Analyze content relevance to a topic
   */
  async analyzeRelevance(content, topic, options = {}) {
    const { maxContentLength = 2000 } = options;
    
    const truncatedContent = content.length > maxContentLength 
      ? content.substring(0, maxContentLength) + '...'
      : content;

    const systemPrompt = `You are a content relevance analyzer. Evaluate how relevant the given content is to the specified research topic.

Return a JSON object with:
{
  "relevanceScore": 0.0-1.0,
  "keyPoints": ["point1", "point2", ...],
  "topicAlignment": "description of alignment",
  "credibilityIndicators": ["indicator1", "indicator2", ...]
}`;

    const prompt = `Research Topic: "${topic}"

Content to analyze:
${truncatedContent}

Analyze the relevance of this content to the research topic:`;

    try {
      const response = await this.generateCompletion(prompt, {
        systemPrompt,
        maxTokens: 500,
        temperature: 0.3
      });

      const analysis = JSON.parse(response);
      return {
        relevanceScore: Math.max(0, Math.min(1, analysis.relevanceScore || 0.5)),
        keyPoints: analysis.keyPoints || [],
        topicAlignment: analysis.topicAlignment || '',
        credibilityIndicators: analysis.credibilityIndicators || []
      };
    } catch (error) {
      this.logger.warn('LLM relevance analysis failed, using fallback', { error: error.message });
      return this.fallbackRelevanceAnalysis(content, topic);
    }
  }

  /**
   * Generate research synthesis
   */
  async synthesizeFindings(findings, topic, options = {}) {
    const { maxFindings = 10, includeConflicts = true } = options;
    
    const limitedFindings = findings.slice(0, maxFindings);
    
    const systemPrompt = `You are a research synthesis expert. Create a comprehensive synthesis of research findings on a given topic.

Generate a JSON response with:
{
  "summary": "overall summary",
  "keyInsights": ["insight1", "insight2", ...],
  "themes": ["theme1", "theme2", ...],
  "confidence": 0.0-1.0,
  "gaps": ["gap1", "gap2", ...],
  "recommendations": ["rec1", "rec2", ...]
}`;

    const findingsText = limitedFindings
      .map((finding, index) => `${index + 1}. ${finding.finding || finding.text || finding}`)
      .join('\n');

    const prompt = `Research Topic: "${topic}"

Research Findings:
${findingsText}

Synthesize these findings into a comprehensive analysis:`;

    try {
      const response = await this.generateCompletion(prompt, {
        systemPrompt,
        maxTokens: 800,
        temperature: 0.4
      });

      return JSON.parse(response);
    } catch (error) {
      this.logger.warn('LLM synthesis failed, using fallback', { error: error.message });
      return this.fallbackSynthesis(findings, topic);
    }
  }

  /**
   * Fallback query expansion without LLM
   */
  fallbackQueryExpansion(query, maxExpansions) {
    const variations = [];
    const words = query.toLowerCase().split(/\s+/);
    
    // Question variations
    variations.push(`what is ${query}`);
    variations.push(`how does ${query} work`);
    variations.push(`${query} research`);
    variations.push(`${query} analysis`);
    variations.push(`latest ${query}`);
    
    return variations.slice(0, maxExpansions);
  }

  /**
   * Fallback relevance analysis without LLM
   */
  fallbackRelevanceAnalysis(content, topic) {
    const topicWords = topic.toLowerCase().split(/\s+/);
    const contentWords = content.toLowerCase().split(/\s+/);
    
    const matches = topicWords.filter(word => 
      contentWords.some(cWord => cWord.includes(word) || word.includes(cWord))
    );
    
    const relevanceScore = matches.length / topicWords.length;
    
    return {
      relevanceScore: Math.min(1, relevanceScore),
      keyPoints: [content.substring(0, 100) + '...'],
      topicAlignment: `Found ${matches.length}/${topicWords.length} topic keywords`,
      credibilityIndicators: []
    };
  }

  /**
   * Fallback synthesis without LLM
   */
  fallbackSynthesis(findings, topic) {
    return {
      summary: `Collected ${findings.length} findings related to ${topic}`,
      keyInsights: findings.slice(0, 3).map(f => f.finding || f.text || f),
      themes: ['general research'],
      confidence: 0.5,
      gaps: ['Limited synthesis without LLM'],
      recommendations: ['Use LLM provider for detailed synthesis']
    };
  }

  /**
   * Check if any LLM provider is available
   */
  isAvailable() {
    return this.providers.size > 0;
  }

  /**
   * Get available providers metadata
   */
  getProvidersMetadata() {
    const metadata = {};
    for (const [name, provider] of this.providers) {
      metadata[name] = provider.getMetadata();
    }
    return metadata;
  }

  /**
   * Health check for all providers
   */
  async healthCheck() {
    const health = {};
    
    for (const [name, provider] of this.providers) {
      try {
        const isAvailable = await provider.isAvailable();
        health[name] = {
          available: isAvailable,
          metadata: provider.getMetadata()
        };
      } catch (error) {
        health[name] = {
          available: false,
          error: error.message
        };
      }
    }
    
    return health;
  }
}