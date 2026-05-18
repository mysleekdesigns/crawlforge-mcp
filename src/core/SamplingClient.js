/**
 * SamplingClient — MCP Sampling wrapper for CrawlForge
 *
 * Allows tools to request LLM completions from the connected MCP client
 * instead of holding server-side API keys.
 *
 * Fallback chain (applied in resolveCompletion):
 *   1. Ollama (local, no API key needed)
 *   2. Server-side API key (OPENAI_API_KEY / ANTHROPIC_API_KEY)
 *   3. MCP sampling request to client
 *   4. Error
 */

const OLLAMA_DEFAULT_MODEL = 'llama3.2';
const OLLAMA_BASE_URL = () => (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');

/**
 * Attempt an Ollama completion.
 * @param {string} prompt
 * @param {object} options
 * @returns {Promise<string>}
 */
async function tryOllama(prompt, { model, maxTokens } = {}) {
  const ollamaModel = model || process.env.OLLAMA_DEFAULT_MODEL || OLLAMA_DEFAULT_MODEL;
  const url = `${OLLAMA_BASE_URL()}/api/generate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel,
      prompt,
      stream: false,
      ...(maxTokens ? { options: { num_predict: maxTokens } } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  if (!data.response) throw new Error('Ollama returned empty response');
  return data.response;
}

/**
 * Attempt an OpenAI completion using server-side API key.
 * @param {string} prompt
 * @param {object} options
 * @returns {Promise<string>}
 */
async function tryOpenAI(prompt, { model, maxTokens } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '');
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Attempt an Anthropic completion using server-side API key.
 * @param {string} prompt
 * @param {object} options
 * @returns {Promise<string>}
 */
async function tryAnthropic(prompt, { model, maxTokens } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens || 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

export class SamplingClient {
  /**
   * @param {object} options
   * @param {object|null} options.mcpServer - McpServer instance (must have requestSampling method if sampling is desired)
   */
  constructor({ mcpServer } = {}) {
    this._mcpServer = mcpServer || null;
  }

  /**
   * Resolve an LLM completion using the fallback chain:
   * Ollama → API key (OpenAI then Anthropic) → MCP sampling → error
   *
   * @param {string} prompt - The prompt to complete
   * @param {object} options
   * @param {string} [options.model] - Override model name
   * @param {number} [options.maxTokens] - Max tokens for response
   * @param {string} [options.systemPrompt] - Optional system-level instruction
   * @returns {Promise<{ text: string, provider: string }>}
   */
  async complete(prompt, options = {}) {
    const fullPrompt = options.systemPrompt
      ? `${options.systemPrompt}\n\n${prompt}`
      : prompt;

    // 1. Try Ollama (local, no API key)
    try {
      const text = await tryOllama(fullPrompt, options);
      return { text, provider: 'ollama' };
    } catch (_ollamaErr) {
      // Ollama unavailable — continue fallback chain
    }

    // 2. Try server-side API keys
    if (process.env.OPENAI_API_KEY) {
      try {
        const text = await tryOpenAI(fullPrompt, options);
        return { text, provider: 'openai' };
      } catch (_openaiErr) {
        // OpenAI failed — try Anthropic
      }
    }

    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const text = await tryAnthropic(fullPrompt, options);
        return { text, provider: 'anthropic' };
      } catch (_anthropicErr) {
        // Anthropic failed — try sampling
      }
    }

    // 3. Try MCP sampling (client-side LLM)
    if (this._mcpServer?.server?.createMessage) {
      try {
        const samplingResult = await this._mcpServer.server.createMessage({
          messages: [{ role: 'user', content: { type: 'text', text: fullPrompt } }],
          maxTokens: options.maxTokens || 1024,
          includeContext: 'none',
        });
        const text = samplingResult?.content?.text || '';
        if (text) return { text, provider: 'sampling' };
      } catch (_samplingErr) {
        // Sampling not supported or failed
      }
    }

    // 4. All fallbacks exhausted
    throw new Error(
      'No LLM available: Ollama is not running, no API keys set (OPENAI_API_KEY / ANTHROPIC_API_KEY), and the MCP client does not support sampling.'
    );
  }

  /**
   * Check which LLM providers are available without making a completion call.
   * @returns {Promise<{ ollama: boolean, openai: boolean, anthropic: boolean, sampling: boolean }>}
   */
  async probe() {
    const result = { ollama: false, openai: false, anthropic: false, sampling: false };

    try {
      const res = await fetch(`${OLLAMA_BASE_URL()}/api/tags`, { signal: AbortSignal.timeout(3000) });
      result.ollama = res.ok;
    } catch (_) { /* unavailable */ }

    result.openai = !!process.env.OPENAI_API_KEY;
    result.anthropic = !!process.env.ANTHROPIC_API_KEY;
    result.sampling = !!(this._mcpServer?.server?.createMessage);

    return result;
  }
}
