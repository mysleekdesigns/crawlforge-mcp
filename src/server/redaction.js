/**
 * redaction — the one declaration (G5) of `redact_pii`: the parameter, the
 * entity and style enums, the per-tool text paths, the credit rule and the
 * stage that applies it (Phase 5, 5.3).
 *
 * Nothing in this server scrubbed personal data out of the page text it hands
 * back. `secretMask.js` covered API keys and tokens in our own LOG lines and
 * nothing else, so a support inbox, a staff phone list or a checkout form's
 * card number travelled straight into the caller's context window. `redact_pii`
 * closes that: opt-in, off by default, and priced at nothing for the regex pass.
 *
 * Applied by withAuth after a successful handler run and BEFORE the
 * inline-threshold stage stores the result. That order is the whole point: a
 * result stored unredacted would be served back verbatim by `read_result`,
 * which is exactly the hole this exists to close.
 *
 * Two passes:
 *
 *   fast (default, 0 credits) — `redactPii` from crawlforge-extractors: pure
 *     regex over EMAIL, PHONE, FINANCIAL and SECRET, deterministic, no network.
 *   model (opt-in, +3 credits once per call) — an Ollama-first NER pass for
 *     PERSON and LOCATION, which no regex can decide. The regex pass ALWAYS
 *     runs first and the model only adds to it. G3: the model identifies
 *     spans, this module replaces them, and a span the model invented — one
 *     that is not present verbatim in the input — is discarded. The text it
 *     reads is fenced by `fenceUntrusted` and is already regex-redacted, so
 *     the fence never wraps unredacted text.
 *
 * An `entities` name the chosen mode cannot serve is a validation error, not
 * a silent omission — see `entityNameIssue`. Asking for a class and being
 * handed a page that still contains it is the failure this feature exists to
 * prevent, so the schema refuses before anything is fetched, at no charge.
 *
 * The model pass is bounded by wall clock and by cost, not by taste: it runs
 * once per TEXT, not once per call, so a 50-URL batch_scrape left unbounded
 * would outlive any client's patience and — where the SamplingClient chain
 * reaches a server-side API key rather than local Ollama — spend real money
 * against a single +3 surcharge. Three caps, so the exposure of one call is a
 * fixed number: at most MODEL_TEXT_CHARS of any one text, MODEL_BUDGET_CHARS
 * across the call, and MODEL_MAX_PASSES completions. A warning says when any
 * of them bit.
 *
 * Known limit, stated rather than hidden: `scrape`'s own query-scoped formats
 * (`highlights`/`question` with `mode: "model"`, Phase 1) run their model step
 * INSIDE the handler, before this stage, so those prompts see the page text as
 * fetched. Everything that leaves the server is redacted; that one internal
 * prompt is not. Closing it means redacting inside unifiedScrape as well,
 * which would put the application logic in two places.
 */

import { z } from 'zod';
import {
  redactPii,
  REGEX_ENTITIES,
  MODEL_ONLY_ENTITIES,
  DEFAULT_REPLACE_STYLE
} from 'crawlforge-extractors';
import { fenceUntrusted } from '../utils/untrustedContent.js';

/** What the model-backed PERSON/LOCATION pass adds to a call's price. */
export const REDACT_PII_MODEL_CREDITS = 3;

/** How much of any one text the model pass reads (summarizeContent's cap). */
const MODEL_TEXT_CHARS = 12000;

/** How much text the model pass reads across a whole call. */
const MODEL_BUDGET_CHARS = 60000;

/**
 * How many completions the model pass may make in one call. Derived, not
 * chosen: it is what the character budget already allows at full size, so a
 * result made of many SHORT texts (a 50-URL batch_scrape) cannot turn one
 * +3 surcharge into fifty round-trips.
 */
const MODEL_MAX_PASSES = MODEL_BUDGET_CHARS / MODEL_TEXT_CHARS;

/** Every entity name the public parameter accepts. */
export const REDACT_PII_ENTITIES = Object.freeze([...REGEX_ENTITIES, ...MODEL_ONLY_ENTITIES]);

