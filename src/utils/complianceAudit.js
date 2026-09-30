/**
 * complianceAudit — durable record of the compliance decisions a customer made.
 *
 * Ground rule G5 allows `respect_robots: false`, but only as *the customer's
 * documented decision*. That means the override has to leave a trace: which key
 * asked, for which URL, from which tool, when. Without the row the override is
 * a silent product default again, which is the thing G5 exists to prevent.
 * The same trail records each time a request goes out under a browser identity
 * (a stealth render), so that choice is on record too.
 *
 * Rows go to `logs/compliance-audit.log` as JSONL (one row per line, appended)
 * and to a small in-memory ring the tools and tests can read back. Writing is
 * best-effort: an audit sink that throws must never fail a customer's fetch.
 *
 * The API key is never stored. `apiKeyId` is a truncated SHA-256 of it — stable
 * enough to group a key's overrides, useless as a credential. A row's `url` is
 * kept, because the row has to say what was fetched, but not a credential that
 * rode along in it (see `auditUrl`).
 */

import { createHash } from 'crypto';
import { appendFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOG_PATH = join(__dirname, '../../logs/compliance-audit.log');

const RING_SIZE = 200;
const ring = [];

let sink = null; // null → the default JSONL file sink

/** Truncated, non-reversible identifier for an API key. */
export function apiKeyId(apiKey) {
  if (typeof apiKey !== 'string' || !apiKey) return 'anonymous';
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
}

/**
 * Query parameters whose value is a credential, by name: `token`,
 * `access_token`, `api_key`, `key`, `sig`, `X-Amz-Signature`, `password`,
 * `PHPSESSID`, `authorization`. `author` and `keyword` are not.
 */
const CREDENTIAL_PARAM_RE = /token|secret|passw|signature|credential|sess(?:ion|id)|api[_-]?key|access[_-]?key|private[_-]?key|jwt|auth(?!or(?!i[sz]))|^(?:key|sig|sid|pwd|pass)$/i;

/**
 * A URL as a row may keep it: `user:password@` removed, and the value of every
 * query parameter named like a credential replaced. The path and every other
 * parameter stay as they were sent. Matching is by name, so a credential under
 * a name that says nothing (`?k=`, or one carried in the path) is not caught.
 * @param {string} url
 * @returns {string}
 */
export function auditUrl(url) {
  if (typeof url !== 'string') return url;
  return url
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#@]*@/i, '$1')
    .replace(/([?&])([^=&#]+)=[^&#]*/g, (pair, separator, name) => (
      CREDENTIAL_PARAM_RE.test(name) ? `${separator}${name}=[redacted]` : pair
    ));
}

async function defaultSink(row) {
  await mkdir(dirname(DEFAULT_LOG_PATH), { recursive: true });
  await appendFile(DEFAULT_LOG_PATH, `${JSON.stringify(row)}\n`, 'utf8');
}

/**
 * Record a compliance event. Never throws and never rejects.
 * @param {{ event: string, url?: string, tool?: string, apiKeyId?: string, [k: string]: unknown }} event
 * @returns {{ event: string, timestamp: string }} the row as written
 */
export function recordComplianceEvent(event = {}) {
  const row = {
    timestamp: new Date().toISOString(),
    ...event,
    ...(event.url === undefined ? {} : { url: auditUrl(event.url) })
  };
  ring.push(row);
  if (ring.length > RING_SIZE) ring.shift();

  Promise.resolve()
    .then(() => (sink || defaultSink)(row))
    .catch(() => { /* an audit sink must never break a fetch */ });

  return row;
}

/**
 * Record that a request is about to go out under a browser identity (a stealth
 * render). Neither the raw key nor the raw owner token is stored: both are
 * reduced to apiKeyId digests, and the URL is kept as `auditUrl` leaves it.
 * `ownerId` names the website customer behind an internal-proxy request, where
 * `apiKeyId` is always the service's own key. Never throws.
 */
export function recordStealthEscalation({ url, tool, engine, apiKey, ownerToken } = {}) {
  return recordComplianceEvent({
    event: 'stealth_escalation',
    url,
    tool,
    engine: engine ?? null,
    apiKeyId: apiKeyId(apiKey),
    ...(ownerToken ? { ownerId: apiKeyId(ownerToken) } : {})
  });
}

/** Most recent audit rows, newest last. Test/diagnostic hook. */
export function getComplianceAuditRows() {
  return ring.slice();
}

/** Replace the persistence sink (tests, or a hosted deployment). */
export function setComplianceAuditSink(fn) {
  sink = typeof fn === 'function' ? fn : null;
}

/** Test hook. */
export function _resetComplianceAudit() {
  ring.length = 0;
  sink = null;
}
