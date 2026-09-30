/**
 * windowState — read a page's framework state straight off `window`, after
 * its JavaScript ran (extract_embedded_state's escalated path, plan Phase 3.2).
 *
 * The served HTML is not always where the state ends up: Nuxt 2 ships
 * __NUXT__ as an IIFE the HTML parser cannot evaluate, and YouTube's
 * ytInitialData is assigned by a script. Inside the stealth render those are
 * plain globals, so they are read as the page itself sees them.
 *
 * Engines: on Chromium page.evaluate runs in the page's main world, where the
 * globals live. On camoufox it runs in an isolated world that cannot see them
 * (window.__NEXT_DATA__ is undefined there), but Firefox's Xray waiver,
 * `window.wrappedJSObject`, reaches the page's own window from that world
 * without evaluating anything in the page's — measured against camoufox
 * 0.1.19, 2026-09-29. So the read works on both engines and the page never
 * sees a script of ours run in its world.
 *
 * Each value is serialised INSIDE the page with its own try/catch: a cyclic or
 * otherwise unserialisable global is skipped with a warning instead of
 * failing the read of the others.
 */

/** The globals read, in this order. Only the ones present come back. */
export const WINDOW_STATE_GLOBALS = Object.freeze([
  '__NEXT_DATA__',
  '__NUXT__',
  '__remixContext',
  'ytInitialData',
  'ytInitialPlayerResponse',
  '__INITIAL_STATE__',
  '__PRELOADED_STATE__',
  '__APOLLO_STATE__',
  '__TGT_DATA__',
  '__PWS_DATA__'
]);

/** Said wherever these values are reported: they are not what the server sent. */
export const WINDOW_STATE_NOTE = 'read from window after JavaScript ran, not from the served HTML';

/**
 * Runs in the page. `{ json }` for a global that serialised, `{ error }` for
 * one that did not; absent (null/undefined) globals are left out.
 * @param {string[]} names
 */
export function serialiseWindowGlobals(names) {
  const target = window.wrappedJSObject || window;
  const out = {};
  for (const name of names) {
    try {
      const value = target[name];
      if (value === undefined || value === null) continue;
      const json = JSON.stringify(value);
      out[name] = typeof json === 'string' ? { json } : { error: 'it has no JSON form' };
    } catch (error) {
      out[name] = { error: String((error && error.message) || error) };
    }
  }
  return out;
}

/**
 * @param {{ evaluate: Function }} page a Playwright page
 * @returns {Promise<{ state: Record<string, unknown>, warnings: string[] }>}
 */
export async function readWindowState(page) {
  const warnings = [];
  let raw;
  try {
    raw = await page.evaluate(serialiseWindowGlobals, [...WINDOW_STATE_GLOBALS]);
  } catch (error) {
    warnings.push(`window_state could not be read: ${String(error.message).split('\n')[0]}`);
    return { state: {}, warnings };
  }
  const state = {};
  for (const [name, entry] of Object.entries(raw || {})) {
    if (entry && typeof entry.json === 'string') {
      try {
        state[name] = JSON.parse(entry.json);
        continue;
      } catch (error) {
        warnings.push(`window_state: ${name} skipped - its JSON did not parse (${error.message})`);
        continue;
      }
    }
    warnings.push(`window_state: ${name} skipped - not serialisable (${entry?.error ?? 'unknown reason'})`);
  }
  return { state, warnings };
}
