/**
 * Shared Ollama endpoint configuration.
 *
 * OLLAMA_BASE_URL   — where the Ollama API lives (default http://localhost:11434).
 *                     Set to https://ollama.com for Ollama Cloud, or to a tunnel
 *                     URL fronting a self-hosted instance.
 * OLLAMA_API_KEY    — optional bearer token. Ollama Cloud requires it; a plain
 *                     local instance ignores auth, so leaving it unset keeps the
 *                     zero-config localhost behavior.
 *
 * Every HTTP call to Ollama (extract_with_llm, list_ollama_models, the
 * SamplingClient fallback chain) must build its URL and headers from here so a
 * hosted deployment configures the endpoint once.
 */

export function ollamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
}

/**
 * @param {Record<string, string>} [extra] headers to merge (e.g. Content-Type)
 * @returns {Record<string, string>}
 */
export function ollamaHeaders(extra = {}) {
  const apiKey = process.env.OLLAMA_API_KEY;
  return { ...extra, ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
}