/** The tag names this module writes, so a model can never re-redact one. */
const TAG_NAMES = new Set([...REDACT_PII_ENTITIES, 'REDACTED']);

/**
 * Why an entity name this mode cannot serve is REJECTED rather than dropped.
 *
 * `redactPii` drops a name it does not handle in silence, and it is right to:
 * a library has no channel to tell a caller anything. A tool does. Under a
 * lenient rule `entities: ["EMAIL", "PERSON"]` with the default `fast` mode
 * returns a page with every personal name still in it, plus a redaction
 * report listing only the emails — a partial version of the exact failure
 * this feature exists to prevent, with no signal that half the request was
 * ignored. So the schema refuses it, before anything is fetched and at no
 * charge, and says which of the two things went wrong.
 *
 * @param {string} name as the caller wrote it
 * @param {unknown} mode the call's `mode`
 * @returns {string|null} the validation message, or null when the name is fine
 */
function entityNameIssue(name, mode) {
  const upper = typeof name === 'string' ? name.toUpperCase() : '';
  if (REGEX_ENTITIES.includes(upper)) return null;
  if (MODEL_ONLY_ENTITIES.includes(upper)) {
    if (mode === 'model') return null;
    return `${MODEL_ONLY_ENTITIES.join(' and ')} need mode: "model" — no regex can decide them. Add mode:"model" (+${REDACT_PII_MODEL_CREDITS} credits once per call) or drop "${name}"`;
  }
  return `unknown entity name "${name}" — expected one of ${REGEX_ENTITIES.join(', ')}, or ${MODEL_ONLY_ENTITIES.join('/')} with mode:"model"`;
}

/** The object form of `redact_pii`; names are matched case-insensitively. */
const RedactPiiOptionsSchema = z.object({
  entities: z.array(z.string()).optional().describe(`Which classes to redact, case-insensitive: ${REGEX_ENTITIES.join(', ')}, plus ${MODEL_ONLY_ENTITIES.join(' and ')} when mode is "model". Omitted or empty means all four regex classes (and both model classes in "model" mode). An unknown name, or a model-only name without mode:"model", is rejected`),
  replace_style: z.enum(['tag', 'mask', 'remove']).optional().describe('"tag" (default) writes <EMAIL>, "mask" writes [REDACTED], "remove" deletes the value'),
  mode: z.enum(['fast', 'model']).optional().describe('"fast" (default) is regex only and free; "model" adds an Ollama NER pass for PERSON and LOCATION (+3 credits once per call)')
}).superRefine((value, ctx) => {
  if (!Array.isArray(value.entities)) return;
  value.entities.forEach((name, index) => {
    const message = entityNameIssue(name, value.mode);
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['entities', index], message });
  });
});

/**
 * The public parameter, with the text the client sees. Spread into the input
 * schema of each tool in REDACTION_TOOLS.
 */
export const REDACT_PII_PARAM = {
  redact_pii: z.union([
    z.boolean(),
    RedactPiiOptionsSchema
  ]).optional().describe('Redact personal data from the text this call returns, before it reaches your context window. true means the free regex pass over EMAIL, PHONE, FINANCIAL and SECRET. The result carries redaction:{entities,count}. Default: off')
};

/**
 * Where each tool keeps the text a redaction must cover. `[]` walks an array.
 * Every path listed is redacted, not just the first one that matches — a
 * single unredacted copy (extract_content's `readability.textContent`, say)
 * would defeat the whole feature.
 */
export const REDACTION_TOOLS = Object.freeze({
  scrape: [
    'content.markdown', 'content.text', 'content.html', 'content.rawHtml',
    'content.highlights[].text', 'content.answer.text', 'content.answer.evidence[].text'
  ],
  extract_content: [
    'content.text', 'content.html', 'content.markdown', 'content.cleanedHTML',
    'readability.content', 'readability.textContent', 'readability.excerpt'
  ],
  extract_text: ['text', 'markdown'],
  batch_scrape: ['results[].content.text', 'results[].content.html', 'results[].content.markdown'],
  crawl_deep: ['results[].content'],
  stealth_mode: ['content.text', 'content.html', 'content.markdown'],
  scrape_with_actions: ['content.text', 'content.html', 'content.markdown'],
  process_document: ['content.text', 'content.html', 'content.extractedContent'],
  search_web: [
    'results[].snippet', 'results[].htmlSnippet',
    'results_by_query[].results[].snippet', 'results_by_query[].results[].htmlSnippet'
  ]
});

