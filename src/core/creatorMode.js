/**
 * Creator Mode Authentication
 * Extracted from server.js to allow tool classes to be imported independently
 * without triggering the full MCP server startup sequence.
 *
 * SECURITY: The creator secret hash is safe to commit — one-way SHA-256.
 * The actual secret is never stored. Only the package maintainer has it.
 */

import crypto from 'crypto';
import dotenv from 'dotenv';

// Load the cwd .env early to check for the creator secret, but into an isolated
// object rather than straight into process.env. A .env sitting in whatever
// directory the server is launched from is untrusted; seeding process.env from
// it directly would let it silently flip the SSRF controls (this module is
// imported before config.js runs its package-relative .env load). We copy the
// benign keys through — preserving the historical "cwd .env is read" behavior,
// including the creator secret — but never the SSRF/allowlist controls, which
// must come from the real environment.
const CWD_ENV_DENYLIST = new Set(['SSRF_PROTECTION_ENABLED', 'SSRF_STRICT', 'ALLOWED_DOMAINS']);
const cwdEnv = {};
dotenv.config({ path: '.env', quiet: true, processEnv: cwdEnv });
for (const [key, value] of Object.entries(cwdEnv)) {
  if (CWD_ENV_DENYLIST.has(key)) continue;
  if (process.env[key] === undefined) process.env[key] = value; // don't override the real env
}

// SECURITY: Clear any externally-set creator mode env var to prevent bypass
delete process.env.CRAWLFORGE_CREATOR_MODE;

const CREATOR_SECRET_HASH = 'cfef62e5068d48e7dd6a39c9e16f0be2615510c6b68274fc8abe3156feb5050b';

// Module-scoped flag — cannot be set externally
let _creatorModeVerified = false;

if (process.env.CRAWLFORGE_CREATOR_SECRET) {
  const providedHash = crypto
    .createHash('sha256')
    .update(process.env.CRAWLFORGE_CREATOR_SECRET)
    .digest('hex');

  if (crypto.timingSafeEqual(Buffer.from(providedHash, 'hex'), Buffer.from(CREATOR_SECRET_HASH, 'hex'))) {
    _creatorModeVerified = true;
    // Status message → stderr so stdout stays clean (MCP JSON-RPC / CLI --json output).
    console.error('Creator Mode Enabled - Unlimited Access');
  } else {
    console.warn('Invalid creator secret provided');
  }
  // Clean up the secret from environment
  delete process.env.CRAWLFORGE_CREATOR_SECRET;
}

/**
 * Returns true only when the package maintainer has provided the correct secret.
 * This flag is module-scoped and cannot be set via environment variables after
 * the module has loaded.
 */
export function isCreatorModeVerified() {
  return _creatorModeVerified;
}
