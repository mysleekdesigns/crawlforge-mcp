/**
 * Phase 4.4 end-to-end: a confirmation round trip through the REAL SDK dispatch.
 *
 * The unit tests around withAuth drive the wrapper directly. This one drives the
 * whole path — a registered tool with an `outputSchema`, the SDK's legacy shim
 * doing the server→client `elicitation/create`, and the handler re-entered with
 * the answer — because three things here are internals-dependent enough that a
 * mocked test would keep passing while the real thing broke:
 *
 *   1. The SDK must accept an `input_required` return from a tool that declares
 *      an `outputSchema`. `crawl_deep` declares one. If the SDK validated the
 *      round trip against it, every gated crawl would fail on the wire.
 *   2. The shim must re-enter the SAME wrapper, which is what makes the double
 *      charge possible in the first place — this asserts the handler runs twice
 *      and `reportUsage` runs once.
 *   3. A declining client must reach the tool as a decline, not as a failure.
 *
 * Run: node --test tests/unit/inputRequiredRoundTrip.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { z } from 'zod';
import { makeWithAuth } from '../../src/server/withAuth.js';
import { ElicitationHelper } from '../../src/core/ElicitationHelper.js';

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function makeAuth(toolCost) {
  const reportCalls = [];
  return {
    reportCalls,
    isCreatorMode: () => false,
    getToolCost: () => toolCost,
    checkCredits: async () => true,
    projectCost: () => ({ projected: toolCost, note: 'test' }),
    reportUsage: async (...args) => { reportCalls.push(args); }
  };
}

/**
 * Wire a server whose one tool gates on a confirmation, exactly the way the
 * five real tools now do, and a client that answers with `answer`.
 */
async function runGatedCall({ answer, clientCapabilities = { elicitation: {} }, toolCost = 4 }) {
  const auth = makeAuth(toolCost);
  const withAuth = makeWithAuth({ authManager: auth, logger: silentLogger });
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  const elicitation = new ElicitationHelper({ mcpServer: server, logger: silentLogger });

  let entries = 0;
  server.registerTool('gated_tool', {
    description: 'gated',
    inputSchema: { pages: z.number() },
    // The shape crawl_deep registers. Point 1 above.
    outputSchema: { success: z.boolean(), pages: z.number() },
  }, withAuth('crawl_deep', async ({ pages }, ctx) => {
    entries += 1;
    const gate = elicitation.confirm(ctx, 'crawl_deep:large', `Crawl ${pages} pages?`, { pages });
    if (gate.status === 'ask') return gate.result;
    const out = gate.status === 'cancelled'
      ? { success: false, pages }
      : { success: true, pages };
    return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
  }));

  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: clientCapabilities });
  let prompts = 0;
  if (answer) {
    client.setRequestHandler('elicitation/create', async (req) => {
      prompts += 1;
      return answer(req);
    });
  }

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name: 'gated_tool', arguments: { pages: 900 } });
    return { result, entries, prompts, reportCalls: auth.reportCalls };
  } finally {
    await client.close();
  }
}

test('a confirmed round trip: handler runs twice, the user is asked once, billing happens once', async () => {
  const { result, entries, prompts, reportCalls } = await runGatedCall({
    answer: () => ({ action: 'accept', content: { confirmed: true } })
  });

  assert.equal(entries, 2, 'the SDK re-enters the same wrapper with the answer');
  assert.equal(prompts, 1, 'and asks the user exactly once');
  assert.equal(reportCalls.length, 1, 'the round trip is not billed — only the entry that did the work');
  assert.equal(reportCalls[0][1], 4, 'billed the full tool price, once');

  assert.equal(result.isError, undefined, 'an outputSchema does not reject the round trip');
  assert.deepEqual(result.structuredContent, { success: true, pages: 900 });
});

test('the prompt carries the message and the detail lines the tool passed', async () => {
  let seen = null;
  await runGatedCall({
    answer: (req) => { seen = req.params; return { action: 'accept', content: { confirmed: true } }; }
  });

  assert.equal(seen.message, 'Crawl 900 pages?\n\n  pages: 900');
  assert.equal(seen.mode, 'form');
  assert.deepEqual(seen.requestedSchema.required, ['confirmed']);
});

test('a declined confirmation reaches the tool as a decline and is billed once', async () => {
  const { result, entries, reportCalls } = await runGatedCall({
    answer: () => ({ action: 'decline' })
  });

  assert.equal(entries, 2);
  assert.deepEqual(result.structuredContent, { success: false, pages: 900 }, 'the tool decided, not the SDK');
  assert.equal(reportCalls.length, 1, 'the decline round trip itself is free');
});

test('a client that never declared elicitation is not asked, and the call succeeds', async () => {
  // The capability gate. Without it the SDK answers an input_required return on
  // such a connection with isError, turning a nicety into a failed call.
  const { result, entries, prompts, reportCalls } = await runGatedCall({
    answer: null,
    clientCapabilities: {}
  });

  assert.equal(entries, 1, 'no round trip at all');
  assert.equal(prompts, 0);
  assert.equal(result.isError, undefined, 'fail-open: the operation proceeds unasked');
  assert.deepEqual(result.structuredContent, { success: true, pages: 900 });
  assert.equal(reportCalls.length, 1);
});
