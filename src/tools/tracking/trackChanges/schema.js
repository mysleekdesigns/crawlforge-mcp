/**
 * TrackChanges — schema module.
 * Centralises the Zod input schema so monitor.js, differ.js, notifier.js
 * and the entry-point index.js can all import from one place.
 */

import { z } from 'zod';

export const TrackChangesSchema = z.object({
  url: z.string().url(),
  operation: z.enum([
    'create_baseline',
    'compare',
    'monitor',
    'get_history',
    'get_stats',
    'create_scheduled_monitor',
    'stop_scheduled_monitor',
    'get_dashboard',
    'export_history',
    'create_alert_rule',
    'generate_trend_report',
    'get_monitoring_templates'
  ]).default('compare'),

  content: z.string().optional(),
  html: z.string().optional(),

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
  }).optional().default({}),

  monitoringOptions: z.object({
    enabled: z.boolean().default(false),
    interval: z.number().min(60000).max(24 * 60 * 60 * 1000).default(300000),
    maxRetries: z.number().min(0).max(5).default(3),
    retryDelay: z.number().min(1000).max(60000).default(5000),
    notificationThreshold: z.enum(['minor', 'moderate', 'major', 'critical']).default('moderate'),
    enableWebhook: z.boolean().default(false),
    webhookUrl: z.string().url().optional(),
    webhookSecret: z.string().optional()
  }).optional(),

  storageOptions: z.object({
    enableSnapshots: z.boolean().default(true),
    retainHistory: z.boolean().default(true),
    maxHistoryEntries: z.number().min(1).max(1000).default(100),
    compressionEnabled: z.boolean().default(true),
    deltaStorageEnabled: z.boolean().default(true)
  }).optional().default({}),

  queryOptions: z.object({
    limit: z.number().min(1).max(500).default(50),
    offset: z.number().min(0).default(0),
    startTime: z.number().optional(),
    endTime: z.number().optional(),
    includeContent: z.boolean().default(false),
    significanceFilter: z.enum(['all', 'minor', 'moderate', 'major', 'critical']).optional()
  }).optional(),

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
  }).optional(),

  scheduledMonitorOptions: z.object({
    schedule: z.string().optional(),
    templateId: z.string().optional(),
    enabled: z.boolean().default(true)
  }).optional(),

  alertRuleOptions: z.object({
    ruleId: z.string().optional(),
    condition: z.string().optional(),
    actions: z.array(z.enum(['webhook', 'email', 'slack'])).optional(),
    throttle: z.number().min(0).optional(),
    priority: z.enum(['low', 'medium', 'high']).optional()
  }).optional(),

  exportOptions: z.object({
    format: z.enum(['json', 'csv']).default('json'),
    startTime: z.number().optional(),
    endTime: z.number().optional(),
    includeContent: z.boolean().default(false),
    includeSnapshots: z.boolean().default(false)
  }).optional(),

  dashboardOptions: z.object({
    includeRecentAlerts: z.boolean().default(true),
    includeTrends: z.boolean().default(true),
    includeMonitorStatus: z.boolean().default(true)
  }).optional()
});
