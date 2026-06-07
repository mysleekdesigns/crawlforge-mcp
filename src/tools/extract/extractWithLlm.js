/**
 * Extract With LLM MCP Tool
 * Natural-language extraction powered by a local Ollama model (default) or
 * a cloud provider (OpenAI / Anthropic, explicit opt-in).
 *
 * Default: provider 'auto' → Ollama at http://localhost:11434, no API key required.
 * Pass provider: "openai" | "anthropic" with the matching API key to use a cloud model.
 */

import { fetchAndParse } from './_fetchAndParse.js';
// D1.3: SamplingClient for MCP sampling fallback (lazy — only imported if needed)
let _SamplingClient = null;
async function getSamplingClient() {
  if (!_SamplingClient) {
    const mod = await import('../../core/SamplingClient.js');
    _SamplingClient = mod.SamplingClient;
  }
  return _SamplingClient;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_INPUT_CHARS = 50_000;

const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';
const ANTHROPIC_DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const OLLAMA_DEFAULT_MODEL = 'llama3.2';

// Support test-time overrides so the test suite can stub endpoints.
function openaiBaseUrl() {
  return (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '');
}
function anthropicBaseUrl() {
  return (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
}
function ollamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve which provider to use.
 * @param {'openai'|'anthropic'|'ollama'|'auto'} provider
 * @returns {{ provider: 'openai'|'anthropic'|'ollama', apiKey: string|null }}
 */
function resolveProvider(provider) {
  if (provider === 'auto' || provider === 'ollama') {
    // Local Ollama is the default. No API key required; OLLAMA_BASE_URL is
    // an optional override (defaults to http://localhost:11434).
    return { provider: 'ollama', apiKey: null };
  }

  if (provider === 'anthropic') {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) throw new Error('extract_with_llm: ANTHROPIC_API_KEY is not set');
    return { provider: 'anthropic', apiKey: anthropicKey };
  }

  if (provider === 'openai') {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) throw new Error('extract_with_llm: OPENAI_API_KEY is not set');
    return { provider: 'openai', apiKey: openaiKey };
  }

  throw new Error(`extract_with_llm: unknown provider "${provider}"`);
}

/**
 * Build the user message text that goes to the LLM.
 * C3: also returns truncation metadata so the caller can surface it.
 * @returns {{ userMessage: string, truncated: boolean, original_length: number }}
 */
function buildUserMessage(userPrompt, text, schema) {
  const original_length = text.length;
  const truncated = original_length > MAX_INPUT_CHARS;
  const body = truncated ? text.slice(0, MAX_INPUT_CHARS) + '\n[...truncated]' : text;
  let msg = `Extraction instruction: ${userPrompt}\n\n`;
  if (schema && Object.keys(schema).length > 0) {
    msg += `Output schema hint:\n${JSON.stringify(schema, null, 2)}\n\n`;
  }
  msg += `Web page content:\n${body}\n\nReturn only valid JSON.`;
  return { userMessage: msg, truncated, original_length };
}

/**
 * Parse JSON from an LLM response string defensively.
 * Strips markdown code fences if present.
 * C3: if the stripped string is not a full JSON document, locate the first
 * embedded JSON object or array and try to parse that substring.
 * Returns parsed object or throws.
 */
function parseJson(raw) {
  // Strip markdown fences
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  // Fast path: well-formed JSON
  try {
    return JSON.parse(stripped);
  } catch (_) {
    // Fall through to substring recovery
  }

  // C3: locate the first JSON object or array in the string
  const objStart = stripped.indexOf('{');
  const arrStart = stripped.indexOf('[');
  const start = objStart === -1 ? arrStart :
                arrStart === -1 ? objStart :
                Math.min(objStart, arrStart);
  if (start !== -1) {
    const slice = stripped.slice(start);
    return JSON.parse(slice);
  }

  // Re-throw the original parse error with the full content
  throw new SyntaxError(`No JSON found in LLM response: ${stripped.slice(0, 200)}`);
}

// ── OpenAI call ───────────────────────────────────────────────────────────────

