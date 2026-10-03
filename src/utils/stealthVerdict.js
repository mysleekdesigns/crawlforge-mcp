/**
 * stealthVerdict.js — the document verdict, with the widget refinement.
 *
 * `stealthDocumentVerdict` moved to crawlforge-extractors 1.7.0 as
 * `documentVerdict` — the same behaviour and messages for the stealth callers,
 * plus a `fetcher` option so the plain `scrape` path on both surfaces reaches
 * the same verdict (Phase 0, 0.1). Callers keep importing from here.
 *
 * Upstream decides the block before every other rule it owns, so the widget
 * refinement in challengeDetection.js would never reach the verdict the tools
 * and the benchmark actually print. The wrapper below re-runs upstream on the
 * same document with the widget marker neutralised whenever the refinement
 * clears the block, so an HTTP error page, an empty shell or a short
 * error-titled placeholder that happens to embed a widget is still named by
 * upstream and still decides (Phase 1, finding 6).
 */

import { documentVerdict, SOFT_ERROR_MAX_CHARS } from 'crawlforge-extractors';
import { detectChallengePage } from './challengeDetection.js';

export { SOFT_ERROR_MAX_CHARS };

// The two Turnstile markers challengeDetection.js clears: the widget's script
// host, and the hidden response input the widget names itself
// (id="cf-chl-widget-<id>_response" — quora.com, measured 2026-09-21).
// Upstream's Cloudflare pattern matches a bare cf-chl-, so neutralising the
// host alone left the re-run blocking the same document a second time. Both
// are swapped for inert text; the bootstrap markers are never touched, so a
// document that carries one is still upstream's block to make.
const TURNSTILE_WIDGET = /challenges\.cloudflare\.com|cf-chl-widget/gi;

/**
 * @param {{ url?: string, title?: string, text?: string, html?: string, status?: number|null }} scraped
 * @param {{ waitedMs?: number, allowEmpty?: boolean, fetcher?: string, rendered?: boolean, contentReturned?: boolean }} [options]
 * @returns {{ success: boolean, status: number|null, error?: string, blocked?: { vendor: string, evidence: string } }}
 */
export function stealthDocumentVerdict(scraped, options) {
  const verdict = documentVerdict(scraped, options);
  if (!verdict.blocked || detectChallengePage(scraped || {})) return verdict;
  // The neutralised copy is read by upstream and discarded; the caller's own
  // document is never rewritten.
  const html = String(scraped?.html || '').replace(TURNSTILE_WIDGET, 'turnstile-widget');
  return documentVerdict({ ...scraped, html }, options);
}
