/**
 * localize command — fetch a URL with a country's Accept-Language header.
 * Looks up the country's settings via LocalizationManager and passes its
 * Accept-Language to the fetch. That header is the only thing sent: the
 * request leaves from this machine's IP under the CrawlForge identity, and
 * the timezone and currency are reported, not applied.
 */
import { LocalizationManager } from '../../core/LocalizationManager.js';
import { fetchUrlHandler } from '../../tools/basic/fetchUrl.js';
import { getToolConfig } from '../../constants/config.js';
import { runTool } from '../lib/runTool.js';

// Derive a 2-letter country code from a --country flag or an en-US style locale.
function resolveCountry(country, locale) {
  if (country) return country.toUpperCase();
  if (locale && locale.includes('-')) return locale.split('-')[1].toUpperCase();
  return 'US';
}

export function register(program) {
  program
    .command('localize <url>')
    .description("Fetch URL with a country's Accept-Language header (no proxy: the request IP does not change)")
    .option('--locale <locale>', 'Locale code (e.g. en-US, fr-FR)', 'en-US')
    .option('--country <code>', 'Country whose settings to look up (e.g. US, FR); defaults to the locale\'s region')
    .option('--currency <code>', 'Currency code to report in the output (e.g. USD, EUR); not sent')
    .action(async (url, opts, cmd) => {
      const globals = cmd.parent.opts();
      const cliFlags = { json: globals.json, pretty: globals.pretty, quiet: globals.quiet };

      const countryCode = resolveCountry(opts.country, opts.locale);
      const language = opts.locale ? opts.locale.split('-')[0] : undefined;

      const wrapperTool = {
        execute: async () => {
          const mgr = new LocalizationManager(getToolConfig('localization'));
          await mgr.initialize();
          const config = await mgr.configureCountry(countryCode, {
            language,
            currency: opts.currency
          });

          const headers = {
            'Accept-Language': config.acceptLanguage,
            ...(config.customHeaders || {})
          };

          const fetched = await fetchUrlHandler({ url, headers });
          return {
            localization: {
              countryCode: config.countryCode,
              language: config.language,
              timezone: config.timezone,
              currency: config.currency,
              acceptLanguage: config.acceptLanguage
            },
            request_headers: headers,
            response: fetched
          };
        }
      };

      await runTool(wrapperTool, {}, cliFlags);
    });
}
