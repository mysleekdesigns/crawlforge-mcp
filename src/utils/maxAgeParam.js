/**
 * maxAgeParam — the one declaration of `maxAge` (repeat-call reduction plan,
 * Phase 1, 1.5 / D2). Passed through as `options.maxAge` to the two page-cache
 * seams, fetchWithTimeout and fetchAndParse; undefined means the server's
 * default TTL there.
 */

import { z } from 'zod';
import { pageCacheActive } from '../core/pageCache.js';

export const MAX_AGE_PARAM = {
  maxAge: z.number().int().min(0).optional().describe("Reuse this session's copy of the page if it was fetched within this many ms (default 600000 = 10 min); 0 always fetches fresh.")
};

// Phase 3 (3.1): the one sentence the nine cached tools' descriptions carry.
// Empty where the cache is off (hosted HTTP, CRAWLFORGE_PAGE_CACHE_MB=0).
export const PAGE_CACHE_TEXT = ' Asking again for the same page with different formats, paths or selectors reuses this session\'s copy for 10 minutes at 1 credit; pass maxAge: 0 to force a fresh fetch.';
export const PAGE_CACHE_SENTENCE = pageCacheActive() ? PAGE_CACHE_TEXT : '';
