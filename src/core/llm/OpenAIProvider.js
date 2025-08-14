import { LLMProvider } from './LLMProvider.js';

/**
 * OpenAI API Provider
 * Implements LLM operations using OpenAI's GPT models
 */
export class OpenAIProvider extends LLMProvider {
  constructor(options = {}) {
    super(options);
    
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    this.baseURL = options.baseURL || 'https://api.openai.com/v1';
    this.model = options.model || 'gpt-3.5-turbo';
    this.embeddingModel = options.embeddingModel || 'text-embedding-ada-002';
    this.timeout = options.timeout || 30000;
    
    if (!this.apiKey) {
      this.logger.warn('OpenAI API key not configured');
    }
  }

  async generateCompletion(prompt, options = {}) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const {
      maxTokens = 1000,
      temperature = 0.7,
      systemPrompt = null,
      stopSequences = null
    } = options;

    const messages = [];
    
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    
    messages.push({ role: 'user', content: prompt });

    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: maxTokens,
          temperature,
          stop: stopSequences
        }),
        signal: AbortSignal.timeout(this.timeout)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`OpenAI API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.choices || data.choices.length === 0) {
        throw new Error('No completion generated');
      }

      return data.choices[0].message.content.trim();
    } catch (error) {
      this.logger.error('OpenAI completion failed', { error: error.message });
      throw error;
    }
  }

  async generateEmbedding(text) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    try {
      const response = await fetch(`${this.baseURL}/embeddings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.embeddingModel,
          input: text
        }),
        signal: AbortSignal.timeout(this.timeout)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`OpenAI API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.data || data.data.length === 0) {
        throw new Error('No embedding generated');
      }

      return data.data[0].embedding;
    } catch (error) {
      this.logger.error('OpenAI embedding failed', { error: error.message });
      throw error;
    }
  }

  getMetadata() {
    return {
      ...super.getMetadata(),
      name: 'OpenAI',
      model: this.model,
      embeddingModel: this.embeddingModel,
      capabilities: {
        completion: true,
        embedding: true,
        similarity: true
      }
    };
  }
}