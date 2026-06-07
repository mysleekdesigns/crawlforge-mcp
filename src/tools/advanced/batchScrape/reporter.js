/**
 * batchScrape — reporter module.
 * Webhook dispatching helper (thin wrapper around WebhookDispatcher).
 */

/**
 * Send a batch event via the webhookDispatcher.
 * C3: returns a delivery status object so callers can include it in the result.
 * @param {string}  event
 * @param {Object}  data
 * @param {Object}  webhookConfig
 * @param {Object}  webhookDispatcher
 * @param {boolean} enabled
 * @returns {Promise<{queued: boolean, url?: string, error?: string}|null>}
 */
export async function sendWebhookNotification(event, data, webhookConfig, webhookDispatcher, enabled) {
  if (!enabled || !webhookConfig || !webhookDispatcher) return null;

  try {
    await webhookDispatcher.dispatch(event, data, {
      urls: [webhookConfig.url],
      immediate: false,
      metadata: { batchId: data.batchId, timestamp: Date.now() }
    });
    return { queued: true, url: webhookConfig.url };
  } catch (error) {
    console.warn(`[batchScrape] Webhook notification failed: ${error.message}`);
    return { queued: false, url: webhookConfig.url, error: error.message };
  }
}
