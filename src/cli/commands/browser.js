/**
 * browser command — run one browser session end to end: open, snapshot the
 * page, run steps against the refs the snapshot handed back, close.
 *
 * ONE INVOCATION IS ONE SESSION, deliberately. `browser_session` keeps its page
 * in the process that opened it, and a CLI process ends when the command does —
 * so a `crawlforge browser open` that returned a session id would be returning
 * an id whose page died on exit. The loop an MCP client spreads over several
 * calls is therefore written down in advance here and run in one go. When a
 * session has to outlive the call that opened it, use the MCP tool.
 */
import { BrowserSessionTool } from '../../tools/advanced/BrowserSessionTool.js';
import { runTool } from '../lib/runTool.js';
import { readFileSync } from 'node:fs';

export function register(program) {
  program
    .command('browser <url>')
    .description('Run a browser session against a URL: open, snapshot, run steps on its refs, close')
    // No --timeout here: the global --timeout shadows a subcommand option of
    // the same name, which then never receives its value.
    .option('--steps <file>', 'JSON file of session steps, e.g. [{"operation":"act","actions":[…]}]')
    .option('--read', 'Read the page content after the steps have run')
    .option('--format <list>', 'Comma-separated read formats: markdown, html, text, json', 'markdown')
    .option('--stealth', 'Open the session in the stealth browser')
    .option('--ttl <seconds>', 'Session lifetime in seconds (30-3600, default 600)')
    .action(async (url, opts, cmd) => {
      const globals = cmd.parent.opts();
      const cliFlags = { json: globals.json, pretty: globals.pretty, quiet: globals.quiet };

      const steps = [];
      if (opts.steps) {
        try {
          steps.push(...JSON.parse(readFileSync(opts.steps, 'utf8')));
        } catch (e) {
          process.stderr.write(`Error reading steps file: ${e.message}\n`);
          process.exit(1);
        }
      }
      if (opts.read) {
        steps.push({
          operation: 'read',
          formats: opts.format.split(',').map((f) => f.trim()).filter(Boolean)
        });
      }

      const tool = new BrowserSessionTool();
      const wrapperTool = {
        execute: async (p) => {
          const opened = await tool.execute({ operation: 'open', ...p });
          const sessionId = opened.sessionId;
          const results = [opened];
          try {
            // The opening snapshot is what makes a `@e1` selector in --steps
            // resolve at all: refs are stamped by a snapshot on this page in
            // this process, and there is no earlier call to have taken one.
            results.push(await tool.execute({ operation: 'snapshot', session_id: sessionId }));
            for (const step of steps) {
              results.push(await tool.execute({ ...step, session_id: sessionId }));
            }
            results.push(await tool.execute({ operation: 'close', session_id: sessionId }));
          } finally {
            // Closes anything a failed step left open and shuts the browser
            // down — this executor is ours, unlike the server's shared one.
            await tool.destroy();
          }
          return { url, steps: results };
        }
      };

      await runTool(wrapperTool, {
        url,
        stealth: !!opts.stealth,
        ...(opts.ttl ? { ttl: parseInt(opts.ttl, 10) } : {})
      }, cliFlags);
    });
}
