/**
 * fetchLadder — scrape's fetch ladder for extract_text and extract_links (fix
 * plan Phase E2). Same rules and wording as the website's
 * src/lib/tools/fetch-ladder.ts — keep the two in step.
 *
 *   1. A plain fetch (15 s), retried once when a 429/503 asks for at most
 *      10 s with Retry-After.
 *   2. A 2xx body that is not text (a PDF, an image, an archive) stops here as
 *      UNSUPPORTED_CONTENT_TYPE; it never escalates.
 *   3. Only with escalate:true, and only when a browser could change the
 *      outcome (aBrowserMightPass, or a 444 refusal): the injected stealth
 *      stage — server.js `stealthEscalation`, the one scrape and
 *      extract_embedded_state run, behind the same compliance gate (impit
 *      first under "auto", then the browser).
 *   4. Otherwise E1's verdict stands unchanged (targetFailure).
 *
 * scrape and extract_embedded_state keep their own copies of steps 3–4; this
 * reuses their exported pieces rather than moving them.
 */

import { load } from 'cheerio';
import { z } from 'zod';
import { fetchWithTimeout } from '../tools/basic/_fetch.js';
import { plainVerdict, targetFailure } from '../tools/basic/_targetFailure.js';
import { stealthDocumentVerdict } from './stealthVerdict.js';
import { parseRetryAfter } from './hostRateLimiter.js';
import { setActualCost } from '../server/requestContext.js';
import { SCRAPE_ESCALATION_SHAPE, SCRAPE_ESCALATION_CREDITS, aBrowserMightPass } from '../tools/scrape/escalation.js';

/** extract_text's and extract_links's table price; escalation adds SCRAPE_ESCALATION_CREDITS. */
const EXTRACT_BASE_CREDITS = 1;

export const LADDER_TIMEOUT_MS = 15000;

/** A Retry-After longer than this is not waited out inside one call. */
export const RETRY_AFTER_MAX_MS = 10000;

export const CLIENT_RENDERED_WARNING = 'page renders client-side; use scrape';

/** The two public fields both tools take, in tools/list order. */
export const EXTRACT_ESCALATION_SHAPE = {
  escalate: z.boolean().optional().default(false).describe('When the plain fetch comes back blocked (403/429/444/challenge page/empty shell), re-read the page once in the stealth browser and extract from the rendered document. Under escalate_engine "auto" a Chrome TLS handshake with the honest CrawlForge User-Agent (impit) is tried first, and the browser runs only when that does not get the page. A 404 or 5xx never escalates. Projected at 1+5; the actual charge stays at 1 when the plain fetch succeeded. Default: false'),
  escalate_engine: SCRAPE_ESCALATION_SHAPE.escalate_engine
};

// Bodies these tools read. A missing Content-Type is read as HTML.
const TEXTUAL_TYPE = /^(?:text\/[\w.+-]+|application\/(?:xhtml\+xml|xml|json)|application\/[\w.+-]+\+(?:xml|json))$/;
const JSON_TYPE = /^application\/(?:[\w.+-]+\+)?json$/;

/** The media type without parameters, lowercased; '' when absent. */
function mediaType(response) {
  return (response.headers?.get?.('content-type') ?? '').split(';')[0].trim().toLowerCase();
}

/** Whether a media type is JSON (application/json or a +json suffix). */
export function isJsonType(type) {
  return JSON_TYPE.test(type);
}

// A page that says it needs JavaScript (scrapingcourse.com's
// /javascript-rendering serves "Enable JavaScript to see products" over empty
// product cards, with no mount point to find).
// No \b before the verbs: cheerio's text() joins <h1>Challenge</h1><p>Enable…
// into one word.
const JS_REQUIRED = /(?:enable|requires?|turn on)\s+javascript\b|\bjavascript\s+(?:is\s+)?(?:required|disabled)\b/i;

/**
 * A client-rendered shell: under 200 characters of visible text, and either an
 * empty <div id="root">, "app" or "__next" for the framework to mount into or
 * text saying the page needs JavaScript.
 * @param {string} html
 */
export function isClientRenderedShell(html) {
  const $ = load(html);
  $('script, style, noscript').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  if (text.length >= 200) return false;
  if (JS_REQUIRED.test(text)) return true;
  return $('div#root, div#app, div#__next').toArray().some((el) => $(el).text().trim() === '');
}

/**
 * Retry-After in ms, or null when the header is absent or unreadable.
 * @param {Response} response
 */
function retryAfterMs(response) {
  const header = response.headers?.get?.('retry-after');
  if (header == null) return null;
  const raw = String(header).trim();
  if (!/^\d+$/.test(raw) && Number.isNaN(Date.parse(raw))) return null;
  return parseRetryAfter(raw);
}

/**
 * The plain fetch, retried once on a 429/503 whose Retry-After is at most
 * RETRY_AFTER_MAX_MS. fetchWithTimeout has already recorded the Retry-After
 * (noteRetryAfter), and the second request's gate waits it out in the
 * per-host throttle — so the wait happens once, there.
 */
async function plainFetch(url, options) {
  const response = await fetchWithTimeout(url, options);
  if (response.status !== 429 && response.status !== 503) return response;
  const waitMs = retryAfterMs(response);
  if (waitMs === null || waitMs > RETRY_AFTER_MAX_MS) return response;
  return fetchWithTimeout(url, options);
}

