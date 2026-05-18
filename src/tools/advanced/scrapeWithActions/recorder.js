/**
 * recorder.js — Recording and replay support for scrape_with_actions.
 *
 * Responsibilities:
 *   - Validate recording names (path-traversal prevention)
 *   - Persist recorded action sequences to disk (atomic write)
 *   - Load saved recordings for replay
 *   - List available recordings
 *
 * The recordings directory is resolved from:
 *   1. process.env.CRAWLFORGE_HOME_OVERRIDE  (tests only)
 *   2. os.homedir()
 *
 * File layout: <homeDir>/.crawlforge/recordings/<name>.json
 */

import os from 'os';
import fs from 'fs/promises';
import path from 'path';

// Regex enforcing safe recording names — no path separators or special chars.
const VALID_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Return the base home directory respecting the test override env var.
 * @returns {string}
 */
function homeDir() {
  return process.env.CRAWLFORGE_HOME_OVERRIDE || os.homedir();
}

/**
 * Return the recordings directory path (not guaranteed to exist).
 * @returns {string}
 */
function recordingsDir() {
  return path.join(homeDir(), '.crawlforge', 'recordings');
}

/**
 * Validate a recording name.
 * @param {string} name
 * @throws {Error} if the name is invalid
 */
export function validateRecordingName(name) {
  if (typeof name !== 'string' || !VALID_NAME_RE.test(name)) {
    throw new Error(
      `Invalid recording name "${name}". ` +
      'Names must be 1–64 characters and contain only letters, digits, underscores, or hyphens.'
    );
  }
}

/**
 * Persist a recorded action sequence to disk atomically.
 *
 * @param {string} name - Recording name (validated before writing)
 * @param {Array<Object>} recordedActions - Array of annotated action entries
 * @param {Object} [meta] - Optional metadata (original url, timestamp, etc.)
 * @returns {Promise<string>} Resolved file path
 */
export async function saveRecording(name, recordedActions, meta = {}) {
  validateRecordingName(name);

  const dir = recordingsDir();
  await fs.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, `${name}.json`);
  const tmpPath = `${filePath}.tmp`;

  const payload = JSON.stringify(
    {
      name,
      savedAt: new Date().toISOString(),
      ...meta,
      recordedActions
    },
    null,
    2
  );

  // Atomic write: write to .tmp then rename
  await fs.writeFile(tmpPath, payload, 'utf8');
  await fs.rename(tmpPath, filePath);

  return filePath;
}

/**
 * Load a saved recording from disk.
 *
 * @param {string} name - Recording name
 * @returns {Promise<Object>} Parsed recording object (includes `recordedActions`)
 * @throws {Error} if the recording does not exist or cannot be parsed
 */
export async function loadRecording(name) {
  validateRecordingName(name);

  const filePath = path.join(recordingsDir(), `${name}.json`);

  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Recording "${name}" not found. Use replayRecording: "__list__" to see available recordings.`);
    }
    throw new Error(`Failed to read recording "${name}": ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Recording "${name}" is corrupted (invalid JSON): ${err.message}`);
  }

  if (!Array.isArray(parsed.recordedActions)) {
    throw new Error(`Recording "${name}" has an unexpected format (missing recordedActions array).`);
  }

  return parsed;
}

/**
 * List all available recording names.
 *
 * @returns {Promise<string[]>} Sorted array of recording names (without .json extension)
 */
export async function listRecordings() {
  const dir = recordingsDir();

  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw new Error(`Failed to list recordings: ${err.message}`);
  }

  return entries
    .filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))
    .map(f => f.slice(0, -5)) // strip .json
    .sort();
}

/**
 * Build a recordedActions entry from an action definition and timing info.
 *
 * Only the fields meaningful for replay are kept.
 *
 * @param {Object} action - Original action object
 * @param {number} timestampMsSinceStart - ms since recording session started
 * @returns {Object}
 */
export function buildRecordedEntry(action, timestampMsSinceStart) {
  const entry = {
    type: action.type,
    timestamp_ms_since_start: timestampMsSinceStart
  };

  // Preserve replay-relevant fields per action type
  if (action.selector !== undefined) entry.selector = action.selector;
  if (action.text !== undefined) entry.text = action.text;
  if (action.key !== undefined) entry.key = action.key;
  if (action.duration !== undefined) entry.duration = action.duration;
  if (action.url !== undefined) entry.url = action.url;
  if (action.value !== undefined) entry.value = action.value;
  if (action.direction !== undefined) entry.direction = action.direction;
  if (action.distance !== undefined) entry.distance = action.distance;
  if (action.description !== undefined) entry.description = action.description;

  return entry;
}

/**
 * Convert a recorded entry back into an action object suitable for ActionExecutor.
 *
 * @param {Object} entry - Recorded entry
 * @returns {Object} Action object
 */
export function recordedEntryToAction(entry) {
  // Pass through all fields except the recording-specific timestamp
  const { timestamp_ms_since_start: _ignored, ...action } = entry;
  return action;
}
