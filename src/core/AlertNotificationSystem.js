/**
 * AlertNotificationSystem - Enhanced notification system for change tracking
 * Supports email, webhook, and Slack notifications with throttling and aggregation
 */

import { EventEmitter } from 'events';
import fetch from 'node-fetch';
import crypto from 'crypto';

export class AlertNotificationSystem extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      throttlingEnabled: true,
      aggregationEnabled: true,
      retryAttempts: 3,
      retryDelay: 5000,
      signatureSecret: process.env.WEBHOOK_SECRET || 'default-secret',
      ...options
    };
    
    // Notification queues and throttling
    this.notificationQueue = [];
    this.throttleCache = new Map();
    this.alertAggregation = new Map();
    this.retryQueue = new Map();
    
    // Statistics
    this.stats = {
      totalNotifications: 0,
      successfulNotifications: 0,
      failedNotifications: 0,
      throttledNotifications: 0,
      aggregatedNotifications: 0,
      webhooksSent: 0,
      emailsSent: 0,
      slackMessagesSent: 0
    };
    
    // Start processing queue
    this.startQueueProcessor();
  }
  
  /**
   * Send notification with throttling and aggregation
   * @param {Object} notification - Notification configuration
   */
  async sendNotification(notification) {
    try {
      const {
        type, // webhook, email, slack
        target, // URL, email address, etc.
        data,
        throttle = 0,
        aggregateKey = null,
        priority = 'medium'
      } = notification;
      
      // Check throttling
      if (this.options.throttlingEnabled && throttle > 0) {
        const throttleKey = `${type}_${target}_${aggregateKey || 'default'}`;
        const lastSent = this.throttleCache.get(throttleKey);
        
        if (lastSent && Date.now() - lastSent < throttle) {
          this.stats.throttledNotifications++;
          this.emit('notificationThrottled', { notification, throttleKey });
          return { success: false, reason: 'throttled' };
        }
      }
      
      // Check aggregation
      if (this.options.aggregationEnabled && aggregateKey) {
        const result = this.handleAggregation(notification, aggregateKey);
        if (result.aggregated) {
          this.stats.aggregatedNotifications++;
          this.emit('notificationAggregated', { notification, aggregateKey });
          return { success: true, reason: 'aggregated' };
        }
      }
      
      // Add to queue
      this.notificationQueue.push({
        ...notification,
        id: `notification_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        attempts: 0
      });
      
      this.stats.totalNotifications++;
      this.emit('notificationQueued', notification);
      
      return { success: true, reason: 'queued' };
      
    } catch (error) {
      this.emit('error', { operation: 'sendNotification', error: error.message });
      return { success: false, reason: 'error', error: error.message };
    }
  }
  
  /**
   * Send webhook notification
   * @param {Object} config - Webhook configuration
   * @param {Object} data - Notification data
   */
  async sendWebhookNotification(config, data) {
    try {
      const {
        url,
        method = 'POST',
        headers = {},
        signingSecret,
        includeContent = false
      } = config;
      
      // Prepare payload
      const payload = {
        event: 'change_alert',
        timestamp: Date.now(),
        data: includeContent ? data : this.sanitizeData(data)
      };
      
      const body = JSON.stringify(payload);
      
      // Generate signature if secret provided
      const requestHeaders = {
        'Content-Type': 'application/json',
        'User-Agent': 'MCP-WebScraper-AlertSystem/3.0',
        ...headers
      };
      
      if (signingSecret) {
        const signature = this.generateSignature(body, signingSecret);
        requestHeaders['X-Signature'] = signature;
      }
      
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body,
        timeout: 30000
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      this.stats.webhooksSent++;
      this.stats.successfulNotifications++;
      
      this.emit('webhookSent', {
        url,
        status: response.status,
        data: payload
      });
      
      return { success: true, status: response.status };
      
    } catch (error) {
      this.stats.failedNotifications++;
      this.emit('webhookError', {
        url: config.url,
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Send email notification (placeholder for integration)
   * @param {Object} config - Email configuration
   * @param {Object} data - Notification data
   */
  async sendEmailNotification(config, data) {
    try {
      const {
        recipients,
        subject = 'Content Change Alert',
        includeDetails = true
      } = config;
      
      // Email integration would go here
      // For now, just emit event for external handling
      const emailData = {
        to: recipients,
        subject,
        body: this.generateEmailBody(data, includeDetails),
        timestamp: Date.now()
      };
      
      this.emit('emailRequested', emailData);
      
      this.stats.emailsSent++;
      this.stats.successfulNotifications++;
      
      return { success: true, message: 'Email queued for external handling' };
      
    } catch (error) {
      this.stats.failedNotifications++;
      this.emit('emailError', {
        recipients: config.recipients,
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Send Slack notification
   * @param {Object} config - Slack configuration
   * @param {Object} data - Notification data
   */
  async sendSlackNotification(config, data) {
    try {
      const {
        webhookUrl,
        channel,
        username = 'Change Tracker',
        iconEmoji = ':warning:'
      } = config;
      
      const payload = {
        channel,
        username,
        icon_emoji: iconEmoji,
        text: this.generateSlackMessage(data),
        attachments: this.generateSlackAttachments(data)
      };
      
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        timeout: 30000
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Slack API error: ${response.status} - ${errorText}`);
      }
      
      this.stats.slackMessagesSent++;
      this.stats.successfulNotifications++;
      
      this.emit('slackSent', {
        channel,
        message: payload.text
      });
      
      return { success: true };
      
    } catch (error) {
      this.stats.failedNotifications++;
      this.emit('slackError', {
        channel: config.channel,
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Process notification queue
   */
  startQueueProcessor() {
    setInterval(async () => {
      if (this.notificationQueue.length === 0) return;
      
      const notification = this.notificationQueue.shift();
      
      try {
        await this.processNotification(notification);
      } catch (error) {
        await this.handleNotificationFailure(notification, error);
      }
      
    }, 1000); // Process every second
  }
  
  /**
   * Process individual notification
   * @param {Object} notification - Notification to process
   */
  async processNotification(notification) {
    const { type, config, data } = notification;
    
    switch (type) {
      case 'webhook':
        await this.sendWebhookNotification(config, data);
        break;
      case 'email':
        await this.sendEmailNotification(config, data);
        break;
      case 'slack':
        await this.sendSlackNotification(config, data);
        break;
      default:
        throw new Error(`Unknown notification type: ${type}`);
    }
    
    // Update throttle cache
    if (notification.throttle && notification.throttle > 0) {
      const throttleKey = `${type}_${config.url || config.recipients?.[0] || config.channel}_${notification.aggregateKey || 'default'}`;
      this.throttleCache.set(throttleKey, Date.now());
    }
    
    this.emit('notificationProcessed', notification);
  }
  
  /**
   * Handle notification failure with retry logic
   * @param {Object} notification - Failed notification
   * @param {Error} error - Error that occurred
   */
  async handleNotificationFailure(notification, error) {
    notification.attempts = (notification.attempts || 0) + 1;
    
    if (notification.attempts < this.options.retryAttempts) {
      // Add to retry queue with delay
      setTimeout(() => {
        this.notificationQueue.push(notification);
      }, this.options.retryDelay * notification.attempts);
      
      this.emit('notificationRetry', {
        notification,
        attempt: notification.attempts,
        error: error.message
      });
    } else {
      // Max retries exceeded
      this.stats.failedNotifications++;
      
      this.emit('notificationFailed', {
        notification,
        error: error.message,
        finalAttempt: true
      });
    }
  }
  
  /**
   * Handle notification aggregation
   * @param {Object} notification - Notification to aggregate
   * @param {string} aggregateKey - Aggregation key
   * @returns {Object} - Aggregation result
   */
  handleAggregation(notification, aggregateKey) {
    const now = Date.now();
    const aggregationWindow = 300000; // 5 minutes
    
    if (!this.alertAggregation.has(aggregateKey)) {
      this.alertAggregation.set(aggregateKey, {
        notifications: [],
        firstSeen: now,
        lastSeen: now
      });
    }
    
    const aggregate = this.alertAggregation.get(aggregateKey);
    aggregate.notifications.push(notification);
    aggregate.lastSeen = now;
    
    // Check if aggregation window expired
    if (now - aggregate.firstSeen > aggregationWindow) {
      // Send aggregated notification
      this.sendAggregatedNotification(aggregateKey, aggregate);
      this.alertAggregation.delete(aggregateKey);
      return { aggregated: false };
    }
    
    return { aggregated: true };
  }
  
  /**
   * Send aggregated notification
   * @param {string} aggregateKey - Aggregation key
   * @param {Object} aggregate - Aggregated data
   */
  async sendAggregatedNotification(aggregateKey, aggregate) {
    const { notifications } = aggregate;
    const firstNotification = notifications[0];
    
    // Create aggregated data
    const aggregatedData = {
      ...firstNotification.data,
      aggregatedCount: notifications.length,
      timeSpan: {
        start: aggregate.firstSeen,
        end: aggregate.lastSeen
      },
      summary: this.generateAggregatedSummary(notifications)
    };
    
    // Send using first notification's configuration
    const aggregatedNotification = {
      ...firstNotification,
      data: aggregatedData,
      aggregated: true
    };
    
    await this.processNotification(aggregatedNotification);
  }
  
  /**
   * Generate aggregated summary
   * @param {Array} notifications - Notifications to summarize
   * @returns {Object} - Summary data
   */
  generateAggregatedSummary(notifications) {
    const urls = new Set();
    const significanceLevels = {};
    const changeTypes = {};
    
    notifications.forEach(notification => {
      const { url, significance, changeType } = notification.data;
      urls.add(url);
      significanceLevels[significance] = (significanceLevels[significance] || 0) + 1;
      changeTypes[changeType] = (changeTypes[changeType] || 0) + 1;
    });
    
    return {
      uniqueUrls: urls.size,
      urls: Array.from(urls),
      significanceDistribution: significanceLevels,
      changeTypeDistribution: changeTypes,
      totalChanges: notifications.length
    };
  }
  
  /**
   * Generate signature for webhook security
   * @param {string} body - Request body
   * @param {string} secret - Signing secret
   * @returns {string} - Signature
   */
  generateSignature(body, secret) {
    return crypto
      .createHmac('sha256', secret)
      .update(body, 'utf8')
      .digest('hex');
  }
  
  /**
   * Sanitize data for external transmission
   * @param {Object} data - Data to sanitize
   * @returns {Object} - Sanitized data
   */
  sanitizeData(data) {
    return {
      url: data.url,
      significance: data.significance,
      changeType: data.changeType,
      timestamp: data.timestamp,
      summary: data.summary
    };
  }
  
  /**
   * Generate email body
   * @param {Object} data - Notification data
   * @param {boolean} includeDetails - Include detailed information
   * @returns {string} - Email body
   */
  generateEmailBody(data, includeDetails) {
    let body = `Content Change Alert\n\n`;
    body += `URL: ${data.url}\n`;
    body += `Significance: ${data.significance.toUpperCase()}\n`;
    body += `Change Type: ${data.changeType.replace('_', ' ')}\n`;
    body += `Time: ${new Date(data.timestamp).toISOString()}\n\n`;
    
    if (data.summary) {
      body += `Summary:\n${data.summary.changeDescription}\n\n`;
    }
    
    if (includeDetails && data.details) {
      body += `Details:\n`;
      body += `- Similarity: ${Math.round(data.details.similarity * 100)}%\n`;
      body += `- Changes: ${data.details.addedElements?.length || 0} added, `;
      body += `${data.details.removedElements?.length || 0} removed, `;
      body += `${data.details.modifiedElements?.length || 0} modified\n`;
    }
    
    body += `\nGenerated by MCP WebScraper Change Tracker`;
    
    return body;
  }
  
  /**
   * Generate Slack message
   * @param {Object} data - Notification data
   * @returns {string} - Slack message
   */
  generateSlackMessage(data) {
    const emoji = this.getSignificanceEmoji(data.significance);
    return `${emoji} Content change detected on ${data.url}`;
  }
  
  /**
   * Generate Slack attachments
   * @param {Object} data - Notification data
   * @returns {Array} - Slack attachments
   */
  generateSlackAttachments(data) {
    return [{
      color: this.getSignificanceColor(data.significance),
      fields: [
        {
          title: 'URL',
          value: data.url,
          short: false
        },
        {
          title: 'Significance',
          value: data.significance.toUpperCase(),
          short: true
        },
        {
          title: 'Change Type',
          value: data.changeType.replace('_', ' '),
          short: true
        },
        {
          title: 'Summary',
          value: data.summary?.changeDescription || 'Change detected',
          short: false
        }
      ],
      footer: 'MCP WebScraper Change Tracker',
      ts: Math.floor(data.timestamp / 1000)
    }];
  }
  
  /**
   * Get emoji for significance level
   * @param {string} significance - Significance level
   * @returns {string} - Emoji
   */
  getSignificanceEmoji(significance) {
    const emojis = {
      'none': ':white_circle:',
      'minor': ':yellow_circle:',
      'moderate': ':orange_circle:',
      'major': ':red_circle:',
      'critical': ':rotating_light:'
    };
    return emojis[significance] || ':grey_question:';
  }
  
  /**
   * Get color for significance level
   * @param {string} significance - Significance level
   * @returns {string} - Color code
   */
  getSignificanceColor(significance) {
    const colors = {
      'none': '#36a64f',
      'minor': '#ffeb3b',
      'moderate': '#ff9800',
      'major': '#f44336',
      'critical': '#9c27b0'
    };
    return colors[significance] || '#9e9e9e';
  }
  
  /**
   * Get notification statistics
   * @returns {Object} - Statistics
   */
  getStats() {
    return {
      ...this.stats,
      queueLength: this.notificationQueue.length,
      throttleCacheSize: this.throttleCache.size,
      aggregationCacheSize: this.alertAggregation.size,
      successRate: this.stats.totalNotifications > 0 ? 
        (this.stats.successfulNotifications / this.stats.totalNotifications) * 100 : 0
    };
  }
  
  /**
   * Clear all caches and queues
   */
  clear() {
    this.notificationQueue.length = 0;
    this.throttleCache.clear();
    this.alertAggregation.clear();
    this.retryQueue.clear();
  }
  
  /**
   * Cleanup resources
   */
  cleanup() {
    this.clear();
    this.removeAllListeners();
  }
}

export default AlertNotificationSystem;