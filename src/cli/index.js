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

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});
