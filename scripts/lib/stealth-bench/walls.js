/**
 * walls.js — the section 2.2 bot-wall matrix: one plain fetch and one stealth
 * scrape per engine, judged by the tool's own verdict.
 *
 * "Blocked" here means exactly what it means in the review: `documentVerdict`
 * said so. The harness never decides for itself whether a page looks real —
 * that is the layer under test (finding 6 is a false positive in it), so
 * second-guessing it would hide the thing being measured.
 *
 * robots.txt is checked before a target is touched, through the same gate the
 * browser paths use. A disallowed target is reported as `skipped (robots)`
 * across the row, which is how trustpilot.com appears in the review.
 *
 * A stealth engine only runs when the plain fetch was blocked. That is what
 * `scrape` itself does — escalation is second by construction — and it is why
 * four rows of the review's table read "not run".
 */

import { load } from 'cheerio';
import { fetchWithTimeout } from '../../../src/tools/basic/_fetch.js';
import { stealthDocumentVerdict } from '../../../src/utils/stealthVerdict.js';
import { browserPreflight } from '../../../src/utils/robotsGate.js';

/** The cell vocabulary of section 2.2, plus the two a script needs and a hand run did not. */
export const CELL = {
  PASS: 'Pass',
  BLOCKED: 'Blocked',
  ROBOTS: 'skipped (robots)',
  NOT_RUN: 'n/a',
  NO_ENGINE: 'skipped (engine)',
  ERROR: 'error'
};

const oneLine = (text, max = 200) =>
  String(text || '').split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, max);

