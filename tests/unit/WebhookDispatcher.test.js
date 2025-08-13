/**
 * Unit tests for WebhookDispatcher
 */

import { describe, it, beforeEach, afterEach, expect } from '@jest/globals';
import { jest } from '@jest/globals';
import WebhookDispatcher from '../../src/core/WebhookDispatcher.js';
import { promises as fs } from 'fs';
import crypto from 'crypto';

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn()
  }
}));

jest.mock('../../src/utils/RetryManager.js', () => {
  return {
    default: jest.fn().mockImplementation(() => ({
      execute: jest.fn().mockImplementation(async (fn) => await fn()),
      getStats: jest.fn().mockReturnValue({
        totalAttempts: 0,
        totalRetries: 0,
        successfulRetries: 0,
        failedOperations: 0,
        averageRetryDelay: 0
      })
    }))
  };
});

// Mock fetch
global.fetch = jest.fn();

describe('WebhookDispatcher', () => {
  let dispatcher;
  const testQueueDir = './test-webhooks';

  beforeEach(() => {
    jest.clearAllMocks();
    fs.mkdir.mockResolvedValue();
    fs.readFile.mockRejectedValue({ code: 'ENOENT' }); // Simulate no existing queue file
    fs.writeFile.mockResolvedValue();

    dispatcher = new WebhookDispatcher({
      queueDir: testQueueDir,
      enablePersistence: false,
      enableHealthMonitoring: false,
      maxRetries: 2,
      retryDelay: 100,
      timeout: 5000
    });
  });

  afterEach(async () => {
    if (dispatcher) {
      dispatcher.destroy();
    }
  });

  describe('Webhook Registration', () => {
    it('should register webhook with default configuration', () => {
      const config = dispatcher.registerWebhook('http://example.com/webhook');

      expect(config).toMatchObject({
        url: 'http://example.com/webhook',
        enabled: true,
        events: ['*'],
        timeout: 5000,
        maxRetries: 2,
        retryDelay: 100
      });
      expect(config.createdAt).toBeDefined();
    });

    it('should register webhook with custom configuration', () => {
      const customConfig = {
        enabled: true,
        events: ['user.created', 'user.updated'],
        headers: { 'Authorization': 'Bearer token123' },
        timeout: 10000,
        maxRetries: 5,
        retryDelay: 2000,
        signingSecret: 'secret123',
        metadata: { team: 'backend' }
      };

      const config = dispatcher.registerWebhook('http://custom.com/webhook', customConfig);

      expect(config).toMatchObject({
        url: 'http://custom.com/webhook',
        ...customConfig
      });
    });

    it('should unregister webhook', () => {
      dispatcher.registerWebhook('http://example.com/webhook');
      expect(dispatcher.unregisterWebhook('http://example.com/webhook')).toBe(true);
      expect(dispatcher.unregisterWebhook('http://nonexistent.com/webhook')).toBe(false);
    });

    it('should emit events for webhook registration/unregistration', () => {
      const registeredCallback = jest.fn();
      const unregisteredCallback = jest.fn();
      
      dispatcher.on('webhookRegistered', registeredCallback);
      dispatcher.on('webhookUnregistered', unregisteredCallback);

      const config = dispatcher.registerWebhook('http://test.com/webhook');
      expect(registeredCallback).toHaveBeenCalledWith('http://test.com/webhook', config);

      dispatcher.unregisterWebhook('http://test.com/webhook');
      expect(unregisteredCallback).toHaveBeenCalledWith('http://test.com/webhook');
    });
  });

  describe('Event Dispatching', () => {
    beforeEach(() => {
      fetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK'
      });
    });

    it('should dispatch event to all registered webhooks', async () => {
      dispatcher.registerWebhook('http://webhook1.com/endpoint');
      dispatcher.registerWebhook('http://webhook2.com/endpoint');

      const results = await dispatcher.dispatch('user.created', { userId: 123 }, { immediate: true });

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ success: true, url: 'http://webhook1.com/endpoint' });
      expect(results[1]).toMatchObject({ success: true, url: 'http://webhook2.com/endpoint' });
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should filter webhooks by event type', async () => {
      dispatcher.registerWebhook('http://all-events.com/webhook', { events: ['*'] });
      dispatcher.registerWebhook('http://user-events.com/webhook', { events: ['user.created', 'user.updated'] });
      dispatcher.registerWebhook('http://order-events.com/webhook', { events: ['order.created'] });

      const results = await dispatcher.dispatch('user.created', { userId: 123 }, { immediate: true });

      expect(results).toHaveLength(2);
      expect(results.some(r => r.url === 'http://all-events.com/webhook')).toBe(true);
      expect(results.some(r => r.url === 'http://user-events.com/webhook')).toBe(true);
      expect(results.some(r => r.url === 'http://order-events.com/webhook')).toBe(false);
    });

    it('should dispatch to specific URLs when provided', async () => {
      dispatcher.registerWebhook('http://webhook1.com/endpoint');
      dispatcher.registerWebhook('http://webhook2.com/endpoint');
      dispatcher.registerWebhook('http://webhook3.com/endpoint');

      const targetUrls = ['http://webhook1.com/endpoint', 'http://webhook3.com/endpoint'];
      const results = await dispatcher.dispatch('test.event', { data: 'test' }, { 
        immediate: true,
        urls: targetUrls 
      });

      expect(results).toHaveLength(2);
      expect(results.every(r => targetUrls.includes(r.url))).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should queue events when immediate is false', async () => {
      dispatcher.registerWebhook('http://webhook.com/endpoint');

      const eventsQueuedCallback = jest.fn();
      dispatcher.on('eventsQueued', eventsQueuedCallback);

      const results = await dispatcher.dispatch('test.event', { data: 'test' }, { immediate: false });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ 
        queued: true, 
        url: 'http://webhook.com/endpoint' 
      });
      expect(eventsQueuedCallback).toHaveBeenCalledWith(1, 'test.event');
      expect(fetch).not.toHaveBeenCalled(); // Should not execute immediately
    });

    it('should handle dispatch with no target webhooks', async () => {
      dispatcher.registerWebhook('http://webhook.com/endpoint', { events: ['other.event'] });

      const noTargetsCallback = jest.fn();
      dispatcher.on('noTargets', noTargetsCallback);

      const results = await dispatcher.dispatch('unmatched.event', { data: 'test' });

      expect(results).toHaveLength(0);
      expect(noTargetsCallback).toHaveBeenCalled();
    });
  });

  describe('Webhook Delivery', () => {
    beforeEach(() => {
      dispatcher.registerWebhook('http://test.com/webhook', {
        signingSecret: 'test-secret',
        headers: { 'X-Custom': 'header-value' }
      });
    });

    it('should send properly formatted webhook request', async () => {
      fetch.mockResolvedValue({ ok: true, status: 200 });

      const event = {
        id: 'event-123',
        type: 'test.event',
        payload: { message: 'test' },
        timestamp: Date.now(),
        metadata: { source: 'test' },
        url: 'http://test.com/webhook'
      };

      await dispatcher.deliverWebhook(event);

      expect(fetch).toHaveBeenCalledWith(
        'http://test.com/webhook',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'User-Agent': 'WebhookDispatcher/1.0',
            'X-Webhook-Event': 'test.event',
            'X-Webhook-ID': 'event-123',
            'X-Webhook-Timestamp': event.timestamp.toString(),
            'X-Webhook-Signature': expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
            'X-Custom': 'header-value'
          }),
          body: expect.stringContaining('"event":"test.event"'),
          timeout: 5000
        })
      );
    });

    it('should generate correct HMAC signature', () => {
      const payload = { message: 'test' };
      const secret = 'test-secret';
      
      const signature = dispatcher.generateSignature(payload, secret);
      
      // Verify signature manually
      const body = JSON.stringify(payload);
      const expectedHmac = crypto.createHmac('sha256', secret);
      expectedHmac.update(body);
      const expectedSignature = 'sha256=' + expectedHmac.digest('hex');
      
      expect(signature).toBe(expectedSignature);
    });

    it('should handle delivery success', async () => {
      fetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK'
      });

      const event = {
        id: 'success-event',
        type: 'test.event',
        payload: { data: 'test' },
        timestamp: Date.now(),
        metadata: {},
        url: 'http://test.com/webhook'
      };

      const result = await dispatcher.deliverWebhook(event);

      expect(result).toMatchObject({
        success: true,
        url: 'http://test.com/webhook',
        status: 200
      });
    });

    it('should handle delivery failure', async () => {
      fetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      const event = {
        id: 'failure-event',
        type: 'test.event',
        payload: { data: 'test' },
        timestamp: Date.now(),
        metadata: {},
        url: 'http://test.com/webhook'
      };

      await expect(dispatcher.deliverWebhook(event)).rejects.toThrow(
        'HTTP 500: Internal Server Error'
      );
    });

    it('should update webhook last used time on successful delivery', async () => {
      fetch.mockResolvedValue({ ok: true, status: 200 });

      const webhookConfig = dispatcher.registerWebhook('http://timestamp.com/webhook');
      expect(webhookConfig.lastUsed).toBeNull();

      const event = {
        id: 'timestamp-event',
        type: 'test.event',
        payload: { data: 'test' },
        timestamp: Date.now(),
        metadata: {},
        url: 'http://timestamp.com/webhook'
      };

      await dispatcher.deliverWebhook(event);

      // Get updated config (this would need to be accessible via a getter in real implementation)
      const stats = dispatcher.getStats();
      expect(stats.successfulDeliveries).toBe(1);
    });
  });

  describe('Health Monitoring', () => {
    beforeEach(() => {
      // Enable health monitoring for these tests
      dispatcher.enableHealthMonitoring = true;
    });

    it('should perform health check on URL', async () => {
      dispatcher.registerWebhook('http://healthy.com/webhook');
      
      fetch.mockResolvedValue({
        ok: true,
        status: 200
      });

      await dispatcher.healthCheckUrl('http://healthy.com/webhook');

      expect(fetch).toHaveBeenCalledWith(
        'http://healthy.com/webhook',
        expect.objectContaining({
          method: 'HEAD',
          timeout: 2500, // Half of default timeout
          headers: expect.objectContaining({
            'User-Agent': 'WebhookDispatcher-HealthCheck/1.0'
          })
        })
      );
    });

    it('should record successful health check', async () => {
      dispatcher.registerWebhook('http://healthy.com/webhook');
      
      fetch.mockResolvedValue({
        ok: true,
        status: 200
      });

      await dispatcher.healthCheckUrl('http://healthy.com/webhook');

      const health = dispatcher.getHealthSummary();
      expect(health.healthyUrls).toBe(1);
      expect(health.details['http://healthy.com/webhook'].status).toBe('healthy');
    });

    it('should record failed health check', async () => {
      dispatcher.registerWebhook('http://unhealthy.com/webhook');
      
      fetch.mockRejectedValue(new Error('Connection failed'));

      await dispatcher.healthCheckUrl('http://unhealthy.com/webhook');

      const health = dispatcher.getHealthSummary();
      expect(health.unhealthyUrls).toBe(1);
      expect(health.details['http://unhealthy.com/webhook'].status).toBe('unhealthy');
      expect(health.details['http://unhealthy.com/webhook'].lastError).toBe('Connection failed');
    });

    it('should accept 405 Method Not Allowed as healthy for HEAD requests', async () => {
      dispatcher.registerWebhook('http://no-head.com/webhook');
      
      fetch.mockResolvedValue({
        ok: false,
        status: 405,
        statusText: 'Method Not Allowed'
      });

      await dispatcher.healthCheckUrl('http://no-head.com/webhook');

      const health = dispatcher.getHealthSummary();
      expect(health.healthyUrls).toBe(1);
    });
  });

  describe('Queue Management', () => {
    it('should add events to queue with priority sorting', async () => {
      const events = [
        { priority: 1, id: 'low' },
        { priority: 5, id: 'high' },
        { priority: 3, id: 'medium' }
      ];

      await dispatcher.enqueueEvents(events);

      // Queue should be sorted by priority (high to low)
      expect(dispatcher.queue[0].priority).toBe(5);
      expect(dispatcher.queue[1].priority).toBe(3);
      expect(dispatcher.queue[2].priority).toBe(1);
    });

    it('should handle queue overflow', async () => {
      // Set a low queue size limit
      dispatcher.maxQueueSize = 2;
      
      const overflowCallback = jest.fn();
      dispatcher.on('queueOverflow', overflowCallback);

      const events = [
        { id: 'event1', priority: 0 },
        { id: 'event2', priority: 0 },
        { id: 'event3', priority: 0 }, // This should cause overflow
      ];

      await dispatcher.enqueueEvents(events);

      expect(overflowCallback).toHaveBeenCalledWith(1); // 1 event removed
      expect(dispatcher.queue).toHaveLength(2);
    });

    it('should process queue events', async () => {
      dispatcher.registerWebhook('http://queue-test.com/webhook');
      
      fetch.mockResolvedValue({
        ok: true,
        status: 200
      });

      const deliveredCallback = jest.fn();
      dispatcher.on('webhookDelivered', deliveredCallback);

      // Add event to queue
      await dispatcher.dispatch('queue.test', { data: 'test' }, { immediate: false });

      // Process queue manually
      await dispatcher.processQueue();

      expect(deliveredCallback).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalled();
    });

    it('should handle processing errors gracefully', async () => {
      dispatcher.registerWebhook('http://error-test.com/webhook');
      
      fetch.mockRejectedValue(new Error('Network error'));

      const processingErrorCallback = jest.fn();
      dispatcher.on('processingError', processingErrorCallback);

      // Add event to queue
      await dispatcher.dispatch('error.test', { data: 'test' }, { immediate: false });

      // Process queue manually - this should handle errors
      await dispatcher.processQueue();

      // The processing should complete without throwing
      expect(dispatcher.processing).toBe(false);
    });
  });

  describe('Error Recovery and Retries', () => {
    beforeEach(() => {
      dispatcher.registerWebhook('http://retry-test.com/webhook');
    });

    it('should retry failed webhook deliveries', async () => {
      let attempts = 0;
      fetch.mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Server Error'
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200
        });
      });

      // Add event to queue
      await dispatcher.dispatch('retry.test', { data: 'test' }, { immediate: false });

      // Process queue - first attempt should fail and schedule retry
      await dispatcher.processQueue();
      expect(attempts).toBe(1);

      // Simulate retry processing
      await new Promise(resolve => setTimeout(resolve, 150)); // Wait for retry delay
      await dispatcher.processQueue();
      await dispatcher.processQueue(); // Final successful attempt

      expect(attempts).toBe(3);
    });

    it('should give up after max retries', async () => {
      fetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Server Error'
      });

      const failedCallback = jest.fn();
      dispatcher.on('webhookFailed', failedCallback);

      // Add event to queue
      await dispatcher.dispatch('fail.test', { data: 'test' }, { immediate: false });

      // Process multiple times to exhaust retries
      for (let i = 0; i <= dispatcher.maxRetries; i++) {
        await dispatcher.processQueue();
        if (i < dispatcher.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      expect(failedCallback).toHaveBeenCalled();
      expect(dispatcher.getStats().failedDeliveries).toBe(1);
    });
  });

  describe('Statistics and Reporting', () => {
    it('should track comprehensive statistics', async () => {
      dispatcher.registerWebhook('http://stats.com/webhook');
      
      fetch.mockResolvedValue({
        ok: true,
        status: 200
      });

      // Dispatch some events
      await dispatcher.dispatch('stats.test1', { data: 'test1' }, { immediate: true });
      await dispatcher.dispatch('stats.test2', { data: 'test2' }, { immediate: true });

      const stats = dispatcher.getStats();

      expect(stats).toMatchObject({
        totalEvents: 2,
        successfulDeliveries: 2,
        failedDeliveries: 0,
        registeredUrls: 1,
        processing: false
      });
      expect(stats.averageResponseTime).toBeGreaterThanOrEqual(0);
    });

    it('should provide health summary', () => {
      dispatcher.registerWebhook('http://healthy.com/webhook');
      dispatcher.registerWebhook('http://unhealthy.com/webhook');
      
      // Simulate health states
      dispatcher.recordSuccess('http://healthy.com/webhook', 100);
      dispatcher.recordFailure('http://unhealthy.com/webhook', new Error('Failed'));

      const summary = dispatcher.getHealthSummary();

      expect(summary).toMatchObject({
        totalUrls: 2,
        healthyUrls: 1,
        unhealthyUrls: 1,
        unknownUrls: 0
      });
      expect(summary.details['http://healthy.com/webhook'].status).toBe('healthy');
      expect(summary.details['http://unhealthy.com/webhook'].status).toBe('unhealthy');
    });

    it('should track failed URLs', () => {
      const error = new Error('Delivery failed');
      
      dispatcher.recordFailure('http://failed.com/webhook', error);
      dispatcher.recordFailure('http://failed.com/webhook', error);

      const failedUrls = dispatcher.getFailedUrls();

      expect(failedUrls['http://failed.com/webhook']).toMatchObject({
        failureCount: 2,
        lastError: 'Delivery failed'
      });
    });

    it('should clear failed URLs tracking', () => {
      dispatcher.recordFailure('http://failed1.com/webhook', new Error('Error 1'));
      dispatcher.recordFailure('http://failed2.com/webhook', new Error('Error 2'));

      expect(Object.keys(dispatcher.getFailedUrls())).toHaveLength(2);

      // Clear specific URL
      dispatcher.clearFailedUrls('http://failed1.com/webhook');
      expect(Object.keys(dispatcher.getFailedUrls())).toHaveLength(1);

      // Clear all URLs
      dispatcher.clearFailedUrls();
      expect(Object.keys(dispatcher.getFailedUrls())).toHaveLength(0);
    });
  });

  describe('Persistence', () => {
    it('should persist queue to disk when enabled', async () => {
      const persistentDispatcher = new WebhookDispatcher({
        enablePersistence: true,
        queueDir: './test-persistent-webhooks'
      });

      await persistentDispatcher.enqueueEvents([
        { id: 'persistent-event', type: 'test', payload: { data: 'test' } }
      ]);

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('queue.json'),
        expect.stringContaining('persistent-event'),
        'utf8'
      );

      persistentDispatcher.destroy();
    });

    it('should load persisted queue on startup', async () => {
      const queueData = JSON.stringify([
        { id: 'loaded-event', type: 'test', payload: { data: 'loaded' } }
      ]);
      
      fs.readFile.mockResolvedValue(queueData);

      const queueLoadedCallback = jest.fn();
      
      const persistentDispatcher = new WebhookDispatcher({
        enablePersistence: true,
        queueDir: './test-load-webhooks'
      });

      persistentDispatcher.on('queueLoaded', queueLoadedCallback);

      await persistentDispatcher.initStorage();

      expect(queueLoadedCallback).toHaveBeenCalledWith(1);
      expect(persistentDispatcher.queue).toHaveLength(1);
      expect(persistentDispatcher.queue[0].id).toBe('loaded-event');

      persistentDispatcher.destroy();
    });
  });

  describe('Resource Cleanup', () => {
    it('should cleanup resources on destroy', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      
      dispatcher.destroy();

      // Should clear timers
      expect(clearIntervalSpy).toHaveBeenCalled();
      
      // Should clear data structures
      expect(dispatcher.queue).toHaveLength(0);
      expect(dispatcher.webhookUrls.size).toBe(0);

      clearIntervalSpy.mockRestore();
    });

    it('should stop processing on destroy', () => {
      expect(dispatcher.processingTimer).toBeDefined();
      
      dispatcher.destroy();

      expect(dispatcher.processingTimer).toBeNull();
    });
  });
});
