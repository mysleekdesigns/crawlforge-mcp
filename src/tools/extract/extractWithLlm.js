/**
 * Extract With LLM MCP Tool
 * Natural-language extraction powered by a local Ollama model (default) or
 * a cloud provider (OpenAI / Anthropic, explicit opt-in).
 *
 * Default: provider 'auto' → Ollama at http://localhost:11434, no API key required.
 * Pass provider: "openai" | "anthropic" with the matching API key to use a cloud model.
 */

import { z } from 'zod';
import { fetchAndParse } from './_fetchAndParse.js';
import { ollamaBaseUrl, ollamaHeaders, selectOllamaModel } from '../../utils/ollamaConfig.js';
import { verifyNumericProvenance } from '../../utils/provenance.js';
import { extractionFormat } from '../../utils/extractionFormat.js';
import { fenceUntrusted } from '../../utils/untrustedContent.js';
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

// Support test-time overrides so the test suite can stub endpoints.
function openaiBaseUrl() {
  return (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '');
}
function anthropicBaseUrl() {
  return (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
}
// Base URL + optional OLLAMA_API_KEY bearer auth (Ollama Cloud / proxied
// instances) come from the shared config.

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
  // Fenced: the page decides this text, and un-fenced it sat at the same level
  // as the extraction instruction above it.
  msg += `${fenceUntrusted(body)}\nReturn only valid JSON.`;
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

  // C3: locate the first *balanced* JSON object or array embedded in the
  // string — tolerant of prose both before and after the JSON.
  const balanced = extractBalancedJson(stripped);
  if (balanced !== null) {
    return JSON.parse(balanced);
  }

  // Re-throw the original parse error with the full content
  throw new SyntaxError(`No JSON found in LLM response: ${stripped.slice(0, 200)}`);
}

/**
 * Scan a string for the first balanced JSON object or array, respecting string
 * literals and escapes so braces inside strings don't unbalance the scan.
 * @returns {string|null} the JSON substring, or null if none is found
 */
function extractBalancedJson(str) {
  const objStart = str.indexOf('{');
  const arrStart = str.indexOf('[');
  const start = objStart === -1 ? arrStart :
                arrStart === -1 ? objStart :
                Math.min(objStart, arrStart);
  if (start === -1) return null;

  const open = str[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return str.slice(start, i + 1);
    }
  }
  return null;
}

// ── Schema handling (C3) ───────────────────────────────────────────────────────

/**
 * Normalize a caller-supplied schema hint into a valid top-level JSON Schema
 * object suitable for Anthropic tool `input_schema`.
 *
 * Accepts either a full JSON Schema (`{ type, properties, ... }`) or a flat
 * field→type-hint map (`{ name: "string", tags: "array" }`), which is wrapped
 * as an object schema.
 */
function buildInputSchema(schema) {
  // Every field nullable, no `required`: the decoder must be allowed to say
  // "not stated" — a required string it cannot leave null becomes an
  // invention (R14: `scrape` json on racket-lang.org answered "Racket 5.1.0"
  // for a page that says 9.3). The caller's schema still drives validation.
  const format = extractionFormat(schema);
  return format === 'json' ? { type: 'object', properties: {}, additionalProperties: true } : format;
}

/**
 * Build a zod validator from a JSON-Schema-like hint. Best-effort: unknown
 * shapes fall back to `z.any()` so validation never rejects on constructs the
 * converter does not understand.
 */
function jsonSchemaToZod(schema) {
  if (!schema || typeof schema !== 'object') return z.any();

  // Flat hint map (no `type`/`properties`) → treat values as field hints.
  const isJsonSchema = schema.type || schema.properties || schema.items;
  if (!isJsonSchema) {
    const shape = {};
    for (const [key, val] of Object.entries(schema)) {
      shape[key] = jsonSchemaToZod(typeof val === 'string' ? { type: val } : val).nullable().optional();
    }
    return z.object(shape).passthrough();
  }

  switch (schema.type) {
    case 'string': return z.string();
    case 'number':
    case 'integer': return z.number();
    case 'boolean': return z.boolean();
    case 'null': return z.null();
    case 'array': return z.array(schema.items ? jsonSchemaToZod(schema.items) : z.any());
    case 'object': {
      const shape = {};
      const required = Array.isArray(schema.required) ? schema.required : [];
      for (const [key, val] of Object.entries(schema.properties || {})) {
        const field = jsonSchemaToZod(val);
        // The model is told to answer null for a field the content never
        // states, so null is the honest answer for a field the schema does
        // not require — not a type violation. A required field stays strict:
        // null there is exactly what the caller needs to hear about.
        shape[key] = required.includes(key) ? field : field.nullable().optional();
      }
      return z.object(shape).passthrough();
    }
    default: return z.any();
  }
}

/** JSON Schema type keywords, used to spot a type declaration posing as a value. */
const SCHEMA_TYPE_KEYWORDS = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);