/**
 * Normalise the raw `redact_pii` param into what the two passes need, or null
 * when redaction is off. Reads the RAW value — getToolCost runs before
 * validation and this is the same declaration it prices from — so anything
 * that is neither `true` nor a plain object means off.
 *
 * An absent or empty `entities` means everything the chosen mode can do. An
 * explicit list is honoured exactly: names a regex can decide go to
 * `redactPii`, and PERSON/LOCATION go to the model pass.
 *
 * This is the TOLERANT layer, deliberately. `RedactPiiOptionsSchema` has
 * already rejected an unknown name, and a model-only name outside `model`
 * mode, at no charge — but this function also runs on unvalidated params
 * (getToolCost, and a REST proxy request that arrives pre-validated by the
 * website), so it must resolve rather than throw. Where the strict schema
 * would have refused, this resolves to a selection that redacts nothing by
 * regex, and `applyRedaction` honours that rather than falling back to all.
 *
 * @param {unknown} raw
 * @returns {{ entities: string[], modelEntities: string[], replaceStyle: string, mode: 'fast'|'model' } | null}
 */
export function resolveRedaction(raw) {
  if (raw !== true && (raw === null || typeof raw !== 'object' || Array.isArray(raw))) return null;
  const options = raw === true ? {} : raw;

  const mode = options.mode === 'model' ? 'model' : 'fast';
  const replaceStyle = ['tag', 'mask', 'remove'].includes(options.replace_style)
    ? options.replace_style
    : DEFAULT_REPLACE_STYLE;

  const asked = Array.isArray(options.entities) && options.entities.length > 0
    ? options.entities.filter((name) => typeof name === 'string').map((name) => name.toUpperCase())
    : [...REGEX_ENTITIES, ...MODEL_ONLY_ENTITIES];

  return {
    entities: REGEX_ENTITIES.filter((name) => asked.includes(name)),
    modelEntities: mode === 'model' ? MODEL_ONLY_ENTITIES.filter((name) => asked.includes(name)) : [],
    replaceStyle,
    mode
  };
}

/**
 * What redaction adds to a tool's price: nothing for the regex pass, and the
 * model pass's own 3 once per call. Charged once rather than per page for the
 * same reason `batch_scrape` and `crawl_deep` are priced flat — the page count
 * is not knowable before the call, and a projection scaled by `max_pages`
 * would have the credit check reject an ordinary crawl. Projected is the
 * ceiling (G4); withAuth drops it when no model completed.
 *
 * @param {string} toolName
 * @param {object} [params] the call's raw params
 * @returns {0 | 3}
 */
export function redactionSurcharge(toolName, params) {
  if (!(toolName in REDACTION_TOOLS)) return 0;
  const resolved = resolveRedaction(params?.redact_pii);
  return resolved && resolved.modelEntities.length > 0 ? REDACT_PII_MODEL_CREDITS : 0;
}

// ── Text routing ─────────────────────────────────────────────────────────────

/** "results[].content.text" -> ["results", "[]", "content", "text"]. */
function segmentsOf(path) {
  const segments = [];
  for (const part of path.split('.')) {
    if (part.endsWith('[]')) {
      segments.push(part.slice(0, -2), '[]');
    } else {
      segments.push(part);
    }
  }
  return segments;
}

/** Every string the path reaches, each with the setter that writes it back. */
function collectAt(node, segments, found) {
  if (node === null || typeof node !== 'object') return;
  const [head, ...rest] = segments;

  if (head === '[]') {
    if (!Array.isArray(node)) return;
    for (let i = 0; i < node.length; i++) {
      if (rest.length === 0) {
        if (typeof node[i] === 'string') found.push({ text: node[i], set: (v) => { node[i] = v; } });
      } else {
        collectAt(node[i], rest, found);
      }
    }
    return;
  }

  if (Array.isArray(node)) return;
  if (rest.length === 0) {
    if (typeof node[head] === 'string') found.push({ text: node[head], set: (v) => { node[head] = v; } });
    return;
  }
  collectAt(node[head], rest, found);
}