async function callOpenAI({ apiKey, model, systemMessage, userMessage, maxTokens }) {
  const url = `${openaiBaseUrl()}/v1/chat/completions`;
  const body = {
    model,
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage }
    ],
    max_tokens: maxTokens,
    response_format: { type: 'json_object' }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000)
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OpenAI API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const json = await response.json();
  const content = json.choices?.[0]?.message?.content ?? '';
  const usage = {
    input_tokens: json.usage?.prompt_tokens ?? 0,
    output_tokens: json.usage?.completion_tokens ?? 0
  };
  return { rawText: content, usage, model: json.model || model };
}

// ── Anthropic call ────────────────────────────────────────────────────────────

async function callAnthropic({ apiKey, model, systemMessage, userMessage, maxTokens }) {
  const url = `${anthropicBaseUrl()}/v1/messages`;
  const body = {
    model,
    system: systemMessage,
    messages: [{ role: 'user', content: userMessage }],
    max_tokens: maxTokens
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000)
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Anthropic API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const json = await response.json();
  const content = json.content?.[0]?.text ?? '';
  const usage = {
    input_tokens: json.usage?.input_tokens ?? 0,
    output_tokens: json.usage?.output_tokens ?? 0
  };
  return { rawText: content, usage, model: json.model || model };
}

// ── Ollama call ───────────────────────────────────────────────────────────────