/**
 * True when the model returned the output schema itself instead of data
 * extracted from the page — e.g. {"type":"object","properties":{"title":{"type":"null"}}}
 * for a schema asking for a title. The schema is embedded in the prompt as an
 * output hint, and on long inputs a model will latch onto it and echo it back.
 *
 * The result is well-formed JSON and, when the caller declared no required
 * fields, it passes schema validation too — so it reaches callers as a
 * successful extraction full of nonsense.
 *
 * @param {*} parsed - Parsed LLM output
 * @param {Object} schema - The schema hint that was sent
 * @returns {boolean}
 */
function looksLikeSchemaEcho(parsed, schema) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  if (!schema || Object.keys(schema).length === 0) return false;

  const requested = new Set(Object.keys(schema.properties || schema));
  const returned = Object.keys(parsed);
  if (returned.length === 0) return false;

  // The whole schema document came back. Only suspicious when the caller did
  // not actually ask for a field named "properties".
  if (parsed.properties && typeof parsed.properties === 'object' && !requested.has('properties')) {
    return true;
  }

  // Every value is a type declaration rather than a value:
  // {"title":{"type":"string"},"price":{"type":"string"}}. A field the caller
  // genuinely declared as an object is exempt, since a nested object result is
  // legitimate there.
  const declarations = returned.filter((key) => {
    const value = parsed[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (!SCHEMA_TYPE_KEYWORDS.has(value.type)) return false;
    const declaredType = schema.properties?.[key]?.type;
    return declaredType !== 'object';
  });
  return declarations.length === returned.length;
}

/**
 * Detect output that parsed cleanly but carries nothing taken from the page —
 * `{}`, `[]`, or a structure whose every leaf is null/blank. A small model that
 * loses the instruction on a long input answers with `{}` and 2 output tokens,
 * which would otherwise reach the caller as a successful extraction of nothing.
 *
 * Recurses through objects and arrays. Numbers and booleans are data at any
 * depth, so `{count: 0}` and `{found: false}` are real results, not emptiness.
 *
 * @param {*} parsed - Parsed LLM output (or any value inside it)
 * @returns {boolean}
 */
function hasNoExtractableData(parsed) {
  if (parsed === null || parsed === undefined) return true;
  if (typeof parsed === 'string') return parsed.trim() === '';
  if (typeof parsed !== 'object') return false;
  // Object.values covers arrays too; an empty object/array vacuously satisfies
  // every(), which is the answer we want.
  return Object.values(parsed).every(hasNoExtractableData);
}

