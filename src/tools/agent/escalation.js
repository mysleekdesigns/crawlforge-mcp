/**
 * escalation.js — the one declaration of the `agent` tool's automatic stealth
 * retry (stealth review Phase 3, decision 4: automatic, capped).
 *
 * When ACT's plain fetch comes back walled (challenge page, 403/429, empty
 * shell, timeout), the agent retries the URL once through the same stealth
 * stage `scrape`'s escalate:true uses. It is not opt-in, so it is capped per
 * run and priced per retry that actually runs.
 *
 * The cap and the price live here so the orchestrator, the tool wrapper and
 * `AuthManager.getToolCost` read one declaration — the arrangement
 * `src/tools/scrape/escalation.js` has for `scrape`. Imports nothing, so
 * AuthManager can read it without pulling in the orchestrator.
 */

/** What one stealth retry adds to the agent's price: the stealth browser's own. */
export const AGENT_ESCALATION_CREDITS = 5;

/**
 * Most stealth retries one run may make. A second, independent bound on top
 * of maxSteps/maxUrls/wall-clock: each retry is a browser launch (seconds,
 * and hundreds of MB) and 5 credits, and the projection a caller is checked
 * against has to be a finite ceiling.
 */
export const AGENT_MAX_ESCALATIONS = 2;

/**
 * The most escalation can add to one call — the ceiling getToolCost projects.
 * Reads the RAW params (getToolCost runs before validation). The pro model
 * delegates to ResearchOrchestrator and never runs this stage, so it adds 0.
 *
 * @param {object|undefined} params
 * @returns {number}
 */
export function agentEscalationSurcharge(params) {
  if (params?.model === 'pro') return 0;
  const maxUrls = Number.isFinite(params?.maxUrls) && params.maxUrls >= 1 ? Math.floor(params.maxUrls) : AGENT_MAX_ESCALATIONS;
  return AGENT_ESCALATION_CREDITS * Math.min(AGENT_MAX_ESCALATIONS, maxUrls);
}
