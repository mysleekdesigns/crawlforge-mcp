/**
 * Shared Zod schema fragments reused across tool registrations in server.js.
 * Centralizes repeated patterns (url, pagination, webhook, cache opts).
 */

import { z } from 'zod';

/** URL field — string that validates as a URL */
export const urlSchema = z.string().url();

/** Optional pagination fields shared by history / list endpoints */
export const paginationSchema = z.object({
  limit: z.number().min(1).max(500).default(50),
  offset: z.number().min(0).default(0)
});

/** Webhook notification object, used in batch_scrape and deep_research */
export const webhookSchema = z.object({
  url: urlSchema,
  events: z.array(z.string()).optional(),
  headers: z.record(z.string()).optional(),
  signingSecret: z.string().optional()
});

/** Cache behaviour flags, used in crawl and search tools */
export const cacheOptsSchema = z.object({
  enabled: z.boolean().default(true),
  ttl: z.number().min(0).default(3600000)
});
