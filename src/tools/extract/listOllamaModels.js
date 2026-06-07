/**
 * List Ollama Models MCP Tool
 * Returns the models installed on the local Ollama server (GET /api/tags).
 * Used to discover names that can be passed as the `model` parameter to extract_with_llm.
 */

function ollamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
}

export class ListOllamaModelsTool {
  async execute() {
    const baseUrl = ollamaBaseUrl();
    const url = `${baseUrl}/api/tags`;

    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      return {
        success: false,
        baseUrl,
        error:
          `Could not reach Ollama at ${url}: ${err.message}. ` +
          `Install from https://ollama.com and run "ollama serve".`
      };
    }

    if (!response.ok) {
      return {
        success: false,
        baseUrl,
        error: `Ollama responded ${response.status} at ${url}. Is "ollama serve" running?`
      };
    }

    let data;
    try {
      data = await response.json();
    } catch (err) {
      return { success: false, baseUrl, error: `Invalid JSON from Ollama: ${err.message}` };
    }

    // C3: harden against non-array response; normalize modified_at to ISO 8601.
    const rawModels = Array.isArray(data.models) ? data.models :
                      Array.isArray(data) ? data : [];

    const models = rawModels.map((m) => {
      let modified_at = m.modified_at ?? null;
      if (modified_at !== null) {
        const d = new Date(modified_at);
        modified_at = isNaN(d.getTime()) ? modified_at : d.toISOString();
      }
      return {
        name: m.name,
        size_bytes: m.size,
        modified_at,
        family: m.details?.family,
        parameter_size: m.details?.parameter_size,
        quantization: m.details?.quantization_level
      };
    });

    return {
      success: true,
      baseUrl,
      count: models.length,
      models,
      hint:
        models.length === 0
          ? 'No models installed. Run "ollama pull llama3.2" (or any model from https://ollama.com/library) in your terminal.'
          : 'Pass any of these names as the `model` parameter to extract_with_llm.'
    };
  }
}

export default ListOllamaModelsTool;
