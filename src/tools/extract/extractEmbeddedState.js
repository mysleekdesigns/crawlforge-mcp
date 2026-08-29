/**
 * extract_embedded_state — return the JSON state a page already ships in its
 * own HTML: __NEXT_DATA__, RSC flight chunks (self.__next_f), __NUXT__,
 * __APOLLO_STATE__, __INITIAL_STATE__, __PRELOADED_STATE__ and
 * <script type="application/json"> blocks.
 *
 * One fetch, exact values, no LLM in the extraction path — the numbers come
 * from the site's own serialized state, so they cannot be fabricated.
 */

import { fetchAndParse } from './_fetchAndParse.js';
// Both live in crawlforge-extractors so the REST API's extract_embedded_state
// runs this exact reader — one RSC flight-stream parser, not two.
import { extractEmbeddedState, selectJsonPath } from 'crawlforge-extractors';

// Above this, an unscoped result is big enough to be a problem for the caller
// (context window, transport) rather than just large. Warn — never truncate:
// a half-serialized object is worse than a big one, and `path` already gives
// the caller an exact way to ask for less.
const LARGE_RESULT_BYTES = 256_000;

/**
 * @param {{ url: string, path?: string, user_agent?: string, respect_robots?: boolean }} params
 */
export async function extractEmbeddedStateHandler({ url, path, user_agent, respect_robots }) {
  try {
    // The raw `html` is used, not `$`: fetchAndParse strips <script> from the
    // parsed tree by default, and every source here lives in a script tag.
    const { html, finalUrl, warnings: fetchWarnings } = await fetchAndParse(url, {
      userAgent: user_agent,
      respectRobots: respect_robots,
      tool: 'extract_embedded_state'
    });

    const state = extractEmbeddedState(html);
    const warnings = [...fetchWarnings, ...state.warnings];

    if (state.found.length === 0) {
      warnings.push(
        'No embedded state found. The page may render entirely on the client, or ship its data in a format this tool does not read.'
      );
    }

    const data = path ? selectJsonPath(state.data, path) : state.data;
    const bytes = Buffer.byteLength(JSON.stringify(data) ?? '');

    if (!path && bytes > LARGE_RESULT_BYTES) {
      const largest = state.found.reduce((a, b) => (b.bytes > a.bytes ? b : a));
      warnings.push(
        `Result is ${bytes} bytes; "${largest.name}" alone is ${largest.bytes}. Re-run with path to scope it, e.g. path:"${largest.name}.${Object.keys(state.data[largest.name])[0]}".`
      );
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          url: finalUrl,
          found: state.found,
          path: path || null,
          bytes,
          data,
          warnings
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Failed to extract embedded state: ${error.message}` }],
      isError: true
    };
  }
}
