import PQueue, { TimeoutError } from 'p-queue';

export class QueueManager {
  constructor(options = {}) {
    const {
      concurrency = 10,
      interval = 1000,
      intervalCap = 10,
      timeout = 30000
    } = options;

    // p-queue v9 removed `throwOnTimeout` — timeouts always throw now
    // (this was already the effective behavior since it was set to true).
    this.queue = new PQueue({
      concurrency,
      interval,
      intervalCap,
      timeout
    });

    this.stats = {
      processed: 0,
      failed: 0,
      pending: 0,
      active: 0
    };

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.queue.on('active', () => {
      this.stats.active = this.queue.pending;
      this.stats.pending = this.queue.size;
    });

    this.queue.on('completed', () => {
      this.stats.processed++;
    });

    this.queue.on('error', (error) => {
      this.stats.failed++;
      console.error('Queue error:', error);
    });
  }

  async add(fn, options = {}) {
    const { priority = 0 } = options;
    try {
      return await this.queue.add(fn, { priority });
    } catch (error) {
      // p-queue's message gives the queue state when the task STARTED, which
      // reads like a queue problem. The task itself ran too long, often
      // because synchronous work elsewhere held the event loop.
      if (error instanceof TimeoutError) {
        throw new Error(
          `Task ran over its ${this.queue.timeout / 1000} s time budget; ` +
          'it may have been starved by other work running in this process.',
          { cause: error }
        );
      }
      throw error;
    }
  }

  async addAll(tasks, options = {}) {
    const promises = tasks.map(task => this.add(task, options));
    return Promise.all(promises);
  }

  pause() {
    this.queue.pause();
  }

  start() {
    this.queue.start();
  }

  clear() {
    this.queue.clear();
  }

  async onEmpty() {
    return this.queue.onEmpty();
  }

  async onIdle() {
    return this.queue.onIdle();
  }

  getStats() {
    return {
      ...this.stats,
      // Read live: the 'active' event fires when a task starts, never when the
      // last one ends, so the stored value stayed at 8 on a finished crawl.
      active: this.queue.pending,
      size: this.queue.size,
      pending: this.queue.pending,
      isPaused: this.queue.isPaused
    };
  }

  get size() {
    return this.queue.size;
  }

  get pending() {
    return this.queue.pending;
  }

  get isPaused() {
    return this.queue.isPaused;
  }
}

export default QueueManager;