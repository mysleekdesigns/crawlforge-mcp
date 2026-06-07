#!/usr/bin/env node
/**
 * CrawlForge CLI — src/cli/index.js
 * Entry point for the `crawlforge` command.
 *
 * Global flags:
 *   --json        Output raw JSON (compact)
 *   --pretty      Output pretty-printed JSON
 *   --quiet       Suppress all output (exit code only)
 *   --api-key     CrawlForge API key (overrides CRAWLFORGE_API_KEY env)
 *   --timeout     Global request timeout in ms (default: 30000)
 */

import { Command } from 'commander';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { setGlobalDispatcher, EnvHttpProxyAgent } from 'undici';

// Node's global fetch() (undici) ignores HTTP(S)_PROXY by default. When a proxy
// is configured — e.g. inside a sandbox that only permits egress through it —
// route every fetch() through it so the CLI's API/scrape calls succeed without
// excluding the command from the sandbox. EnvHttpProxyAgent honors HTTPS_PROXY,
// HTTP_PROXY and NO_PROXY itself; this is a no-op when none are set.
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY ||
    process.env.https_proxy || process.env.http_proxy || process.env.all_proxy) {
  try {
    setGlobalDispatcher(new EnvHttpProxyAgent());
  } catch { /* proxy agent unavailable — fall back to direct connections */ }
}

// Load package.json for version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkgPath = join(__dirname, '../../package.json');
let version = '4.1.0';
try {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  version = pkg.version;
} catch { /* use fallback */ }

// Import all command registrars
import { register as registerScrape } from './commands/scrape.js';
import { register as registerSearch } from './commands/search.js';
import { register as registerCrawl } from './commands/crawl.js';
import { register as registerMap } from './commands/map.js';
import { register as registerExtract } from './commands/extract.js';
import { register as registerTrack } from './commands/track.js';
import { register as registerAnalyze } from './commands/analyze.js';
import { register as registerResearch } from './commands/research.js';
import { register as registerStealth } from './commands/stealth.js';
import { register as registerBatch } from './commands/batch.js';
import { register as registerActions } from './commands/actions.js';
import { register as registerLocalize } from './commands/localize.js';
import { register as registerLlmstxt } from './commands/llmstxt.js';
import { register as registerTemplate } from './commands/template.js';
import { register as registerMonitor } from './commands/monitor.js';
import { register as registerInstallSkills } from './commands/install-skills.js';
import { register as registerUninstallSkills } from './commands/uninstall-skills.js';
import { register as registerInit } from './commands/init.js';

// ─── MCP stdio server mode (backward compatibility) ──────────────────────────
// Before v4.1.0 the `crawlforge` bin WAS the MCP server. v4.1.0 turned it into
// this CLI, which silently broke MCP clients still configured with
// `command: "crawlforge"` — they received CLI help text instead of a JSON-RPC
// stream, surfacing as a -32000 connect error. Detect that case and hand off to
// the MCP server so existing configs keep working with no edits:
//   • explicit:  `crawlforge mcp` / `crawlforge serve`  (registered below)
//   • explicit:  CRAWLFORGE_MCP_STDIO=true
//   • implicit:  no subcommand AND stdin is not a TTY (i.e. spawned by an MCP host)
// Escape hatch: CRAWLFORGE_FORCE_CLI=true forces CLI help even over a pipe.
const __mcpImplicit =
  process.argv.slice(2).length === 0 &&
  !process.stdin.isTTY &&
  process.env.CRAWLFORGE_FORCE_CLI !== 'true';

if (process.env.CRAWLFORGE_MCP_STDIO === 'true' || __mcpImplicit) {
  await import('../../server.js');
} else {

const program = new Command();

program
  .name('crawlforge')
  .description('CrawlForge CLI — web scraping, crawling, and content processing')
  .version(version)
  .option('--json', 'Output compact JSON')
  .option('--pretty', 'Output pretty-printed JSON')
  .option('--quiet', 'Suppress all stdout output (exit code only)')
  .option('--api-key <key>', 'CrawlForge API key (overrides CRAWLFORGE_API_KEY env var)')
  .option('--timeout <ms>', 'Global request timeout in milliseconds', '30000');

// Resolve the API key from (in priority order): --api-key flag, CRAWLFORGE_API_KEY env,
// then the stored ~/.crawlforge/config.json written by `crawlforge-setup`.
function loadStoredApiKey() {
  try {
    const home = process.env.HOME || process.env.USERPROFILE;
    if (!home) return undefined;
    const cfgPath = join(home, '.crawlforge', 'config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    return cfg.apiKey || undefined;
  } catch {
    return undefined;
  }
}

// Apply --api-key globally before commands run
program.hook('preAction', (thisCommand) => {
  const opts = program.opts();
  if (opts.apiKey) {
    process.env.CRAWLFORGE_API_KEY = opts.apiKey;
  } else if (!process.env.CRAWLFORGE_API_KEY) {
    const stored = loadStoredApiKey();
    if (stored) process.env.CRAWLFORGE_API_KEY = stored;
  }
  if (opts.timeout) {
    process.env.CRAWLFORGE_CLI_TIMEOUT = opts.timeout;
  }
});

// Register all 15 tool commands + 2 skills commands
registerScrape(program);
registerSearch(program);
registerCrawl(program);
registerMap(program);
registerExtract(program);
registerTrack(program);
registerAnalyze(program);
registerResearch(program);
registerStealth(program);
registerBatch(program);
registerActions(program);
registerLocalize(program);
registerLlmstxt(program);
registerTemplate(program);
registerMonitor(program);
registerInstallSkills(program);
registerUninstallSkills(program);
registerInit(program);

// `crawlforge mcp` / `crawlforge serve` — explicitly start the MCP server over
// stdio. Extra args (e.g. --http) are read directly by server.js from argv.
program
  .command('mcp')
  .alias('serve')
  .description('Start the MCP server over stdio (for MCP clients like Claude Code, Claude Desktop, Cursor)')
  .allowUnknownOption(true)
  .action(async () => {
    await import('../../server.js');
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});

}
