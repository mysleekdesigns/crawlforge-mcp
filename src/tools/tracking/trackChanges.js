/**
 * trackChanges.js — backward-compatibility re-export shim.
 *
 * The implementation has been split into:
 *   trackChanges/schema.js   — Zod input schema
 *   trackChanges/differ.js   — fetch + history helpers
 *   trackChanges/monitor.js  — polling monitor lifecycle
 *   trackChanges/notifier.js — webhook / email / Slack notifications
 *   trackChanges/index.js    — TrackChangesTool class + singleton
 *
 * All original named exports are preserved here so existing imports continue to work.
 */

export { TrackChangesTool, TrackChangesTool as default, trackChangesTool } from './trackChanges/index.js';
export { TrackChangesSchema } from './trackChanges/schema.js';
