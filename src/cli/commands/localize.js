/**
 * localize command — fetch content with locale/geo awareness.
 */
import { LocalizationManager } from '../../core/LocalizationManager.js';
import { getToolConfig } from '../../constants/config.js';
import { runTool } from '../lib/runTool.js';

export function register(program) {
  program
    .command('localize <url>')
    .description('Fetch URL with locale/geo-aware settings')
    .option('--locale <locale>', 'Locale code (e.g. en-US, fr-FR)', 'en-US')
    .option('--country <code>', 'Country code for geo-targeting (e.g. US, FR)')
    .option('--currency <code>', 'Currency code (e.g. USD, EUR)')
    .action(async (url, opts, cmd) => {
      const globals = cmd.parent.opts();
      const cliFlags = { json: globals.json, pretty: globals.pretty, quiet: globals.quiet };
      const mgr = new LocalizationManager(getToolConfig('localization'));
      const wrapperTool = {
        execute: (p) => mgr.fetchWithLocalization(p)
      };
      await runTool(wrapperTool, {
        url,
        locale: opts.locale,
        country: opts.country,
        currency: opts.currency
      }, cliFlags);
    });
}
