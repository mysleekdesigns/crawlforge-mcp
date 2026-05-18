/**
 * batchScrape — schema module.
 */

import { z } from 'zod';

export const UrlConfigSchema = z.object({
  url: z.string().url(),
  selectors: z.record(z.string()).optional(),
  headers: z.record(z.string()).optional(),
  timeout: z.number().min(1000).max(30000).optional(),
  metadata: z.record(z.any()).optional()
});

export const BatchScrapeSchema = z.object({
  urls: z.array(z.union([z.string().url(), UrlConfigSchema])).min(1).max(50),
  formats: z.array(z.enum(['markdown', 'html', 'json', 'text'])).default(['json']), // 4.2.1: aligned with server.js MCP registration default; markdown remains opt-in via formats:['markdown'] for RAG workflows
  mode: z.enum(['sync', 'async']).default('sync'),
  webhook: z.object({
    url: z.string().url(),
    events: z.array(z.string()).optional().default(['batch_completed', 'batch_failed']),
    headers: z.record(z.string()).optional(),
    signingSecret: z.string().optional()
  }).optional(),
  extractionSchema: z.record(z.string()).optional(),
  maxConcurrency: z.number().min(1).max(20).default(10),
  delayBetweenRequests: z.number().min(0).max(10000).default(100),
  includeMetadata: z.boolean().default(true),
  includeFailed: z.boolean().default(true),
  pageSize: z.number().min(1).max(100).default(25),
  jobOptions: z.object({
    priority: z.number().default(0),
    ttl: z.number().min(60000).default(24 * 60 * 60 * 1000),
    maxRetries: z.number().min(0).max(5).default(1),
    tags: z.array(z.string()).default([])
  }).optional()
});