/**
 * @param {string} url
 * @param {{ tool: 'extract_text'|'extract_links', userAgent?: string, respectRobots?: boolean,
 *   escalate?: boolean, escalateEngine?: string,
 *   escalateFetch?: (args: { url: string, engine: string, respectRobots?: boolean }) => Promise<object> }} options
 * @returns {Promise<
 *   { unsupported: string } |
 *   { error: string, url: string, status?: number|null, blocked?: object, warnings: string[], fields: object } |
 *   { html: string, url: string, type: string, warnings: string[], fields: object }>}
 *   `fields` carries `escalated` (only when escalate was asked for), `stealth`
 *   (when the stage ran) and `rendered: false` (a client-rendered shell)
 */
export async function fetchLadder(url, { tool, userAgent, respectRobots, escalate = false, escalateEngine = 'auto', escalateFetch } = {}) {
  let escalationRan = false;
  try {
    const response = await plainFetch(url, { timeout: LADDER_TIMEOUT_MS, userAgent, respectRobots, tool });
    const type = mediaType(response);
    if (response.ok && type && !TEXTUAL_TYPE.test(type)) return { unsupported: type };

    const warnings = [...(response._warnings ?? [])];
    // Reported only to a caller who asked to escalate.
    const fields = escalate ? { escalated: false } : {};
    const verdict = plainVerdict(response, url);
    const failed = verdict ? !verdict.success : !response.ok;

    // A 404 or a 5xx never escalates (aBrowserMightPass); a 444 is a refusal
    // of our network, which a browser on another identity can pass. A host
    // whose Retry-After is still open (over 10 s, or repeated on the retry)
    // asked us to back off, and a stealth request now would override it (G6).
    const backingOff = (response.status === 429 || response.status === 503) && retryAfterMs(response) !== null;
    if (escalate && failed && !backingOff && (aBrowserMightPass(verdict, response.status) || response.status === 444)) {
      const vendorDetected = verdict?.blocked?.vendor ?? null;
      if (!escalateFetch) {
        warnings.push('escalate: no stealth stage is wired into this server build');
      } else {
        try {
          const stealth = await escalateFetch({ url: response.url || url, engine: escalateEngine, respectRobots });
          escalationRan = true;
          const engine = stealth.engine || escalateEngine;
          // The stage's gate repeats the plain fetch's robots notes; say each once.
          for (const w of stealth.warnings ?? []) if (!warnings.includes(w)) warnings.push(w);
          const html = stealth.html || '';
          const finalUrl = stealth.url || response.url || url;
          const status = stealth.status ?? null;
          const rendered = stealthDocumentVerdict(
            { url: finalUrl, title: stealth.title || '', text: stealth.text || '', html, status },
            { waitedMs: stealth.gracedMs || 0, fetcher: 'the stealth browser', rendered: true, contentReturned: false }
          );
          warnings.push(
            `escalate: the plain fetch ${vendorDetected ? `was blocked by ${vendorDetected}` : 'did not return the page'}; ` +
            `${engine === 'impit' ? 'a Chrome TLS handshake (impit, honest User-Agent)' : `the ${engine} stealth browser`} ${rendered.success ? 'returned it' : 'did not get it either'}`
          );
          fields.escalated = true;
          fields.stealth = { engine, vendor_detected: vendorDetected };
          if (!rendered.success) {
            return { error: rendered.error, url: finalUrl, status, ...(rendered.blocked ? { blocked: rendered.blocked } : {}), warnings, fields };
          }
          return { html, url: finalUrl, type: 'text/html', warnings, fields };
        } catch (err) {
          // A robots refusal inside the gate stamps markPreflightRefusal, and
          // withAuth then bills the whole call zero: nothing was rendered.
          warnings.push(`escalate: the stealth retry did not run — ${err.message}`);
        }
      }
    }

    const failure = targetFailure(response, url, verdict);
    if (failure) {
      return { error: failure, url: response.url || url, status: response.status, ...(verdict?.blocked ? { blocked: verdict.blocked } : {}), warnings, fields };
    }

    const html = response._body ?? '';
    if (!isJsonType(type) && isClientRenderedShell(html)) {
      warnings.push(CLIENT_RENDERED_WARNING);
      fields.rendered = false;
    }
    return { html, url: response.url || url, type, warnings, fields };
  } finally {
    // The projection is 1+5 when escalating; the stage's 5 is owed only if it ran.
    if (escalate) setActualCost(EXTRACT_BASE_CREDITS + (escalationRan ? SCRAPE_ESCALATION_CREDITS : 0));
  }
}

/**
 * The error result for a ladder that did not return a page. Unescalated, the
 * E1 text error; with escalate asked for, a JSON body carrying `escalated`,
 * so withAuth's hint does not send the caller back to the stealth browser.
 * @param {string} tool
 * @param {string} prefix e.g. 'Failed to extract text: '
 * @param {object} ladder fetchLadder's result
 */
export function ladderErrorResult(tool, prefix, ladder) {
  if (ladder.unsupported) {
    return {
      content: [{
        type: 'text',
        text: `${prefix}UNSUPPORTED_CONTENT_TYPE: Unsupported content type ${ladder.unsupported}: ${tool} reads ${tool === 'extract_links' ? 'HTML' : 'HTML and text'}\n` +
          'Next step: process_document reads PDF and DOCX documents from a URL (2 credits); an image or an archive has no text to extract.'
      }],
      isError: true
    };
  }
  if (!('escalated' in ladder.fields)) {
    return { content: [{ type: 'text', text: `${prefix}${ladder.error}` }], isError: true };
  }
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: false,
        url: ladder.url,
        ...(typeof ladder.status === 'number' ? { status: ladder.status } : {}),
        error: ladder.error,
        ...(ladder.blocked ? { blocked: ladder.blocked } : {}),
        ...ladder.fields,
        ...(ladder.warnings.length > 0 ? { warnings: ladder.warnings } : {})
      }, null, 2)
    }],
    isError: true
  };
}
