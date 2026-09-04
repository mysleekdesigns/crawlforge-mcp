/**
 * robotsGate — the one pre-fetch gate every fetching tool goes through.
 *
 * Before this module, `RobotsChecker` was instantiated in exactly one place
 * (BFSCrawler), so only `crawl_deep` honoured robots.txt; `scrape`,
 * `batch_scrape`, `scrape_template`, `track_changes`, `map_site` and every
 * `extract_*` tool did no robots check at all. Ground rule G5 says every
 * fetching tool respects robots.txt by default, so the check has to live at the
 * fetch boundary rather than in one crawler.
 *
 * Order matters. The platform blocklist (G7) is consulted first and is not
 * overridable by anything a caller can send; robots (G5) is next and *is*
 * overridable, but only explicitly, with a warning and an audit row; the
 * host's Crawl-delay (G6) then feeds the per-host throttle.
 *
 * Callers replace `await throttleHost(url)` with `await preflightFetch(url, …)`
 * and spread the returned `headers` into the request.
 */

import { RobotsChecker } from './robotsChecker.js';
import { assertHostAllowed } from './hostBlocklist.js';
import { identityHeaders, resolveUserAgent } from './fetchIdentity.js';
import { throttleHost } from './hostRateLimiter.js';
import { recordComplianceEvent, apiKeyId } from './complianceAudit.js';
import { signRequestHeaders } from './webBotAuth.js';
import { markPreflightRefusal } from '../server/requestContext.js';
import { config } from '../constants/config.js';

export class RobotsDisallowedError extends Error {
  constructor(url) {
    super(
      `robots.txt on ${new URL(url).host} disallows this path for CrawlForge. ` +
      `Pass respect_robots: false to fetch it anyway — that override is recorded ` +
      `against your API key and is your decision to make.`
    );
    this.name = 'RobotsDisallowedError';
    this.code = 'ROBOTS_DISALLOWED';
    this.url = url;
  }
}

/**
 * One checker per identity, so the robots cache is process-wide rather than
 * per-tool — otherwise every tool would re-fetch the same robots.txt.
 * @type {Map<string, RobotsChecker>}
 */
const checkers = new Map();

function checkerFor(userAgent) {
  let checker = checkers.get(userAgent);
  if (!checker) {
    checker = new RobotsChecker(userAgent);
    checkers.set(userAgent, checker);
  }
  return checker;
}

/**
 * Decide whether a URL may be fetched. Pure decision — does no throttling and
 * sends no request other than the (cached) robots.txt lookup.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {boolean} [options.respectRobots] per-request override; defaults to
 *   `config.crawling.respectRobots`. `false` is honoured, warned about, audited.
 * @param {string}  [options.userAgent] per-request identity override
 * @param {string}  [options.tool] tool name, for the audit row
 * @param {string}  [options.apiKey] hashed into the audit row, never stored raw
 * @returns {Promise<{ allowed: boolean, userAgent: string, crawlDelayMs: number,
 *   warnings: string[], overridden: boolean }>}
 * @throws {BlockedHostError} for a permanently blocked host
 */
export async function robotsPreflight(url, options = {}) {
  // G7 — first, and not overridable. Stamp before rethrowing so a blocked host
  // costs the caller nothing: we refused, we fetched nothing.
  try {
    assertHostAllowed(url);
  } catch (error) {
    if (error?.code === 'HOST_BLOCKED') markPreflightRefusal('HOST_BLOCKED');
    throw error;
  }

  const userAgent = resolveUserAgent(options.userAgent);
  const warnings = [];

  const explicitOverride = options.respectRobots === false;
  const respect = options.respectRobots === undefined
    ? config.crawling.respectRobots
    : options.respectRobots !== false;

  const checker = checkerFor(userAgent);
  let allowed = true;
  let crawlDelayMs = 0;

  try {
    allowed = await checker.canFetch(url);
    crawlDelayMs = (await checker.fetchCrawlDelay(url)) * 1000;
  } catch {
    // Unreadable robots.txt is not a disallow (see RobotsChecker.canFetch).
    allowed = true;
  }

  if (explicitOverride) {
    warnings.push(
      allowed
        ? 'respect_robots was disabled for this request. robots.txt did not disallow this URL, so the override changed nothing. The request is recorded against your API key.'
        : `respect_robots was disabled for this request and robots.txt on ${new URL(url).host} disallows this path. Fetching anyway is your decision and is recorded against your API key.`
    );
    recordComplianceEvent({
      event: 'robots_override',
      url,
      tool: options.tool || null,
      apiKeyId: apiKeyId(options.apiKey),
      userAgent,
      robotsAllowed: allowed
    });
  }

  return {
    allowed: allowed || !respect,
    userAgent,
    crawlDelayMs,
    warnings,
    overridden: explicitOverride && !allowed
  };
}

