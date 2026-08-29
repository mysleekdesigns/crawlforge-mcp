/**
 * embeddedState.js — find the JSON state a page already ships in its own HTML.
 *
 * Modern SPAs serialize the data their UI renders into the document: Next.js
 * pages carry __NEXT_DATA__ or an RSC flight stream, Nuxt carries __NUXT__,
 * Apollo/Redux apps carry __APOLLO_STATE__ / __INITIAL_STATE__ /
 * __PRELOADED_STATE__. One fetch returns the exact values the site itself uses
 * — no LLM in the extraction path, so no fabricated prices.
 *
 * Pure: HTML in, named payloads out. No fetching, no cheerio — every source
 * lives inside a <script> tag, so one regex pass over script tags is enough
 * and avoids a second full parse of a multi-megabyte document.
 */

/**
 * Global variable assignments we look for, in the order they are reported.
 * Each is matched with an optional window./self./globalThis. prefix.
 * `name` is the path-safe key the caller addresses with a JSON path — the
 * raw variable name has no dots, but keeping the two separate means a caller
 * never has to guess how "self.__next_f" would be spelled in a path.
 */
const STATE_VARIABLES = [
  { name: 'nuxt', variable: '__NUXT__' },
  { name: 'apollo_state', variable: '__APOLLO_STATE__' },
  { name: 'initial_state', variable: '__INITIAL_STATE__' },
  { name: 'preloaded_state', variable: '__PRELOADED_STATE__' }
];

// Script bodies cannot contain a literal "</script", so a non-greedy match is
// exact here — the same assumption every HTML parser makes.
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

// self.__next_f.push([1,"<chunk>"]) — Next.js App Router RSC flight chunks.
const NEXT_F_PUSH_RE = /self\.__next_f\.push\(\s*\[\s*1\s*,\s*/g;

/**
 * Read an HTML attribute out of a raw tag's attribute string.
 * @param {string} attrs
 * @param {string} name
 * @returns {string|null}
 */
function attr(attrs, name) {
  const match = attrs.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  );
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

/**
 * Scan a double-quoted string literal starting at `start` and return its
 * parsed value plus the index just past its closing quote.
 * @param {string} text
 * @param {number} start index of the opening quote
 * @returns {{ value: string, end: number }|null}
 */
function readStringLiteral(text, start) {
  if (text[start] !== '"') return null;
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '"') break;
    i++;
  }
  if (i >= text.length) return null;
  try {
    return { value: JSON.parse(text.slice(start, i + 1)), end: i + 1 };
  } catch {
    return null;
  }
}

/**
 * Scan a balanced {...} / [...] literal starting at `start`, respecting string
 * literals and escapes so braces inside strings don't end it early.
 * @param {string} text
 * @param {number} start
 * @returns {string|null} the raw literal, or null if it never closes
 */
function readBracketedLiteral(text, start) {
  const open = text[start];
  const close = open === '{' ? '}' : open === '[' ? ']' : null;
  if (!close) return null;
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i++;
        i++;
      }
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
    i++;
  }
  return null;
}

/**
 * Split a concatenated RSC flight stream into its rows.
 *
 * The stream is a sequence of `<hexId>:<payload>\n` rows. Three payload shapes
 * matter:
 *   - `T<hexByteLength>,` — a length-prefixed text blob. The length is in
 *     UTF-8 BYTES and INCLUDES the row's terminating newline, so the cursor
 *     advances exactly that many bytes and no further. (Advancing one extra
 *     character for a newline silently eats the first hex digit of the next
 *     row id, turning row "14" into row "4" and overwriting an unrelated row —
 *     verified against the live Healthgrades capture, where it produced seven
 *     colliding ids.)
 *   - `I[...]` / `HL[...]` — module and hint references. Not JSON; kept as the
 *     raw string so the caller can still see which components a page loads.
 *   - anything else — JSON, parsed.
 *
 * @param {string} stream
 * @returns {Record<string, unknown>} row id -> value
 */
function parseFlightRows(stream) {
  const rows = {};
  let cursor = 0;

  while (cursor < stream.length) {
    const newline = stream.indexOf('\n', cursor);
    const lineEnd = newline === -1 ? stream.length : newline;
    const header = stream.slice(cursor, lineEnd).match(/^([0-9a-f]+):/i);
    if (!header) {
      // Not a row start: a chunk boundary landed mid-row, or the stream was
      // truncated. Resync on the next line rather than giving up.
      cursor = lineEnd + 1;
      continue;
    }

    const id = header[1];
    const payloadStart = cursor + header[0].length;
    const payload = stream.slice(payloadStart, lineEnd);

    const textRow = payload.match(/^T([0-9a-f]+),/i);
    if (textRow) {
      const blobStart = payloadStart + textRow[0].length;
      const text = Buffer.from(stream.slice(blobStart), 'utf8')
        .subarray(0, parseInt(textRow[1], 16))
        .toString('utf8');
      rows[id] = text;
      cursor = blobStart + text.length;
      continue;
    }

    try {
      rows[id] = JSON.parse(payload);
    } catch {
      rows[id] = payload;
    }
    cursor = lineEnd + 1;
  }

  return rows;
}

