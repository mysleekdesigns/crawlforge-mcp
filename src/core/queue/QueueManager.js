import PQueue from 'p-queue';

export class QueueManager {
  constructor(options = {}) {
    const {
      concurrency = 10,
      interval = 1000,
      intervalCap = 10,
      timeout = 30000
    } = options;

    this.queue = new PQueue({
      concurrency,
      interval,
      intervalCap,
      timeout,
      throwOnTimeout: true
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
    return this.queue.add(fn, { priority });
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