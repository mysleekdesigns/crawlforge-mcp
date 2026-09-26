#!/usr/bin/env node
/**
 * stealth-bench.mjs — section 2 of docs/STEALTH_REVIEW_2026-09.md as a command.
 *
 * The review's benchmark was run by hand, one MCP call at a time, on one
 * machine, on one afternoon. Every phase after it is supposed to be measured
 * against that table, which only works if the table can be produced again — on
 * another machine, on another IP, after a Playwright bump. This is that script.
 *
 * It drives `StealthBrowserManager` and the plain fetch directly rather than
 * through MCP: the question is what the engines do, not what the server bills,
 * and a direct call keeps a browser page in reach for the detector probes.
 *
 * "Blocked" is the tool's own verdict (`documentVerdict`), exactly as in the
 * review. The harness never overrules it — the verdict layer is one of the
 * things being measured, false positives included.
 *
 * Usage:
 *   node scripts/stealth-bench.mjs                  # walls + detectors
 *   node scripts/stealth-bench.mjs --walls          # the section 2.2 matrix only
 *   node scripts/stealth-bench.mjs --detectors      # the section 2.3 checks only
 *   node scripts/stealth-bench.mjs --ci             # self-probes only, gated on ci-baseline.json
 *   node scripts/stealth-bench.mjs --self-check     # negative control for the harness itself
 *
 *   --engines=chromium,camoufox   default: both, skipping any that is unavailable
 *   --targets=indeed,harrods      restrict the wall run to these target ids
 *   --out <path>                  write the markdown report to a file as well as stdout
 *   --json <path>                 write the machine-readable result alongside it
 *   --timeout=<ms>                per-target cap (default 60000)
 *
 * Exit codes: 0 on a completed run — a Blocked cell is data, not an error.
 * `--ci` exits 1 on a failing check that is not in ci-baseline.json.
 * `--self-check` exits 1 when the harness fails to catch a forced
 * `navigator.webdriver === true`, which is the one result that means the
 * detector layer itself is broken and every other green is worthless.
 *
 * Cost: no CrawlForge credits (nothing goes through withAuth) and no API keys.
 * A full run does hit live third-party sites — the twelve bot walls once each
 * and the five detector pages once per engine — on the robots-respecting path,
 * which is the same traffic the review made by hand.
 *
 * Markdown goes to stdout; progress goes to stderr, as everywhere else here.
 */

import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { StealthBrowserManager, CamoufoxAdapter } from '../src/core/StealthBrowserManager.js';
import { safeGoto } from '../src/utils/ssrfGuard.js';
import { WALL_TARGETS } from './lib/stealth-bench/targets.js';
import { runWalls, robotsSkip, withTimeout } from './lib/stealth-bench/walls.js';
import { collectEnvironment } from './lib/stealth-bench/env.js';
import { renderMarkdown } from './lib/stealth-bench/report.js';

const REPO = resolve(import.meta.dirname, '..');
dotenv.config({ path: resolve(REPO, '.env'), quiet: true });

const BASELINE_PATH = resolve(REPO, 'scripts/lib/stealth-bench/ci-baseline.json');
// The review gave detector pages 6 to 10 s. CreepJS needs the long end before
// its worker and WebRTC sections have anything to read.
const DETECTOR_PAGE_SETTLE_MS = 10000;

const log = (line) => console.error(line);

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
/** Supports both `--out path` and `--out=path`. */
function option(name, fallback = null) {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  const next = index === -1 ? null : args[index + 1];
  return next && !next.startsWith('--') ? next : fallback;
}

const ci = has('ci');
const selfCheck = has('self-check');
const wantWalls = has('walls') || (!has('detectors') && !ci && !selfCheck);
const wantDetectors = has('detectors') || (!has('walls') && !selfCheck);
const timeoutMs = parseInt(option('timeout', '60000'), 10);
const outPath = option('out');
const jsonPath = option('json');
const requestedEngines = option('engines', 'chromium,camoufox').split(',').map((s) => s.trim()).filter(Boolean);
const targetIds = (option('targets') || '').split(',').map((s) => s.trim()).filter(Boolean);

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  log(`--timeout must be a positive number of milliseconds, got "${option('timeout')}".`);
  process.exit(1);
}
const unknownEngine = requestedEngines.find((engine) => !['chromium', 'camoufox'].includes(engine));
if (unknownEngine) {
  log(`Unknown engine "${unknownEngine}". The manager knows chromium and camoufox.`);
  process.exit(1);
}
const targets = targetIds.length
  ? WALL_TARGETS.filter((target) => targetIds.includes(target.id))
  : WALL_TARGETS;
