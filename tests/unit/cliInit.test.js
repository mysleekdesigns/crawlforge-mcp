/**
 * cli init — mcpStanza shape.
 *
 * Regression (2026-08-20): `crawlforge init` exited 1 without an API key even
 * in creator mode. Creator mode now proceeds keyless; the stanza written in
 * that case must omit the env block entirely (the creator secret is never
 * written into client configs — the registered server re-derives creator mode
 * from its own environment).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { mcpStanza } from '../../src/cli/commands/init.js';

describe('cli init — mcpStanza', () => {
  test('keyless stanza (creator mode) has no env block', () => {
    const stanza = mcpStanza(undefined);
    assert.deepEqual(stanza, { command: 'npx', args: ['-y', 'crawlforge@latest', 'mcp'] });
    assert.ok(!('env' in stanza));
  });

  test('stanza with a key carries it in env.CRAWLFORGE_API_KEY', () => {
    const stanza = mcpStanza('cf_test_key_123');
    assert.equal(stanza.command, 'npx');
    assert.deepEqual(stanza.env, { CRAWLFORGE_API_KEY: 'cf_test_key_123' });
  });
});