async function callOllama({ model, systemMessage, userMessage, maxTokens, schema }) {
  const url = `${ollamaBaseUrl()}/api/chat`;
  const body = {
    model,
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage }
    ],
    stream: false,
    options: { num_predict: maxTokens, temperature: 0 },
    format: (schema && Object.keys(schema).length > 0) ? schema : 'json'
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000)
    });
  } catch (err) {
    const code = err?.cause?.code;
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || /ECONNREFUSED|ENOTFOUND|fetch failed/i.test(err.message || '')) {
      throw new Error(
        `Ollama is not running at ${ollamaBaseUrl()}. ` +
        `Start it with "ollama serve" and pull a model: "ollama pull ${model}".`
      );
    }
    throw err;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    if (response.status === 404 && /model.*not found|pull/i.test(errText)) {
      throw new Error(
        `Ollama model "${model}" is not pulled. Run: "ollama pull ${model}"`
      );
    }
    throw new Error(`Ollama API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const json = await response.json();
  const content = json.message?.content ?? '';
  const usage = {
    input_tokens: json.prompt_eval_count ?? 0,
    output_tokens: json.eval_count ?? 0
  };
  return { rawText: content, usage, model: json.model || model };
}

// ── LLM dispatch ─────────────────────────────────────────────────────────────

async function callLLM({ provider, apiKey, model, systemMessage, userMessage, maxTokens, schema }) {
  if (provider === 'openai') {
    return callOpenAI({ apiKey, model, systemMessage, userMessage, maxTokens });
  }
  if (provider === 'ollama') {
    return callOllama({ model, systemMessage, userMessage, maxTokens, schema });
  }
  return callAnthropic({ apiKey, model, systemMessage, userMessage, maxTokens });
}

// ── Tool class ────────────────────────────────────────────────────────────────

export class ExtractWithLlm {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * Execute LLM-powered extraction.
   * @param {Object} params
   * @param {string}  [params.url]       - URL to fetch (one of url/content required)
   * @param {string}  [params.content]   - Pre-fetched text content
   * @param {string}   params.prompt     - Natural-language extraction instruction
   * @param {Object}  [params.schema]    - Optional JSON-schema-like output hint
   * @param {string}  [params.provider]  - 'openai' | 'anthropic' | 'auto'
   * @param {string}  [params.model]     - Override default model
   * @param {number}  [params.maxTokens] - Max output tokens (default 4096)
   * @returns {Promise<Object>}
   */
  async execute(params) {
    const {
      url,
      content,
      prompt,
      schema,
      provider: providerParam = 'auto',
      model: modelParam,
      maxTokens = 4096
    } = params;

    // Validate: exactly one of url or content must be provided
    if (!url && !content) {
      return {
        success: false,
        error: 'extract_with_llm: either "url" or "content" must be provided'
      };
    }
    if (!prompt) {
      return { success: false, error: 'extract_with_llm: "prompt" is required' };
    }

    // Resolve provider + API key (throws clearly if neither key is set)
    let resolved;
    try {
      resolved = resolveProvider(providerParam);
    } catch (err) {
      return { success: false, error: err.message };
    }

    const { provider, apiKey } = resolved;
    const defaultModel =
      provider === 'openai' ? OPENAI_DEFAULT_MODEL :
      provider === 'ollama' ? (process.env.OLLAMA_DEFAULT_MODEL || OLLAMA_DEFAULT_MODEL) :
      ANTHROPIC_DEFAULT_MODEL;
    const model = modelParam || defaultModel;

    // Step 1: Get text to extract from
    let text;
    try {
      if (url) {
        const { textContent } = await fetchAndParse(url);
        text = textContent;
      } else {
        text = content;
      }
    } catch (fetchErr) {
      return { success: false, error: `Failed to fetch content: ${fetchErr.message}` };
    }

    const systemMessage =
      'You extract structured data from web content per the user\'s instructions. Return JSON only.';

    const { userMessage, truncated: inputTruncated, original_length } = buildUserMessage(prompt, text, schema);

    // Step 2: First LLM call — with sampling fallback for 'auto' provider
    // Fallback chain: Ollama → API key (handled by resolveProvider) → sampling → error
    let rawText, usage, resolvedModel = model;
    try {
      ({ rawText, usage } = await callLLM({
        provider, apiKey, model, systemMessage, userMessage, maxTokens, schema
      }));
    } catch (llmErr) {
      // D1.3: If provider is 'auto'/'ollama' and it failed, try MCP sampling as final fallback
      if (providerParam === 'auto' || providerParam === 'ollama') {
        try {
          const SamplingClient = await getSamplingClient();
          const samplingClient = new SamplingClient();
          const { text: sampledText } = await samplingClient.complete(
            `${systemMessage}\n\n${userMessage}`,
            { maxTokens }
          );
          rawText = sampledText;
          usage = { input_tokens: 0, output_tokens: 0 };
          resolvedModel = 'sampling';
        } catch (samplingErr) {
          return { success: false, error: `LLM call failed: ${llmErr.message}. Sampling fallback also failed: ${samplingErr.message}` };
        }
      } else {
        return { success: false, error: `LLM call failed: ${llmErr.message}` };
      }
    }

    // Step 3: Parse JSON; retry once with stricter prompt if it fails
    let parsed;
    try {
      parsed = parseJson(rawText);
    } catch (_parseErr) {
      // Retry with stricter instruction
      const retryUserMessage =
        `${userMessage}\n\nIMPORTANT: Your previous response was not valid JSON. ` +
        'Respond with ONLY a JSON object or array. No explanation, no markdown fences.';
      let retryRaw, retryUsage;
      try {
        ({ rawText: retryRaw, usage: retryUsage } = await callLLM({
          provider, apiKey, model, systemMessage,
          userMessage: retryUserMessage, maxTokens, schema
        }));
        // Merge usage
        usage = {
          input_tokens: usage.input_tokens + retryUsage.input_tokens,
          output_tokens: usage.output_tokens + retryUsage.output_tokens
        };
      } catch (retryLlmErr) {
        return { success: false, error: `LLM retry call failed: ${retryLlmErr.message}` };
      }

      try {
        parsed = parseJson(retryRaw);
      } catch (_retryParseErr) {
        return {
          success: false,
          error: 'LLM did not return valid JSON after retry',
          raw: retryRaw.slice(0, 500)
        };
      }
    }

    // C3: surface truncation metadata so callers know the input was clipped
    const result = {
      success: true,
      data: parsed,
      provider: resolvedModel === 'sampling' ? 'sampling' : provider,
      model: resolvedModel || model,
      usage
    };
    if (inputTruncated) {
      result.truncated = true;
      result.original_length = original_length;
    }
    return result;
  }
}

export default ExtractWithLlm;
