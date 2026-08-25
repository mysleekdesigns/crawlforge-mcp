import { LLMProvider } from './LLMProvider.js';
import { ollamaBaseUrl, ollamaHeaders } from '../../utils/ollamaConfig.js';

const DEFAULT_MODEL = 'llama3.2';

/**
 * Ollama Provider
 * Implements LLM operations against a local (or hosted) Ollama server.
 *
 * Ollama needs no API key, so it is the provider that is available by default.
 * Reachability is established by probing /api/tags rather than by the presence
 * of a credential — see LLMManager.ready().
 */
export class OllamaProvider extends LLMProvider {
  constructor(options = {}) {
    super(options);

    this.model = options.model || process.env.OLLAMA_DEFAULT_MODEL || DEFAULT_MODEL;
    this.embeddingModel = options.embeddingModel || process.env.OLLAMA_EMBEDDING_MODEL || this.model;
    this.timeout = options.timeout || 120000;
  }

  async generateCompletion(prompt, options = {}) {
    const {
      maxTokens = 1000,
      temperature = 0.7,
      systemPrompt = null,
      // 'json' constrains the model to emit a parseable object, or pass a JSON
      // Schema to constrain the shape as well. Small local models otherwise
      // wrap JSON in prose and the caller's JSON.parse fails.
      format = null
    } = options;

    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const body = {
      model: this.model,
      messages,
      stream: false,
      options: { num_predict: maxTokens, temperature }
    };
    if (format) body.format = format;

    let response;
    try {
      response = await fetch(`${ollamaBaseUrl()}/api/chat`, {
        method: 'POST',
        headers: ollamaHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout)
      });
    } catch (error) {
      const message = /fetch failed|ECONNREFUSED/i.test(error.message)
        ? `Ollama is not running at ${ollamaBaseUrl()}. Start it with "ollama serve".`
        : `Ollama request failed: ${error.message}`;
      this.logger.error('Ollama completion failed', { error: message });
      throw new Error(message);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      const message = response.status === 404 && /model.*not found|pull/i.test(errText)
        ? `Ollama model "${this.model}" is not pulled. Run: "ollama pull ${this.model}"`
        : `Ollama API error ${response.status}: ${errText.slice(0, 200)}`;
      this.logger.error('Ollama completion failed', { error: message });
      throw new Error(message);
    }

    const json = await response.json();
    const content = json?.message?.content;
    if (!content) {
      throw new Error('No completion generated');
    }
    return content.trim();
  }

  async generateEmbedding(text) {
    const response = await fetch(`${ollamaBaseUrl()}/api/embeddings`, {
      method: 'POST',
      headers: ollamaHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ model: this.embeddingModel, prompt: text }),
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Ollama embedding error ${response.status}: ${errText.slice(0, 200)}`);
    }

    const json = await response.json();
    if (!Array.isArray(json.embedding) || json.embedding.length === 0) {
      throw new Error('No embedding generated');
    }
    return json.embedding;
  }

  /**
   * Reachability check. Lists installed models rather than running a completion,
   * so it costs nothing and stays fast even on a cold model.
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      const response = await fetch(`${ollamaBaseUrl()}/api/tags`, {
        headers: ollamaHeaders(),
        signal: AbortSignal.timeout(3000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  getMetadata() {
    return {
      ...super.getMetadata(),
      name: 'Ollama',
      baseUrl: ollamaBaseUrl(),
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
