/**
 * formats.js — the one declaration of what `scrape` can return.
 *
 * The formats enum used to be spelled in server.js, unifiedScrape.js and
 * toolOutputSchemas.js separately, so a format added to one copy shipped a
 * schema that did not describe the tool (Phase 0, 0.3). server.js and the
 * output schema import from here; the tool module re-exports.
 *
 * The query-scoped formats (Phase 1) carry their price rule here too, so
 * AuthManager.getToolCost and the tool read the same one.
 */

import { z } from 'zod';

export const SCRAPE_STRING_FORMATS = ['markdown', 'html', 'rawHtml', 'text', 'links', 'metadata', 'screenshot', 'branding'];

export const JsonFormatSchema = z.object({
  type: z.literal('json'),
  schema: z.record(z.any()).optional().describe('JSON schema for extraction'),
  prompt: z.string().optional().describe('Extraction instruction for the LLM')
});

// "extractive" returns page text verbatim and calls no model; "model" lets a
// model choose among (highlights) or answer from (question) the extractive
// units, and is priced separately.
const QueryModeSchema = z.enum(['extractive', 'model']).optional().default('extractive')
  .describe('"extractive" (default) returns verbatim page text, no model; "model" adds an LLM step (+3 credits)');

export const HighlightsFormatSchema = z.object({
  type: z.literal('highlights'),
  query: z.string().min(1).max(500).describe('What to look for; the matching sentences, table rows and code blocks come back verbatim with offsets into the markdown'),
  max_highlights: z.number().int().min(1).max(50).optional().default(10).describe('How many units to return (default 10)'),
  mode: QueryModeSchema
});

export const QuestionFormatSchema = z.object({
  type: z.literal('question'),
  question: z.string().min(1).max(500).describe('The question to answer from the page; the evidence units come back verbatim with offsets'),
  mode: QueryModeSchema
});

const OBJECT_FORMAT_SCHEMAS = [JsonFormatSchema, HighlightsFormatSchema, QuestionFormatSchema];

/** The `type` of each object format, in schema order. */
export const SCRAPE_OBJECT_FORMATS = OBJECT_FORMAT_SCHEMAS.map((schema) => schema.shape.type.value);

export const FormatSchema = z.union([
  z.enum(SCRAPE_STRING_FORMATS),
  ...OBJECT_FORMAT_SCHEMAS
]);

const QUERY_FORMATS = new Set(['highlights', 'question']);

/**
 * What the query-scoped formats add to `scrape`'s base price: 1 credit once
 * per call when any `highlights` or `question` format is present, 3 more
 * once when any of them asks for `mode: "model"`. Reads the raw params
 * (getToolCost runs before validation), so anything that is not an array
 * of formats prices as none.
 *
 * @param {unknown} formats
 * @returns {{ query: 0 | 1, model: 0 | 3 }}
 */
export function scrapeFormatSurcharge(formats) {
  if (!Array.isArray(formats)) return { query: 0, model: 0 };
  const queryFormats = formats.filter((fmt) => fmt && typeof fmt === 'object' && QUERY_FORMATS.has(fmt.type));
  if (queryFormats.length === 0) return { query: 0, model: 0 };
  return { query: 1, model: queryFormats.some((fmt) => fmt.mode === 'model') ? 3 : 0 };
}
