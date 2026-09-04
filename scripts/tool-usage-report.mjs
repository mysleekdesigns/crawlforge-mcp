/**
 * tool-usage-report — the two numbers the 2026-09 tool-selection work moves.
 *
 * Reads logs/app.log (one `tool invocation` line per call, written by
 * src/server/withAuth.js) and reports, for session-like traffic:
 *   - the duplicate rate: calls that repeat an identical (tool, params) pair
 *     within 30 minutes — the result was already in the model's context
 *   - double-fetch pairs: fetch_url followed within 2 minutes by an extract_*
 *     tool, and the other tool->tool pairs
 * Test harnesses and regression sweeps are filtered out first: network tools
 * that returned in under 40 ms are mocked, and 8+ calls inside 10 seconds are
 * a sweep. The numbers are only comparable run to run with the same filters.
 *
 * Usage: node scripts/tool-usage-report.mjs [--days N] [--log path]
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const DAYS = Number(opt('--days', 30));
const LOG = opt('--log', 'logs/app.log');

const ESC = String.fromCharCode(27);
const raw = readFileSync(LOG, 'utf8').split(ESC).join('').replace(/\[[0-9;]*m/g, '');
const LINE = /^\[([0-9-]+ [0-9:.]+)\].*tool invocation.*Context: (\{.*\})\s*$/;
const all = [];
for (const line of raw.split('\n')) {
  const m = line.match(LINE);
  if (!m) continue;
  let c;
  try { c = JSON.parse(m[2]); } catch { continue; }
  if (!c.toolName || /^(tool_[ab]|test_tool|test)$/.test(c.toolName)) continue;
  all.push({ t: Date.parse(m[1].replace(' ', 'T')), tool: c.toolName, hash: c.paramHash, ok: c.outcome, ms: c.durationMs });
}
all.sort((a, b) => a.t - b.t);

// Tools that legitimately answer in under 40 ms without a network round-trip.
const LOCAL = new Set(['analyze_content', 'summarize_content', 'get_batch_results', 'list_ollama_models', 'localization', 'track_changes']);
const real = all.filter((e) => LOCAL.has(e.tool) || (e.ms ?? 999) >= 40);
const burst = new Set();
for (let i = 0; i < real.length; i++) {
  let j = i;
  while (j + 1 < real.length && real[j + 1].t - real[i].t <= 10000) j++;
  if (j - i + 1 >= 8) for (let k = i; k <= j; k++) burst.add(k);
}
const cutoff = Date.now() - DAYS * 86400e3;
const sess = real.filter((_, i) => !burst.has(i)).filter((e) => e.t >= cutoff);

console.log(`log lines: ${all.length}; after test/sweep filters and last ${DAYS} days: ${sess.length} session-like calls`);
if (sess.length === 0) process.exit(0);

const per = {};
for (const e of sess) { per[e.tool] ??= { n: 0, err: 0 }; per[e.tool].n++; if (e.ok !== 'success') per[e.tool].err++; }
console.log('\ntool                      calls  share  err%');
for (const [k, v] of Object.entries(per).sort((a, b) => b[1].n - a[1].n)) {
  console.log(k.padEnd(24), String(v.n).padStart(5), (100 * v.n / sess.length).toFixed(1).padStart(5) + '%', (100 * v.err / v.n).toFixed(0).padStart(4) + '%');
}

let dup = 0; const dupBy = {}; const seen = new Map();
for (const e of sess) {
  const k = e.tool + '|' + e.hash; const last = seen.get(k);
  if (last !== undefined && e.t - last < 30 * 60 * 1000) { dup++; dupBy[e.tool] = (dupBy[e.tool] || 0) + 1; }
  seen.set(k, e.t);
}
console.log(`\nDUPLICATE RATE (identical params within 30 min): ${dup} / ${sess.length} = ${(100 * dup / sess.length).toFixed(1)}%`);
console.log('  by tool:', JSON.stringify(Object.fromEntries(Object.entries(dupBy).sort((a, b) => b[1] - a[1]).slice(0, 8))));

const pairs = {}; let doubleFetch = 0;
for (let i = 1; i < sess.length; i++) {
  const a = sess[i - 1], b = sess[i];
  if (b.t - a.t > 120000 || a.tool === b.tool) continue;
  pairs[a.tool + ' -> ' + b.tool] = (pairs[a.tool + ' -> ' + b.tool] || 0) + 1;
  if (a.tool === 'fetch_url' && /^extract_/.test(b.tool)) doubleFetch++;
}
console.log(`\nDOUBLE-FETCH PAIRS (fetch_url then extract_* within 2 min): ${doubleFetch}`);
console.log('top pairs:');
for (const [k, v] of Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(String(v).padStart(5), k);
let rep = 0;
for (let i = 1; i < sess.length; i++) if (sess[i].tool === sess[i - 1].tool && sess[i].t - sess[i - 1].t <= 120000) rep++;
console.log(`same-tool consecutive calls within 2 min: ${rep} (${(100 * rep / sess.length).toFixed(1)}%)`);