/**
 * Collect every `self.__next_f.push([1,"…"])` chunk in document order and
 * concatenate them into the flight stream they encode.
 * @param {string} html
 * @returns {{ chunks: number, stream: string }}
 */
function readFlightStream(html) {
  const parts = [];
  NEXT_F_PUSH_RE.lastIndex = 0;
  let match;
  while ((match = NEXT_F_PUSH_RE.exec(html)) !== null) {
    const literal = readStringLiteral(html, NEXT_F_PUSH_RE.lastIndex);
    if (!literal) continue;
    parts.push(literal.value);
    NEXT_F_PUSH_RE.lastIndex = literal.end;
  }
  return { chunks: parts.length, stream: parts.join('') };
}

const serializedBytes = (value) => Buffer.byteLength(JSON.stringify(value) ?? '');

/**
 * Extract every embedded state payload a page carries.
 *
 * @param {string} rawHtml raw HTML — NOT a script-stripped document
 * @returns {{ data: Record<string, unknown>, found: Array<{name: string, variable: string, bytes: number, note?: string}>, warnings: string[] }}
 */
export function extractEmbeddedState(rawHtml) {
  const data = {};
  const found = [];
  const warnings = [];
  const jsonScripts = [];

  // Commented-out markup is not state the page renders from, and an opening
  // <script> tag inside a comment would otherwise match through to the first
  // real </script> — swallowing the genuine tag that follows it.
  const html = rawHtml.replace(HTML_COMMENT_RE, '');

  SCRIPT_RE.lastIndex = 0;
  let script;
  while ((script = SCRIPT_RE.exec(html)) !== null) {
    const [, attrs, body] = script;
    const type = (attr(attrs, 'type') || '').toLowerCase();
    if (type !== 'application/json') continue;

    const id = attr(attrs, 'id');
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      warnings.push(
        `A <script type="application/json"${id ? ` id="${id}"` : ''}> block is not valid JSON; skipped.`
      );
      continue;
    }

    // __NEXT_DATA__ is a JSON script too. Reported under its own name so a
    // caller addressing "next_data" gets it, and not duplicated into
    // json_scripts — on a Next.js page that would double a multi-hundred-KB
    // payload.
    if (id === '__NEXT_DATA__') {
      data.next_data = parsed;
      found.push({
        name: 'next_data',
        variable: '__NEXT_DATA__',
        bytes: serializedBytes(parsed)
      });
    } else {
      jsonScripts.push({ id: id || null, data: parsed });
    }
  }

  const flight = readFlightStream(html);
  if (flight.chunks > 0) {
    const rows = parseFlightRows(flight.stream);
    data.next_f = rows;
    found.push({
      name: 'next_f',
      variable: 'self.__next_f',
      bytes: serializedBytes(rows),
      note: `${flight.chunks} RSC flight chunks concatenated into ${Object.keys(rows).length} rows, keyed by row id`
    });
  }

  for (const { name, variable } of STATE_VARIABLES) {
    const assignment = html.match(
      new RegExp(`(?:window|self|globalThis)?\\.?\\b${variable}\\s*=\\s*`)
    );
    if (!assignment) continue;

    const valueStart = assignment.index + assignment[0].length;
    const literal = readBracketedLiteral(html, valueStart);
    let parsed;
    if (literal !== null) {
      try {
        parsed = JSON.parse(literal);
      } catch {
        parsed = undefined;
      }
    }

    if (parsed === undefined) {
      // Nuxt 2 wraps its payload in an IIFE, and Nuxt 3 emits a bare JS object
      // literal with unquoted keys. Neither is JSON and neither is worth
      // eval()ing — say so instead of reporting a source we did not read.
      warnings.push(
        `${variable} is present but its value is not a JSON literal (a JS object literal or function-wrapped payload); not parsed.`
      );
      continue;
    }

    // Nuxt 3 emits `window.__NUXT__={}` and then fills it from a second,
    // non-JSON statement. Reporting the empty object without saying so reads
    // like "this page has no Nuxt state", which is the opposite of true.
    if (Object.keys(parsed).length === 0) {
      warnings.push(
        `${variable} is present but assigned an empty ${Array.isArray(parsed) ? 'array' : 'object'}; the page fills it in from a later statement this tool does not evaluate.`
      );
    }

    data[name] = parsed;
    found.push({ name, variable, bytes: serializedBytes(parsed) });
  }

  if (jsonScripts.length > 0) {
    data.json_scripts = jsonScripts;
    found.push({
      name: 'json_scripts',
      variable: 'script[type="application/json"]',
      bytes: serializedBytes(jsonScripts),
      note: `${jsonScripts.length} block(s), each { id, data }`
    });
  }

  return { data, found, warnings };
}
