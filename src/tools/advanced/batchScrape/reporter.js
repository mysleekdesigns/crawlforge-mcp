/**
 * batchScrape — reporter module.
 * Webhook dispatching helper (thin wrapper around WebhookDispatcher).
 */

/**
 * Send a batch event via the webhookDispatcher.
 * @param {string}  event
 * @param {Object}  data
 * @param {Object}  webhookConfig
 * @param {Object}  webhookDispatcher
 * @param {boolean} enabled
 */
export async function sendWebhookNotification(event, data, webhookConfig, webhookDispatcher, enabled) {
  if (!enabled || !webhookConfig || !webhookDispatcher) return;

  try {
    await webhookDispatcher.dispatch(event, data, {
      urls: [webhookConfig.url],
      immediate: false,
      metadata: { batchId: data.batchId, timestamp: Date.now() }
    });
  } catch (error) {
    console.warn(`[batchScrape] Webhook notification failed: ${error.message}`);
  }
}
