/**
 * TrackChanges — hosted monitors (Phase 6.1).
 *
 * `scheduledMonitorOptions.hosted: true` registers a monitor with the
 * website's /api/v1/monitors instead of the local MonitorStore. The website's
 * cron then fetches, compares, bills the account and sends the notifications
 * (email, signed webhooks), so the monitor fires whether or not this process
 * is alive. This module is the thin client; index.js decides when to use it
 * and shapes the tool results.
 *
 * These calls go to our own configured backend (AuthManager.apiEndpoint, from
 * CRAWLFORGE_API_URL through endpointGuard), not to a caller-supplied URL, so
 * they use bare fetch with the X-API-Key header exactly as AuthManager does.
 * The SSRF guard is for pages a caller names; the endpoint is legitimately
 * localhost in development.
 */
import authManager from '../../../core/AuthManager.js';

const HOSTED_TIMEOUT_MS = 30_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const HOSTED_FIRING_GUARANTEE_NOTE =
  "Runs from CrawlForge's scheduler whether or not this process is alive. Each check bills " +
  '3 credits per compared target from the account; blocked and errored targets are free.';

export const NO_KEY_MESSAGE =
  'hosted monitors need a CrawlForge API key — run `crawlforge-setup` or `crawlforge login`';

/**
 * The endpoint and key the hosted calls authenticate with, from the sources
 * the server and the CLI already use: CRAWLFORGE_API_KEY (the CLI's preAction
 * hook fills it from --api-key or the stored config), then the key AuthManager
 * loaded at startup, then the stored config read directly — the server skips
 * loading it in creator mode, and a hosted monitor is billed to an account
 * either way. No network: initialize() would re-validate the key.
 */
export async function resolveHostedCredentials() {
  let apiKey = process.env.CRAWLFORGE_API_KEY || authManager.getConfig()?.apiKey;
  if (!apiKey) {
    try {
      await authManager.loadConfig();
      apiKey = authManager.getConfig()?.apiKey;
    } catch {
      /* no stored config */
    }
  }
  if (!apiKey) throw new Error(NO_KEY_MESSAGE);
  return { endpoint: authManager.apiEndpoint, apiKey };
}

// resolveApiEndpoint keeps a trailing slash on the configured endpoint; joined
// to an absolute path that is `//api/...`, a redirect on every call and a
// dashboard link with a double slash.
const base = (endpoint) => String(endpoint).replace(/\/+$/, '');

async function request(method, pathname, creds, body) {
  const response = await fetch(`${base(creds.endpoint)}${pathname}`, {
    method,
    headers: {
      'X-API-Key': creds.apiKey,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(HOSTED_TIMEOUT_MS)
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    /* no JSON body */
  }
  if (!response.ok) {
    // `{ error: { code, message, details? } }` from the monitors API; the
    // API-key middleware's 401 is the same envelope. The website's own words
    // reach the caller so a validation or robots refusal is readable.
    const err = payload?.error;
    const code = err?.code || `HTTP_${response.status}`;
    const message = (typeof err === 'string' ? err : err?.message) || response.statusText || 'request failed';
    const details = err?.details !== undefined ? ` ${JSON.stringify(err.details)}` : '';
    const failure = new Error(`${code}: ${message}${details}`);
    failure.code = code;
    failure.status = response.status;
    throw failure;
  }
  return payload?.data;
}

export function createHostedMonitor(input, creds) {
  return request('POST', '/api/v1/monitors', creds, input);
}

export async function listHostedMonitors(creds) {
  // An account holds at most 50 monitors, so one page is the whole list.
  return (await request('GET', '/api/v1/monitors?limit=100', creds)) ?? [];
}

export function deleteHostedMonitor(id, creds) {
  return request('DELETE', `/api/v1/monitors/${encodeURIComponent(id)}`, creds);
}

// The cron slots the website accepts: consecutive runs at least 5 minutes
// apart. For a `*/N` minute step that means N must divide 60 (`*/7` has a
// 4-minute gap at the top of every hour); for an hour step, H must divide 24.
const SLOTS = [
  ...[5, 6, 10, 12, 15, 20, 30].map((m) => ({ ms: m * MINUTE, cron: `*/${m} * * * *` })),
  { ms: HOUR, cron: '0 * * * *' },
  ...[2, 3, 4, 6, 8, 12].map((h) => ({ ms: h * HOUR, cron: `0 */${h} * * *` })),
  { ms: 24 * HOUR, cron: '0 0 * * *' }
];

/**
 * The hosted schedule for a polling interval in ms.
 * @returns {{ cron: string, effectiveIntervalMs: number, adjusted: boolean }}
 *   `adjusted` is true when the interval was not an accepted slot and the
 *   nearest one was used; a tie goes to the longer interval (fewer billed checks).
 */
export function intervalToCron(ms) {
  let best = SLOTS[0];
  for (const slot of SLOTS) {
    const d = Math.abs(slot.ms - ms);
    const bestD = Math.abs(best.ms - ms);
    if (d < bestD || (d === bestD && slot.ms > best.ms)) best = slot;
  }
  return { cron: best.cron, effectiveIntervalMs: best.ms, adjusted: best.ms !== ms };
}

export function formatInterval(ms) {
  return ms % HOUR === 0 ? `${ms / HOUR} h` : `${Math.round(ms / MINUTE)} min`;
}

const parseIso = (iso) => (iso ? Date.parse(iso) || null : null);

export function hostedDashboardUrl(endpoint, id) {
  return `${base(endpoint)}/dashboard/monitors/${id}`;
}

/** The `monitor` a hosted create_scheduled_monitor returns. */
export function createdHostedMonitor(record, endpoint) {
  return {
    id: record.id,
    hosted: true,
    name: record.name,
    targets: record.targets,
    schedule: record.schedule_cron,
    timezone: record.timezone,
    notifyEmails: record.notify_emails,
    webhookUrl: record.webhook_url,
    webhookSecret: record.webhook_secret,
    status: record.status,
    nextRunAt: parseIso(record.next_run_at),
    estimatedCreditsPerMonth: record.estimated_credits_per_month,
    dashboardUrl: hostedDashboardUrl(endpoint, record.id)
  };
}

/** A hosted monitor as list_scheduled_monitors shows it, beside the local ones. */
export function listedHostedMonitor(record, endpoint) {
  const active = record.status === 'active';
  return {
    id: record.id,
    hosted: true,
    url: record.targets?.[0]?.url,
    targets: record.targets,
    name: record.name,
    schedule: record.schedule_cron,
    timezone: record.timezone,
    enabled: active,
    nextDueAt: parseIso(record.next_run_at),
    lastCheckAt: parseIso(record.last_check_at),
    lastCheck: record.last_check ?? null,
    estimatedCreditsPerMonth: record.estimated_credits_per_month,
    dashboardUrl: hostedDashboardUrl(endpoint, record.id),
    scheduled: active
  };
}
