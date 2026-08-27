/**
 * hostBlocklist — the platform's permanent refusals (ground rule G7).
 *
 * When a site owner opts out or sends a takedown, the block has to hold at the
 * platform layer. A blocklist any customer can switch off is not a blocklist,
 * so nothing here reads a per-request flag: `respect_robots: false` does not
 * reach it, and neither does a `userAgent` override.
 *
 * To add an entry, append to BLOCKED_HOSTS with a dated one-line reason. Blocks
 * cover the host and all of its subdomains. `CRAWLFORGE_BLOCKED_HOSTS` (comma
 * separated) adds more at runtime; it can only ever extend the list.
 */

/** @type {string[]} host → blocked, with the date and reason it was added. */
const BLOCKED_HOSTS = [
  // e.g. 'example.com', // 2026-08-27 owner opt-out, ref #123
];

export class BlockedHostError extends Error {
  constructor(host) {
    super(
      `${host} is on CrawlForge's permanent blocklist (site-owner opt-out or takedown) ` +
      `and cannot be fetched. This block is not overridable. ` +
      `If you believe it is in error, contact support@crawlforge.dev.`
    );
    this.name = 'BlockedHostError';
    this.code = 'HOST_BLOCKED';
    this.host = host;
  }
}

let overrideList = null; // tests only

function blockedSet() {
  if (overrideList) return overrideList;
  const fromEnv = (process.env.CRAWLFORGE_BLOCKED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...BLOCKED_HOSTS.map((h) => h.toLowerCase()), ...fromEnv]);
}

/** The hostname of a URL, lowercased, or null if it will not parse. */
function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

/**
 * True when the URL's host, or any parent domain of it, is blocked.
 * @param {string} url
 */
export function isBlockedHost(url) {
  const host = hostOf(url);
  if (!host) return false;
  const blocked = blockedSet();
  if (blocked.size === 0) return false;

  const labels = host.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    if (blocked.has(labels.slice(i).join('.'))) return true;
  }
  return blocked.has(host);
}

/**
 * Throw BlockedHostError if the URL's host is blocked. Call before any network
 * work — the point is that a blocked host never gets a request.
 * @param {string} url
 */
export function assertHostAllowed(url) {
  if (isBlockedHost(url)) throw new BlockedHostError(hostOf(url));
}

/** Test hook: replace the effective list. Pass null to restore. */
export function _setBlockedHostsForTests(hosts) {
  overrideList = hosts ? new Set(hosts.map((h) => h.toLowerCase())) : null;
}
