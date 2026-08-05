/**
 * Phase 6 — SEP-1303 regression test
 *
 * SEP-1303 requires that input-validation (zod) failures on `tools/call` be
 * surfaced as Tool Execution Errors (a normal JSON-RPC *result* with
 * `isError: true`) rather than as a JSON-RPC Protocol Error (a thrown
 * `-32602` at the transport level). This lets the calling model see the
 * validation problem in-band and self-correct, instead of the request
 * failing outright.
 *
 * ESTABLISHED FACT (verified against node_modules/@modelcontextprotocol/sdk
 * 1.29.0's `server/mcp.js`): `McpServer`'s `CallToolRequestSchema` handler
 * already wraps `validateToolInput()` failures in a try/catch and returns
 * `this.createToolError(...)` — i.e. `{ content: [...], isError: true }` —
 * instead of letting the `McpError(InvalidParams, ...)` escape as a
 * protocol-level error. This test pins that behavior in-process (no
 * server.js, no network, no spawning) so a future SDK upgrade or server
 * change can't silently regress it.
 *
 * Run: node --test tests/unit/phase6-sep1303-validation.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

/**
 * Build a connected (server, client) pair with a single test tool whose
 * inputSchema requires a valid URL — enough surface to exercise validation
 * failure and success paths without depending on server.js.
 */
async function buildConnectedPair() {
  const server = new McpServer({ name: 'phase6-sep1303-test-server', version: '1.0.0' });

  server.registerTool(
    'test_tool',
    {
      description: 'Echoes back the given URL. Used only to exercise SEP-1303 validation behavior.',
      inputSchema: { url: z.string().url().describe('A URL') }
    },
    async ({ url }) => ({
      content: [{ type: 'text', text: `ok:${url}` }]
    })
  );

  const client = new Client({ name: 'phase6-sep1303-test-client', version: '1.0.0' });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport)
  ]);

  return { server, client };
}

test('SEP-1303: invalid argument value (bad URL) resolves as a Tool Execution Error, not a thrown protocol error', async () => {
  const { client } = await buildConnectedPair();

  // If this were a protocol-level error, callTool() would reject (throw).
  // SEP-1303 requires it to resolve normally with isError: true instead.
  const result = await client.callTool({
    name: 'test_tool',
    arguments: { url: 'not-a-url' }
  });

  assert.equal(result.isError, true, 'expected result.isError to be true for invalid input');
  assert.ok(Array.isArray(result.content) && result.content.length > 0, 'expected content array on the error result');

  const text = result.content[0].text;
  assert.match(text, /MCP error -32602/, 'error text should still carry the -32602 (Invalid params) code so the compliance suite\'s extractError() keeps recognizing it');
  assert.match(text, /Input validation error/i, 'error text should describe an input validation problem');
});

test('SEP-1303: missing required argument resolves as a Tool Execution Error, not a thrown protocol error', async () => {
  const { client } = await buildConnectedPair();

  const result = await client.callTool({
    name: 'test_tool',
    arguments: {}
  });

  assert.equal(result.isError, true, 'expected result.isError to be true for a missing required argument');
  assert.ok(Array.isArray(result.content) && result.content.length > 0, 'expected content array on the error result');

  const text = result.content[0].text;
  assert.match(text, /MCP error -32602/, 'error text should still carry the -32602 (Invalid params) code');
  assert.match(text, /Input validation error/i, 'error text should describe an input validation problem');
});

test('SEP-1303 control: a valid call still succeeds normally (isError absent/false)', async () => {
  const { client } = await buildConnectedPair();

  const result = await client.callTool({
    name: 'test_tool',
    arguments: { url: 'https://example.com' }
  });

  assert.ok(!result.isError, 'expected a valid call to not be flagged as an error');
  assert.equal(result.content?.[0]?.text, 'ok:https://example.com');
});
