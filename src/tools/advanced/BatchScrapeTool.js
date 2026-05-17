/**
 * BatchScrapeTool.js — backward-compatibility re-export shim.
 *
 * The implementation has been split into:
 *   batchScrape/schema.js   — Zod input schema
 *   batchScrape/worker.js   — per-URL fetch + content extraction
 *   batchScrape/queue.js    — Semaphore concurrency runner
 *   batchScrape/reporter.js — webhook notification helper
 *   batchScrape/index.js    — BatchScrapeTool class
 *
 * All original named exports are preserved so existing imports continue to work.
 */

export { BatchScrapeTool, BatchScrapeTool as default } from './batchScrape/index.js';
export { BatchScrapeSchema } from './batchScrape/schema.js';
