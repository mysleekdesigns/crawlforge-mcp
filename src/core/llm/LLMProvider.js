import { Logger } from '../../utils/Logger.js';

/**
 * Base LLM Provider class
 * Defines the interface that all LLM providers must implement
 */
export class LLMProvider {
  constructor(options = {}) {
    this.logger = new Logger({ component: 'LLMProvider' });
    this.config = options;
  }

  /**
   * Generate a completion from the LLM
   * @param {string} prompt - The input prompt
   * @param {Object} options - Generation options
   * @returns {Promise<string>} Generated text
   */
  async generateCompletion(prompt, options = {}) {
    throw new Error('generateCompletion must be implemented by subclass');
  }

  /**
   * Generate embeddings for semantic similarity
   * @param {string} text - Text to embed
   * @returns {Promise<number[]>} Embedding vector
   */
  async generateEmbedding(text) {
    throw new Error('generateEmbedding must be implemented by subclass');
  }

  /**
   * Calculate semantic similarity between two texts
   * @param {string} text1 - First text
   * @param {string} text2 - Second text
   * @returns {Promise<number>} Similarity score (0-1)
   */
  async calculateSimilarity(text1, text2) {
    const embedding1 = await this.generateEmbedding(text1);
    const embedding2 = await this.generateEmbedding(text2);
    return this.cosineSimilarity(embedding1, embedding2);
  }

  /**
   * Calculate cosine similarity between two vectors
   * @param {number[]} vec1 - First vector
   * @param {number[]} vec2 - Second vector
   * @returns {number} Similarity score (0-1)
   */
  cosineSimilarity(vec1, vec2) {
    if (vec1.length !== vec2.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
    return magnitude > 0 ? dotProduct / magnitude : 0;
  }

  /**
   * Check if the provider is available and configured
   * @returns {Promise<boolean>} True if available
   */
  async isAvailable() {
    try {
      await this.generateCompletion('test', { maxTokens: 1 });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get provider metadata
   * @returns {Object} Provider information
   */
  getMetadata() {
    return {
      name: this.constructor.name,
      config: this.config,
      capabilities: {
        completion: true,
        embedding: false,
        similarity: false
      }
    };
  }
}