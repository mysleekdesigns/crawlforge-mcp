/**
 * The constrained-decoding shape for an LLM extraction.
 *
 * A caller's JSON Schema says which fields are REQUIRED of the result. Handed
 * to the model verbatim as the output format, that word means something else:
 * the decoder cannot emit null for a required string, so a model shown content
 * that never states the field is forced to invent one. R14 caught it twice on
 * the same day — racket-lang.org's version came back as the page title,
 * rust-lang.org's as the word "stable" — while the same model on the same
 * pages answered correctly the moment the fact was in front of it.
 *
 * So the format the model decodes against makes every property nullable and
 * drops `required`. The caller's schema still drives validation and the
 * provenance retry: a required field the model answered null is what those
 * exist to catch, and a null is honest where a guess is not.
 *
 * @param {object} schema - caller's JSON Schema (or a flat hint map)
 * @returns {object|'json'} an object schema for the decoder, or 'json' when the
 *   input carries no properties to constrain
 */
export function extractionFormat(schema) {
  if (!schema || typeof schema !== 'object') return 'json';
  const source = schema.properties && typeof schema.properties === 'object'
    ? schema
    : { type: 'object', properties: flatHintProperties(schema) };
  if (!source.properties || Object.keys(source.properties).length === 0) return 'json';

  const properties = {};
  for (const [key, prop] of Object.entries(source.properties)) {
    properties[key] = nullable(prop);
  }
  const { required: _required, ...rest } = source;
  return { additionalProperties: true, ...rest, type: 'object', properties };
}

/** A flat `{ field: 'string' }` hint map as JSON-Schema properties. */
function flatHintProperties(hints) {
  const properties = {};
  for (const [key, val] of Object.entries(hints)) {
    properties[key] = (val && typeof val === 'object') ? val : { type: 'string' };
  }
  return properties;
}

/** The property with `null` admitted to its type, when it names a single type. */
function nullable(prop) {
  if (!prop || typeof prop !== 'object' || Array.isArray(prop)) return prop;
  if (typeof prop.type !== 'string' || prop.type === 'null' || prop.type === 'object') return prop;
  return { ...prop, type: [prop.type, 'null'] };
}

export default extractionFormat;
