/**
 * TrackChanges — monitor module.
 * Handles the polling monitor lifecycle: start, check, stop.
 * Used by the TrackChangesTool class (index.js).
 */

import { fetchContent, meetsNotificationThreshold } from './differ.js';
import { sendNotifications } from './notifier.js';

/**
 * Perform a single monitoring check for a URL.
 * Mutates monitorConfig.stats in place.
 *
 * @param {string} url
 * @param {Object} monitorConfig
 * @param {Object} deps — { changeTracker, snapshotManager, emitter }
 */
export async function performMonitoringCheck(url, monitorConfig, { changeTracker, snapshotManager, emitter }) {
  const startTime = Date.now();

  try {
    monitorConfig.stats.checks++;

    const fetchResult = await fetchContent(url);

    const comparisonResult = await changeTracker.compareWithBaseline(
      url,
      fetchResult.content,
      monitorConfig.options.trackingOptions
    );

    const responseTime = Date.now() - startTime;
    monitorConfig.stats.averageResponseTime =
      (monitorConfig.stats.averageResponseTime * (monitorConfig.stats.checks - 1) + responseTime) /
      monitorConfig.stats.checks;

    monitorConfig.stats.lastCheck = Date.now();

    if (comparisonResult.hasChanges) {
      monitorConfig.stats.changesDetected++;
      monitorConfig.stats.lastChange = Date.now();

      if (meetsNotificationThreshold(
        comparisonResult.significance,
        monitorConfig.options.notificationThreshold
      )) {
        if (monitorConfig.options.storageOptions?.enableSnapshots) {
          await snapshotManager.storeSnapshot(url, fetchResult.content, {
            ...fetchResult.metadata,
            changes: comparisonResult.summary,
            significance: comparisonResult.significance,
            monitoring: true
          });
        }

        if (monitorConfig.options.notificationOptions) {
          await sendNotifications(url, comparisonResult, monitorConfig.options.notificationOptions, emitter);
        }
      }
    }

    emitter?.emit('monitoringCheck', {
      url,
      hasChanges: comparisonResult.hasChanges,
      significance: comparisonResult.significance,
      responseTime,
      timestamp: Date.now()
    });
  } catch (error) {
    monitorConfig.stats.errors++;

    emitter?.emit('monitoringError', { url, error: error.message, timestamp: Date.now() });

    if (monitorConfig.stats.errors > monitorConfig.options.maxRetries) {
      stopMonitor(url, monitorConfig, emitter);
      emitter?.emit('monitoringDisabled', {
        url,
        reason: 'Too many errors',
        totalErrors: monitorConfig.stats.errors
      });
    }
  }
}

/**
 * Stop a single active monitor (clears its interval).
 */
export function stopMonitor(url, monitorConfig, emitter) {
  if (monitorConfig?.timer) {
    clearInterval(monitorConfig.timer);
  }
  emitter?.emit('monitoringStopped', { url });
}
