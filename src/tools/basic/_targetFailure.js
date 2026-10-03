/**
 * Why a fetched document fails extract_links / extract_text, with the same
 * verdict and wording as the REST routes (fix plan Phase E1).
 *
 * A named vendor's wall fails on any status: a challenge arrives as a 403 or
 * as a 200 with the wall in the body. Any other non-2xx fails with its
 * status. An empty shell or an error placeholder on a 2xx is not raised here;
 * extraction proceeds as before.
 */

import { load } from 'cheerio';
import { stealthDocumentVerdict } from '../../utils/stealthVerdict.js';
import { pageTitle } from '../../utils/pageTitle.js';

// Response bodies a verdict can be read from; anything else is a binary. A
// missing Content-Type is read, as _fetchAndParse.js treats it as HTML.
const TEXTUAL_BODY = /^(?:text\/(?:html|plain)|application\/xhtml\+xml)\b/i;

/**
 * @param {Response & { _body: string }} response - from fetchWithTimeout
 * @param {string} url - the requested URL
 * @returns {string|null} the error message, or null when the document is usable
 */
export function targetFailure(response, url) {
  const contentType = response.headers?.get?.('content-type');
  if (!contentType || TEXTUAL_BODY.test(contentType)) {
    // A parse of its own, scripts and styles removed, so the handler's
    // document stays intact.
    const $ = load(response._body ?? '');
    $('script, style, noscript').remove();
    const verdict = stealthDocumentVerdict(
      {
        url: response.url || url,
        status: response.status,
        title: pageTitle($),
        text: $('body').text().replace(/\s+/g, ' ').trim(),
        html: response._body
      },
      { fetcher: 'a plain fetch', rendered: false, contentReturned: false }
    );
    if (verdict.blocked) return `Target answered HTTP ${response.status}: ${verdict.error}`;
  }
  return response.ok ? null : `Target answered HTTP ${response.status}`;
}
