/**
 * cli browser — command registration and option shape.
 *
 * The `--timeout` assertion is the load-bearing one: the root program declares a
 * global `--timeout <ms>`, and a subcommand option of the same name never
 * receives its value (it is shadowed). `browser` therefore must not declare one.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { Command } from 'commander';
import { register } from '../../../src/cli/commands/browser.js';

function browserCommand() {
  const program = new Command();
  program.option('--timeout <ms>', 'Global request timeout in milliseconds', '30000');
  register(program);
  return program.commands.find((c) => c.name() === 'browser');
}

describe('cli browser', () => {
  test('registers a `browser <url>` command', () => {
    const cmd = browserCommand();
    assert.ok(cmd, 'browser command registered');
    assert.equal(cmd.usage().trim(), '[options] <url>');
  });

  test('declares the session options, and no shadowed --timeout', () => {
    const flags = browserCommand().options.map((o) => o.long);
    assert.deepEqual(flags, ['--steps', '--read', '--format', '--stealth', '--ttl']);
    assert.ok(!flags.includes('--timeout'), 'must not collide with the global --timeout');
  });

  test('--format defaults to markdown', () => {
    const format = browserCommand().options.find((o) => o.long === '--format');
    assert.equal(format.defaultValue, 'markdown');
  });
});
