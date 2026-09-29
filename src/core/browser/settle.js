/**
 * Settle — wait for a page to finish rendering before a snapshot reads it, and
 * after a click/press/select that may have changed it.
 *
 * `domcontentloaded` alone is not enough: a client-rendered page builds its DOM
 * after it, and an SPA route change never fires it at all. A snapshot taken at
 * that point describes an empty shell — the Amazon homepage came back as
 * `[document]` with 0 nodes and a blank title. So the wait is two steps:
 *
 *   1. `load`, capped at LOAD_CAP_MS.
 *   2. A quiet window: no DOM mutation for DOM_QUIET_MS AND no request in
 *      flight for NETWORK_QUIET_MS, capped at QUIET_CAP_MS. The network window
 *      counts from when the wait began, so a request an interaction is about to
 *      start is not beaten to the check by a page that was idle before it.
 *
 * Long-polling, websockets and analytics beacons can keep a request in flight
 * forever, which is what the cap is for: `settled_by: 'cap'` is a normal
 * outcome, not an error. Nothing here throws — a page that navigates mid-wait
 * restarts the DOM window, and one that closes ends the wait.
 */

export const LOAD_CAP_MS = 5000;
export const QUIET_CAP_MS = 3000;
export const DOM_QUIET_MS = 300;
export const NETWORK_QUIET_MS = 500;
const POLL_MS = 50;

// Where the in-page probe keeps itself. On the document, not the window, so a
// navigation (a new document) installs a fresh observer; non-enumerable, so it
// does not show up in a walk of the document's keys.
const PROBE_KEY = '__crawlforgeSettleProbe';

// Page -> { inFlight: Set<Request>, idleSince }. WeakMap so a closed page's
// tracker goes with it.
const trackers = new WeakMap();

/**
 * Count the page's in-flight requests. Idempotent: the listeners are attached
 * once per page, however many times the page is settled.
 *
 * A Set rather than a counter because requests already in flight when the
 * listeners attach finish without ever having been counted — deleting an
 * unknown request is a no-op, where decrementing would drive a counter negative.
 */
export function trackRequests(page) {
  let tracker = trackers.get(page);
  if (tracker) return tracker;

  tracker = { inFlight: new Set(), idleSince: Date.now() };
  const done = (request) => {
    if (tracker.inFlight.delete(request) && tracker.inFlight.size === 0) {
      tracker.idleSince = Date.now();
    }
  };
  page.on('request', (request) => tracker.inFlight.add(request));
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  trackers.set(page, tracker);
  return tracker;
}

/**
 * Injected: ms since the document last mutated. The first call on a document
 * installs the observer and reports 0, so a fresh document is never quiet
 * until DOM_QUIET_MS have actually been watched.
 */
function mutationProbe(key) {
  let probe = document[key];
  if (!probe) {
    let last = performance.now();
    new MutationObserver(() => { last = performance.now(); })
      .observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    probe = () => performance.now() - last;
    Object.defineProperty(document, key, { value: probe });
  }
  return probe();
}

/** The probe's answer, or 0 (not quiet) if the page could not answer before the deadline. */
async function sinceLastMutation(page, deadline) {
  // A navigation destroys the execution context mid-evaluate; that document is
  // not quiet, and the next poll probes its successor.
  const probe = page.evaluate(mutationProbe, PROBE_KEY).catch(() => 0);
  let timer;
  const expiry = new Promise((resolve) => {
    timer = setTimeout(resolve, Math.max(0, deadline - Date.now()), 0);
  });
  try {
    return await Promise.race([probe, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wait for `load`, then for a quiet window, never longer than `timeout` in all.
 *
 * @param {import('playwright').Page} page
 * @param {object} [options]
 * @param {number} [options.timeout] — overall budget in ms; default LOAD_CAP_MS + QUIET_CAP_MS
 * @returns {Promise<{waited_ms: number, settled_by: 'quiet'|'cap'|'closed'}>}
 *   `quiet` — both windows held; `cap` — a cap or the budget ran out first;
 *   `closed` — the page closed during the wait.
 */
export async function settlePage(page, { timeout = LOAD_CAP_MS + QUIET_CAP_MS } = {}) {
  const started = Date.now();
  let settledBy = 'cap';

  try {
    // Attached before the load wait so the requests that hold `load` back are counted.
    const requests = trackRequests(page);

    try {
      await page.waitForLoadState('load', { timeout: Math.max(1, Math.min(LOAD_CAP_MS, timeout)) });
    } catch {
      // Not loaded within the cap — the quiet window still gets its turn.
    }

    const quietFrom = Date.now();
    const deadline = Math.min(quietFrom + QUIET_CAP_MS, started + timeout);
    while (Date.now() < deadline) {
      if (page.isClosed()) {
        settledBy = 'closed';
        break;
      }
      const domQuietFor = await sinceLastMutation(page, deadline);
      const networkQuietFor = requests.inFlight.size > 0
        ? 0
        : Date.now() - Math.max(requests.idleSince, quietFrom);
      if (domQuietFor >= DOM_QUIET_MS && networkQuietFor >= NETWORK_QUIET_MS) {
        settledBy = 'quiet';
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_MS, Math.max(0, deadline - Date.now()))));
    }
  } catch {
    // A page torn down under us. Settling is never itself a failure.
  }

  return { waited_ms: Date.now() - started, settled_by: settledBy };
}
