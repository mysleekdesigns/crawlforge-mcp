/**
 * jsonPath.js — the minimal subtree selector for extract_embedded_state.
 *
 * Deliberately not a JSONPath engine: dotted keys and array indexes only, no
 * wildcards, filters, slices or recursive descent. That is enough to turn a
 * multi-megabyte state blob into the branch a caller actually wants, and a
 * caller who needs more can select a branch and filter it themselves.
 *
 * Syntax: `next_data.props.pageProps`, `json_scripts.0.data`, `next_f[1a]`,
 * `a.b[0].c`. A key containing a literal "." cannot be addressed.
 */

/**
 * Split a path into its segments.
 * @param {string} path
 * @returns {string[]}
 */
export function parseJsonPath(path) {
  const segments = [];
  for (const part of path.split('.')) {
    // "a[0][1]" -> "a", "0", "1"
    const [head, ...brackets] = part.split('[');
    if (head !== '') segments.push(head);
    for (const bracket of brackets) {
      const key = bracket.endsWith(']') ? bracket.slice(0, -1) : bracket;
      segments.push(key.replace(/^['"]|['"]$/g, ''));
    }
  }
  return segments.filter((segment) => segment !== '');
}

/**
 * Describe what a caller could have asked for at a dead end, so a typo comes
 * back as a fixable message rather than an empty result.
 * @param {unknown} value
 * @returns {string}
 */
function describeOptions(value) {
  if (Array.isArray(value)) return `array of length ${value.length}`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    const shown = keys.slice(0, 25).join(', ');
    return `available keys: ${shown}${keys.length > 25 ? `, … (${keys.length} total)` : ''}`;
  }
  return `a ${value === null ? 'null' : typeof value} value, which has no keys`;
}

/**
 * Resolve a path against a parsed object.
 *
 * @param {unknown} root
 * @param {string} path
 * @returns {unknown}
 * @throws {Error} when the path does not resolve — including the keys that
 *   were available at the point it stopped
 */
export function selectJsonPath(root, path) {
  const segments = parseJsonPath(path);
  if (segments.length === 0) {
    throw new Error(`Path "${path}" is empty`);
  }

  let current = root;
  const walked = [];

  for (const segment of segments) {
    const container = current !== null && typeof current === 'object';
    const key = Array.isArray(current) ? Number(segment) : segment;
    if (!container || !(key in current)) {
      const at = walked.length === 0 ? 'the result' : `"${walked.join('.')}"`;
      throw new Error(
        `Path "${path}" not found: ${at} has no "${segment}" (${describeOptions(current)})`
      );
    }
    current = current[key];
    walked.push(segment);
  }

  return current;
}