/** Reject after `ms` so one hung target cannot eat the run. Shared with the detector runs. */
export function withTimeout(promise, ms, what) {
  let timer;
  const cap = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} exceeded the ${ms}ms cap`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, cap]).finally(() => clearTimeout(timer));
}

/** The verdict as a cell. */
function cellFor(verdict, { title = '', text = '' } = {}) {
  if (verdict.success) {
    return { cell: CELL.PASS, detail: `"${oneLine(title, 80)}", ${text.trim().length} chars of text` };
  }
  return {
    cell: CELL.BLOCKED,
    detail: verdict.blocked
      ? `${verdict.blocked.vendor} — ${verdict.blocked.evidence}`
      : oneLine(verdict.error)
  };
}

/**
 * Is this URL ours to fetch? Returns null when it is, a cell when it is not.
 * @param {string} url
 * @returns {Promise<{cell:string, detail:string}|null>}
 */
export async function robotsSkip(url) {
  try {
    await browserPreflight(url, { respectRobots: true, tool: 'stealth-bench' });
    return null;
  } catch (error) {
    if (error?.code === 'ROBOTS_DISALLOWED') return { cell: CELL.ROBOTS, detail: oneLine(error.message) };
    if (error?.code === 'HOST_BLOCKED') return { cell: CELL.ROBOTS, detail: oneLine(error.message) };
    // An unreachable robots.txt is not a disallow (the gate fails open); this
    // is the gate itself failing, and guessing past it would be dishonest.
    return { cell: CELL.ERROR, detail: `robots gate failed: ${oneLine(error.message)}` };
  }
}

/**
 * The plain-fetch column: the honest `CrawlForge/<version>` identity over
 * Node's TLS stack, judged by the same verdict the browser column uses.
 */
export async function plainFetchCell(url, { timeoutMs }) {
  try {
    const response = await withTimeout(
      fetchWithTimeout(url, { timeout: timeoutMs, tool: 'stealth-bench', respectRobots: true }),
      timeoutMs + 5000,
      'plain fetch'
    );
    const html = response._body || '';
    const $ = load(html);
    const title = $('title').first().text().trim();
    // Scripts carry the challenge markers the verdict looks for in `html`; the
    // visible text is measured without them, as unifiedScrape does.
    $('script, style, noscript, template').remove();
    const text = $('body').text();
    const verdict = stealthDocumentVerdict(
      { url, title, text, html, status: response.status },
      { fetcher: 'a plain fetch', rendered: false, contentReturned: false }
    );
    return { ...cellFor(verdict, { title, text }), status: response.status };
  } catch (error) {
    return { cell: CELL.ERROR, detail: oneLine(error.message) };
  }
}

/**
 * One stealth scrape, retried once at `retryWaitMs` when the first run is
 * blocked and the target documents a longer wait (nowsecure.nl at 15 s).
 */
export async function stealthCell(manager, { url, engine, waitFor, retryWaitMs, timeoutMs }) {
  const attempt = async (wait) => {
    const scraped = await withTimeout(
      manager.scrapeWithStealth({ url, engine, wait_for: wait }),
      timeoutMs + wait,
      `${engine} scrape of ${url}`
    );
    const verdict = stealthDocumentVerdict(scraped, { waitedMs: wait + (scraped.gracedMs || 0) });
    return { ...cellFor(verdict, scraped), status: verdict.status };
  };

  let first;
  try {
    first = await attempt(waitFor);
  } catch (error) {
    return { cell: CELL.ERROR, detail: oneLine(error.message) };
  }
  if (first.cell !== CELL.BLOCKED || !retryWaitMs) return first;
  try {
    const retried = await attempt(retryWaitMs);
    return { ...retried, detail: `${retried.detail} (also at ${retryWaitMs}ms)` };
  } catch (error) {
    // The longer wait failing does not unmake the answer the short one gave.
    return { ...first, detail: `${first.detail} (the ${retryWaitMs}ms retry failed: ${oneLine(error.message, 80)})` };
  }
}

/**
 * The whole matrix.
 *
 * @param {object} options
 * @param {import('../../../src/core/StealthBrowserManager.js').StealthBrowserManager} options.manager
 * @param {Array} options.targets           rows from targets.js
 * @param {string[]} options.engines        engines that are available and selected
 * @param {number} options.timeoutMs        per-target cap
 * @param {(line:string)=>void} options.log  progress, on stderr
 * @param {(engine:string)=>Promise<void>} [options.onEngineRun] called after an engine's first run, to read its version
 * @returns {Promise<Array>} one row per target
 */
export async function runWalls({ manager, targets, engines, timeoutMs, log, onEngineRun }) {
  const rows = [];

  for (const target of targets) {
    log(`→ ${target.id} (${target.vendor})`);
    const row = { id: target.id, url: target.url, vendor: target.vendor, recorded: target.recorded, results: {} };

    const skip = await robotsSkip(target.url);
    if (skip) {
      for (const column of ['plain', 'chromium', 'camoufox']) row.results[column] = { ...skip };
      log(`   ${skip.cell} — ${skip.detail}`);
      rows.push(row);
      continue;
    }

    row.results.plain = await plainFetchCell(target.url, { timeoutMs });
    log(`   plain fetch: ${row.results.plain.cell} — ${row.results.plain.detail}`);

    for (const engine of ['chromium', 'camoufox']) {
      if (!engines.includes(engine)) {
        row.results[engine] = { cell: CELL.NO_ENGINE, detail: 'engine not available or not selected' };
        continue;
      }
      // Escalation is second by construction: a page the honest fetch already
      // read is not worth a browser, and the review did not run one either.
      if (row.results.plain.cell === CELL.PASS) {
        row.results[engine] = { cell: CELL.NOT_RUN, detail: 'not run — the plain fetch was not blocked' };
        continue;
      }
      row.results[engine] = await stealthCell(manager, {
        url: target.url,
        engine,
        waitFor: target.waitFor,
        retryWaitMs: target.retryWaitFor,
        timeoutMs
      });
      log(`   ${engine}: ${row.results[engine].cell} — ${row.results[engine].detail}`);
      if (onEngineRun) await onEngineRun(engine);
    }

    rows.push(row);
  }

  return rows;
}
