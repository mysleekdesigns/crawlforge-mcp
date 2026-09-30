/**
 * extract_embedded_state — return the JSON state a page already ships in its
 * own HTML: __NEXT_DATA__, RSC flight chunks (self.__next_f), __NUXT__,
 * __APOLLO_STATE__, __INITIAL_STATE__, __PRELOADED_STATE__ and
 * <script type="application/json"> blocks.
 *
 * One fetch, exact values, no LLM in the extraction path — the numbers come
 * from the site's own serialized state, so they cannot be fabricated.
 *
 * `escalate: true` (plan Phase 3.2) adds scrape's second stage: when the plain
 * fetch is walled, the page is rendered by the same stealth escalation `scrape`
 * uses (injected — this module never imports the browser) and the same parser
 * runs on the rendered document. The browser also reads the framework globals
 * off `window`, reported under `window_state`.
 */

import { STATUS_CODES } from 'node:http';
import { z } from 'zod';
import { fetchAndParse } from './_fetchAndParse.js';
// Both live in crawlforge-extractors so the REST API's extract_embedded_state
// runs this exact reader — one RSC flight-stream parser, not two.
import { extractEmbeddedState, selectJsonPath } from 'crawlforge-extractors';
import { stealthDocumentVerdict } from '../../utils/stealthVerdict.js';
import { pageTitle } from '../../utils/pageTitle.js';
import { setActualCost } from '../../server/requestContext.js';
import { SCRAPE_ESCALATION_SHAPE, SCRAPE_ESCALATION_CREDITS, aBrowserMightPass } from '../scrape/escalation.js';
import { WINDOW_STATE_NOTE } from '../../core/browser/windowState.js';

/** The table price in AuthManager.getToolCost; escalation adds SCRAPE_ESCALATION_CREDITS. */
const EMBEDDED_STATE_BASE_CREDITS = 2;

// Above this, an unscoped result is big enough to be a problem for the caller
// (context window, transport) rather than just large. Warn with a ready path:
// over max_inline_chars the result comes back as a preview plus a
// result_handle (src/server/inlineThreshold.js), and `path` or `keys_only`
// ask for less up front.
const LARGE_RESULT_BYTES = 256_000;

// A wall, as opposed to a missing page or a broken server (G4: a 404 or a 5xx
// never escalates — see aBrowserMightPass).
const WALL_STATUSES = new Set([403, 429, 444]);

const BLOCKED_HINT =
  'stealth_mode operation:"scrape" renders the page in a browser and returns the HTML; the embedded state is in the returned html. Do not repeat this call with a different path.';

const ESCALATE_HINT =
  'Call extract_embedded_state again with escalate:true - the stealth browser re-reads the page and the same parser runs on it (projected 7 credits, charged 2 if the plain fetch gets through). Do not repeat this call with a different path.';

const STAGE_DID_NOT_RUN_HINT =
  'The stealth stage did not run (see warnings) - retry once with escalate:true; stealth_mode drives the same browser, so it is not a way around this. Do not repeat this call with a different path.';

/** The tool's own params, in tools/list order; server.js adds the compliance and inline-limit ones. */
export const EMBEDDED_STATE_INPUT_SHAPE = {
  url: z.string().url().describe('The URL to read embedded state from'),
  path: z.string().optional().describe('Return only this subtree instead of the whole payload. Dotted keys and array indexes, e.g. "next_data.props.pageProps" or "next_f[0].f" — not JSONPath (no wildcards, filters or recursion). State payloads are routinely over a megabyte; scope them.'),
  keys_only: z.boolean().optional().default(false).describe('Return `keys` instead of `data`: the first two levels of keys of the selected data (after `path`), each value replaced by its type ("object", "array(<n>)", "string", "number", "boolean", "null"); an array shows its length and its first item. Cheap discovery before choosing a path. Default: false'),
  escalate: z.boolean().optional().default(false).describe('When the plain fetch comes back blocked (403/429/challenge page, or an empty shell with no state), re-read the page once in the stealth browser and run the same parser on the rendered document; the browser also reads the framework globals off window (window_state). Under escalate_engine "auto" a Chrome TLS handshake with the honest CrawlForge User-Agent (impit) is tried first, and the browser runs only when that does not get the page. A 404 or 5xx never escalates. Projected at 2+5; the actual charge stays at 2 when the plain fetch succeeded. Default: false'),
  escalate_engine: SCRAPE_ESCALATION_SHAPE.escalate_engine,
  wait_for: z.number().min(0).max(30000).optional().describe('Escalated render only: extra wait after page load, in ms — for state assigned after DOMContentLoaded. Ignored without escalation')
};

/** "object" | "array(<n>)" | "string" | "number" | "boolean" | "null" */
function label(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  return typeof value;
}

/**
 * The keys of `value`, `depth` levels deep, every value replaced by its type.
 * Shared shape with the REST route — keep the two in step.
 * @param {unknown} value
 * @param {number} depth
 */
