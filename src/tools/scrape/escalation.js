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

/**
 * Whether a second, browser-backed attempt could plausibly change this
 * outcome.
 *
 * A named vendor's wall qualifies, and so does a bare 403 or 429 — an
 * IP-reputation, WAF or User-Agent block, which a real browser and fingerprint
 * often do pass (travel.state.gov answers some networks with exactly that). So
 * does any failure that arrived with a 2xx: an empty shell, a JavaScript-only
 * document or a soft-error placeholder is precisely what rendering fixes.
 *
 * A 404 is not a wall and a 5xx is the server's own failure. Escalating either
 * would spend the browser's 5 credits to be told the same thing, so `escalate`
 * leaves them as the plain fetch reported them (G4 — never charge for work
 * that cannot help).
 *
 * @param {{ blocked?: unknown } | null | undefined} verdict
 * @param {number | null | undefined} status
 * @returns {boolean}
 */
export function aBrowserMightPass(verdict, status) {
  if (verdict && verdict.blocked) return true;
  if (status === 403 || status === 429) return true;
  return status === null || status === undefined || (status >= 200 && status < 300);
}
