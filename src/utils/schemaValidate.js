/**
 * Shared JSON-Schema → zod validation.
 *
 * Lifted out of `src/tools/extract/extractWithLlm.js`, where it was local and
 * unexported, so that every consumer of LLM-decoded JSON validates the same
 * way. `LLMManager.validateAgainstSchema` used to hand-roll its own check that
 * only ever looked one level deep: `{countries: ["a string", "another"]}`
 * against `{countries: {type: 'array', items: {type: 'object'}}}` reported
 * `valid: true` because the top-level value was, in fact, an array (R19).
 */

import { z } from 'zod';

/**
 * Build a zod validator from a JSON-Schema-like hint. Best-effort: unknown
 * shapes fall back to `z.any()` so validation never rejects on constructs the
 * converter does not understand.
 */
export function jsonSchemaToZod(schema) {
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

/**
 * Validate parsed output against the schema hint.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateAgainstSchema(parsed, schema) {
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

/**
 * Validate against a schema and report problems per field, in the wording
 * callers see in tool output: "Missing required field: x" and
 * `Field "x": expected number, got string`, with a dotted path for anything
 * nested (`Field "countries.0.capital": ...`).
 *
 * Same structural check as validateAgainstSchema — this differs only in how
 * the failures are worded, and in also checking `enum`, which the zod
 * converter does not carry.
 *
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateFieldsAgainstSchema(data, schema) {
  const required = Array.isArray(schema?.required) ? schema.required : [];
  const properties = schema?.properties || {};
  const errors = [];

  let issues = [];
  try {
    const result = jsonSchemaToZod(schema).safeParse(data);
    if (!result.success) issues = result.error.issues;
  } catch {
    // The converter is best-effort and falls back to z.any() rather than
    // throwing, so this is unreachable in practice. Treat it as unvalidated
    // rather than failing an extraction on a validator bug.
    return { valid: true, errors: [] };
  }

  for (const issue of issues) {
    const path = issue.path;
    const value = path.reduce((acc, key) => (acc == null ? undefined : acc[key]), data);
    // A required field the decoder left null is "not filled in", the same as
    // absent — the caller wants to hear it is missing, not that null is the
    // wrong type. Optional nulls never reach here: the converter allows them.
    if (path.length === 1 && required.includes(path[0]) && (value === null || value === undefined)) {
      errors.push(`Missing required field: ${path[0]}`);
      continue;
    }
    const where = path.length ? path.join('.') : '(root)';
    if (issue.code === 'invalid_type' && issue.expected) {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      errors.push(`Field "${where}": expected ${issue.expected}, got ${actualType}`);
    } else {
      errors.push(`Field "${where}": ${issue.message}`);
    }
  }

  // The converter carries no `enum`, so that check stays here. Top level only.
  for (const [key, fieldSchema] of Object.entries(properties)) {
    const value = data?.[key];
    if (value === null || value === undefined) continue;
    if (fieldSchema?.enum && !fieldSchema.enum.includes(value)) {
      errors.push(`Field "${key}": value "${value}" not in enum ${JSON.stringify(fieldSchema.enum)}`);
    }
  }

  // A malformed array can raise one issue per element; the full list is pushed
  // into tool output, so cap it.
  const MAX_REPORTED = 10;
  const reported = errors.length > MAX_REPORTED
    ? [...errors.slice(0, MAX_REPORTED), `…and ${errors.length - MAX_REPORTED} more validation errors`]
    : errors;

  return { valid: errors.length === 0, errors: reported };
}
