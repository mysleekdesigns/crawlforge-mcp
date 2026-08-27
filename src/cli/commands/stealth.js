/**
 * stealth command — scrape a URL using stealth mode.
 */
import { StealthBrowserManager } from '../../core/StealthBrowserManager.js';
import { browserPreflight } from '../../utils/robotsGate.js';
import { getToolConfig } from '../../constants/config.js';
import { runTool } from '../lib/runTool.js';

export function register(program) {
  program
    .command('stealth <url>')
    .description('Scrape a URL using stealth/anti-bot browser mode')
    .option('--engine <engine>', 'Browser engine: chromium or camoufox', 'chromium')
    .option('--wait <ms>', 'Wait time after page load in milliseconds', '2000')
    .option('--screenshot', 'Capture a screenshot')
    .action(async (url, opts, cmd) => {
      const globals = cmd.parent.opts();
      const cliFlags = { json: globals.json, pretty: globals.pretty, quiet: globals.quiet };
      const mgr = new StealthBrowserManager(getToolConfig('stealth_mode'));
      const wrapperTool = {
        // Same gate the stealth_mode tool runs. The CLI reaches the browser by
        // a different door, not by a different set of rules.
        execute: async (p) => {
          await browserPreflight(p.url, { tool: 'stealth_mode' });
          return mgr.scrapeWithStealth(p);
        }
      };
      await runTool(wrapperTool, {
        url,
        // "playwright" was the pre-v4.0.0 name for the chromium engine
        engine: opts.engine === 'playwright' ? 'chromium' : opts.engine,
        wait_for: parseInt(opts.wait, 10),
        screenshot: !!opts.screenshot
      }, cliFlags);
    });
}