/**
 * Validate parsed output against the schema hint.
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateAgainstSchema(parsed, schema) {
  try {
    const validator = jsonSchemaToZod(schema);
    const result = validator.safeParse(parsed);
    if (result.success) return { valid: true, errors: [] };
    return {
      valid: false,
      errors: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    };
  } catch {
    // Converter failure should not block extraction — treat as unvalidated.
    return { valid: true, errors: [] };
  }
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

async function callAnthropic({ apiKey, model, systemMessage, userMessage, maxTokens, schema }) {
  const url = `${anthropicBaseUrl()}/v1/messages`;
  const useToolUse = schema && Object.keys(schema).length > 0;

  const body = {
    model,
    system: systemMessage,
    messages: [{ role: 'user', content: userMessage }],
    max_tokens: maxTokens
  };

  // C3: when a schema is provided, force structured output via tool-use. The
  // tool's input_schema constrains the model and the tool_use input block is
  // returned as already-valid JSON (no fence-stripping/parsing guesswork).
  if (useToolUse) {
    body.tools = [{
      name: 'extract_data',
      description: 'Return the extracted data conforming to the provided schema.',
      input_schema: buildInputSchema(schema)
    }];
    body.tool_choice = { type: 'tool', name: 'extract_data' };
  }

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
  const usage = {
    input_tokens: json.usage?.input_tokens ?? 0,
    output_tokens: json.usage?.output_tokens ?? 0
  };

  if (useToolUse) {
    // Read the structured input from the tool_use block.
    const toolBlock = (json.content || []).find((b) => b.type === 'tool_use');
    if (toolBlock && toolBlock.input !== undefined) {
      return { rawText: JSON.stringify(toolBlock.input), usage, model: json.model || model };
    }
    // Fall through to text if the model declined to call the tool.
  }

  const content = (json.content || []).find((b) => b.type === 'text')?.text ?? '';
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
    // Normalize the same way the Anthropic branch does — Ollama's `format`
    // needs a valid JSON Schema, not a raw flat field->type-hint map.
    format: (schema && Object.keys(schema).length > 0) ? buildInputSchema(schema) : 'json'
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: ollamaHeaders({ 'Content-Type': 'application/json' }),
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
  return callAnthropic({ apiKey, model, systemMessage, userMessage, maxTokens, schema });
}

// ── Tool class ────────────────────────────────────────────────────────────────

export class ExtractWithLlm {
  constructor(config = {}) {
    this.config = config;
    this._mcpServer = null;
  }

  /** D1.3: Wire MCP server so the sampling fallback can reach the client. */
  setMcpServer(mcpServer) {
    this._mcpServer = mcpServer;
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
   * @param {boolean} [params.respect_robots] - Per-request robots.txt override
   * @param {string}  [params.user_agent]     - Per-request identity override
   * @param {boolean} [params.verify_numbers] - Numeric provenance guard (default true)
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
      maxTokens = 4096,
      respect_robots,
      user_agent,
      verify_numbers = true
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
      // Picks the most accurate model actually installed; OLLAMA_DEFAULT_MODEL
      // still wins when set.
      provider === 'ollama' ? await selectOllamaModel() :
      ANTHROPIC_DEFAULT_MODEL;
    const model = modelParam || defaultModel;

    // Step 1: Get text to extract from
    let text;
    // What the provenance guard checks against. Deliberately wider than what
    // the model is shown: the raw html carries numbers the flattened text does
    // not (Apple's prices exist only inside an embedded JSON blob), and a value
    // missing from `text` but present on the page must not be nulled.
    let sourceForProvenance;
    let fetchWarnings = [];
    try {
      if (url) {
        const { html, textContent, warnings } = await fetchAndParse(url, {
          respectRobots: respect_robots,
          userAgent: user_agent,
          tool: 'extract_with_llm'
        });
        text = textContent;
        sourceForProvenance = `${html}\n${textContent}`;
        fetchWarnings = warnings || [];
      } else {
        text = content;
        sourceForProvenance = content;
      }
    } catch (fetchErr) {
      return { success: false, error: `Failed to fetch content: ${fetchErr.message}` };
    }

    const systemMessage =
      'You extract structured data from web content per the user\'s instructions. Return JSON only. ' +
      'Use null for any field the content does not state — never guess, infer, or fill a value from memory.';

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
          const samplingClient = new SamplingClient({ mcpServer: this._mcpServer });
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

    // Step 3: Parse JSON; retry once with a stricter prompt if the response is
    // unusable. "Unusable" covers unparseable output, a schema echo and an
    // empty result — the latter two parse cleanly but contain no page data.
    let parsed = null;
    let unusableReason = null;
    try {
      parsed = parseJson(rawText);
      if (looksLikeSchemaEcho(parsed, schema)) {
        parsed = null;
        unusableReason = 'echoed the output schema instead of extracting data from the page';
      } else if (hasNoExtractableData(parsed)) {
        parsed = null;
        unusableReason = 'contained no data from the page — every field was empty';
      }
    } catch (_parseErr) {
      unusableReason = 'was not valid JSON';
    }

    if (parsed === null) {
      // Retry with stricter instruction
      const retryUserMessage =
        `${userMessage}\n\nIMPORTANT: Your previous response ${unusableReason}. ` +
        'Respond with ONLY a JSON object or array whose values are data taken from the page content. ' +
        'Never return a JSON Schema. No explanation, no markdown fences.';
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

      if (looksLikeSchemaEcho(parsed, schema)) {
        // Fail loudly. Returning the echo would hand the caller a well-formed
        // object containing nothing from the page.
        return {
          success: false,
          error: 'LLM echoed the output schema instead of extracting data, after retry. ' +
                 'The page text is likely too long or too noisy for this model — try a larger model ' +
                 '(OLLAMA_DEFAULT_MODEL) or narrow the input with onlyMainContent.',
          raw: JSON.stringify(parsed).slice(0, 500)
        };
      }

      if (hasNoExtractableData(parsed)) {
        // Same failure mode as the echo: well-formed JSON with nothing from the
        // page in it. Returning it would read as a successful extraction.
        return {
          success: false,
          error: `LLM (${model}) returned no data from the page after retry — every field was empty. ` +
                 'The page text is likely too long or too noisy for this model — try a larger model ' +
                 '(OLLAMA_DEFAULT_MODEL) or narrow the input with onlyMainContent.',
          raw: JSON.stringify(parsed).slice(0, 500)
        };
      }
    }

    // 3.4: numeric provenance. A number the model wrote that is nowhere in the
    // page it was given was invented, so it comes back null with a reason
    // rather than as a confident answer.
    let provenance = { enabled: false };
    if (verify_numbers) {
      const checked = verifyNumericProvenance(parsed, sourceForProvenance);
      parsed = checked.data;
      provenance = {
        enabled: true,
        verified: checked.verified,
        nulled: checked.nulled,
        unverified: checked.unverified
      };
      if (checked.skipped) provenance.skipped = checked.skipped;
    }

    // C3: surface truncation metadata so callers know the input was clipped
    const result = {
      success: true,
      data: parsed,
      provenance,
      provider: resolvedModel === 'sampling' ? 'sampling' : provider,
      model: resolvedModel || model,
      usage
    };
    if (inputTruncated) {
      result.truncated = true;
      result.original_length = original_length;
    }
    if (fetchWarnings.length > 0) result.warnings = fetchWarnings;
    // C3: validate output against the schema hint (zod). Non-fatal — the data
    // is still returned; callers can inspect `valid`/`validationErrors`.
    if (schema && Object.keys(schema).length > 0) {
      const { valid, errors } = validateAgainstSchema(parsed, schema);
      result.valid = valid;
      if (!valid) result.validationErrors = errors;
    }
    return result;
  }
}

export default ExtractWithLlm;
