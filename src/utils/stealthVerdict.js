/**
 * stealthVerdict.js — decide what a stealth-rendered document is.
 *
 * A browser scrape that reached a document is not a scrape that succeeded.
 * Round 18 (2026-09-04, pricing sweep) returned success:true for Edmunds'
 * "403 - Access Denied" page, Lufthansa's "Page not found", Home Depot's
 * "Error Page" and Hilton's "Something went wrong" — each an HTTP error or a
 * soft block served with a title and a few lines of prose, so the R15
 * challenge-vendor check and the R16 empty-document check both passed it.
 * The HTTP status of the navigation and a short error-titled document are
 * now failures too; the content is still returned so the caller can read
 * what the site served.
 */

import { detectChallengePage } from './challengeDetection.js';

// A document this short with one of these titles is an error placeholder,
// not a page. Real pages with these words in a longer title (a news story
// about an outage) carry far more text than the cap.
const ERROR_TITLE = /^(?:(?:\d{3}\s*[-–—|:]\s*)?(?:error(?: page)?|access denied|forbidden|(?:page )?not found|service unavailable|internal server error|bad gateway|something went wrong|oops!?[^\n]{0,60}))$/i;
export const SOFT_ERROR_MAX_CHARS = 1500;

/**
 * @param {{ url?: string, title?: string, text?: string, html?: string, status?: number|null }} scraped
 * @param {{ waitedMs?: number, allowEmpty?: boolean }} [options]
 * @returns {{ success: boolean, status: number|null, error?: string, blocked?: { vendor: string, evidence: string } }}
 */
export function stealthDocumentVerdict(scraped, { waitedMs = 0, allowEmpty = false } = {}) {
  const status = Number.isInteger(scraped?.status) ? scraped.status : null;
  const url = scraped?.url || '';
  const title = String(scraped?.title || '').trim();
  const text = String(scraped?.text || '').trim();

  const challenge = detectChallengePage(scraped || {});
  if (challenge) {
    return {
      success: false,
      status,
      blocked: challenge,
      error: `${challenge.vendor} served a challenge page instead of the content (${challenge.evidence}); the stealth browser did not pass it.`
    };
  }

  if (status !== null && status >= 400) {
    const why = status === 403
      ? 'A 403 with no challenge vendor on the page is an IP-reputation or WAF block; the site will not serve this network.'
      : status === 404
        ? 'The site says the URL does not exist — check the path.'
        : status === 429
          ? 'The site is rate-limiting this network; wait before retrying.'
          : 'Retry later; the server, not the page, failed.';
    return {
      success: false,
      status,
      error: `HTTP ${status}: ${url} answered with an error page${title ? ` titled "${title}"` : ''}, not the resource; the content returned is that page. ${why}`
    };
  }

  if (!title && !text) {
    if (allowEmpty) return { success: true, status };
    return {
      success: false,
      status,
      error:
        `The stealth browser reached ${url} but the document rendered no title and no text` +
        ` after ${waitedMs}ms of extra wait (${(scraped?.html || '').length} bytes of HTML).` +
        ' A JavaScript-rendered page needs a longer wait_for; an empty document means the server sent nothing to render.'
    };
  }

  if (text.length < SOFT_ERROR_MAX_CHARS && ERROR_TITLE.test(title)) {
    return {
      success: false,
      status,
      error:
        `${url} rendered an error page titled "${title}" (${text.length} characters of text) instead of the resource` +
        ' — a soft block or an application error. Retry later, or with a longer wait_for if the site paints content after a placeholder.'
    };
  }

  return { success: true, status };
}
