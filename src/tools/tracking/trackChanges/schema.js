/**
 * TrackChanges — schema module.
 * Centralises the Zod input schema so monitor.js, differ.js, notifier.js
 * and the entry-point index.js can all import from one place.
 */

import { z } from 'zod';

/**
 * The raw input shape — one declaration (G5). server.js spreads it, with the
 * shared compliance params, into the registered inputSchema, so the
 * `.describe()` strings a client sees and the defaults the tool validates
 * with cannot drift apart again (they had: the `email` block and the default
 * `excludeSelectors` never reached tools/list). `.prefault({})` on the option
 * objects fills their inner defaults when the object is omitted; zod 4's
 * `.default({})` would not.
 */
export const TRACK_CHANGES_INPUT_SHAPE = {
  url: z.string().url().optional().describe("The URL to track changes for (optional for list_scheduled_monitors)"),
  operation: z.enum([
    'create_baseline',
    'compare',
    'monitor',
    'get_history',
    'get_stats',
    'create_scheduled_monitor',
    'stop_scheduled_monitor',
    'list_scheduled_monitors',
    'get_dashboard',
    'export_history',
    'create_alert_rule',
    'generate_trend_report',
    'get_monitoring_templates'
  ]).default('compare').describe("Tracking operation to perform"),

  content: z.string().optional().describe("Content to compare against baseline"),
  html: z.string().optional().describe("HTML content to compare against baseline"),

  trackingOptions: z.object({
    granularity: z.enum(['page', 'section', 'element', 'text']).default('section'),
    trackText: z.boolean().default(true),
    trackStructure: z.boolean().default(true),
    trackAttributes: z.boolean().default(false),
    trackImages: z.boolean().default(false),
    trackLinks: z.boolean().default(true),
    ignoreWhitespace: z.boolean().default(true),
    ignoreCase: z.boolean().default(false),
    customSelectors: z.array(z.string()).optional(),
    excludeSelectors: z.array(z.string()).optional().default([
      'script', 'style', 'noscript', '.advertisement', '.ad', '#comments'
    ]),
    significanceThresholds: z.object({
      minor: z.number().min(0).max(1).default(0.1),
      moderate: z.number().min(0).max(1).default(0.3),
      major: z.number().min(0).max(1).default(0.7)
    }).optional()
  }).optional().prefault({}).describe("Options for how changes are tracked and compared"),

  monitoringOptions: z.object({
    enabled: z.boolean().default(false),
    interval: z.number().min(60000).max(24 * 60 * 60 * 1000).default(300000),
    maxRetries: z.number().min(0).max(5).default(3),
    retryDelay: z.number().min(1000).max(60000).default(5000),
    notificationThreshold: z.enum(['minor', 'moderate', 'major', 'critical']).default('moderate'),
    enableWebhook: z.boolean().default(false),
    webhookUrl: z.string().url().optional(),
    webhookSecret: z.string().optional()
  }).optional().prefault({}).describe("Monitoring schedule and notification settings"),

  storageOptions: z.object({
    enableSnapshots: z.boolean().default(true),
    retainHistory: z.boolean().default(true),
    maxHistoryEntries: z.number().min(1).max(1000).default(100),
    compressionEnabled: z.boolean().default(true),
    deltaStorageEnabled: z.boolean().default(true)
  }).optional().prefault({}).describe("Storage and history retention settings"),

  queryOptions: z.object({
    limit: z.number().min(1).max(500).default(50),
    offset: z.number().min(0).default(0),
    startTime: z.number().optional(),
    endTime: z.number().optional(),
    includeContent: z.boolean().default(false),
    significanceFilter: z.enum(['all', 'minor', 'moderate', 'major', 'critical']).optional()
  }).optional().prefault({}).describe("Query options for history and stats retrieval"),

  notificationOptions: z.object({
    email: z.object({
      enabled: z.boolean().default(false),
      recipients: z.array(z.string().email()).optional(),
      subject: z.string().optional(),
      includeDetails: z.boolean().default(true)
    }).optional(),
    webhook: z.object({
      enabled: z.boolean().default(false),
      url: z.string().url().optional(),
      method: z.enum(['POST', 'PUT']).default('POST'),
      headers: z.record(z.string()).optional(),
      signingSecret: z.string().optional(),
      includeContent: z.boolean().default(false)
    }).optional(),
    slack: z.object({
      enabled: z.boolean().default(false),
      webhookUrl: z.string().url().optional(),
      channel: z.string().optional(),
      username: z.string().optional()
    }).optional()
  }).optional().describe("Notification configuration for webhooks, Slack and email (email is sent by hosted monitors only)"),

  scheduledMonitorOptions: z.object({
    schedule: z.string().optional().describe("Optional cron expression (power users)"),
    templateId: z.string().optional(),
    enabled: z.boolean().default(true),
    interval: z.number().min(60000).optional().describe("Polling interval in ms (default 1h)"),
    goal: z.string().optional().describe("Plain-English alert goal; an LLM judges whether a change matches (degrades to threshold if no LLM)"),
    monitorId: z.string().optional().describe("Monitor id for stop_scheduled_monitor"),
    notificationThreshold: z.enum(['minor', 'moderate', 'major', 'critical']).optional(),
    hosted: z.boolean().default(false).describe("Run the monitor on CrawlForge's servers: it fires from the hosted scheduler whether or not this process is alive and sends email and signed webhooks. Each check bills 3 credits per compared target from the account; blocked and errored targets are free. Default false = local, in-process."),
    name: z.string().min(1).max(80).optional().describe("Display name for a hosted monitor (default: the URL host)")
  }).optional().describe("Scheduled monitoring: recurring compare + notify, optional plain-English goal"),

  alertRuleOptions: z.object({
    ruleId: z.string().optional(),
    condition: z.string().optional(),
    actions: z.array(z.enum(['webhook', 'email', 'slack'])).optional(),
    throttle: z.number().min(0).optional(),
    priority: z.enum(['low', 'medium', 'high']).optional()
  }).optional().describe("Alert rule configuration for change notifications"),

  exportOptions: z.object({
    format: z.enum(['json', 'csv']).default('json'),
    startTime: z.number().optional(),
    endTime: z.number().optional(),
    includeContent: z.boolean().default(false),
    includeSnapshots: z.boolean().default(false)
  }).optional().describe("Export options for change history data"),

  dashboardOptions: z.object({
    includeRecentAlerts: z.boolean().default(true),
    includeTrends: z.boolean().default(true),
    includeMonitorStatus: z.boolean().default(true)
  }).optional().describe("Dashboard display options")
};

export const TrackChangesSchema = z.object({
  ...TRACK_CHANGES_INPUT_SHAPE,
  respect_robots: z.boolean().optional(),
  user_agent: z.string().optional()
});
