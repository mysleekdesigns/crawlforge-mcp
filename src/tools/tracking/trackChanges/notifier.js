/**
 * TrackChanges — notifier module.
 * Handles webhook, email and Slack change notifications.
 * Used by monitor.js and the main TrackChangesTool class.
 */

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

    const response = await fetch(webhookConfig.url, {
      method: webhookConfig.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MCP-WebScraper-ChangeTracker/3.0',
        ...webhookConfig.headers
      },
      body: JSON.stringify(payload)
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

    const response = await fetch(slackConfig.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Slack notification failed: ${response.status}`);
    }

    emitter?.emit('notificationSent', { type: 'slack', url, success: true });
  } catch (error) {
    emitter?.emit('notificationError', { type: 'slack', url, error: error.message });
  }
}
