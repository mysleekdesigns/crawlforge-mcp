/**
 * Stops a Firefox page's own JavaScript error from taking the process down.
 *
 * Camoufox's Juggler reports an uncaught page error without a `location`:
 *
 *   ◀ RECV {"method":"Page.uncaughtError","params":{
 *       "frameId":"mainframe-8",
 *       "message":"TypeError: null has no properties",
 *       "stack":"@http://127.0.0.1:55712/:3:13\n"}}
 *
 * playwright-core 1.62's FFPage._onUncaughtError forwards that missing
 * `params.location` into Page.addPageError, and the BrowserContext dispatcher
 * then reads it unconditionally:
 *
 *   location: { url: pageError.location.url, ... }
 *
 * The resulting "Cannot read properties of undefined (reading 'url')" is thrown
 * inside the protocol dispatch loop, where nothing awaits it — it arrives as an
 * uncaughtException. A plain `<script>null.boom;</script>` on any page is enough
 * to trigger it, and bot.sannysoft.com does it in the ordinary course of
 * running its checks.
 *
 * Under server.js the catch-all uncaughtException handler absorbs it and the
 * scrape still returns, but every other consumer — the CLI, deep_research when
 * it is embedded, any direct use of StealthBrowserManager — dies on the spot.
 * Leaning on that handler is not a fix either: it logs a stack trace on a page
 * that did nothing wrong, and Node treats the process state as undefined
 * afterwards.
 *
 * So the missing value is filled in at its source. Firefox told us a page error
 * happened but not where; the zeroed location says exactly that, and everything
 * downstream — including the `pageerror` event a caller can listen for —
 * behaves normally. Chromium and WebKit always send a location, so they never
 * reach the fallback.
 *
 * Reaching into playwright's internals is deliberate and bounded: this patches
 * one method, only when it exists and has not already been patched, and any
 * failure leaves the original in place. A playwright that fixes this upstream,
 * or renames the method, turns it into a no-op rather than a breakage. The
 * `playwright-core/lib/coreBundle` specifier is one playwright-core publishes in
 * its own `exports` map, and it resolves to the same module instance playwright
 * itself loads. playwright-core is not declared as a dependency on purpose: it
 * must stay the exact version playwright pins, so it is only ever reached
 * through the copy playwright brought.
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Firefox reports that an error happened but not where. Zeros say "unknown"
// without inventing a file or a line number.
const UNKNOWN_LOCATION = Object.freeze({ url: '', lineNumber: 0, columnNumber: 0 });

let applied = false;

/**
 * Idempotent, best-effort, and safe to call before every Firefox/Camoufox
 * launch. Returns true when the guard is in place (including when a previous
 * call installed it), false when this playwright build did not match.
 */
export function guardFirefoxPageErrors() {
  if (applied) return true;

  try {
    const bundle = require('playwright-core/lib/coreBundle');
    const prototype = bundle?.server?.Page?.prototype;
    if (!prototype || typeof prototype.addPageError !== 'function') return false;
    if (prototype.addPageError.__crawlforgeGuarded) {
      applied = true;
      return true;
    }

    const original = prototype.addPageError;
    function addPageError(error, location) {
      return original.call(this, error, location || UNKNOWN_LOCATION);
    }
    addPageError.__crawlforgeGuarded = true;
    prototype.addPageError = addPageError;

    applied = true;
    return true;
  } catch {
    // A playwright that moved or sealed this is not a reason to fail a launch;
    // the crash it prevents is rarer than the launch it would break.
    return false;
  }
}

/** Test seam: forget that the guard was installed. Does not un-patch. */
export function _resetFirefoxPageErrorGuard() {
  applied = false;
}
