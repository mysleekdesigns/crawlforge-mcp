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

// AWS WAF's challenge interstitial, which upstream's table does not know yet.
// amazon.com answered a headless Chromium with HTTP 202 and this page four
// times out of four (2026-10-03): no title, no text, `window.gokuProps = {…}`
// and a token.awswaf.com challenge.js that reloads into the real homepage
// about 0.4 s after domcontentloaded. gokuProps is the payload the WAF injects
// into its own page; a real page that integrates the WAF SDK loads
// challenge.js but carries no gokuProps, and the short-page cap keeps it out
// regardless. Read only here until upstream's CHALLENGES table takes it.
const AWS_WAF_INTERSTITIAL = /window\.gokuProps\s*=/;
const SHORT_PAGE_CHARS = 4000;

function awsWafVerdict(scraped, verdict, options) {
  const visible = String(scraped?.text || '').replace(/\s+/g, ' ').trim();
  if (visible.length >= SHORT_PAGE_CHARS || !AWS_WAF_INTERSTITIAL.test(String(scraped?.html || ''))) return null;
  const blocked = { vendor: 'aws-waf', evidence: `an AWS WAF challenge interstitial on a ${visible.length}-character page` };
  return {
    success: false,
    status: verdict.status,
    blocked,
    error: `${blocked.vendor} served a challenge page instead of the content (${blocked.evidence}); ${options?.fetcher || 'the stealth browser'} did not pass it.`
  };
}

/**
 * @param {{ url?: string, title?: string, text?: string, html?: string, status?: number|null }} scraped
 * @param {{ waitedMs?: number, allowEmpty?: boolean, fetcher?: string, rendered?: boolean, contentReturned?: boolean }} [options]
 * @returns {{ success: boolean, status: number|null, error?: string, blocked?: { vendor: string, evidence: string } }}
 */
export function stealthDocumentVerdict(scraped, options) {
  const verdict = documentVerdict(scraped, options);
  if (!verdict.blocked) return awsWafVerdict(scraped, verdict, options) || verdict;
  if (detectChallengePage(scraped || {})) return verdict;
  // The neutralised copy is read by upstream and discarded; the caller's own
  // document is never rewritten.
  const html = String(scraped?.html || '').replace(TURNSTILE_WIDGET, 'turnstile-widget');
  return documentVerdict({ ...scraped, html }, options);
}