if (targetIds.length && targets.length !== targetIds.length) {
  const known = WALL_TARGETS.map((target) => target.id).join(', ');
  log(`Unknown target id in --targets. Known ids: ${known}`);
  process.exit(1);
}

// ─── Engines ──────────────────────────────────────────────────────────────────

/** Camoufox is optional everywhere; an absent one is a skip, never a crash. */
async function resolveEngines(environment) {
  const available = [];
  for (const engine of requestedEngines) {
    if (engine === 'chromium') {
      if (environment.playwrightVersion === 'not installed') log('  chromium skipped: playwright is not installed');
      else available.push('chromium');
      continue;
    }
    try {
      if (await new CamoufoxAdapter().isAvailable()) available.push('camoufox');
      else log('  camoufox skipped: the camoufox package is not installed');
    } catch (error) {
      log(`  camoufox skipped: ${String(error.message).split('\n')[0]}`);
    }
  }
  return available;
}

// ─── Detector runs ────────────────────────────────────────────────────────────
//
// The detector modules only evaluate a page; every navigation is made here, so
// they never decide where a browser goes. They are imported at the point of
// use: a `--walls` run must not depend on them.

const loadDetectors = () => import('./lib/stealth-bench/detectors.js');
const loadDetectorPages = () => import('./lib/stealth-bench/detector-pages.js');

// No clearance jar: a clearance replayed from an earlier run would measure the
// jar, not the engine, and every row here is meant to start cold.
const manager = new StealthBrowserManager({ clearanceJar: null });

/** The launched browser's own version string, recorded once per engine. */
function noteBrowserVersion(environment, engine, page) {
  if (environment.browsers[engine]) return environment.browsers[engine];
  let version = null;
  try {
    version = (page ? page.context().browser() : manager.browser)?.version() || null;
  } catch { /* a closed browser; the header says unknown */ }
  if (version) environment.browsers[engine] = version;
  return version;
}

/**
 * Open one stealth page on `engine`, hand it to `body`, close the context.
 * @param {string} engine
 * @param {(page: import('playwright').Page) => Promise<any>} body
 */
async function onStealthPage(engine, body) {
  const { contextId } = await manager.createStealthContext({ engine });
  try {
    return await body(await manager.createStealthPage(contextId));
  } finally {
    await manager.closeContext(contextId).catch(() => {});
  }
}

/**
 * The self-probes: our own checks on a neutral origin, which is all CI runs.
 * `force` is the negative control — navigator.webdriver is made to report true
 * before navigation, and a harness worth trusting must report that as a fail.
 */
async function runSelfProbes(environment, engine, { force = false } = {}) {
  const name = force ? 'self-probes (navigator.webdriver forced true)' : 'self-probes';
  try {
    const { NEUTRAL_ORIGIN, runDetectorProbes } = await loadDetectors();
    return await onStealthPage(engine, async (page) => {
      if (force) {
        await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => true }));
      }
      const browserVersion = noteBrowserVersion(environment, engine, page);
      await withTimeout(safeGoto(page, NEUTRAL_ORIGIN, { waitUntil: 'domcontentloaded' }), timeoutMs, `${engine} navigation to ${NEUTRAL_ORIGIN}`);
      const checks = await withTimeout(
        runDetectorProbes(page, { engine, browserVersion, hostOS: process.platform }),
        timeoutMs,
        `${engine} self-probes`
      );
      return { engine, name, browserVersion, checks };
    });
  } catch (error) {
    return { engine, name, checks: [], error: String(error.message).split('\n')[0] };
  }
}

