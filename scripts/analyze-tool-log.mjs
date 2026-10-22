/**
 * analyze-tool-log — repeat and re-fetch rates per server session, from
 * logs/app.log (REPEAT_CALL_REDUCTION_PLAN item 0.2).
 *
 * Reads the `tool invocation` lines written by src/server/withAuth.js:
 *   { toolName, paramHash, durationMs, outcome, creditCost, creatorMode, internal,
 *     runId, client, source, urlKey }
 * Session = runId (one per server process; a stdio process is one client
 * session). Only source=client lines count by default; --source picks another
 * (test | harness | eval). Lines written before the tags existed have no
 * source: they are excluded unless --include-legacy, which treats each
 * calendar day of them as one session.
 *
 * Metrics, per runId:
 *   - identical repeat: same tool + paramHash within 30 min
 *   - same-URL refetch: same urlKey, different tool or paramHash, within 30 min
 *   - network fetches per URL per session: calls carrying a urlKey per (runId, urlKey)
 * Cross-agent re-fetches can't be seen here: in Claude Code subagents call the
 * parent's MCP server process, so they share its runId, and the line has no
 * agent marker. scripts/analyze-transcripts.mjs measures them.
 *
 * Usage: node scripts/analyze-tool-log.mjs [--days N] [--log path] [--source client]
 *          [--include-legacy] [--json]
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const DAYS = Number(opt('--days', 30));
const LOG = opt('--log', 'logs/app.log');
const SOURCE = opt('--source', 'client');
const LEGACY = args.includes('--include-legacy');
const JSON_OUT = args.includes('--json');
const WINDOW = 30 * 60 * 1000;

const ESC = String.fromCharCode(27);
const raw = readFileSync(LOG, 'utf8').split(ESC).join('').replace(/\[[0-9;]*m/g, '');
const LINE = /^\[([0-9-]+ [0-9:.]+)\].*tool invocation.*Context: (\{.*\})\s*$/;
const cutoff = Date.now() - DAYS * 86400e3;
let lines = 0, legacy = 0, otherSource = 0;
const calls = [];
for (const line of raw.split('\n')) {
  const m = line.match(LINE);
  if (!m) continue;
  let c;
  try { c = JSON.parse(m[2]); } catch { continue; }
  if (!c.toolName) continue;
  lines++;
  const t = Date.parse(m[1].replace(' ', 'T'));
  if (!(t >= cutoff)) continue;
  let run = c.runId;
  if (c.source === undefined) {
    legacy++;
    if (!LEGACY) continue;
    run = 'legacy:' + m[1].slice(0, 10);
  } else if (c.source !== SOURCE) { otherSource++; continue; }
  calls.push({ t, run, tool: c.toolName, hash: c.paramHash, ok: c.outcome === 'success', urlKey: c.urlKey ?? null, client: c.client ?? null });
}
calls.sort((a, b) => a.t - b.t);

const out = {
  log: LOG, days: DAYS, source: SOURCE, includeLegacy: LEGACY,
  lines, legacyInWindow: legacy, otherSourceInWindow: otherSource,
  calls: calls.length, sessions: new Set(calls.map((c) => c.run)).size, clients: {},
  identical: 0, identicalAfterFailure: 0, urlCalls: 0, sameUrl: 0, pairs: {},
  fetchesPerUrl: null,
  crossAgent: 'not visible: subagents share the parent process runId and the line has no agent marker; see analyze-transcripts.mjs'
};
for (const c of calls) out.clients[c.client ?? '(none)'] = (out.clients[c.client ?? '(none)'] || 0) + 1;
const lastKey = new Map(); const lastUrl = new Map(); const perUrl = new Map();
for (const c of calls) {
  const k = c.run + '|' + c.tool + '|' + c.hash;
  const prev = lastKey.get(k);
  const identical = prev && c.t - prev.t <= WINDOW;
  if (identical) { out.identical++; if (!prev.ok) out.identicalAfterFailure++; }
  lastKey.set(k, c);
  if (!c.urlKey) continue;
  out.urlCalls++;
  const uk = c.run + '|' + c.urlKey;
  perUrl.set(uk, (perUrl.get(uk) || 0) + 1);
  const pu = lastUrl.get(uk);
  if (pu && c.t - pu.t <= WINDOW && !identical) {
    out.sameUrl++;
    const label = pu.tool + ' -> ' + c.tool;
    out.pairs[label] = (out.pairs[label] || 0) + 1;
  }
  lastUrl.set(uk, c);
}
const counts = [...perUrl.values()];
const dist = {};
for (const n of counts) { const b = n >= 5 ? '5+' : String(n); dist[b] = (dist[b] || 0) + 1; }
out.fetchesPerUrl = {
  sessionUrls: counts.length,
  mean: counts.length ? +(counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(2) : 0,
  max: counts.length ? Math.max(...counts) : 0,
  distribution: dist
};
out.pairs = Object.fromEntries(Object.entries(out.pairs).sort((a, b) => b[1] - a[1]).slice(0, 10));

if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';
console.log(`${LOG}: ${lines} tool invocation lines; last ${DAYS} days: ${legacy} untagged (legacy, ${LEGACY ? 'included, one session per day' : 'excluded'}), ${otherSource} with another source`);
console.log(`source=${SOURCE}: ${out.calls} calls in ${out.sessions} sessions`);
if (out.calls === 0) process.exit(0);
console.log('clients:', JSON.stringify(out.clients));
console.log(`identical repeat <=30 min:   ${out.identical} (${pct(out.identical, out.calls)}), ${out.identicalAfterFailure} right after a failed call`);
console.log(`same URL, different params:  ${out.sameUrl} of ${out.urlCalls} URL calls (${pct(out.sameUrl, out.urlCalls)})`);
const f = out.fetchesPerUrl;
console.log(`fetches per URL per session: mean ${f.mean}, max ${f.max} over ${f.sessionUrls} (session, URL) pairs; distribution ${JSON.stringify(f.distribution)}`);
console.log('top same-URL patterns:');
for (const [k, v] of Object.entries(out.pairs)) console.log(String(v).padStart(5), k);
console.log(`cross-agent re-fetches: ${out.crossAgent}`);