/**
 * @param {object} resultObject
 * @param {string[]} paths
 * @returns {Array<{ text: string, set: (value: string) => void }>}
 */
export function collectTexts(resultObject, paths) {
  const found = [];
  for (const path of paths) collectAt(resultObject, segmentsOf(path), found);
  return found;
}

// ── The model pass ───────────────────────────────────────────────────────────

/**
 * Parse the model's reply into the spans it claims. A line the model wrote
 * that is not present verbatim in the text is dropped: the model identifies,
 * it never rewrites (G3).
 *
 * @param {string} reply
 * @param {string} text the text the model read
 * @param {string[]} wanted the entity names asked for
 * @returns {Array<{ start: number, end: number, entity: string }>}
 */
export function spansFromReply(reply, text, wanted) {
  if (typeof reply !== 'string') return [];
  const spans = [];
  for (const line of reply.split('\n')) {
    const match = /^\s*(?:[-*]\s*)?(PERSON|LOCATION)\s*[:\-]\s*(.+?)\s*$/i.exec(line);
    if (!match) continue;
    const entity = match[1].toUpperCase();
    if (!wanted.includes(entity)) continue;
    const value = match[2].replace(/^["'`]|["'`]$/g, '').trim();
    if (value.length < 2 || TAG_NAMES.has(value.toUpperCase())) continue;

    let from = 0;
    for (;;) {
      const at = text.indexOf(value, from);
      if (at === -1) break;
      spans.push({ start: at, end: at + value.length, entity });
      from = at + value.length;
    }
  }
  // Longest first, so an overlap resolves in favour of the fuller name.
  spans.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const accepted = [];
  for (const span of spans) {
    if (accepted.some((other) => span.start < other.end && other.start < span.end)) continue;
    accepted.push(span);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

function replacementFor(entity, style) {
  if (style === 'mask') return '[REDACTED]';
  if (style === 'remove') return '';
  return `<${entity}>`;
}

/** Rebuild `text` with the accepted spans replaced; counts them by entity. */
function applySpans(text, spans, style, counts) {
  let out = '';
  let cursor = 0;
  for (const span of spans) {
    out += text.slice(cursor, span.start) + replacementFor(span.entity, style);
    counts[span.entity] = (counts[span.entity] || 0) + 1;
    cursor = span.end;
  }
  return out + text.slice(cursor);
}

const PROMPT_SYSTEM = 'You mark personal names and place names in text quoted from a web page. ' +
  'Reply with one entry per line, each "PERSON: <text>" or "LOCATION: <text>", copying the text exactly as it appears. ' +
  'Do not translate, shorten or correct it. If there are none, reply NONE. No other output.';

/**
 * One completion for one text. Returns the reply, or throws — the caller
 * treats a throw as "no LLM route", drops the surcharge and warns.
 * @param {(prompt: string, options: object) => Promise<{ text: string }>} complete
 */
async function askModel(complete, text, wanted) {
  const { text: reply } = await complete(
    `${fenceUntrusted(text, 'page text')}\nList every ${wanted.join(' and ')} in the text above.`,
    { maxTokens: 512, systemPrompt: PROMPT_SYSTEM }
  );
  return reply;
}

// ── The stage ────────────────────────────────────────────────────────────────

/**
 * Redact a tool result in place.
 *
 * @param {string} toolName
 * @param {object} resultObject the parsed JSON result; mutated
 * @param {object} params the call's params
 * @param {{ complete?: (prompt: string, options: object) => Promise<{ text: string }> }} deps
 * @returns {Promise<{ redacted: boolean, modelRan: boolean }>}
 */
export async function applyRedaction(toolName, resultObject, params, { complete } = {}) {
  const paths = REDACTION_TOOLS[toolName];
  const resolved = resolveRedaction(params?.redact_pii);
  if (!paths || !resolved) return { redacted: false, modelRan: false };
  if (!resultObject || typeof resultObject !== 'object' || Array.isArray(resultObject)) {
    return { redacted: false, modelRan: false };
  }

  const targets = collectTexts(resultObject, paths);
  const counts = {};
  const warnings = [];

  // Skip the regex pass entirely when the caller's selection left it nothing
  // to do (`entities: ['PERSON']`). `redactPii` reads an EMPTY array as "all
  // four", so passing one through would redact everything a caller who asked
  // for one model-only class never asked to lose.
  if (resolved.entities.length > 0) {
    for (const target of targets) {
      const { text, redaction } = redactPii(target.text, {
        entities: resolved.entities,
        replaceStyle: resolved.replaceStyle
      });
      for (const [entity, n] of Object.entries(redaction.entities)) counts[entity] = (counts[entity] || 0) + n;
      // What the model pass reads, so the fence never wraps unredacted text.
      target.text = text;
      target.set(text);
    }
  }

  let modelRan = false;
  if (resolved.modelEntities.length > 0 && typeof complete === 'function') {
    let budget = MODEL_BUDGET_CHARS;
    let capped = false;
    let failure = null;

    let passes = 0;
    for (const target of targets) {
      const live = target.text; // the regex-redacted copy
      if (budget <= 0 || passes >= MODEL_MAX_PASSES) { capped = true; break; }
      const slice = live.slice(0, Math.min(MODEL_TEXT_CHARS, budget));
      if (slice.length === 0) continue;
      if (slice.length < live.length) capped = true;
      budget -= slice.length;
      passes++;

      let reply;
      try {
        reply = await askModel(complete, slice, resolved.modelEntities);
      } catch (error) {
        failure = error;
        break;
      }
      modelRan = true;
      const spans = spansFromReply(reply, slice, resolved.modelEntities);
      if (spans.length === 0) continue;
      target.set(applySpans(slice, spans, resolved.replaceStyle, counts) + live.slice(slice.length));
    }

    if (failure && !modelRan) {
      warnings.push(`redact_pii: no model answered, so ${resolved.modelEntities.join(' and ')} were not redacted (${failure.message}); the model surcharge was not charged`);
    } else if (failure) {
      warnings.push(`redact_pii: the model pass stopped early (${failure.message}); the text it did not reach carries the regex redactions only`);
    }
    if (capped) {
      warnings.push(`redact_pii: the model pass read at most ${MODEL_TEXT_CHARS} characters per text, ${MODEL_BUDGET_CHARS} in total and ${MODEL_MAX_PASSES} texts; text beyond that carries the regex redactions only`);
    }
  }

  const count = Object.values(counts).reduce((sum, n) => sum + n, 0);
  resultObject.redaction = {
    entities: counts,
    count,
    mode: resolved.mode,
    ...(resolved.modelEntities.length > 0 ? { model_ran: modelRan } : {})
  };

  // The query-scoped formats index the markdown by offset. Redaction changes
  // its length, so say so rather than let the caller trust a stale offset.
  if (count > 0 && resultObject.content && (resultObject.content.highlights || resultObject.content.answer)) {
    warnings.push('redact_pii: highlight and evidence offsets index the text as it was before redaction');
  }

  if (warnings.length > 0) {
    resultObject.warnings = [
      ...(Array.isArray(resultObject.warnings) ? resultObject.warnings : []),
      ...warnings
    ];
  }

  return { redacted: true, modelRan };
}

/**
 * The redaction stage as withAuth uses it: a SamplingClient-backed `complete`
 * built only when a model pass was actually asked for, so an ordinary call
 * never loads the client.
 *
 * @param {string} toolName
 * @param {object} resultObject
 * @param {object} params
 * @param {{ mcpServer?: object|null }} [deps]
 */
export async function runRedactionStage(toolName, resultObject, params, { mcpServer = null } = {}) {
  const resolved = resolveRedaction(params?.redact_pii);
  const complete = resolved && resolved.modelEntities.length > 0
    ? async (prompt, options) => {
      const { SamplingClient } = await import('../core/SamplingClient.js');
      return new SamplingClient({ mcpServer }).complete(prompt, options);
    }
    : undefined;
  return applyRedaction(toolName, resultObject, params, { complete });
}
