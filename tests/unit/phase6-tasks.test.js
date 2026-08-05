/**
 * Phase 6 — MCP tasks extension (io.modelcontextprotocol/tasks) regression tests
 *
 * Exercises src/server/taskSupport.js end-to-end against a real McpServer +
 * Client pair connected over InMemoryTransport (no live network, no server.js).
 *
 * Run: node --test --test-force-exit tests/unit/phase6-tasks.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

import { createTaskStore, TASK_EXECUTION, TASKS_CAPABILITY, makeTaskToolHandler } from '../../src/server/taskSupport.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Builds a connected (server, client) pair with a handful of task-backed
 * tools registered via registerToolTask + makeTaskToolHandler.
 */
async function buildConnectedPair() {
  const taskStore = createTaskStore({ logger: undefined });
  const server = new McpServer({ name: 'phase6-tasks-test-server', version: '1.0.0' }, { taskStore });
  server.server.registerCapabilities(TASKS_CAPABILITY);

  server.experimental.tasks.registerToolTask(
    'slow_echo',
    {
      description: 'Echoes msg back after a short delay. Test tool only.',
      inputSchema: { msg: z.string() },
      execution: TASK_EXECUTION
    },
    makeTaskToolHandler({
      name: 'slow_echo',
      run: async ({ msg }) => {
        await delay(50);
        return { content: [{ type: 'text', text: msg }] };
      },
      taskStore,
      logger: undefined
    })
  );

  server.experimental.tasks.registerToolTask(
    'slow_fail',
    {
      description: 'Always throws after a short delay. Test tool only.',
      inputSchema: { msg: z.string() },
      execution: TASK_EXECUTION
    },
    makeTaskToolHandler({
      name: 'slow_fail',
      run: async () => {
        await delay(30);
        throw new Error('boom');
      },
      taskStore,
      logger: undefined
    })
  );

  server.experimental.tasks.registerToolTask(
    'cancellable',
    {
      description: 'Resolves well after it can be cancelled. Test tool only.',
      inputSchema: { msg: z.string() },
      execution: TASK_EXECUTION
    },
    makeTaskToolHandler({
      name: 'cancellable',
      run: async ({ msg }) => {
        await delay(300);
        return { content: [{ type: 'text', text: msg }] };
      },
      taskStore,
      logger: undefined
    })
  );

  const client = new Client({ name: 'phase6-tasks-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return { server, client, taskStore };
}

async function pollUntilTerminal(client, taskId, { timeoutMs = 5000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let task = await client.experimental.tasks.getTask(taskId);
  while (task.status === 'working' || task.status === 'input_required') {
    if (Date.now() > deadline) {
      throw new Error(`Task ${taskId} did not reach a terminal status within ${timeoutMs}ms (last status: ${task.status})`);
    }
    await delay(intervalMs);
    task = await client.experimental.tasks.getTask(taskId);
  }
  return task;
}

test('task-augmented tools/call returns a task handle immediately, then completes via polling', async () => {
  const { client } = await buildConnectedPair();

  const stream = client.experimental.tasks.callToolStream(
    { name: 'slow_echo', arguments: { msg: 'hello' } },
    CallToolResultSchema,
    { task: {} }
  );

  const first = await stream.next();
  assert.equal(first.done, false);
  assert.equal(first.value.type, 'taskCreated');
  const taskId = first.value.task.taskId;
  assert.ok(taskId, 'expected a taskId on task creation');
  assert.equal(first.value.task.status, 'working', 'task should still be working immediately after creation (run() takes 50ms)');

  const finalTask = await pollUntilTerminal(client, taskId);
  assert.equal(finalTask.status, 'completed');

  const result = await client.experimental.tasks.getTaskResult(taskId, CallToolResultSchema);
  assert.equal(result.content?.[0]?.text, 'hello');
});

test('a plain (non-task-augmented) tools/call on a task-capable tool still resolves synchronously', async () => {
  const { client } = await buildConnectedPair();

  const result = await client.callTool({ name: 'slow_echo', arguments: { msg: 'world' } });

  assert.ok(!result.isError);
  assert.equal(result.content?.[0]?.text, 'world');
});

test('a failing run() yields task status "failed" with an error result', async () => {
  const { client } = await buildConnectedPair();

  const stream = client.experimental.tasks.callToolStream(
    { name: 'slow_fail', arguments: { msg: 'irrelevant' } },
    CallToolResultSchema,
    { task: {} }
  );

  const first = await stream.next();
  const taskId = first.value.task.taskId;

  const finalTask = await pollUntilTerminal(client, taskId);
  assert.equal(finalTask.status, 'failed');

  const result = await client.experimental.tasks.getTaskResult(taskId, CallToolResultSchema);
  assert.equal(result.isError, true);
  assert.match(result.content?.[0]?.text ?? '', /boom/);
});

test('tasks/list surfaces created tasks', async () => {
  const { client } = await buildConnectedPair();

  const stream = client.experimental.tasks.callToolStream(
    { name: 'slow_echo', arguments: { msg: 'listed' } },
    CallToolResultSchema,
    { task: {} }
  );
  const first = await stream.next();
  const taskId = first.value.task.taskId;

  const { tasks } = await client.experimental.tasks.listTasks();
  assert.ok(
    tasks.some((t) => t.taskId === taskId),
    'expected the newly created task to appear in tasks/list'
  );

  await pollUntilTerminal(client, taskId);
});

test('tasks/cancel on an in-flight task terminates it, and the late result does not overwrite the cancellation', async () => {
  const { client } = await buildConnectedPair();

  const stream = client.experimental.tasks.callToolStream(
    { name: 'cancellable', arguments: { msg: 'never seen' } },
    CallToolResultSchema,
    { task: {} }
  );
  const first = await stream.next();
  const taskId = first.value.task.taskId;
  assert.equal(first.value.task.status, 'working');

  const cancelResult = await client.experimental.tasks.cancelTask(taskId);
  assert.equal(cancelResult.status, 'cancelled');

  const rightAfterCancel = await client.experimental.tasks.getTask(taskId);
  assert.equal(rightAfterCancel.status, 'cancelled');

  // The tool's run() (300ms) resolves well after cancellation; make sure that
  // late completion does not flip the task back to 'completed'.
  await delay(400);
  const stillCancelled = await client.experimental.tasks.getTask(taskId);
  assert.equal(stillCancelled.status, 'cancelled', 'late tool completion must not overwrite a terminal cancellation');
});
