/**
 * repeat-call-eval — how many times does an agent fetch the same page to
 * finish a task? (REPEAT_CALL_REDUCTION_PLAN item 0.3, Anthropic's
 * "Writing effective tools for agents" eval method.)
 *
 * Runs 9 fixed tasks through headless `claude -p` (stream-json), each N times,
 * against THIS repo's server.js only (--strict-mcp-config; built-in web tools
 * and Bash disallowed, so CrawlForge is the only web path). It runs from this
 * repo, whose .claude/settings.json has no crawlforge-dedupe hook. Several
 * tasks are built so the natural path re-reads one page with different params
 * (formats, embedded-state path, selectors, map then summarise) — the waste
 * the Phase 1 page cache targets. Task 7 fans out to subagents.
 *
 * Per run the spawned server gets CRAWLFORGE_RUN_ID=eval-<task>-<rep>-<ts> and
 * CRAWLFORGE_LOG_SOURCE=eval through the mcp config "env" block, so its
 * `tool invocation` log lines can be matched. Network fetches = those lines
 * with a non-null urlKey (minus any cache:"hit" once Phase 1 lands); when the
 * log carries no runId/urlKey yet, the count falls back to URL-bearing
 * CrawlForge calls in the transcript, labelled "transcript".
 *
 * The server reads its creator secret from this repo's .env (cwd), so nothing
 * is billed; every run still spends Claude tokens.
 *
 * Usage: node scripts/repeat-call-eval.mjs [--reps 3] [--only 1,4]
 *        [--concurrency 3] [--model sonnet] [--out <dir>] [--dry-run]
 *        node scripts/repeat-call-eval.mjs --rescore <out dir>   (re-score saved runs, no new runs)
 * Output: <out>/<task>-<rep>.jsonl (raw stream), <out>/mcp-<task>-<rep>.json,
 *         <out>/summary.json, <out>/summary.md
 * Default out: $TMPDIR/crawlforge-repeat-eval/<timestamp>
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOG_DIR = join(REPO, 'logs');

const BOOK = 'https://books.toscrape.com/catalogue';
const TASKS = [
  { id: 'price-upc',
    prompt: `From ${BOOK}/a-light-in-the-attic_1000/index.html give me the price including tax and the UPC.`,
    pass: [/51\.77/, /a897fe39b1053632/i] },
  { id: 'formats-change',
    prompt: `For ${BOOK}/tipping-the-velvet_999/index.html: first tell me the page's <title> and the links in its breadcrumb. Then, as a separate step, tell me how many copies are in stock and the UPC.`,
    pass: [/\b20\b/, /90fa61229261140a/i] },
  { id: 'docs-map-summarise',
    prompt: 'List every page on https://jsonlines.org, then summarise the examples page and the validator page in one sentence each. Include the page URLs in your answer.',
    pass: [/jsonlines\.org\/examples/i, /jsonlines\.org\/validator/i] },
  { id: 'next-data',
    prompt: 'https://react.dev/learn is a Next.js page. From its __NEXT_DATA__, report the Next.js route (the `page` field), the page title in pageProps.meta, and the value of query.markdownPath.',
    pass: [/\[\[\.\.\.markdownPath\]\]/, /Quick Start/] },
  { id: 'selector-tweak',
    prompt: 'Using CSS selectors, extract each quote\'s author on https://quotes.toscrape.com/page/2/. Then extract each quote\'s tags too. Which author\'s quote carries the tag "misattributed-john-lennon"?',
    pass: [/Allen Saunders/] },
  { id: 'sequential-small',
    prompt: 'What is the title of https://example.com? Next, what links does it contain? Finally, what is its meta description, if it has one?',
    // The 2026-10-21 page has no links and no meta description.
    pass: [/Example Domain/i, /links?\W[^\n]*\b(none|no links|0)\b/i] },
  { id: 'subagent-fanout', agents: true,
    prompt: `List the books on ${BOOK}/category/books/poetry_23/index.html. Then use the Agent tool to launch two subagents in parallel: each must open one of the first two books' product pages and report its title, price and UPC. Give me both books' title, price and UPC.`,
    pass: [/51\.77/, /52\.15/, /a897fe39b1053632/i, /1dfe412b8ac00530/i] },
  { id: 'large-page-two-asks',
    prompt: 'Read https://www.rfc-editor.org/rfc/rfc9110.html. First give me the document title from its metadata, then the section number that defines HTTP status code 418.',
    pass: [/15\.5\.19/] },
  { id: 'structured-then-scrape',
    prompt: `Extract {title, price, availability} as JSON from ${BOOK}/sapiens-a-brief-history-of-humankind_996/index.html. Then also give me the book's category from its breadcrumb and its UPC.`,
    pass: [/54\.23/, /History/, /4165285e1663650f/i] },
];

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const MODEL = opt('--model', 'sonnet');
const REPS = Number(opt('--reps', 3));
const CONC = Number(opt('--concurrency', 3));
const ONLY = opt('--only', null)?.split(',').map(Number);
const DRY = args.includes('--dry-run');
const RESCORE = opt('--rescore', null);
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
const OUT = RESCORE ?? opt('--out', join(process.env.TMPDIR || tmpdir(), 'crawlforge-repeat-eval', STAMP));
const TIMEOUT_MS = 600000;

const PREAMBLE = 'Use the CrawlForge MCP tools for any web access; the built-in web tools are unavailable. Answer briefly. Do not ask questions.';

function claudeArgs(task, mcpPath) {
  const allowed = ['mcp__crawlforge', ...(task.agents ? ['Agent', 'Task'] : [])];
  const disallowed = ['WebFetch', 'WebSearch', 'Bash', ...(task.agents ? [] : ['Agent', 'Task'])];
  return ['-p', task.prompt, '--output-format', 'stream-json', '--verbose', '--model', MODEL,
    '--mcp-config', mcpPath, '--strict-mcp-config',
    '--allowedTools', ...allowed, '--disallowedTools', ...disallowed,
    '--max-turns', task.agents ? '30' : '20', '--no-session-persistence', '--append-system-prompt', PREAMBLE];
}

function mcpConfig(runId) {
  return { mcpServers: { crawlforge: { type: 'stdio', command: process.execPath, args: [join(REPO, 'server.js')],
    env: { CRAWLFORGE_RUN_ID: runId, CRAWLFORGE_LOG_SOURCE: 'eval' } } } };
}

function runOne(n, rep) {
  const task = TASKS[n - 1];
  const runId = `eval-${task.id}-${rep}-${STAMP}`;
  const mcpPath = join(OUT, `mcp-${n}-${rep}.json`);
  writeFileSync(mcpPath, JSON.stringify(mcpConfig(runId), null, 2));
  const argv = claudeArgs(task, mcpPath);
  return new Promise((resolve) => {
    const started = Date.now();
    const p = spawn('claude', argv, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => p.kill('SIGKILL'), TIMEOUT_MS);
    p.on('close', (code) => {
      clearTimeout(timer);
      writeFileSync(join(OUT, `${n}-${rep}.jsonl`), out + (err ? `\n#stderr\n${err}` : ''));
      resolve(parseRun({ n, rep, task, runId, out, code, wallMs: Date.now() - started }));
    });
  });
}

const sortedJson = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

function canonicalUrl(u) {
  try { const x = new URL(u); x.hash = ''; return x.href.replace(/\/$/, ''); } catch { return u; }
}

function urlsOf(input = {}) {
  const urls = [];
  if (typeof input.url === 'string') urls.push(input.url);
  for (const u of input.urls ?? []) urls.push(typeof u === 'string' ? u : u?.url);
  return urls.filter(Boolean).map(canonicalUrl);
}

function parseRun({ n, rep, task, runId, out, code, wallMs }) {
  // Background subagents make `claude -p` emit one result event per resumed
  // turn, and the last can be empty: read all of them, not just the last.
  const calls = []; const errored = new Set(); const results = [];
  for (const line of out.split('\n')) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'assistant') {
      for (const c of e.message?.content ?? []) {
        if (c.type === 'tool_use') calls.push({ id: c.id, name: c.name, input: c.input ?? {}, sub: Boolean(e.parent_tool_use_id) });
      }
    }
    if (e.type === 'user') for (const c of e.message?.content ?? []) if (c.type === 'tool_result' && c.is_error) errored.add(c.tool_use_id);
    if (e.type === 'result') results.push(e);
  }
  const result = results.at(-1) ?? null;
  const cf = calls.filter((c) => c.name.startsWith('mcp__crawlforge__'))
    .map((c) => ({ tool: c.name.replace('mcp__crawlforge__', ''), input: c.input, sub: c.sub, error: errored.has(c.id), urls: urlsOf(c.input) }));

  // Identical repeats, and same URL re-read with different params.
  const seen = new Set(); const byUrl = new Map(); let identical = 0; let sameUrlDiff = 0;
  for (const c of cf) {
    const sig = c.tool + sortedJson(c.input);
    if (seen.has(sig)) identical++;
    for (const u of c.urls) {
      const prev = byUrl.get(u) ?? [];
      if (prev.length && !prev.includes(sig)) sameUrlDiff++;
      byUrl.set(u, [...prev, sig]);
    }
    seen.add(sig);
  }
  const transcriptFetches = cf.reduce((s, c) => s + c.urls.length, 0);
  const log = logFetches(runId);
  // urlKey hashes params.url only, so batch_scrape's `urls` never reach the
  // log count: add those from the transcript.
  const batchUrls = cf.reduce((s, c) => s + (Array.isArray(c.input.urls) ? c.urls.length : 0), 0);
  const fetches = log.matched ? log.fetches + batchUrls : transcriptFetches;
  const answer = results.map((r) => (typeof r.result === 'string' ? r.result : '')).filter(Boolean).join('\n\n');
  const usage = (k) => results.reduce((s, r) => s + (r.usage?.[k] ?? 0), 0);
  const total = (k) => (results.length ? results.reduce((s, r) => s + (r[k] ?? 0), 0) : null);
  return {
    task: n, id: task.id, rep, runId, exit: code, subtype: result?.subtype ?? 'no-result',
    pass: Boolean(answer) && task.pass.every((re) => re.test(answer)),
    calls: cf.length, sequence: cf.map((c) => `${c.sub ? 'sub:' : ''}${c.tool}${c.error ? '!' : ''}`),
    subagentCalls: cf.filter((c) => c.sub).length, erroredCalls: cf.filter((c) => c.error).length,
    toolSearchCalls: calls.filter((c) => c.name === 'ToolSearch').length,
    agentSpawns: calls.filter((c) => c.name === 'Agent' || c.name === 'Task').length,
    identicalRepeats: identical, sameUrlDiffParams: sameUrlDiff,
    distinctUrls: byUrl.size, networkFetches: fetches, fetchSource: log.matched ? 'log' : 'transcript',
    logInvocations: log.invocations, transcriptFetches, cacheHits: log.hits,
    fetchesPerUrl: byUrl.size ? fetches / byUrl.size : 0,
    tokens: { input: usage('input_tokens'), output: usage('output_tokens'), cacheCreate: usage('cache_creation_input_tokens'), cacheRead: usage('cache_read_input_tokens') },
    // total_cost_usd is already the session total on every result event.
    costUsd: result?.total_cost_usd ?? null, durationMs: total('duration_ms') ?? wallMs, numTurns: total('num_turns'),
    answer: answer.slice(0, 2000),
  };
}

// `tool invocation` lines for this runId in logs/app*.log. matched=false when
// none carries the runId (0.1 fields not in withAuth yet, or no calls made).
function logFetches(runId) {
  let invocations = 0; let fetches = 0; let hits = 0;
  if (!existsSync(LOG_DIR)) return { matched: false, invocations, fetches, hits };
  for (const f of readdirSync(LOG_DIR).filter((x) => /^app\d*\.log$/.test(x))) {
    for (const line of readFileSync(join(LOG_DIR, f), 'utf8').split('\n')) {
      if (!line.includes(runId) || !line.includes('tool invocation')) continue;
      let ctx; try { ctx = JSON.parse(line.slice(line.indexOf('Context: ') + 9)); } catch { continue; }
      if (ctx.runId !== runId) continue;
      invocations++;
      if (ctx.urlKey) { if (ctx.cache === 'hit') hits++; else fetches++; }
    }
  }
  return { matched: invocations > 0, invocations, fetches, hits };
}

const stats = (xs) => (xs.length ? { mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4), min: +Math.min(...xs).toFixed(4), max: +Math.max(...xs).toFixed(4) } : null);

function aggregate(runs) {
  const perTask = [];
  for (const n of [...new Set(runs.map((r) => r.task))]) {
    const rs = runs.filter((r) => r.task === n);
    perTask.push({
      task: n, id: rs[0].id, runs: rs.length, passRate: rs.filter((r) => r.pass).length / rs.length,
      calls: stats(rs.map((r) => r.calls)), identicalRepeats: stats(rs.map((r) => r.identicalRepeats)),
      sameUrlDiffParams: stats(rs.map((r) => r.sameUrlDiffParams)), networkFetches: stats(rs.map((r) => r.networkFetches)),
      fetchesPerUrl: stats(rs.map((r) => +r.fetchesPerUrl.toFixed(2))),
      tokens: stats(rs.map((r) => r.tokens.input + r.tokens.output + r.tokens.cacheCreate + r.tokens.cacheRead)),
      outputTokens: stats(rs.map((r) => r.tokens.output)),
      costUsd: stats(rs.map((r) => r.costUsd ?? 0)), durationMs: stats(rs.map((r) => r.durationMs)),
      fetchSource: [...new Set(rs.map((r) => r.fetchSource))].join('+'),
    });
  }
  const sum = (f) => runs.reduce((s, r) => s + f(r), 0);
  return {
    perTask,
    overall: {
      runs: runs.length, passRate: +(sum((r) => r.pass) / runs.length).toFixed(3),
      calls: sum((r) => r.calls), identicalRepeats: sum((r) => r.identicalRepeats), sameUrlDiffParams: sum((r) => r.sameUrlDiffParams),
      networkFetches: sum((r) => r.networkFetches), distinctUrlsPerRunSum: sum((r) => r.distinctUrls),
      // Network fetches per URL per run: total fetches / total (run, URL) pairs.
      fetchesPerUrlPerRun: +(sum((r) => r.networkFetches) / Math.max(1, sum((r) => r.distinctUrls))).toFixed(3),
      tokens: sum((r) => r.tokens.input + r.tokens.output + r.tokens.cacheCreate + r.tokens.cacheRead),
      outputTokens: sum((r) => r.tokens.output), costUsd: +sum((r) => r.costUsd ?? 0).toFixed(4),
      fetchSource: [...new Set(runs.map((r) => r.fetchSource))].join('+'),
    },
  };
}

function markdown(meta, agg, runs) {
  const f = (s) => (s ? `${s.mean} (${s.min}–${s.max})` : '-');
  const o = agg.overall;
  const lines = [`# Repeat-call eval ${meta.stamp}`, '', `model ${meta.model}; reps ${meta.reps}; runs ${o.runs}; network fetches from: ${o.fetchSource}`, '',
    `**Pass rate ${(100 * o.passRate).toFixed(0)}%** · fetches per URL per run **${o.fetchesPerUrlPerRun}** · CrawlForge calls ${o.calls} · identical repeats ${o.identicalRepeats} · same-URL different params ${o.sameUrlDiffParams} · tokens ${o.tokens} (output ${o.outputTokens}) · cost $${o.costUsd}`, '',
    '| # | task | pass | calls | identical | same-URL diff params | network fetches | fetches/URL | tokens | cost $ | duration ms |',
    '|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const t of agg.perTask) {
    lines.push(`| ${t.task} | ${t.id} | ${t.passRate * t.runs}/${t.runs} | ${f(t.calls)} | ${f(t.identicalRepeats)} | ${f(t.sameUrlDiffParams)} | ${f(t.networkFetches)} [${t.fetchSource}] | ${f(t.fetchesPerUrl)} | ${f(t.tokens)} | ${f(t.costUsd)} | ${f(t.durationMs)} |`);
  }
  lines.push('', '## Runs', '');
  for (const r of runs) lines.push(`- ${r.task}.${r.rep} ${r.id} ${r.pass ? 'PASS' : 'FAIL'} [${r.subtype}] ${r.sequence.join(' > ') || '(no calls)'}`);
  return lines.join('\n') + '\n';
}

const jobs = [];
for (const [i] of TASKS.entries()) if (!ONLY || ONLY.includes(i + 1)) for (let rep = 1; rep <= REPS; rep++) jobs.push([i + 1, rep]);

if (DRY) {
  console.log(`out ${OUT}\nmodel ${MODEL}; reps ${REPS}; concurrency ${CONC}; ${jobs.length} runs; cwd ${REPO}\n`);
  for (const [n, rep] of jobs.filter(([, rep]) => rep === 1)) {
    const t = TASKS[n - 1];
    const runId = `eval-${t.id}-<rep>-${STAMP}`;
    console.log(`#${n} ${t.id}  pass: ${t.pass.map(String).join(' && ')}`);
    console.log(`  claude ${claudeArgs(t, `<out>/mcp-${n}-<rep>.json`).map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    if (n === jobs[0][0]) console.log(`  mcp config: ${JSON.stringify(mcpConfig(runId))}`);
  }
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
const runs = [];
if (RESCORE) {
  for (const [n, rep] of jobs) {
    const raw = join(OUT, `${n}-${rep}.jsonl`);
    if (!existsSync(raw)) continue;
    const runId = JSON.parse(readFileSync(join(OUT, `mcp-${n}-${rep}.json`), 'utf8')).mcpServers.crawlforge.env.CRAWLFORGE_RUN_ID;
    runs.push(parseRun({ n, rep, task: TASKS[n - 1], runId, out: readFileSync(raw, 'utf8'), code: 0, wallMs: 0 }));
  }
  jobs.length = 0;
}
let cursor = 0;
async function worker() {
  while (cursor < jobs.length) {
    const [n, rep] = jobs[cursor++];
    const r = await runOne(n, rep);
    console.log(`${n}.${rep} ${r.id} ${r.pass ? 'PASS' : 'FAIL'} [${r.subtype}] calls ${r.calls} fetches ${r.networkFetches} (${r.fetchSource}) $${(r.costUsd ?? 0).toFixed(3)}`);
    runs.push(r);
  }
}
await Promise.all(Array.from({ length: Math.min(CONC, jobs.length) }, worker));
runs.sort((a, b) => a.task - b.task || a.rep - b.rep);

const meta = { stamp: STAMP, model: MODEL, reps: REPS, out: OUT, serverVersion: JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version };
const agg = aggregate(runs);
writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ meta, ...agg, runs }, null, 2));
writeFileSync(join(OUT, 'summary.md'), markdown(meta, agg, runs));
console.log('\n' + markdown(meta, agg, runs));
console.log(`out: ${OUT}`);
