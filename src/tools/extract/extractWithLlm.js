/**
 * Extract With LLM MCP Tool
 * Natural-language extraction powered by OpenAI or Anthropic.
 * Mirrors ScrapeGraphAI positioning: describe what you want, get structured JSON back.
 *
 * Requires OPENAI_API_KEY or ANTHROPIC_API_KEY in environment.
 * Gate: tool throws a clear error when neither key is present.
 */

import { fetchAndParse } from './_fetchAndParse.js';

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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve which provider to use.
 * @param {'openai'|'anthropic'|'auto'} provider
 * @returns {{ provider: 'openai'|'anthropic', apiKey: string }}
 */
function resolveProvider(provider) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (provider === 'auto') {
    if (anthropicKey) return { provider: 'anthropic', apiKey: anthropicKey };
    if (openaiKey) return { provider: 'openai', apiKey: openaiKey };
    throw new Error(
      'extract_with_llm requires OPENAI_API_KEY or ANTHROPIC_API_KEY in environment'
    );
  }

  if (provider === 'anthropic') {
    if (!anthropicKey) throw new Error('extract_with_llm: ANTHROPIC_API_KEY is not set');
    return { provider: 'anthropic', apiKey: anthropicKey };
  }

  if (provider === 'openai') {
    if (!openaiKey) throw new Error('extract_with_llm: OPENAI_API_KEY is not set');
    return { provider: 'openai', apiKey: openaiKey };
  }

  throw new Error(`extract_with_llm: unknown provider "${provider}"`);
}

/**
 * Build the user message text that goes to the LLM.
 */
function buildUserMessage(userPrompt, text, schema) {
  const truncated = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) + '\n[...truncated]' : text;
  let msg = `Extraction instruction: ${userPrompt}\n\n`;
  if (schema && Object.keys(schema).length > 0) {
    msg += `Output schema hint:\n${JSON.stringify(schema, null, 2)}\n\n`;
  }
  msg += `Web page content:\n${truncated}\n\nReturn only valid JSON.`;
  return msg;
}

/**
 * Parse JSON from an LLM response string defensively.
 * Strips markdown code fences if present.
 * Returns parsed object or throws.
 */
function parseJson(raw) {
  // Strip markdown fences
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  return JSON.parse(stripped);
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

// ── LLM dispatch ─────────────────────────────────────────────────────────────

async function callLLM({ provider, apiKey, model, systemMessage, userMessage, maxTokens }) {
  if (provider === 'openai') {
    return callOpenAI({ apiKey, model, systemMessage, userMessage, maxTokens });
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
    const defaultModel = provider === 'openai' ? OPENAI_DEFAULT_MODEL : ANTHROPIC_DEFAULT_MODEL;
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

    const userMessage = buildUserMessage(prompt, text, schema);

    // Step 2: First LLM call
    let rawText, usage;
    try {
      ({ rawText, usage } = await callLLM({
        provider, apiKey, model, systemMessage, userMessage, maxTokens
      }));
    } catch (llmErr) {
      return { success: false, error: `LLM call failed: ${llmErr.message}` };
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
          userMessage: retryUserMessage, maxTokens
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

    return {
      success: true,
      data: parsed,
      provider,
      model,
      usage
    };
  }
}

export default ExtractWithLlm;