/** The third-party detector pages of section 2.3. Never run in CI. */
async function runDetectorPages(environment, engine) {
  const runs = [];
  let module;
  try {
    module = await loadDetectorPages();
  } catch (error) {
    return [{ engine, name: 'detector pages', checks: [], error: String(error.message).split('\n')[0] }];
  }

  for (const detector of module.DETECTOR_PAGES) {
    log(`→ ${detector.name} on ${engine}`);
    const skip = await robotsSkip(detector.url);
    if (skip) {
      runs.push({ engine, name: detector.name, checks: [], error: `${skip.cell} — ${skip.detail}` });
      continue;
    }
    try {
      const run = await onStealthPage(engine, async (page) => {
        const browserVersion = noteBrowserVersion(environment, engine, page);
        await withTimeout(safeGoto(page, detector.url, { waitUntil: 'domcontentloaded' }), timeoutMs, `${engine} navigation to ${detector.url}`);
        // These pages score after their own scripts have run; the review gave
        // them the same seconds by hand.
        await page.waitForTimeout(DETECTOR_PAGE_SETTLE_MS);
        const checks = await withTimeout(
          module.runDetectorPage(page, detector.id, { engine }),
          timeoutMs,
          `${engine} on ${detector.id}`
        );
        return { engine, name: detector.name, browserVersion, checks };
      });
      runs.push(run);
      log(`   ${run.checks.length} checks, ${run.checks.filter((check) => check.status === 'fail').length} failing`);
    } catch (error) {
      runs.push({ engine, name: detector.name, checks: [], error: String(error.message).split('\n')[0] });
      log(`   not run: ${String(error.message).split('\n')[0]}`);
    }
  }
  return runs;
}

// ─── CI gate ──────────────────────────────────────────────────────────────────

/** A run that reached a real verdict on something; an all-skip run measured nothing. */
const measured = (run) => (run.checks || []).some((check) => check.status !== 'skip');

/**
 * A failing check that the baseline does not list is a regression and fails the
 * build. A listed check that passed — or that no longer runs under that id — is
 * reported so the list can be corrected rather than left to rot.
 */
