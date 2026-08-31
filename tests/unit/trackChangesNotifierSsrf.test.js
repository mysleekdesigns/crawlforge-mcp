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
import { spawnSync } from 'node:child_process';
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

describe('track_changes notifier timeout', () => {
  // Subprocess, because ALLOWED_DOMAINS is read when the guard's config module
  // is imported — the same reason ssrfGuard.test.js spawns for its redirect
  // test. The allowlist is what lets this reach a loopback fixture at all.
  const notifierUrl = new URL('../../src/tools/tracking/trackChanges/notifier.js', import.meta.url)
    .href;

  test('a webhook endpoint that never answers is abandoned, not awaited forever', () => {
    const script = `
      import http from 'node:http';
      import { EventEmitter } from 'node:events';
      import { sendWebhookNotification } from '${notifierUrl}';

      // Accepts the connection and then says nothing, ever.
      const server = http.createServer(() => {});

      server.listen(0, '127.0.0.1', async () => {
        const port = server.address().port;
        const emitter = new EventEmitter();
        let error = null;
        emitter.on('notificationError', (e) => { error = e.error; });

        const startedAt = Date.now();
        await sendWebhookNotification(
          'https://example.com/watched',
          { significance: 'minor', changeType: 'content_change',
            summary: { changeDescription: 'x' }, details: {} },
          { url: 'http://127.0.0.1:' + port + '/hook', enabled: true },
          emitter
        );
        const elapsed = Date.now() - startedAt;

        process.stdout.write(JSON.stringify({ error, elapsed }));
        server.close(() => process.exit(0));
      });
    `;

    const env = {
      ...process.env,
      ALLOWED_DOMAINS: '127.0.0.1',
      TRACK_CHANGES_NOTIFY_TIMEOUT_MS: '400',
    };
    delete env.SSRF_PROTECTION_ENABLED;

    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env,
      encoding: 'utf8',
      timeout: 15000,
    });

    assert.equal(result.status, 0, `subprocess failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);

    // It has to return, and it has to say why — a silent success would mean the
    // notification was reported as delivered to an endpoint that never replied.
    assert.ok(parsed.error, 'expected the notifier to report an error');
    assert.match(parsed.error, /abort|timeout|timed out/i);
    // Comfortably under the 30s default: proof the send was bounded by the
    // signal rather than by the subprocess timeout or the OS.
    assert.ok(parsed.elapsed < 10000, `took ${parsed.elapsed}ms — the signal did not bound it`);
  });
});
