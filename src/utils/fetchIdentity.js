/**
 * fetchIdentity — the single outbound identity for every CrawlForge fetch.
 *
 * Nine tools used to hardcode nine different User-Agents, so nine tools saw nine
 * different versions of the same page (a Zillow listing served 41 `address`
 * elements to one tool and 9 to another). That is a correctness bug, not a
 * disguise problem, and the fix is one honest identity everywhere:
 *
 *     CrawlForge/<version> (+https://crawlforge.dev)
 *
 * Ground rule G4: identify honestly by default — real product name, real
 * contact URL — so a site that wants to block us can. Callers that have their
 * own agreement with a target can pass a per-request `userAgent` override
 * (G4's escape hatch); the override wins, the canonical UA applies otherwise.
 *
 * The literal 'User-Agent' header name lives here and nowhere else outside the
 * browser paths, so `identityHeaders()` is the only way to spell it.
 */

import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
const _pkg = _require('../../package.json');

/** The canonical, honest identity every page fetch sends. */
export const CRAWLFORGE_USER_AGENT = `CrawlForge/${_pkg.version} (+https://crawlforge.dev)`;

/**
 * Identity for non-page traffic (webhook delivery, health checks, alerting).
 * Same product name and contact URL, with the role appended so a receiving
 * server can tell a webhook POST from a crawl. Falls back to the canonical UA.
 * @param {string} [role]
 * @returns {string}
 */
export function serviceUserAgent(role) {
  const trimmed = typeof role === 'string' ? role.trim() : '';
  return trimmed
    ? `CrawlForge/${_pkg.version} (+https://crawlforge.dev; ${trimmed})`
    : CRAWLFORGE_USER_AGENT;
}

/**
 * Resolve the User-Agent for a request: a non-empty override wins, otherwise
 * the canonical identity (optionally role-suffixed).
 * @param {string} [override]
 * @param {string} [role]
 * @returns {string}
 */
export function resolveUserAgent(override, role) {
  const trimmed = typeof override === 'string' ? override.trim() : '';
  return trimmed || serviceUserAgent(role);
}

/**
 * The outbound identity headers for a fetch. Spread this into a headers object
 * rather than writing the header name at the call site.
 * @param {{ userAgent?: string, role?: string }} [options]
 * @returns {{ 'User-Agent': string }}
 */
export function identityHeaders(options = {}) {
  return { 'User-Agent': resolveUserAgent(options.userAgent, options.role) };
}
