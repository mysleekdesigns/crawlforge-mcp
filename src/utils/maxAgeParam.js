/**
 * maxAgeParam — the one declaration of `maxAge` (repeat-call reduction plan,
 * Phase 1, 1.5 / D2). Passed through as `options.maxAge` to the two page-cache
 * seams, fetchWithTimeout and fetchAndParse; undefined means the server's
 * default TTL there.
 */

import { z } from 'zod';

export const MAX_AGE_PARAM = {
  maxAge: z.number().int().min(0).optional().describe("Reuse this session's copy of the page if it was fetched within this many ms (default 600000 = 10 min); 0 always fetches fresh.")
};