/**
 * The call-site helper: run the gate, honour Crawl-delay and any recorded
 * `Retry-After`, and hand back the identity headers to send.
 *
 * @param {string} url
 * @param {object} [options] see {@link robotsPreflight}
 * @returns {Promise<{ headers: Record<string,string>, userAgent: string,
 *   warnings: string[], overridden: boolean }>}
 * @throws {BlockedHostError|RobotsDisallowedError}
 */
/**
 * The headers an HTTP page fetch carries: identity, the Web Bot Auth signature
 * when one is configured, and an EMPTY Accept-Language.
 *
 * Node's fetch adds `Accept-Language: *` whenever the caller sets none. Amazon
 * answers this identity with a captcha interstitial when ANY Accept-Language
 * rides along — `*`, en-US, de-DE, a full browser list — and serves the page
 * when the header is absent (R14, bisected header by header with curl, then
 * reproduced with Node's fetch). fetch offers no way to leave the header out,
 * but an empty value is sent as-is instead of `*`, and Amazon treats empty as
 * absent. The identity stays honest; no language preference is claimed.
 * @param {string} [userAgent]
 * @param {Record<string,string>} [signature]
 * @returns {Record<string,string>}
 */
export function outboundHeaders(userAgent, signature = {}) {
  return {
    ...identityHeaders({ userAgent }),
    'Accept-Language': '',
    ...signature
  };
}

export async function preflightFetch(url, options = {}) {
  const decision = await robotsPreflight(url, options);
  if (!decision.allowed) {
    markPreflightRefusal('ROBOTS_DISALLOWED');
    throw new RobotsDisallowedError(url);
  }

  await throttleHost(url, { crawlDelayMs: decision.crawlDelayMs });

  // Web Bot Auth: when a signing key is configured, every request also carries
  // a signature a site owner can verify against our published key. No key
  // configured means no headers and no behaviour change. Requests with a
  // caller-supplied userAgent override are still signed — the signature covers
  // @authority, not the UA, and it identifies the operator (us), not the
  // identity the caller asked us to present.
  const signature = signRequestHeaders(url) || {};

  return {
    headers: outboundHeaders(decision.userAgent, signature),
    userAgent: decision.userAgent,
    warnings: decision.warnings,
    overridden: decision.overridden
  };
}

/**
 * The gate for browser paths. Same decision as {@link preflightFetch}, minus
 * the identity and signature headers — those belong on an HTTP fetch, not on a
 * browser context that presents its own identity.
 *
 * Deliberately takes no `userAgent`: robots.txt is matched against our
 * canonical product token even when the browser presents another UA. Matching
 * on the presented UA would let browser traffic walk past the rules our own
 * token is bound by, which is the G5 hole this gate exists to close.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {boolean} [options.respectRobots] per-request override
 * @param {string}  [options.tool] tool name, for the audit row
 * @param {string}  [options.apiKey] hashed into the audit row, never stored raw
 * @returns {Promise<string[]>} warnings to surface on the response
 * @throws {BlockedHostError|RobotsDisallowedError}
 */
export async function browserPreflight(url, options = {}) {
  const decision = await robotsPreflight(url, {
    respectRobots: options.respectRobots,
    tool: options.tool,
    apiKey: options.apiKey
  });
  if (!decision.allowed) {
    markPreflightRefusal('ROBOTS_DISALLOWED');
    throw new RobotsDisallowedError(url);
  }

  await throttleHost(url, { crawlDelayMs: decision.crawlDelayMs });
  return decision.warnings;
}

/** Test/diagnostic hook: drop every cached robots.txt. */
export function _resetRobotsGate() {
  checkers.clear();
}

/** Test/diagnostic hook: total robots.txt requests made across all identities. */
export function _robotsFetchCount() {
  let total = 0;
  for (const checker of checkers.values()) total += checker.fetchCount;
  return total;
}
