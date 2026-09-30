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
import { assertNotRedditUrl } from './redditHosts.js';
import { identityHeaders, resolveUserAgent } from './fetchIdentity.js';
import { throttleHost } from './hostRateLimiter.js';
import { recordComplianceEvent, apiKeyId } from './complianceAudit.js';
import { signRequestHeaders } from './webBotAuth.js';
import { markPreflightRefusal, internalOwnerToken } from '../server/requestContext.js';
import AuthManager from '../core/AuthManager.js';
import { config } from '../constants/config.js';

/** A URL as it may appear in an error: no query string, which can carry a key. */
function withoutQuery(url) {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

export class RobotsDisallowedError extends Error {
  /**
   * @param {string} url the URL robots.txt disallows
   * @param {{ redirectedFrom?: string, movedFrom?: string }} [options] set when
   *   `url` is not what the caller asked for, so the message says how it was
   *   reached: `redirectedFrom` when a redirect led there, `movedFrom` when a
   *   browser page went there by itself (a click, a form, a script)
   */
  constructor(url, { redirectedFrom, movedFrom } = {}) {
    const host = new URL(url).host;
    let reached = `robots.txt on ${host} disallows this path for CrawlForge. `;
    if (redirectedFrom) {
      reached = `${withoutQuery(redirectedFrom)} redirects to ${withoutQuery(url)}, and robots.txt on ${host} disallows that path for CrawlForge. `;
    } else if (movedFrom) {
      reached = `The page moved from ${withoutQuery(movedFrom)} to ${withoutQuery(url)}, and robots.txt on ${host} disallows that path for CrawlForge. `;
    }
    super(
      reached +
      `Pass respect_robots: false to ${movedFrom ? 'use' : 'fetch'} it anyway — that override is recorded ` +
      `against your API key and is your decision to make.`
    );
    this.name = 'RobotsDisallowedError';
    this.code = 'ROBOTS_DISALLOWED';
    this.url = url;
  }
}

/** What a refusal carries as `code`: this gate's three, and the SSRF guard's. */
const REFUSAL_CODES = new Set(['ROBOTS_DISALLOWED', 'HOST_BLOCKED', 'USE_REDDIT_SEARCH', 'SSRF_BLOCKED']);

/**
 * The refusal code an error carries, or null when it is a failure rather than
 * a refusal. A refusal is this gate or the SSRF guard saying no: asking again
 * gets the same answer, so nothing should retry it.
 * @param {unknown} error
 * @returns {string|null}
 */
export function gateRefusalCode(error) {
  for (const code of [error?.code, error?.cause?.code]) {
    if (REFUSAL_CODES.has(code)) return code;
  }
  return null;
}

/**
 * Remove a known deployment credential from a URL bound for the audit log: the
 * raw value and both encodings of it. `URLSearchParams` escapes `~ ! ' ( )` and
 * writes a space as `+`; `encodeURIComponent` does neither.
 */
function redactSecret(value, secret) {
  if (!secret) return value;
  const forms = new Set([
    secret,
    encodeURIComponent(secret),
    new URLSearchParams({ s: secret }).toString().slice(2)
  ]);
  let redacted = value;
  for (const form of forms) redacted = redacted.replaceAll(form, '[redacted]');
  return redacted;
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
 * @param {string}  [options.redactCredential] a deployment credential that
 *   appears in `url` (a keyed connector puts its key in the query string), to
 *   remove from the audit row. The row keeps the URL, because it has to say
 *   what was fetched, and loses the secret.
 * @returns {Promise<{ allowed: boolean, userAgent: string, crawlDelayMs: number,
 *   warnings: string[], overridden: boolean }>}
 * @throws {BlockedHostError} for a permanently blocked host
 */
export async function robotsPreflight(url, options = {}) {
  // G7 — first, and not overridable. Stamp before rethrowing so a blocked host
  // costs the caller nothing: we refused, we fetched nothing.
  try {
    assertHostAllowed(url);
    // reddit.com refuses every non-browser client, so it is never fetched and
    // the caller is pointed at reddit_search instead. Also not overridable.
    assertNotRedditUrl(url);
  } catch (error) {
    if (error?.code === 'HOST_BLOCKED' || error?.code === 'USE_REDDIT_SEARCH') {
      markPreflightRefusal(error.code);
    }
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
    // No fetching tool passes its key down to here, so the row falls back to
    // the key this server runs under, as the stealth_escalation row does.
    // Without it every live override was logged as "anonymous".
    const ownerToken = internalOwnerToken();
    recordComplianceEvent({
      event: 'robots_override',
      url: redactSecret(url, options.redactCredential),
      tool: options.tool || null,
      apiKeyId: apiKeyId(options.apiKey ?? AuthManager.getConfig()?.apiKey),
      ...(ownerToken ? { ownerId: apiKeyId(ownerToken) } : {}),
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
 * The gate for a redirect hop, to pass to the fetch as `onRedirect`.
 *
 * The gate above decides about the URL the caller asked for; a redirect can
 * lead anywhere. Without this a 301 into a path robots.txt disallows, or onto
 * a host on the platform blocklist, was fetched because nobody asked again.
 * Each hop gets the decision a first request would: blocklist, then robots,
 * with the caller's own `respect_robots` and an audit row when it overrides.
 *
 * It then waits its turn as a first request would: the hop is one more request
 * to its host, so it is spaced by that host's Crawl-delay, by a Retry-After it
 * has sent and by our own per-host limit. A fetch does not charge that wait to
 * its timeout (resignedFetch.js). A browser has made the request before anyone
 * could be asked, so its caller passes `alreadyRequested` and nothing is
 * slept: there is no request left to space.
 *
 * @param {string} from the URL the fetch started at, for the refusal message
 * @param {object} [options] see {@link robotsPreflight}
 * @returns {(to: string, hop?: { alreadyRequested?: boolean }) => Promise<void>}
 *   throws BlockedHostError or RobotsDisallowedError to refuse the hop
 */
export function redirectGate(from, options = {}) {
  return hopGate(options, { redirectedFrom: from });
}

/**
 * The gate for a URL a browser page reached without being sent there: a click
 * followed a link, a form posted, a script redirected, a client-side router
 * rewrote the address. The decision is {@link redirectGate}'s; only the
 * refusal reads differently, because nothing redirected.
 *
 * @param {string} [from] the last URL the page was checked at
 * @param {object} [options] see {@link robotsPreflight}
 * @returns {(to: string, hop?: { alreadyRequested?: boolean }) => Promise<void>}
 *   throws BlockedHostError or RobotsDisallowedError to refuse where the page
 *   now stands
 */
export function pageMoveGate(from, options = {}) {
  return hopGate(options, { movedFrom: from });
}

function hopGate(options, reached) {
  return async (to, { alreadyRequested = false } = {}) => {
    const decision = await robotsPreflight(to, options);
    if (!decision.allowed) {
      markPreflightRefusal('ROBOTS_DISALLOWED');
      throw new RobotsDisallowedError(to, reached);
    }
    if (!alreadyRequested) await throttleHost(to, { crawlDelayMs: decision.crawlDelayMs });
  };
}

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

/**
 * The call-site helper: run the gate, honour Crawl-delay and any recorded
 * `Retry-After`, and hand back the identity headers to send and the gate for
 * any redirect the fetch follows. Pass both to the fetch.
 *
 * @param {string} url
 * @param {object} [options] see {@link robotsPreflight}
 * @returns {Promise<{ headers: Record<string,string>, userAgent: string,
 *   warnings: string[], overridden: boolean,
 *   onRedirect: (to: string) => Promise<void> }>}
 * @throws {BlockedHostError|RobotsDisallowedError}
 */
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
    warnings: [...decision.warnings, ...crawlDelayWarning(url, decision.crawlDelayMs)],
    overridden: decision.overridden,
    onRedirect: redirectGate(url, options)
  };
}

/**
 * Name a long Crawl-delay, so a slow multi-page call reads as compliance
 * rather than a stall: eff.org asks every agent for 30 s, and a 10-page
 * llms.txt run took 13 minutes with nothing in the response saying why (R21,
 * 2026-09-09).
 * @param {string} url
 * @param {number} crawlDelayMs
 * @returns {string[]}
 */
function crawlDelayWarning(url, crawlDelayMs) {
  if (!(crawlDelayMs >= 5000)) return [];
  let host = url;
  try { host = new URL(url).host; } catch { /* keep the raw url */ }
  return [
    `robots.txt on ${host} asks for a ${Math.round(crawlDelayMs / 1000)} s crawl delay; requests to it are spaced by that much, so a multi-page call takes about that long per page.`
  ];
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
  return [...decision.warnings, ...crawlDelayWarning(url, decision.crawlDelayMs)];
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
