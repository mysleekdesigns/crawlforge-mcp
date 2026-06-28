/**
 * TrackChanges — differ module.
 * URL content fetching and history/stat helper functions.
 */

import { safeFetch } from '../../../utils/ssrfGuard.js';

/**
 * Default Jaccard similarity threshold below which a change is considered
 * meaningful (i.e. worth flagging). 0.85 means content must be at least 85 %
 * similar to be treated as "no significant change".
 */
export const DEFAULT_CHANGE_THRESHOLD = 0.85;

/**
 * Compute token-based Jaccard similarity between two text strings.
 * Tokenises on whitespace; returns a value in [0, 1] where 1 is identical.
 *
 * @param {string} text1
 * @param {string} text2
 * @returns {number}
 */
export function calculateSimilarity(text1, text2) {
  if (!text1 && !text2) return 1;
  if (!text1 || !text2) return 0;

  const tokenise = (str) => new Set(str.toLowerCase().split(/\s+/).filter(Boolean));
  const setA = tokenise(text1);
  const setB = tokenise(text2);

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/**
 * Fetch the HTML/text content of a URL with change-tracking headers.
 * @param {string} url
 * @returns {Promise<{ content: string, metadata: Object }>}
 */
export async function fetchContent(url) {
  try {
    const response = await safeFetch(url, {
      headers: {
        'User-Agent': 'MCP-WebScraper-ChangeTracker/3.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Cache-Control': 'no-cache'
      },
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const content = await response.text();

    return {
      content,
      metadata: {
        statusCode: response.status,
        contentType: response.headers.get('content-type'),
        contentLength: content.length,
        lastModified: response.headers.get('last-modified'),
        etag: response.headers.get('etag'),
        fetchedAt: Date.now()
      }
    };
  } catch (error) {
    throw new Error(`Failed to fetch content: ${error.message}`);
  }
}

/**
 * Merge change-tracker history entries with snapshot history entries.
 * Deduplicates by timestamp proximity (within 60 s).
 */
export function mergeHistoryData(changeHistory, snapshotHistory) {
  const merged = [];

  changeHistory.forEach(entry => {
    merged.push({ ...entry, source: 'change_tracker', hasSnapshot: false });
  });

  snapshotHistory.forEach(entry => {
    const existing = merged.find(m => Math.abs(m.timestamp - entry.timestamp) < 60000);
    if (existing) {
      existing.hasSnapshot = true;
      existing.snapshotId = entry.snapshotId;
    } else {
      merged.push({ ...entry, source: 'snapshot', hasSnapshot: true });
    }
  });

  return merged.sort((a, b) => b.timestamp - a.timestamp);
}

/** Return true if entry.significance is at or above the filter level. */
export function matchesSignificanceFilter(entry, filter) {
  const levels = ['none', 'minor', 'moderate', 'major', 'critical'];
  return levels.indexOf(entry.significance || 'none') >= levels.indexOf(filter);
}

/** Return true if significance meets the notification threshold. */
export function meetsNotificationThreshold(significance, threshold) {
  const levels = ['none', 'minor', 'moderate', 'major', 'critical'];
  return levels.indexOf(significance) >= levels.indexOf(threshold);
}

export function calculateAverageInterval(changeHistory) {
  if (changeHistory.length < 2) return null;
  let total = 0;
  for (let i = 1; i < changeHistory.length; i++) {
    total += changeHistory[i - 1].timestamp - changeHistory[i].timestamp;
  }
  return total / (changeHistory.length - 1);
}

export function calculateSignificanceDistribution(changeHistory) {
  const dist = { none: 0, minor: 0, moderate: 0, major: 0, critical: 0 };
  changeHistory.forEach(entry => {
    const sig = entry.significance || 'none';
    if (Object.prototype.hasOwnProperty.call(dist, sig)) dist[sig]++;
  });
  return dist;
}
