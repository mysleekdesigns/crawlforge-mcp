/**
 * uninstall-skills command -- remove CrawlForge skill files.
 */
import { uninstall, uninstallHook } from '../../skills/installer.js';

export function register(program) {
  program
    .command('uninstall-skills')
    .description('Remove CrawlForge skill files from Claude Code, Cursor, or VS Code')
    .option('--target <target>', 'Target: claude-code, cursor, vscode, or all', 'all')
    .option('--remove-hook', 'Also remove the opt-in UserPromptSubmit reminder hook')
    .action(async (opts) => {
      try {
        const results = await uninstall({
          target: opts.target,
          cwd: process.cwd()
        });

        if (opts.removeHook) {
          const hook = uninstallHook();
          process.stdout.write(
            (hook.removed ? 'Removed forced-eval hook: ' : 'No forced-eval hook found: ') +
            hook.path + '\n'
          );
        }

        if (results.removed.length > 0) {
          process.stdout.write('Removed:\n');
          results.removed.forEach(p => process.stdout.write('  ' + p + '\n'));
        }
        if (results.notFound.length > 0) {
          process.stdout.write('Not found (already removed):\n');
          results.notFound.forEach(p => process.stdout.write('  ' + p + '\n'));
        }
        if (results.removed.length === 0) {
          process.stdout.write('No skill files found to remove.\n');
        }
        process.exit(0);
      } catch (err) {
        process.stderr.write('Error: ' + err.message + '\n');
        process.exit(1);
      }
    });
}
