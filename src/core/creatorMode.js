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

// Load .env file early to check for creator secret
dotenv.config({ path: '.env', quiet: true });

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
    console.log('Creator Mode Enabled - Unlimited Access');
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
