/**
 * install-skills command -- install CrawlForge skill files into AI coding tools.
 */
import { install } from '../../skills/installer.js';

export function register(program) {
  program
    .command('install-skills')
    .description('Install CrawlForge skill files into Claude Code, Cursor, or VS Code')
    .option('--target <target>', 'Target: claude-code, cursor, vscode, or all', 'all')
    .option('--force', 'Overwrite existing skill files')
    .option('--dry-run', 'Show what would be installed without writing files')
    .action(async (opts) => {
      try {
        const results = await install({
          target: opts.target,
          force: Boolean(opts.force),
          dryRun: Boolean(opts.dryRun),
          cwd: process.cwd()
        });

        if (opts.dryRun) {
          process.stdout.write('Dry run -- would install to:\n');
          results.paths.forEach(p => process.stdout.write('  ' + p + '\n'));
          process.exit(0);
          return;
        }

        if (results.installed.length > 0) {
          process.stdout.write('Installed:\n');
          results.installed.forEach(p => process.stdout.write('  ' + p + '\n'));
        }
        if (results.skipped.length > 0) {
          process.stdout.write('Skipped (already installed; use --force to overwrite):\n');
          results.skipped.forEach(p => process.stdout.write('  ' + p + '\n'));
        }
        if (results.installed.length === 0 && results.skipped.length === 0) {
          process.stdout.write('Nothing to install.\n');
        }
        process.exit(0);
      } catch (err) {
        process.stderr.write('Error: ' + err.message + '\n');
        process.exit(1);
      }
    });
}
