/**
 * taskSupport.js — adapter for the MCP `io.modelcontextprotocol/tasks` extension
 * (SDK "experimental" tasks API, @modelcontextprotocol/sdk 1.30.0).
 *
 * Lets long-running tools (crawl_deep, batch_scrape, deep_research, agent) return
 * a task handle immediately and be polled via tasks/get + tasks/result, while a
 * plain (non-task-augmented) tools/call still resolves synchronously via the
 * SDK's own automatic task-polling path (McpServer taskSupport: 'optional').
 *
 * Exports are a frozen contract shared with server.js — do not rename:
 *   createTaskStore, TASK_EXECUTION, TASKS_CAPABILITY, makeTaskToolHandler
 */

import { randomUUID } from 'node:crypto';
import { isTerminal } from '@modelcontextprotocol/sdk/experimental/tasks';

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_POLL_INTERVAL_MS = 200;

const NOOP_LOGGER = {
  debug() {},
  info() {},
  warn() {},
  error() {}
};

/**
 * Minimal in-memory TaskStore implementing the SDK's TaskStore interface
 * (experimental/tasks/interfaces.d.ts). Not built on top of the SDK's own
 * InMemoryTaskStore: that class has no default/max TTL policy (an
 * unspecified ttl means "unlimited", i.e. never cleaned up) and its cleanup
 * timers are not unref'd, and neither is overridable from outside since its
 * fields are private with no subclass hook.
 */
class MemoryTaskStore {
  constructor({ logger = NOOP_LOGGER } = {}) {
    this.logger = logger;
    this.tasks = new Map();
  }

  // Every task gets an automatic expiry: a requested ttl is honored up to
  // MAX_TTL_MS, and an unspecified/null ("unlimited") ttl falls back to
  // DEFAULT_TTL_MS — this server never lets a task linger forever.
  _clampTtl(ttl) {
    if (ttl === undefined || ttl === null) return DEFAULT_TTL_MS;
    return Math.min(ttl, MAX_TTL_MS);
  }

  _scheduleCleanup(taskId, ttl) {
    const stored = this.tasks.get(taskId);
    if (!stored) return;
    if (stored.cleanupTimer) clearTimeout(stored.cleanupTimer);
    stored.cleanupTimer = setTimeout(() => {
      this.tasks.delete(taskId);
    }, ttl).unref();
  }

  async createTask(taskParams, requestId, request, sessionId) {
    const ttl = this._clampTtl(taskParams?.ttl);
    const taskId = randomUUID();
    const createdAt = new Date().toISOString();
    const task = {
      taskId,
      status: 'working',
      ttl,
      createdAt,
      lastUpdatedAt: createdAt,
      pollInterval: taskParams?.pollInterval ?? DEFAULT_POLL_INTERVAL_MS
    };
    this.tasks.set(taskId, { task, requestId, request, sessionId, result: undefined, cleanupTimer: null });
    this._scheduleCleanup(taskId, ttl);
    this.logger.debug(`[tasks] created task ${taskId}`, { ttl });
    return task;
  }

  async getTask(taskId) {
    const stored = this.tasks.get(taskId);
    return stored ? { ...stored.task } : null;
  }

  async storeTaskResult(taskId, status, result) {
    const stored = this.tasks.get(taskId);
    if (!stored) {
      throw new Error(`Task ${taskId} not found`);
    }
    if (isTerminal(stored.task.status)) {
      throw new Error(`Cannot store result for task ${taskId} in terminal status '${stored.task.status}'`);
    }
    stored.result = result;
    stored.task.status = status;
    stored.task.lastUpdatedAt = new Date().toISOString();
    this._scheduleCleanup(taskId, stored.task.ttl);
  }

  async getTaskResult(taskId) {
    const stored = this.tasks.get(taskId);
    if (!stored) {
      throw new Error(`Task ${taskId} not found`);
    }
    if (stored.result === undefined) {
      throw new Error(`Task ${taskId} has no result stored`);
    }
    return stored.result;
  }

  async updateTaskStatus(taskId, status, statusMessage) {
    const stored = this.tasks.get(taskId);
    if (!stored) {
      throw new Error(`Task ${taskId} not found`);
    }
    if (isTerminal(stored.task.status)) {
      throw new Error(`Cannot update task ${taskId} from terminal status '${stored.task.status}'`);
    }
    stored.task.status = status;
    if (statusMessage) stored.task.statusMessage = statusMessage;
    stored.task.lastUpdatedAt = new Date().toISOString();
    if (isTerminal(status)) this._scheduleCleanup(taskId, stored.task.ttl);
  }

