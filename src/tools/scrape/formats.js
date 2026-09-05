/**
 * formats.js — the one declaration of what `scrape` can return.
 *
 * The formats enum used to be spelled in server.js, unifiedScrape.js and
 * toolOutputSchemas.js separately, so a format added to one copy shipped a
 * schema that did not describe the tool (Phase 0, 0.3). server.js and the
 * output schema import from here; the tool module re-exports.
 */

import { z } from 'zod';

export const SCRAPE_STRING_FORMATS = ['markdown', 'html', 'rawHtml', 'text', 'links', 'metadata', 'screenshot', 'branding'];

export const JsonFormatSchema = z.object({
  type: z.literal('json'),
  schema: z.record(z.any()).optional().describe('JSON schema for extraction'),
  prompt: z.string().optional().describe('Extraction instruction for the LLM')
});

export const FormatSchema = z.union([
  z.enum(SCRAPE_STRING_FORMATS),
  JsonFormatSchema
]);
