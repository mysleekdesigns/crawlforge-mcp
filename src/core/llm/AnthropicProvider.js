import { LLMProvider } from './LLMProvider.js';

/**
 * Anthropic Claude API Provider
 * Implements LLM operations using Anthropic's Claude models
 */
export class AnthropicProvider extends LLMProvider {
  constructor(options = {}) {
    super(options);
    
    this.apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
    this.baseURL = options.baseURL || 'https://api.anthropic.com/v1';
    this.model = options.model || 'claude-3-haiku-20240307';
    this.timeout = options.timeout || 30000;
    this.version = options.version || '2023-06-01';
    
    if (!this.apiKey) {
      this.logger.warn('Anthropic API key not configured');
    }
  }

  async generateCompletion(prompt, options = {}) {
    if (!this.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    const {
      maxTokens = 1000,
      temperature = 0.7,
      systemPrompt = null,
      stopSequences = null
    } = options;

    try {
      const requestBody = {
        model: this.model,
        max_tokens: maxTokens,
        temperature,
        messages: [
          { role: 'user', content: prompt }
        ]
      };

      if (systemPrompt) {
        requestBody.system = systemPrompt;
      }

      if (stopSequences) {
        requestBody.stop_sequences = stopSequences;
      }

      const response = await fetch(`${this.baseURL}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'anthropic-version': this.version
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.timeout)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Anthropic API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.content || data.content.length === 0) {
        throw new Error('No completion generated');
      }

      return data.content[0].text.trim();
    } catch (error) {
      this.logger.error('Anthropic completion failed', { error: error.message });
      throw error;
    }
  }

  async generateEmbedding(text) {
    // Anthropic doesn't provide embeddings API
    // Fallback to simple text similarity
    this.logger.warn('Anthropic does not provide embeddings API, using fallback similarity');
    return this.generateSimpleEmbedding(text);
  }

  /**
   * Generate a simple embedding based on text characteristics
   * This is a fallback when embeddings API is not available
   */
  generateSimpleEmbedding(text) {
    const words = text.toLowerCase().split(/\s+/);
    const embedding = new Array(100).fill(0); // 100-dimensional vector
    
    // Simple hash-based embedding
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      let hash = 0;
      for (let j = 0; j < word.length; j++) {
        hash = ((hash << 5) - hash + word.charCodeAt(j)) & 0xffffffff;
      }
      const index = Math.abs(hash) % embedding.length;
      embedding[index] += 1 / words.length;
    }
    
    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return magnitude > 0 ? embedding.map(val => val / magnitude) : embedding;
  }

  async calculateSimilarity(text1, text2) {
    // Simple Jaccard similarity for fallback
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  getMetadata() {
    return {
      ...super.getMetadata(),
      name: 'Anthropic',
      model: this.model,
      capabilities: {
        completion: true,
        embedding: false, // Uses fallback
        similarity: true  // Uses fallback
      }
    };
  }
}