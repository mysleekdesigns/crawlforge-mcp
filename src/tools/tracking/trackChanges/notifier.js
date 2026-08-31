/**
 * TrackChanges — notifier module.
 * Handles webhook, email and Slack change notifications.
 * Used by monitor.js and the main TrackChangesTool class.
 */

import { identityHeaders } from '../../../utils/fetchIdentity.js';
// Webhook and Slack targets are caller-supplied URLs, so they go out through the
// same guard as every other outbound request. WebhookDispatcher already did this;
// these two senders were the only ones left calling bare fetch.
import { safeFetch } from '../../../utils/ssrfGuard.js';

/**
 * How long to wait on a notification endpoint before giving up.
 *
 * fetch/undici has no `timeout` RequestInit option, so without an explicit
 * signal a webhook target that accepts the connection and then never answers
 * holds the request open forever. These sends are awaited together in
 * `sendNotifications`, so one unresponsive endpoint stalls every notification
 * for that change, not just its own. `WebhookDispatcher` hit exactly this and
 * documents it; 30s matches the default it settled on.
 */
const NOTIFY_TIMEOUT_MS = Number(process.env.TRACK_CHANGES_NOTIFY_TIMEOUT_MS) || 30000;

/**
 * Send all enabled notifications for a detected change.
 * @param {string} url
 * @param {Object} changeResult
 * @param {Object} notificationOptions
 * @param {EventEmitter} emitter — tool instance for event emission
 */
export async function sendNotifications(url, changeResult, notificationOptions, emitter) {
  const notifications = [];

  if (notificationOptions.webhook?.enabled) {
    notifications.push(sendWebhookNotification(url, changeResult, notificationOptions.webhook, emitter));
  }
  if (notificationOptions.email?.enabled) {
    notifications.push(sendEmailNotification(url, changeResult, notificationOptions.email, emitter));
  }
  if (notificationOptions.slack?.enabled) {
    notifications.push(sendSlackNotification(url, changeResult, notificationOptions.slack, emitter));
  }

  await Promise.allSettled(notifications);
}

export async function sendWebhookNotification(url, changeResult, webhookConfig, emitter) {
  try {
    const payload = {
      event: 'change_detected',
      url,
      timestamp: Date.now(),
      significance: changeResult.significance,
      changeType: changeResult.changeType,
      summary: changeResult.summary,
      details: webhookConfig.includeContent ? changeResult.details : undefined
    };

    const response = await safeFetch(webhookConfig.url, {
      method: webhookConfig.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...identityHeaders({ role: 'webhook' }),
        ...webhookConfig.headers
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
    }

    emitter?.emit('notificationSent', { type: 'webhook', url, success: true });
  } catch (error) {
    emitter?.emit('notificationError', { type: 'webhook', url, error: error.message });
  }
}

export async function sendEmailNotification(url, changeResult, emailConfig, emitter) {
  // Email integration placeholder — requires external service
  emitter?.emit('notificationSent', {
    type: 'email',
    url,
    success: true,
    note: 'Email notifications require external service integration'
  });
}

export async function sendSlackNotification(url, changeResult, slackConfig, emitter) {
  try {
    const colors = { none: '#36a64f', minor: '#ffeb3b', moderate: '#ff9800', major: '#f44336', critical: '#9c27b0' };
    const payload = {
      text: '🔄 Content Change Detected',
      attachments: [{
        color: colors[changeResult.significance] || '#36a64f',
        fields: [
          { title: 'URL', value: url, short: false },
          { title: 'Significance', value: changeResult.significance.toUpperCase(), short: true },
          { title: 'Change Type', value: changeResult.changeType.replace('_', ' '), short: true },
          { title: 'Summary', value: changeResult.summary.changeDescription, short: false }
        ],
        timestamp: Math.floor(Date.now() / 1000)
      }],
      channel: slackConfig.channel,
      username: slackConfig.username || 'Change Tracker'
    };

    const response = await safeFetch(slackConfig.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error(`Slack notification failed: ${response.status}`);
    }

    emitter?.emit('notificationSent', { type: 'slack', url, success: true });
  } catch (error) {
    emitter?.emit('notificationError', { type: 'slack', url, error: error.message });
  }
}
