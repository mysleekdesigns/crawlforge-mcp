/**
 * batchSearch.js — the one declaration of `search_web`'s `queries` param
 * (Phase 5, 5.1).
 *
 * `search_web` takes one query. A caller comparing five phrasings, or
 * checking a term across five sites, pays five round-trips for what is one
 * unit of work. `queries` accepts 1-10 of them in a single call; each still
 * runs through the SAME `execute()` pipeline — expansion, cache, dedupe,
 * rank — so a batch entry and a single call are the same result.
 *
 * The batch wrapper sits ABOVE the provider short-circuit in `execute()`, so
 * the SearXNG branch (which is not part of the adapter factory) inherits
 * `queries` without a second implementation.
 *
 * The field and the price rule live here so `server.js`, the tool module and
 * `AuthManager.getToolCost` read one declaration (G5) — the same arrangement
 * `escalation.js` has for `scrape`.
 */

import { z } from 'zod';

/** How many queries one call may carry. */
export const MAX_SEARCH_QUERIES = 10;

/** search_web's price for ONE query, as AuthManager's table spells it. */
export const SEARCH_WEB_CREDITS = 5;

/** The public field, with the text the client sees. */
export const SEARCH_QUERIES_PARAM = {
  queries: z.array(z.string().min(1)).min(1).max(MAX_SEARCH_QUERIES).optional().describe(`Run 1-${MAX_SEARCH_QUERIES} searches in one call instead of ${MAX_SEARCH_QUERIES} round-trips; every other parameter applies to each. Results come back in results_by_query, one entry per query, in order. Costs 5 per query. Use this OR query, not both`)
};

/** Rejected when a call carries both `query` and `queries`, or neither. */
export const EXACTLY_ONE_QUERY_MESSAGE =
  `search_web needs exactly one of "query" (a single search) or "queries" (1-${MAX_SEARCH_QUERIES} searches in one call), not both and not neither`;

/**
 * How many searches this call will run, for pricing. Reads the RAW param —
 * getToolCost runs before validation — so anything that is not a non-empty
 * array prices as the single-query form, and a caller who sends more than the
 * schema allows never produces a silly projection (the schema rejects that
 * call before it is billed at all).
 *
 * @param {unknown} queries the raw `queries` param
 * @returns {number} 1..MAX_SEARCH_QUERIES
 */
export function searchQueryCount(queries) {
  if (!Array.isArray(queries) || queries.length === 0) return 1;
  return Math.min(queries.length, MAX_SEARCH_QUERIES);
}
