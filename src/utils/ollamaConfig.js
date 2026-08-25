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

// ── Model selection ───────────────────────────────────────────────────────────

/**
 * Local models ranked by extraction accuracy, measured 2026-08-25 against three
 * live product pages (books.toscrape, an Amazon listing, a Shopify storefront)
 * with independently verified ground truth. Score is correct fields out of 18
 * over two runs; a page with no compare-at price counts a fabricated one as
 * wrong.
 *
 *   gemma3:4b          18/18   1040ms      45/45 over five runs
 *   gpt-oss:20b        18/18   3464ms
 *   gemma3:12b         16/18   3652ms      invents a compare-at price
 *   mistral:7b         16/18   2377ms      misses the rating
 *   llama3.2           16/18   1179ms      invents a compare-at price, every run
 *   qwen2.5:3b         16/18   1067ms      misses the title, every run
 *   dolphin-llama3:8b  12/18   6288ms
 *
 * Parameter count did not predict accuracy: the 4B model beat both the 12B and
 * the 20B, and was three times faster than either.
 */
const PREFERRED_MODELS = [
  'gemma3:4b',
  'gpt-oss:20b',
  'gemma3:12b',
  'mistral:7b',
  'llama3.2',
  'qwen2.5:3b'
];

/** Used only when Ollama cannot be reached, so the error names a real model. */
export const FALLBACK_OLLAMA_MODEL = 'llama3.2';

/** Installed-model list per base URL. Keyed by URL so a changed endpoint re-probes. */
const _installedByBaseUrl = new Map();

/** "llama3.2" and "llama3.2:latest" name the same model. */
function baseName(name) {
  return name.replace(/:latest$/, '');
}

/**
 * Names of the models installed on the Ollama server, or [] if unreachable.
 * Cached for the process lifetime — pulling a model mid-session is rare enough
 * that re-listing on every extraction is not worth the round trip.
 * @returns {Promise<string[]>}
 */
export async function installedOllamaModels() {
  const url = ollamaBaseUrl();
  if (!_installedByBaseUrl.has(url)) {
    _installedByBaseUrl.set(url, (async () => {
      try {
        const response = await fetch(`${url}/api/tags`, {
          headers: ollamaHeaders(),
          signal: AbortSignal.timeout(3000)
        });
        if (!response.ok) return [];
        const data = await response.json();
        const models = Array.isArray(data?.models) ? data.models : [];
        return models.map((m) => m.name).filter(Boolean);
      } catch {
        return [];
      }
    })());
  }
  return _installedByBaseUrl.get(url);
}

/**
 * Choose which Ollama model to extract with.
 *
 * The code default used to be llama3.2 regardless of what was installed, and
 * llama3.2 fabricates values — it invented a compare-at price on a Shopify
 * product that has none, on every one of five runs. Hardcoding the winner
 * instead would break anyone who has not pulled it, so the best *installed*
 * model is chosen, and an explicit OLLAMA_DEFAULT_MODEL always wins.
 *
 * @returns {Promise<string>}
 */
export async function selectOllamaModel() {
  const explicit = process.env.OLLAMA_DEFAULT_MODEL;
  if (explicit) return explicit;

  const installed = await installedOllamaModels();
  if (installed.length === 0) return FALLBACK_OLLAMA_MODEL;

  const byBase = new Map(installed.map((name) => [baseName(name), name]));
  for (const preferred of PREFERRED_MODELS) {
    const match = byBase.get(baseName(preferred));
    if (match) return match;
  }
  // Nothing recognised — use whatever is there rather than failing.
  return installed[0];
}
