/**
 * stealthVerdict.js — re-export of the document verdict.
 *
 * `stealthDocumentVerdict` moved to crawlforge-extractors 1.7.0 as
 * `documentVerdict` — the same behaviour and messages for the stealth callers,
 * plus a `fetcher` option so the plain `scrape` path on both surfaces reaches
 * the same verdict (Phase 0, 0.1). Callers keep importing from here.
 */

export { documentVerdict as stealthDocumentVerdict, SOFT_ERROR_MAX_CHARS } from 'crawlforge-extractors';
