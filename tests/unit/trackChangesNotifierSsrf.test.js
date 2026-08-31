/**
 * track_changes notifications are caller-supplied URLs, so they go through the
 * SSRF guard.
 *
 * `notification.webhook.url` and `notification.slack.webhookUrl` are plain
 * `z.string().url()` fields, and these two senders were the only outbound calls
 * left using bare fetch — the sibling `core/WebhookDispatcher.js` already used
 * safeFetch. Left alone, a monitor could be pointed at 169.254.169.254 and used
 * to POST to it on a schedule.
 *
 * Run: node --test tests/unit/trackChangesNotifierSsrf.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import {
  sendWebhookNotification,
  sendSlackNotification,
} from '../../src/tools/tracking/trackChanges/notifier.js';

const changeResult = {
  significance: 'minor',
  changeType: 'content_change',
  summary: { changeDescription: 'something moved' },
  details: {},
};

/** The error text the notifier emitted, or null if it reported success. */
async function errorFrom(send) {
  const emitter = new EventEmitter();
  let error = null;
  emitter.on('notificationError', (e) => {
    error = e.error;
  });
  await send(emitter);
  return error;
}

describe('track_changes notifier SSRF guard', () => {
  for (const target of [
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:6379/',
    'http://[::ffff:127.0.0.1]/',
  ]) {
    test(`webhook to ${target} is refused`, async () => {
      const error = await errorFrom((emitter) =>
        sendWebhookNotification(
          'https://example.com/watched',
          changeResult,
          { url: target, enabled: true },
          emitter
        )
      );

      assert.ok(error, 'expected the notifier to report an error');
      assert.match(error, /SSRF Protection/);
    });
  }

  test('slack webhookUrl is guarded too', async () => {
    const error = await errorFrom((emitter) =>
      sendSlackNotification(
        'https://example.com/watched',
        changeResult,
        { webhookUrl: 'http://169.254.169.254/hook', enabled: true },
        emitter
      )
    );

    assert.ok(error, 'expected the notifier to report an error');
    assert.match(error, /SSRF Protection/);
  });
});
