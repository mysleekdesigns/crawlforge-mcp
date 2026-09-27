#!/usr/bin/env node
/**
 * impit-probe — measure the escalation stage's impit step (stealth review
 * Phase 7) against the section 2.2 bot walls, from wherever it runs.
 *
 * The question it answers is the one the residential spike could not: does a
 * Chrome TLS handshake with the honest User-Agent get pages from the hosted
 * instance's datacenter IP? Its answer decides whether the website's REST
 * `scrape` escalation should gain the step too (owner decision, 2026-09-27).
 *
 * The impit column calls the shipped `impitFetchPage`, so it measures what the
 * product does — the verdict, the 200-character floor and the SSRF check
 * included — not a reimplementation. The plain-fetch column is the stealth
 * benchmark's own. robots.txt is honoured: a disallowed target is skipped.
 * No browser is launched and no credits are spent.
 *
 * Usage, in the Render shell (or anywhere):
 *   node scripts/impit-probe.mjs [--runs=3]
 * The markdown report goes to stdout; progress goes to stderr.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { WALL_TARGETS } from './lib/stealth-bench/targets.js';
import { plainFetchCell, robotsSkip, withTimeout, CELL } from './lib/stealth-bench/walls.js';
import { collectEnvironment } from './lib/stealth-bench/env.js';
import { impitFetchPage, loadImpit } from '../src/utils/impitRung.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runsArg = process.argv.find((a) => a.startsWith('--runs='));
const RUNS = Math.max(1, Number(runsArg?.split('=')[1]) || 3);
const TIMEOUT_MS = 30000;
const log = (line) => process.stderr.write(`${line}\n`);

if (!(await loadImpit())) {
  log('impit is not installed (or its native bindings did not load) on this host — nothing to measure.');
  process.exit(1);
}

const env = await collectEnvironment(REPO);
const rows = [];
for (const target of WALL_TARGETS) {
  log(`→ ${target.id}`);
  const skip = await robotsSkip(target.url);
  if (skip) {
    rows.push({ target, skipped: skip.cell });
    log(`   ${skip.cell}`);
    continue;
  }
  let plainPasses = 0;
  let impitPasses = 0;
  const chars = [];
  for (let run = 1; run <= RUNS; run++) {
    const plain = await plainFetchCell(target.url, { timeoutMs: TIMEOUT_MS });
    if (plain.cell === CELL.PASS) plainPasses++;
    let page = null;
    let impitError = null;
    try {
      page = await withTimeout(impitFetchPage(target.url), TIMEOUT_MS, 'impit');
    } catch (error) {
      impitError = String(error.message).split('\n')[0];
    }
    if (page) {
      impitPasses++;
      chars.push(page.text.length);
    }
    log(`   run ${run}: plain ${plain.cell}${plain.status ? ` (${plain.status})` : ''}; impit ${page ? `page, ${page.text.length} chars` : impitError ? `error: ${impitError}` : 'no page'}`);
  }
  rows.push({ target, plainPasses, impitPasses, chars });
}

const net = env.network || {};
let md = '# impit probe\n\n';
md += `- Run: ${env.timestamp}, CrawlForge ${env.crawlforgeVersion}, commit \`${env.gitCommit}\`\n`;
md += `- Host: ${env.host.platform} ${env.host.arch} ${env.host.release}\n`;
md += `- Network: ${net.type || 'unknown'}${net.asn ? ` — ${net.asn}` : ''}${net.location ? `, ${net.location}` : ''}${net.ip ? ` (${net.ip})` : ''}\n`;
md += `- Runs per target: ${RUNS}. A pass is a page the product's impit step would return (verdict passed, at least 200 characters of text).\n\n`;
md += '| Target | Vendor | Plain fetch | impit (Chrome TLS, honest UA) | impit text chars |\n| --- | --- | --- | --- | --- |\n';
for (const r of rows) {
  if (r.skipped) {
    md += `| ${r.target.id} | ${r.target.vendor} | ${r.skipped} | ${r.skipped} | |\n`;
  } else {
    md += `| ${r.target.id} | ${r.target.vendor} | ${r.plainPasses}/${RUNS} | ${r.impitPasses}/${RUNS} | ${r.chars.join(', ')} |\n`;
  }
}
process.stdout.write(md);
process.exit(0);
