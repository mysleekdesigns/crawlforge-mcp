/**
 * escalation.js — the one declaration of `scrape`'s opt-in auto-escalation.
 *
 * `escalate: true` asks the tool to run the stealth browser itself when the
 * plain fetch comes back walled (Phase 3). The plain fetch always runs first
 * (G1: never start with stealth), so the escalation is a second stage, not a
 * different tool: it reuses the same compliance gate and the same
 * StealthBrowserManager `stealth_mode` uses, and adds no new evasion.
 *
 * The two fields and the price rule live here so `server.js`, the tool
 * module, `AuthManager.getToolCost` and the output schema read one
 * declaration (G5) — the same arrangement `formats.js` already has for the
 * query-format surcharge.
 */

import { z } from 'zod';

/** What an escalated call adds to `scrape`'s price: the stealth browser's own. */
export const SCRAPE_ESCALATION_CREDITS = 5;

/** The two public fields, in tools/list order, with the text the client sees. */
export const SCRAPE_ESCALATION_SHAPE = {
  escalate: z.boolean().optional().default(false).describe('When the plain fetch comes back blocked (403/429/challenge page/empty shell), retry once in the stealth browser and return its content instead of the block. Projected at 2+5; the actual charge stays at the base price when the plain fetch succeeded. Default: false'),
  escalate_engine: z.enum(['playwright', 'camoufox']).optional().default('playwright').describe('Stealth engine for the escalated retry (default: "playwright")')
};

/**
 * What escalation adds to `scrape`'s base price: 5 when the caller asked for
 * it, nothing otherwise. Reads the RAW param — getToolCost runs before
 * validation, so anything that is not exactly `true` prices as 0.
 *
 * @param {unknown} escalate the raw `escalate` param
 * @returns {0 | 5}
 */
export function scrapeEscalationSurcharge(escalate) {
  return escalate === true ? SCRAPE_ESCALATION_CREDITS : 0;
}
