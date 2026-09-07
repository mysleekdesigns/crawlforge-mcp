/**
 * Unit tests: agent tool (real module — src/tools/agent/agent.js)
 * Run: node --test tests/unit/tools/agent/agent.test.js
 *
 * Covers 4.4's input-required round trip: the pro-model confirmation is a gate
 * that RETURNS an input_required result, which the SDK answers by re-entering
 * execute() from the top with the answer on ctx. AgentOrchestrator is stubbed,
 * so nothing here reaches the network.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isInputRequiredResult, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';
import { AgentTool } from '../../../../src/tools/agent/agent.js';

const GATE_KEY = 'agent:pro_model';

// The two ctx shapes the SDK hands a handler: a first entry from a client that
// can be asked, and the re-entry carrying that client's answer.
const askableCtx = () => ({ mcpReq: { envelope: { [CLIENT_CAPABILITIES_META_KEY]: { elicitation: {} } } } });
const answeredCtx = (response) => ({ mcpReq: { inputResponses: { [GATE_KEY]: response } } });

function makeTool() {
  const tool = new AgentTool();
  const runs = [];
  tool._orchestrator = {
    run: async (options) => { runs.push(options); return { success: true, answer: 'stub' }; },
    destroy: async () => {}
  };
  return { tool, runs };
}

describe('agent tool — pro-model confirmation gate', () => {
  test('default model runs without asking, even from an askable client', async () => {
    const { tool, runs } = makeTool();
    const result = await tool.execute({ prompt: 'who ships MCP tools?' }, askableCtx());
    assert.equal(isInputRequiredResult(result), false);
    assert.equal(result.answer, 'stub');
    assert.equal(runs.length, 1);
  });

  test('pro model asks, and runs nothing while the question is outstanding', async () => {
    const { tool, runs } = makeTool();
    const result = await tool.execute({ prompt: 'deep dive', model: 'pro' }, askableCtx());
    assert.ok(isInputRequiredResult(result), 'the gate must return an input_required result verbatim');
    assert.ok(result.inputRequests[GATE_KEY], 'the request is keyed by the tool-scoped gate key');
    assert.equal(runs.length, 0, 'nothing runs until the user answers');
  });

  test('an accepted answer proceeds on re-entry', async () => {
    const { tool, runs } = makeTool();
    const result = await tool.execute(
      { prompt: 'deep dive', model: 'pro' },
      answeredCtx({ action: 'accept', content: { confirmed: true } })
    );
    assert.equal(isInputRequiredResult(result), false);
    assert.equal(result.answer, 'stub');
    assert.equal(runs[0].model, 'pro');
  });

  test('a declined answer returns the cancelled payload', async () => {
    const { tool, runs } = makeTool();
    const result = await tool.execute(
      { prompt: 'deep dive', model: 'pro' },
      answeredCtx({ action: 'decline' })
    );
    assert.deepEqual(result, {
      success: false,
      cancelled: true,
      reason: 'User cancelled pro agent run.'
    });
    assert.equal(runs.length, 0);
  });

  test('accept: false is a cancellation, not a proceed', async () => {
    const { tool, runs } = makeTool();
    const result = await tool.execute(
      { prompt: 'deep dive', model: 'pro' },
      answeredCtx({ action: 'accept', content: { confirmed: false } })
    );
    assert.equal(result.cancelled, true);
    assert.equal(runs.length, 0);
  });

  test('a client that cannot be asked proceeds unasked (fail-open, unchanged)', async () => {
    const { tool, runs } = makeTool();
    const result = await tool.execute({ prompt: 'deep dive', model: 'pro' }, undefined);
    assert.equal(isInputRequiredResult(result), false);
    assert.equal(runs.length, 1);
  });
});
