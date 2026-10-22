/**
 * analyze-transcripts — repeat and re-fetch rates of CrawlForge calls in the
 * local Claude Code transcripts (REPEAT_CALL_REDUCTION_PLAN 1b / item 0.2).
 *
 * Local only: reads ~/.claude/projects/**\/*.jsonl, including subagent files
 * (<session>/subagents/**\/agent-*.jsonl, which carry the parent's sessionId).
 * scripts/ is outside package.json "files", so this never ships.
 *
 * Method (1b):
 *   - every tool_use named mcp__crawlforge__* is a call; it is matched to its
 *     tool_result in the same file (is_error, or a JSON body with
 *     "success": false, marks it failed)
 *   - session = sessionId; a call's key = tool + canonical JSON of its args
 *   - identical repeat: same key seen earlier in the session within 30 min
 *   - URL call: a call with a `url` arg, or a `urls` list (batch_scrape)
 *   - same-URL refetch: a URL call one of whose URLs was called earlier in the
 *     session within 30 min, that is not itself an identical repeat
 *   - cross-transcript: the earlier matching call is in a different file of the
 *     same session (parent vs subagent, or two siblings)
 *   - split by project dir: CrawlForge repos (name contains mcp-server or
 *     crawlforge) vs other projects
 *
 * Privacy: URLs from other projects are never printed unless --show-urls.
 *
 * Usage: node scripts/analyze-transcripts.mjs [--days N] [--until YYYY-MM-DD] [--json] [--show-urls] [--root dir]
 *   --until ends the window at that date (exclusive), to re-run a past report
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const DAYS = Number(opt('--days', 30));
const ROOT = opt('--root', join(homedir(), '.claude', 'projects'));
const JSON_OUT = args.includes('--json');
const SHOW_URLS = args.includes('--show-urls');
const WINDOW = 30 * 60 * 1000;
const PREFIX = 'mcp__crawlforge__';
const UNTIL = opt('--until') ? Date.parse(opt('--until') + 'T00:00:00Z') : Infinity;
const cutoff = (UNTIL === Infinity ? Date.now() : UNTIL) - DAYS * 86400e3;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.jsonl') && st.mtimeMs >= cutoff) out.push(p);
  }
  return out;
}

const canon = (v) => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
  : JSON.stringify(v);
const canonUrl = (u) => {
  try { const x = new URL(u); x.hash = ''; let s = x.href; if (x.pathname !== '/' && s.endsWith('/')) s = s.slice(0, -1); return s; }
  catch { return u; }
};
const failed = (b) => {
  if (b.is_error) return true;
  const text = typeof b.content === 'string' ? b.content
    : Array.isArray(b.content) ? b.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') : '';
  return /"success"\s*:\s*false/.test(text.slice(0, 2000));
};

let filesMentioning = 0;
const calls = [];
const seenIds = new Set();
for (const file of walk(ROOT)) {
  const raw = readFileSync(file, 'utf8');
  if (!raw.includes(PREFIX)) continue;
  filesMentioning++;
  const project = file.slice(ROOT.length + 1).split('/')[0];
  const dev = /mcp-server|crawlforge/i.test(project);
  const uses = []; const results = new Map();
  for (const line of raw.split('\n')) {
    if (!line.includes('tool_use') && !line.includes('tool_result')) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    const content = d.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b.type === 'tool_use' && d.type === 'assistant' && b.name?.startsWith(PREFIX)) uses.push({ b, d });
      else if (b.type === 'tool_result') results.set(b.tool_use_id, b);
    }
  }
  for (const { b, d } of uses) {
    if (seenIds.has(b.id)) continue; // a resumed or forked transcript can copy earlier history
    seenIds.add(b.id);
    const t = Date.parse(d.timestamp);
    if (!(t >= cutoff && t < UNTIL)) continue;
    const r = results.get(b.id);
    const input = b.input ?? {};
    calls.push({
      t, file, dev, session: d.sessionId, tool: b.name.slice(PREFIX.length), input,
      key: b.name + '|' + canon(input),
      urls: (typeof input.url === 'string' ? [input.url] : Array.isArray(input.urls) ? input.urls : [])
        .map((u) => (typeof u === 'string' ? u : u?.url)).filter((u) => typeof u === 'string').map(canonUrl),
      failed: r ? failed(r) : null
    });
  }
}
calls.sort((a, b) => a.t - b.t);

function analyse(group) {
  const out = {
    calls: group.length, sessions: new Set(group.map((c) => c.session)).size,
    transcripts: new Set(group.map((c) => c.file)).size,
    noResult: group.filter((c) => c.failed === null).length,
    failedCalls: group.filter((c) => c.failed).length,
    identical: 0, identicalAfterFailure: 0, identicalCross: 0,
    urlCalls: 0, sameUrl: 0, sameUrlCross: 0,
    pairs: {}, identicalByTool: {}, fetchesPerUrl: {}, topUrls: []
  };
  const lastKey = new Map(); const lastUrl = new Map(); const perUrl = new Map();
  for (const c of group) {
    const k = c.session + '\0' + c.key;
    const prev = lastKey.get(k);
    const identical = prev && c.t - prev.t <= WINDOW;
    if (identical) {
      out.identical++;
      out.identicalByTool[c.tool] = (out.identicalByTool[c.tool] || 0) + 1;
      if (prev.failed) out.identicalAfterFailure++;
      if (prev.file !== c.file) out.identicalCross++;
    }
    lastKey.set(k, c);
    if (!c.urls.length) continue;
    out.urlCalls++;
    let pu = null;
    for (const u of c.urls) {
      const uk = c.session + '\0' + u;
      perUrl.set(uk, (perUrl.get(uk) || 0) + 1);
      const p = lastUrl.get(uk);
      if (p && c.t - p.t <= WINDOW && (!pu || p.t > pu.t)) pu = p;
      lastUrl.set(uk, c);
    }
    if (pu && !identical) {
      out.sameUrl++;
      if (pu.file !== c.file) out.sameUrlCross++;
      let label = pu.tool + ' -> ' + c.tool;
      if (pu.tool === c.tool) {
        const ks = [...new Set([...Object.keys(pu.input), ...Object.keys(c.input)])]
          .filter((x) => canon(pu.input[x]) !== canon(c.input[x])).sort();
        label += ' (changed: ' + ks.join(',') + ')';
      }
      out.pairs[label] = (out.pairs[label] || 0) + 1;
    }
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
  out.topUrls = [...perUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, n]) => ({ url: k.split('\0')[1], fetches: n }));
  out.pairs = Object.fromEntries(Object.entries(out.pairs).sort((a, b) => b[1] - a[1]).slice(0, 12));
  out.identicalByTool = Object.fromEntries(Object.entries(out.identicalByTool).sort((a, b) => b[1] - a[1]));
  return out;
}

const first = calls[0]?.t; const last = calls.at(-1)?.t;
const report = {
  root: ROOT, days: DAYS, until: opt('--until') ?? null,
  range: first ? [new Date(first).toISOString().slice(0, 10), new Date(last).toISOString().slice(0, 10)] : null,
  filesMentioningCrawlforge: filesMentioning,
  transcriptsWithCalls: new Set(calls.map((c) => c.file)).size,
  calls: calls.length,
  crawlforgeRepos: analyse(calls.filter((c) => c.dev)),
  otherProjects: analyse(calls.filter((c) => !c.dev))
};
if (!SHOW_URLS) delete report.otherProjects.topUrls;

if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';
console.log(`transcripts under ${ROOT} (last ${DAYS} days): ${report.filesMentioningCrawlforge} mention ${PREFIX}*, ${report.transcriptsWithCalls} contain calls`);
console.log(`calls: ${report.calls}${report.range ? `  (${report.range[0]} -> ${report.range[1]})` : ''}`);
for (const [name, g] of [['CrawlForge repos', report.crawlforgeRepos], ['Other projects', report.otherProjects]]) {
  console.log(`\n== ${name}: ${g.sessions} sessions, ${g.transcripts} transcripts, ${g.calls} calls (${g.failedCalls} failed, ${g.noResult} without a result)`);
  console.log(`identical repeat <=30 min:  ${g.identical} (${pct(g.identical, g.calls)}), ${g.identicalAfterFailure} right after a failed call, ${g.identicalCross} cross-transcript`);
  console.log(`same URL, different params:  ${g.sameUrl} of ${g.urlCalls} URL calls (${pct(g.sameUrl, g.urlCalls)}), ${g.sameUrlCross} cross-transcript`);
  const f = g.fetchesPerUrl;
  console.log(`fetches per URL per session: mean ${f.mean}, max ${f.max} over ${f.sessionUrls} (session, URL) pairs; distribution ${JSON.stringify(f.distribution)}`);
  console.log('identical repeats by tool:', JSON.stringify(g.identicalByTool));
  console.log('top same-URL patterns:');
  for (const [k, v] of Object.entries(g.pairs)) console.log(String(v).padStart(5), k);
  if (g.topUrls) { console.log('most-fetched URLs (per session):'); for (const u of g.topUrls) console.log(String(u.fetches).padStart(5), u.url); }
}