export function describeKeys(value, depth) {
  if (Array.isArray(value)) {
    if (depth <= 1) return label(value);
    return value.length > 0
      ? { length: value.length, first: describeKeys(value[0], depth - 1) }
      : { length: 0 };
  }
  if (value !== null && typeof value === 'object') {
    const keys = {};
    for (const [key, child] of Object.entries(value)) {
      keys[key] = depth > 1 ? describeKeys(child, depth - 1) : label(child);
    }
    return keys;
  }
  return label(value);
}

function httpError(status) {
  return new Error(`HTTP ${status}: ${STATUS_CODES[status] ?? ''}`.trimEnd());
}

function isHttpError(status) {
  return typeof status === 'number' && (status < 200 || status >= 300);
}

/**
 * Whether a document is a failure for this tool. A named vendor's wall and an
 * HTTP error always are. A page the verdict calls an empty shell or an error
 * placeholder is one only when it carried no state: a client-rendered page
 * that ships nothing but __NEXT_DATA__ is exactly what this tool reads. Shared
 * rule with the REST route — keep the two in step.
 */
function failed(verdict, status, gotState) {
  if (verdict.blocked || isHttpError(status)) return true;
  return !verdict.success && !gotState;
}

/**
 * @param {{ escalateFetch?: (args: { url: string, engine: string, respectRobots?: boolean, waitFor?: number, readWindowState?: boolean }) => Promise<object> }} [deps]
 *   the stealth escalation stage (server.js `stealthEscalation`); without it
 *   an escalation that would run is reported as unavailable
 */
