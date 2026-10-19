/**
 * R25 Phase 0 (billing integrity) regression tests.
 *
 * Run: node --test tests/unit/r25-phase0-billing.test.js
 *
 * 0.1  extract_structured, extract_with_llm and summarize_content returned
 *      {success:false} with no isError, so withAuth billed them in full and
 *      logged a success. Every failure is now an error outcome charged 0.
 * 0.2  _cost and next_step reached only content[0].text, never structuredContent.
 * 0.3  agent accepted a whitespace-only prompt and billed the 8-credit base.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWithAuth } from '../../src/server/withAuth.js';
import { dualOutput } from '../../src/server/registerTool.js';
import { SummarizeContentTool } from '../../src/tools/extract/summarizeContent.js';
import { ExtractWithLlm } from '../../src/tools/extract/extractWithLlm.js';
import { AgentInputSchema } from '../../src/tools/agent/agent.js';

function setup(toolCost) {
  const reportCalls = [];
  const logLines = [];
  const authManager = {
    isCreatorMode: () => false,
    getToolCost: () => toolCost,
    checkCredits: async () => true,
    projectCost: () => ({ projected: toolCost, note: 'test' }),
    reportUsage: async (...args) => { reportCalls.push(args); }
  };
  const logger = {
    info(message, context) { logLines.push(context); },
    warn() {}, error() {}, debug() {}
  };
  return { reportCalls, logLines, withAuth: makeWithAuth({ authManager, logger }) };
}

function assertFreeError({ reportCalls, logLines }, result) {
  assert.equal(result.isError, true, 'flagged as an error for the client');
  assert.deepEqual(reportCalls, [], 'charged 0: no usage reported');
  assert.equal(logLines[0].outcome, 'error', 'logged with outcome error');
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed._cost.actual, 0);
  assert.equal(typeof parsed.next_step, 'string');
}

// 0.1 — the three repros, through the same handler shapes server.js registers.

test('extract_structured on an unresolvable host is charged 0 and logged as an error', async () => {
  const ctx = setup(3);
  // The body extractStructured.execute() returns for a DNS failure, wrapped in
  // dualOutput exactly as server.js does.
  const body = {
    success: false,
    url: 'https://no-such-host-cf-test.invalid/',
    data: {},
    error: 'Structured extraction failed: fetch failed'
  };
  const result = await ctx.withAuth('extract_structured', async () => dualOutput(body))({});
  assertFreeError(ctx, result);
});

test('extract_with_llm with neither url nor content is charged 0 (caller-input error)', async () => {
  const ctx = setup(3);
  const tool = new ExtractWithLlm();
  const result = await ctx.withAuth('extract_with_llm', async (params) => {
    const r = await tool.execute(params);
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  })({ prompt: 'Summarise this text.' });
  assertFreeError(ctx, result);
});

test('summarize_content on text below the minimum is charged 0', async () => {
  const ctx = setup(4);
  const tool = new SummarizeContentTool();
  const result = await ctx.withAuth('summarize_content', async ({ text, options }) => {
    const r = await tool.execute({ text, options });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  })({ text: 'Tiny text' });
  assertFreeError(ctx, result);
});

test('a success body is still billed in full', async () => {
  const ctx = setup(3);
  const result = await ctx.withAuth('extract_structured', async () => dualOutput({ success: true, data: { title: 'x' } }))({});
  assert.equal(result.isError, undefined);
  assert.deepEqual(ctx.reportCalls.map((c) => [c[1], c[3]]), [[3, 200]]);
  assert.equal(result.structuredContent._cost.actual, 3);
});

// 0.2 — structuredContent carries both fields.

test('a failed dualOutput result carries _cost and next_step in structuredContent', async () => {
  const ctx = setup(3);
  const result = await ctx.withAuth('extract_structured', async () => dualOutput({
    success: false, url: 'https://no-such-host-cf-test.invalid/', data: {}, error: 'Structured extraction failed: fetch failed'
  }))({});
  assert.equal(result.structuredContent._cost.actual, 0);
  assert.equal(result.structuredContent._cost.projected, 3);
  assert.equal(result.structuredContent.next_step, JSON.parse(result.content[0].text).next_step);
});

// 0.3 — a blank agent prompt never reaches the handler.

test('agent rejects a whitespace-only prompt and trims a real one', () => {
  assert.equal(AgentInputSchema.safeParse({ prompt: '    ' }).success, false);
  assert.equal(AgentInputSchema.safeParse({ prompt: '\n\t ' }).success, false);
  assert.equal(AgentInputSchema.parse({ prompt: '  latest Python?  ' }).prompt, 'latest Python?');
});