function gateAgainstBaseline(runs) {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const known = new Set(baseline.knownFailing || []);
  const checks = runs.flatMap((run) => (run.checks || []).map((check) => ({ ...check, engine: run.engine })));
  const failing = checks.filter((check) => check.status === 'fail');
  // Only a check that reached a verdict can call a baseline entry stale: a run
  // that skipped everything says nothing about the list.
  const decided = checks.filter((check) => check.status !== 'skip');
  return {
    regressions: failing.filter((check) => !known.has(check.id)),
    baselined: failing.filter((check) => known.has(check.id)),
    stale: decided.length === 0 ? [] : [...known]
      .filter((id) => !failing.some((check) => check.id === id))
      .map((id) => (decided.some((check) => check.id === id) ? id : `${id} (no pass or fail under this id)`))
  };
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const mode = selfCheck ? 'self-check' : ci ? 'ci' : [wantWalls && 'walls', wantDetectors && 'detectors'].filter(Boolean).join(' + ');
log(`CrawlForge stealth benchmark — mode: ${mode}.`);

const environment = await collectEnvironment(REPO);
log(`Host ${environment.host.platform} ${environment.host.arch}, network ${environment.network.type}${environment.network.asn ? ` (${environment.network.asn})` : ''}.`);

const engines = await resolveEngines(environment);
if (engines.length === 0) {
  log('No stealth engine is available. Nothing can be measured.');
  process.exit(1);
}
log(`Engines: ${engines.join(', ')}.\n`);

const result = { mode, environment, walls: null, detectors: [], gate: null };
let exitCode = 0;

try {
  if (selfCheck) {
    // The negative control. Forcing navigator.webdriver to true is a leak the
    // probes must see, so this is the one mode where a clean bill of health is
    // the failure: if nothing reports it, every green elsewhere is worthless.
    for (const engine of engines) {
      result.detectors.push(await runSelfProbes(environment, engine, { force: true }));
    }
    const verdicts = result.detectors.map((run) => ({
      engine: run.engine,
      // An engine whose browser will not start measured nothing; only a run
      // that produced a real verdict on something can be held to this.
      ran: measured(run),
      caught: (run.checks || []).some(
        (check) => /webdriver/i.test(check.id) && check.status === 'fail' && /true/i.test(String(check.actual))
      ),
      error: run.error
    }));
    log('');
    for (const verdict of verdicts) {
      if (verdict.caught) log(`✔ ${verdict.engine}: the harness caught the forced navigator.webdriver === true.`);
      else if (!verdict.ran) log(`  ${verdict.engine}: skipped — it measured nothing${verdict.error ? ` (${verdict.error})` : ''}.`);
      else log(`✖ ${verdict.engine}: the harness did NOT report navigator.webdriver as failing with actual "true".`);
    }
    if (!verdicts.some((verdict) => verdict.ran)) {
      log('\nNo engine measured anything, so the harness was not verified at all.');
      exitCode = 1;
    } else if (verdicts.some((verdict) => verdict.ran && !verdict.caught)) {
      log('\nThe detector layer cannot see a leak it was handed. Fix it before trusting any other run.');
      exitCode = 1;
    }
  } else {
    if (wantWalls && !ci) {
      log('Bot walls — one plain fetch, then a stealth engine only where the fetch was blocked.');
      result.walls = await runWalls({
        manager,
        targets,
        engines,
        timeoutMs,
        log,
        onEngineRun: (engine) => noteBrowserVersion(environment, engine)
      });
      log('');
    }

    if (wantDetectors || ci) {
      log('Detectors — self-probes on a neutral origin.');
      for (const engine of engines) {
        const run = await runSelfProbes(environment, engine);
        result.detectors.push(run);
        log(`   ${engine}: ${run.error ? `not run — ${run.error}` : `${run.checks.length} checks, ${run.checks.filter((check) => check.status === 'fail').length} failing`}`);
      }
      // Third-party detector pages are the slow, flaky, network-dependent half.
      // CI gets the self-probes only, which is what makes it a gate rather than
      // a weather report on five other people's websites.
      if (!ci) {
        for (const engine of engines) {
          result.detectors.push(...await runDetectorPages(environment, engine));
        }
      }
      log('');
    }

    if (ci) {
      result.gate = gateAgainstBaseline(result.detectors);
      // An engine that could not start is a note, not a red build: CI installs
      // Playwright's Chromium and deliberately not Camoufox's binary. A run
      // where NOTHING was measured is a red build — a gate that has stopped
      // measuring must not report green.
      for (const run of result.detectors.filter((run) => !measured(run))) {
        log(`  note: ${run.engine} measured nothing${run.error ? ` — ${run.error}` : ''}`);
      }
      for (const check of result.gate.regressions) {
        log(`✖ regression: ${check.id} on ${check.engine} — expected ${check.expected}, got ${check.actual}`);
      }
      if (!result.detectors.some(measured)) {
        log('✖ No engine produced a single pass or fail. Nothing was measured, so nothing is green.');
        exitCode = 1;
      } else if (result.gate.regressions.length) {
        exitCode = 1;
      } else {
        log('✔ No detector regression: every failing check is in ci-baseline.json.');
      }
      for (const id of result.gate.stale) log(`  note: ci-baseline.json lists ${id} — it is not failing; remove it.`);
    }
  }
} finally {
  await manager.cleanup().catch(() => {});
}

// ─── Output ───────────────────────────────────────────────────────────────────

const markdown = renderMarkdown(result);
if (outPath) {
  writeFileSync(resolve(process.cwd(), outPath), `${markdown}\n`);
  log(`\nReport written to ${outPath}`);
}
if (jsonPath) {
  writeFileSync(resolve(process.cwd(), jsonPath), `${JSON.stringify(result, null, 2)}\n`);
  log(`Result written to ${jsonPath}`);
}

// exit() rather than exitCode: a browser this manager launched can leave a
// handle that keeps the loop alive (the same reason the unit tests run with
// --test-force-exit). The write callback is what stops that truncating the
// report when stdout is a pipe.
process.stdout.write(`${markdown}\n`, () => process.exit(exitCode));