export function createExtractEmbeddedStateHandler({ escalateFetch } = {}) {
  return async function extractEmbeddedStateHandler({
    url, path, keys_only, escalate, escalate_engine = 'auto', wait_for, user_agent, respect_robots
  }) {
    const escalating = escalate === true;
    let escalationRan = false;
    // One charge report for every return path: the projection is 2+5 when
    // escalating, and the stealth stage's 5 is owed only if it ran (G4).
    const reportCost = () => {
      if (escalating) setActualCost(EMBEDDED_STATE_BASE_CREDITS + (escalationRan ? SCRAPE_ESCALATION_CREDITS : 0));
    };
    try {
      // The raw `html` is used, not `$`: fetchAndParse strips <script> from the
      // parsed tree by default, and every source here lives in a script tag.
      // A non-2xx body is read too: a wall arrives as a 403 with the challenge
      // in it, and the verdict below needs both to name the vendor.
      const fetched = await fetchAndParse(url, {
        userAgent: user_agent,
        respectRobots: respect_robots,
        tool: 'extract_embedded_state',
        errorDocuments: true
      });
      let { html, finalUrl, status } = fetched;
      const warnings = [...fetched.warnings];
      let state = extractEmbeddedState(html);
      let verdict = stealthDocumentVerdict(
        { url: finalUrl, title: pageTitle(fetched.$), text: fetched.textContent, html, status },
        { fetcher: 'a plain fetch', rendered: false, contentReturned: false }
      );

      let escalationFields = {};
      let windowState = null;
      if (failed(verdict, status, state.found.length > 0)) {
        // A 404 or a 5xx is not a wall: it fails as it always has, and never
        // escalates — the browser would spend 5 credits to be told the same.
        if (!WALL_STATUSES.has(status) && !aBrowserMightPass(verdict, status)) throw httpError(status);
        // Unescalated, a wall or an empty shell is an error naming the vendor
        // (the verdict does) and the one parameter that changes the outcome.
        if (!escalating) {
          return {
            content: [{ type: 'text', text: `Failed to extract embedded state: ${verdict.error}\nNext step: ${ESCALATE_HINT}` }],
            isError: true
          };
        }
        const vendorDetected = verdict.blocked?.vendor ?? null;
        if (!escalateFetch) {
          warnings.push('escalate: no stealth stage is wired into this server build');
        } else {
          try {
            const stealth = await escalateFetch({
              url: finalUrl,
              engine: escalate_engine,
              respectRobots: respect_robots,
              waitFor: wait_for || 0,
              readWindowState: true
            });
            escalationRan = true;
            const engine = stealth.engine || escalate_engine;
            if (Array.isArray(stealth.warnings)) warnings.push(...stealth.warnings);
            html = stealth.html || '';
            finalUrl = stealth.url || finalUrl;
            status = stealth.status ?? null;
            // The same parser, on the document the browser ended up with.
            state = extractEmbeddedState(html);
            verdict = stealthDocumentVerdict(
              { url: finalUrl, title: stealth.title || '', text: stealth.text || '', html, status },
              { waitedMs: stealth.gracedMs || 0, fetcher: 'the stealth browser', rendered: true, contentReturned: false }
            );
            windowState = stealth.windowState ?? null;
            if (engine === 'impit') {
              warnings.push('escalate: impit (a Chrome TLS handshake, no browser) got the page, so no JavaScript ran and window_state was not read');
            }
            const gotIt = !failed(verdict, status, state.found.length > 0 || Object.keys(windowState ?? {}).length > 0);
            warnings.push(
              `escalate: the plain fetch ${vendorDetected ? `was blocked by ${vendorDetected}` : 'did not return the page'}; ` +
              `${engine === 'impit' ? 'a Chrome TLS handshake (impit, honest User-Agent)' : `the ${engine} stealth browser`} ${gotIt ? 'returned it' : 'did not get it either'}`
            );
            escalationFields = { stealth: { engine, vendor_detected: vendorDetected } };
          } catch (err) {
            // A robots refusal inside the gate stamps markPreflightRefusal, and
            // withAuth then bills the whole call zero: nothing was rendered.
            warnings.push(`escalate: the stealth retry did not run — ${err.message}`);
          }
        }
      }
      // Reported only to a caller who asked to escalate.
      if (escalating) escalationFields = { escalated: escalationRan, ...escalationFields };

      // Globals the served HTML already carried are not repeated: the parsed
      // copy under its own name is the same object, and some are megabytes.
      const windowFound = [];
      if (windowState) {
        const parsedVariables = new Set(state.found.map((f) => f.variable));
        for (const [name, value] of Object.entries(windowState)) {
          if (parsedVariables.has(name)) {
            delete windowState[name];
            warnings.push(`window_state: ${name} is not repeated - the served HTML already carried it (see found)`);
            continue;
          }
          windowFound.push({ name, bytes: Buffer.byteLength(JSON.stringify(value)) });
        }
        if (windowFound.length > 0) state.data.window_state = windowState;
      }

      // Escalation asked for and still walled, with nothing to show for it. An
      // error that says whether the stage ran: when it did, withAuth's hint
      // does not send the caller to the stealth browser a second time.
      if (failed(verdict, status, state.found.length > 0 || windowFound.length > 0)) {
        reportCost();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              url: finalUrl,
              ...(typeof status === 'number' ? { status } : {}),
              error: verdict.error,
              ...(verdict.blocked ? { blocked: verdict.blocked } : {}),
              ...escalationFields,
              found: state.found,
              warnings,
              ...(escalationRan ? {} : { next_step: STAGE_DID_NOT_RUN_HINT })
            }, null, 2)
          }],
          isError: true
        };
      }

      if (state.found.length === 0 && windowFound.length === 0) {
        warnings.push(
          'No embedded state found. The page may render entirely on the client, or ship its data in a format this tool does not read.'
        );
      }

      // A path is naturally written against the payload ("props.pageProps"),
      // not against this tool's envelope ("next_data.props.pageProps"). When
      // the page carries exactly one payload and the path's root is not one of
      // the envelope keys, read it inside that payload and say so (R21,
      // 2026-09-09: four Next.js pages in a row failed on the bare path).
      // `window_state` is an envelope key, so a path into it is left alone.
      let effectivePath = path;
      if (path && state.found.length === 1) {
        const root = path.split(/[.[]/)[0];
        if (root && !(root in state.data)) {
          effectivePath = `${state.found[0].name}.${path}`;
          warnings.push(
            `path "${path}" was read as "${effectivePath}": "${state.found[0].name}" is the only payload on this page, so the path is resolved inside it.`
          );
        }
      }

      const data = effectivePath ? selectJsonPath(state.data, effectivePath) : state.data;
      const bytes = Buffer.byteLength(JSON.stringify(data) ?? '');

      if (!path && !keys_only && bytes > LARGE_RESULT_BYTES) {
        const largest = state.found.reduce((a, b) => (b.bytes > a.bytes ? b : a), state.found[0] ?? null);
        if (largest) {
          warnings.push(
            `Result is ${bytes} bytes; "${largest.name}" alone is ${largest.bytes}. Re-run with path to scope it, e.g. path:"${largest.name}.${Object.keys(state.data[largest.name])[0]}", or with keys_only:true to see its keys first.`
          );
        }
      }

      reportCost();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            url: finalUrl,
            found: state.found,
            path: effectivePath || null,
            bytes,
            ...escalationFields,
            ...(windowFound.length > 0 ? { window_state: { note: WINDOW_STATE_NOTE, found: windowFound } } : {}),
            ...(keys_only ? { keys: describeKeys(data, 2) } : { data }),
            warnings
          }, null, 2)
        }]
      };
    } catch (error) {
      reportCost();
      // A block or server error is not a path problem: the generic hint
      // ("call again without `path`") would send the caller back into the same
      // wall. Naming the next step here keeps withAuth from appending it. A
      // wall (here only one with a binary body, which fetchAndParse still
      // throws on) points at escalate:true; a 5xx keeps the stealth_mode hint.
      const hint = /^HTTP (403|429|444)\b/.test(error.message)
        ? ESCALATE_HINT
        : (/^HTTP 5\d\d\b/.test(error.message) ? BLOCKED_HINT : null);
      return {
        content: [{
          type: 'text',
          text: `Failed to extract embedded state: ${error.message}` + (hint ? `\nNext step: ${hint}` : '')
        }],
        isError: true
      };
    }
  };
}

/** The handler with no escalation stage wired (tests; server.js wires its own). */
export const extractEmbeddedStateHandler = createExtractEmbeddedStateHandler();