  async listTasks(cursor) {
    const PAGE_SIZE = 50;
    const ids = Array.from(this.tasks.keys());
    let start = 0;
    if (cursor) {
      const idx = ids.indexOf(cursor);
      if (idx < 0) throw new Error(`Invalid cursor: ${cursor}`);
      start = idx + 1;
    }
    const pageIds = ids.slice(start, start + PAGE_SIZE);
    const tasks = pageIds.map((id) => ({ ...this.tasks.get(id).task }));
    const nextCursor = start + PAGE_SIZE < ids.length ? pageIds[pageIds.length - 1] : undefined;
    return { tasks, nextCursor };
  }

  /** Clears all pending cleanup timers (graceful shutdown / test teardown). */
  destroy() {
    for (const stored of this.tasks.values()) {
      if (stored.cleanupTimer) clearTimeout(stored.cleanupTimer);
    }
    this.tasks.clear();
  }
}

/**
 * @param {{logger?: object}} [opts]
 * @returns {MemoryTaskStore} an SDK-compatible TaskStore instance
 */
export function createTaskStore({ logger } = {}) {
  return new MemoryTaskStore({ logger });
}

/** execution config for tools registered via registerToolTask */
export const TASK_EXECUTION = { taskSupport: 'optional' };

/**
 * Server capabilities object enabling the tasks extension. Pass to
 * server.server.registerCapabilities(TASKS_CAPABILITY) before connecting
 * the transport.
 */
export const TASKS_CAPABILITY = {
  tasks: {
    list: {},
    cancel: {},
    requests: {
      tools: {
        call: {}
      }
    }
  }
};

/**
 * Builds a ToolTaskHandler ({ createTask, getTask, getTaskResult }) suitable
 * for server.experimental.tasks.registerToolTask(name, config, handler).
 *
 * `run` is the existing withAuth-wrapped tool handler: async (args) => CallToolResult.
 * It is started in the background from createTask (never awaited there) so the
 * request returns a task handle immediately.
 *
 * @param {{name: string, run: (args: any) => Promise<any>, taskStore: object, logger?: object}} opts
 */
// `taskStore` (the global store) is accepted to keep this signature consistent
// with createTaskStore's return value, but request handling below uses
// extra.taskStore — the SDK's request-scoped wrapper, which also emits
// notifications/tasks/status on every update.
export function makeTaskToolHandler({ name, run, taskStore, logger = NOOP_LOGGER }) {
  return {
    async createTask(args, extra) {
      const task = await extra.taskStore.createTask({ ttl: extra.taskRequestedTtl });
      logger.debug(`[tasks] ${name}: task ${task.taskId} created`);

      // Never await run() here — the whole point is to return the task handle now.
      Promise.resolve()
        .then(() => run(args))
        .then(async (result) => {
          try {
            await extra.taskStore.storeTaskResult(task.taskId, 'completed', result);
            logger.debug(`[tasks] ${name}: task ${task.taskId} completed`);
          } catch (storeError) {
            // Task reached a terminal state (e.g. cancelled) before this finished.
            logger.debug(`[tasks] ${name}: dropped late result for task ${task.taskId}: ${storeError.message}`);
          }
        })
        .catch(async (error) => {
          const errorResult = {
            content: [{ type: 'text', text: `Operation failed: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
          try {
            await extra.taskStore.storeTaskResult(task.taskId, 'failed', errorResult);
            logger.debug(`[tasks] ${name}: task ${task.taskId} failed: ${error instanceof Error ? error.message : String(error)}`);
          } catch (storeError) {
            logger.debug(`[tasks] ${name}: dropped late failure for task ${task.taskId}: ${storeError.message}`);
          }
        })
        .catch((fatal) => {
          // Last-resort guard: this handler must never produce an unhandled rejection.
          logger.error(`[tasks] ${name}: unexpected error finalizing task ${task.taskId}`, fatal);
        });

      return { task };
    },

    async getTask(args, extra) {
      return extra.taskStore.getTask(extra.taskId);
    },

    async getTaskResult(args, extra) {
      return extra.taskStore.getTaskResult(extra.taskId);
    }
  };
}
