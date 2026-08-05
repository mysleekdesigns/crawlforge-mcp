/**
 * Phase 6 (MCP-Spec Adoption) — protocol-hygiene wrapper regression tests.
 *
 * Run: node --test tests/unit/phase6-spec-hygiene.test.js
 *
 * Covers src/server/specHygiene.js's applySpecHygiene() against a real
 * McpServer + Client connected over an in-memory transport (no live network,
 * no stdio/HTTP transport spun up):
 *
 *   - tools/list is sorted alphabetically regardless of registration order
 *   - every tool's inputSchema (and outputSchema, when present) is stamped
 *     with the JSON Schema 2020-12 $schema URI
 *   - every tool and prompt gets a default `icons` entry (SEP-973)
 *   - tools/call on an allowlisted cacheable tool carries the SEP-2549-style
 *     `_meta["io.modelcontextprotocol/cacheable"]` cache hint
 *   - an isError tools/call result never gets a cache hint
 *   - applying twice does not double-wrap (no duplicate icons, list stays
 *     sorted, cache hint appears exactly once)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { applySpecHygiene } from '../../src/server/specHygiene.js';

async function buildConnectedClient({ applyTwice = false } = {}) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });

  // Registered deliberately out of alphabetical order.
  server.registerTool(
    'zebra_tool',
    {
      description: 'Z tool, plain content result',
      inputSchema: { value: z.string() }
    },
    async () => ({ content: [{ type: 'text', text: 'zebra' }] })
  );

  server.registerTool(
    'apple_tool',
    {
      description: 'A tool, has an outputSchema and returns isError',
      inputSchema: { value: z.string().optional() },
      outputSchema: { ok: z.boolean() }
    },
    async () => ({
      content: [{ type: 'text', text: 'apple failed' }],
      isError: true
    })
  );

  server.registerTool(
    'fetch_url',
    {
      description: 'Cacheable tool, plain content result',
      inputSchema: { url: z.string() }
    },
    async () => ({ content: [{ type: 'text', text: 'fetched' }] })
  );

  server.registerPrompt(
    'sample-prompt',
    { description: 'A sample prompt' },
    async () => ({ messages: [] })
  );

  applySpecHygiene(server);
  if (applyTwice) applySpecHygiene(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ]);

  return { server, client };
}

test('tools/list is sorted alphabetically', async () => {
  const { client } = await buildConnectedClient();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  assert.deepEqual(names, ['apple_tool', 'fetch_url', 'zebra_tool']);
});

test('every inputSchema (and outputSchema) is stamped with the 2020-12 dialect', async () => {
  const { client } = await buildConnectedClient();
  const { tools } = await client.listTools();

  for (const tool of tools) {
    assert.equal(tool.inputSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  }

  const apple = tools.find((t) => t.name === 'apple_tool');
  assert.ok(apple.outputSchema, 'apple_tool should retain its outputSchema');
  assert.equal(apple.outputSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
});

test('every tool gets a default icons entry', async () => {
  const { client } = await buildConnectedClient();
  const { tools } = await client.listTools();

  for (const tool of tools) {
    assert.ok(Array.isArray(tool.icons) && tool.icons.length === 1, `${tool.name} should have exactly one icon`);
    assert.equal(tool.icons[0].src, 'https://www.crawlforge.dev/icon.png');
  }
});

test('prompts/list gets a default icons entry', async () => {
  const { client } = await buildConnectedClient();
  const { prompts } = await client.listPrompts();
  const prompt = prompts.find((p) => p.name === 'sample-prompt');
  assert.ok(prompt, 'sample-prompt should be listed');
  assert.ok(Array.isArray(prompt.icons) && prompt.icons.length === 1);
});

test('tools/call on a cacheable tool carries the SEP-2549-style cache hint', async () => {
  const { client } = await buildConnectedClient();
  const result = await client.callTool({ name: 'fetch_url', arguments: { url: 'https://example.com' } });

  const hint = result._meta?.['io.modelcontextprotocol/cacheable'];
  assert.ok(hint, 'fetch_url result should carry a cache hint');
  assert.equal(hint.ttlMs, 300000);
  assert.equal(hint.cacheScope, 'private');
});

test('tools/call error results never get a cache hint', async () => {
  const { client } = await buildConnectedClient();
  const result = await client.callTool({ name: 'apple_tool', arguments: {} });

  assert.equal(result.isError, true);
  assert.equal(result._meta?.['io.modelcontextprotocol/cacheable'], undefined);
});

test('tools/call on a non-cacheable, non-error tool has no cache hint', async () => {
  const { client } = await buildConnectedClient();
  const result = await client.callTool({ name: 'zebra_tool', arguments: { value: 'x' } });

  assert.equal(result.isError, undefined);
  assert.equal(result._meta?.['io.modelcontextprotocol/cacheable'], undefined);
});

test('applying applySpecHygiene twice does not double-wrap', async () => {
  const { client } = await buildConnectedClient({ applyTwice: true });

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), ['apple_tool', 'fetch_url', 'zebra_tool']);
  for (const tool of tools) {
    assert.equal(tool.icons.length, 1, `${tool.name} icons should not be duplicated`);
  }

  const { prompts } = await client.listPrompts();
  const prompt = prompts.find((p) => p.name === 'sample-prompt');
  assert.equal(prompt.icons.length, 1);

  const result = await client.callTool({ name: 'fetch_url', arguments: { url: 'https://example.com' } });
  assert.equal(result._meta?.['io.modelcontextprotocol/cacheable']?.ttlMs, 300000);
});
