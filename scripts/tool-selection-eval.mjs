/**
 * tool-selection-eval — does a fresh Claude Code session pick the right
 * CrawlForge tool, once, for a natural-language task?
 *
 * Runs each task through `claude -p` (stream-json), records every tool_use,
 * and scores: first CrawlForge tool in the expected set, CrawlForge call count
 * within budget, no identical repeated call. ToolSearch calls are counted
 * separately (alwaysLoad on scrape/search_web should keep them near zero).
 * The session runs from this repo, so only the server's own routing surface
 * (instructions, descriptions, Next-step hints) is under test — no project
 * hooks. Tools really execute (creator mode bills nothing locally); tasks
 * that hit the network are expected to sometimes error, which is fine: the
 * score is about selection, not success.
 *
 * Usage: node scripts/tool-selection-eval.mjs [--model sonnet] [--only 1,4,7]
 *        [--concurrency 3] [--dry-run] [--strict]
 * Raw transcripts: $TMPDIR/crawlforge-eval/<n>.jsonl
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TASKS = [
  { prompt: 'What is the page title of https://example.com?', expect: ['scrape', 'extract_metadata'], max: 1 },
  { prompt: 'Summarise the main content of https://en.wikipedia.org/wiki/Web_scraping in three bullets.', expect: ['scrape', 'extract_content'], max: 1 },
  { prompt: 'List the outbound links on https://example.com.', expect: ['scrape', 'extract_links'], max: 1 },
  { prompt: 'Read the raw JSON at https://api.github.com/repos/nodejs/node and tell me the stargazers_count.', expect: ['fetch_url'], max: 1 },
  { prompt: 'Find three recent articles about MCP server security and give me their titles and URLs.', expect: ['search_web'], max: 1 },
  { prompt: 'Where does crawlforge.dev rank in Google organic results for "mcp web scraping"?', expect: ['serp_rank'], max: 1 },
  { prompt: 'What are people on Reddit saying about the Firecrawl MCP server? Give me three posts.', expect: ['reddit_search'], max: 1 },
  { prompt: 'Scrape these three pages as markdown: https://example.com, https://example.org, https://example.net', expect: ['batch_scrape'], max: 1 },
  { prompt: 'List the URLs of https://www.crawlforge.dev (a site map). Do not fetch page bodies.', expect: ['map_site'], max: 1 },
  { prompt: 'https://www.ticketmaster.com/discover/concerts is a Next.js page; read its embedded page data (props.pageProps) and list the top-level keys.', expect: ['extract_embedded_state'], max: 2 },
  { prompt: 'Using CSS selectors, extract the h1 text and the first paragraph text from https://example.com.', expect: ['scrape_structured'], max: 1 },
  { prompt: 'Extract {title, description} as JSON from https://www.crawlforge.dev using an LLM.', expect: ['extract_structured', 'extract_with_llm', 'scrape'], max: 1 },
  { prompt: 'Get the repository details for https://github.com/modelcontextprotocol/typescript-sdk using a site template.', expect: ['scrape_template'], max: 1 },
  { prompt: 'Tell me the title of https://example.com and then how many links it contains.', expect: ['scrape'], max: 1 },
  { prompt: 'Read https://www.crawlforge.dev/pricing: name the plans, then give me the page meta description.', expect: ['scrape'], max: 1 },
  { prompt: 'Create a change-tracking baseline for https://example.com.', expect: ['track_changes'], max: 1 },
  { prompt: 'Extract the text of this PDF and give me its abstract: https://arxiv.org/pdf/1706.03762', expect: ['process_document'], max: 1 },
  { prompt: 'Research the current state of MCP tool search across clients and write a short report from at least five sources.', expect: ['deep_research'], max: 1 },
  { prompt: 'Scrape https://www.zillow.com/homes/ as markdown and tell me what the page is about.', expect: ['scrape'], max: 2 },
  { prompt: 'Check whether https://example.com is up and how fast it responds.', expect: ['fetch_url'], max: 1 },
  { prompt: 'What is on the front page of Hacker News right now? Use a template if one exists.', expect: ['scrape_template'], max: 1 },
];

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const MODEL = opt('--model', 'sonnet');
const CONC = Number(opt('--concurrency', 3));
const ONLY = opt('--only', null)?.split(',').map(Number);
const DRY = args.includes('--dry-run');
const STRICT = args.includes('--strict');
const OUT = join(process.env.TMPDIR || tmpdir(), 'crawlforge-eval');
mkdirSync(OUT, { recursive: true });

const PREAMBLE = 'Use the CrawlForge MCP tools for any web access; the built-in web tools are unavailable. Answer briefly. Do not ask questions.';

function runTask(n, task) {
  return new Promise((resolve) => {
    const argv = ['-p', task.prompt, '--output-format', 'stream-json', '--verbose', '--model', MODEL,
      '--allowedTools', 'mcp__crawlforge', '--disallowedTools', 'WebFetch', 'WebSearch',
      '--max-turns', '8', '--no-session-persistence', '--append-system-prompt', PREAMBLE];
    const p = spawn('claude', argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => p.kill('SIGKILL'), 240000);
    p.on('close', () => {
      clearTimeout(timer);
      writeFileSync(join(OUT, `${n}.jsonl`), out + (err ? `\n#stderr\n${err}` : ''));
      const calls = []; let cost = 0; let result = '';
      for (const line of out.split('\n')) {
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type === 'assistant') for (const c of e.message?.content ?? []) if (c.type === 'tool_use') calls.push({ name: c.name, input: c.input });
        if (e.type === 'result') { cost = e.total_cost_usd ?? 0; result = e.subtype; }
      }
      resolve({ n, task, calls, cost, result: result || 'no-result' });
    });
  });
}

function score(r) {
  const cf = r.calls.filter((c) => c.name.startsWith('mcp__crawlforge__')).map((c) => ({ ...c, short: c.name.replace('mcp__crawlforge__', '') }));
  const searches = r.calls.filter((c) => c.name === 'ToolSearch').length;
  const first = cf[0]?.short ?? '-';
  const seen = new Set(); let dups = 0;
  for (const c of cf) { const k = c.short + JSON.stringify(c.input, Object.keys(c.input ?? {}).sort()); if (seen.has(k)) dups++; seen.add(k); }
  return { first, calls: cf.length, searches, dups, sel: r.task.expect.includes(first), budget: cf.length <= r.task.max, sequence: cf.map((c) => c.short).join(' > ') };
}

const selected = TASKS.map((t, i) => [i + 1, t]).filter(([i]) => !ONLY || ONLY.includes(i));
if (DRY) { for (const [i, t] of selected) console.log(i, t.expect.join('|'), `max ${t.max}:`, t.prompt); process.exit(0); }

const results = [];
let cursor = 0;
async function worker() { while (cursor < selected.length) { const [i, t] = selected[cursor++]; results.push(await runTask(i, t)); } }
await Promise.all(Array.from({ length: Math.min(CONC, selected.length) }, worker));
results.sort((a, b) => a.n - b.n);

let selOk = 0, budOk = 0, dupTotal = 0, searchTotal = 0, callTotal = 0, cost = 0;
console.log(`model ${MODEL}; ${results.length} tasks\n`);
console.log('#   sel budget calls search dups  first -> sequence');
for (const r of results) {
  const s = score(r);
  selOk += s.sel; budOk += s.budget; dupTotal += s.dups; searchTotal += s.searches; callTotal += s.calls; cost += r.cost;
  console.log(String(r.n).padStart(2), s.sel ? ' ok ' : 'FAIL', s.budget ? '  ok  ' : ' OVER ', String(s.calls).padStart(4), String(s.searches).padStart(6), String(s.dups).padStart(5), ` ${s.sequence || '(none)'}${r.result !== 'success' ? `  [${r.result}]` : ''}`);
  if (!s.sel) console.log('        expected', r.task.expect.join('|'), '—', r.task.prompt);
}
const n = results.length;
console.log(`\nselection ${selOk}/${n} (${(100 * selOk / n).toFixed(0)}%)  within budget ${budOk}/${n}  calls/task ${(callTotal / n).toFixed(2)}  duplicate calls ${dupTotal}  ToolSearch calls ${searchTotal}  cost $${cost.toFixed(2)}`);
console.log(`transcripts: ${OUT}`);
if (STRICT && (selOk < n || budOk < n)) process.exit(1);
