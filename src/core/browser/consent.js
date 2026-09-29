/**
 * Consent — answer a cookie/consent wall with @duckduckgo/autoconsent before
 * the chain's first action sees the page (browserOptions.consent).
 *
 * autoconsent ships a content script plus a rule set; the content script
 * detects the CMP and clicks its reject (optOut) or accept (optIn) button, and
 * reports each step as a message. It has to run in every frame: several CMPs
 * (Sourcepoint on theguardian.com) render inside a cross-origin iframe.
 *
 * Messages come back through a queue in each frame that this module drains on
 * a short poll, not through page.exposeBinding. A binding can be registered
 * only once per page (a second navigate would throw), and on camoufox
 * page.evaluate runs in an isolated world that a main-world binding is not
 * visible from. Draining a queue works the same on both engines.
 *
 * Engines: on Chromium frame.evaluate runs in the page's main world, so the
 * content script and its globals (window.autoconsentReceiveMessage,
 * window.__crawlforgeConsent) are visible to page scripts. On camoufox it runs
 * in an isolated world: DOM clicks work the same, but the few rules that read
 * a CMP's JavaScript API (`eval` steps, e.g. Cookiebot's, OneTrust's self-test)
 * cannot see page globals there and evaluate to false, so those rules fall
 * back to their DOM steps or do not match.
 *
 * Nothing here throws and nothing fails a chain: no CMP is `action: 'none'`.
 * The content script is not stopped at the cap — a popup it is still working
 * on may be answered after this returns.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const POLL_MS = 100;
const AUTO_ACTION = { reject: 'optOut', accept: 'optIn' };
const QUEUE_KEY = '__crawlforgeConsent';
const KEPT_MESSAGES = ['cmpDetected', 'popupFound', 'optOutResult', 'optInResult', 'autoconsentDone'];

// Read on first use, not at import: ~860 KB that a chain without consent
// handling never needs.
let bundle = null;
function loadBundle() {
  if (!bundle) {
    const require = createRequire(import.meta.url);
    const rulesPath = require.resolve('@duckduckgo/autoconsent/rules/rules.json');
    // The package's exports map does not expose dist/, so it is reached from
    // rules/ — the two ship side by side.
    const script = readFileSync(join(dirname(rulesPath), '..', 'dist', 'autoconsent.playwright.js'), 'utf8');
    const rules = JSON.parse(readFileSync(rulesPath, 'utf8')).autoconsent.map((rule) => ({
      rule,
      pattern: rule.runContext?.urlPattern ? new RegExp(rule.runContext.urlPattern) : null
    }));
    bundle = { script, rules };
  }
  return bundle;
}

// The rules that can apply to a frame (the content script checks again; this
// only keeps a 700 KB rule set out of every frame). Defaults per autoconsent:
// a rule runs in the main frame unless `main: false`, in a subframe only with
// `frame: true`.
function rulesFor(url, mainFrame) {
  return loadBundle().rules
    .filter(({ rule, pattern }) => {
      const ctx = rule.runContext || {};
      if (mainFrame ? ctx.main === false : ctx.frame !== true) return false;
      return !pattern || pattern.test(url);
    })
    .map(({ rule }) => rule);
}

function injectScript(frame, autoAction, timeout, mainFrame) {
  const config = {
    enabled: true,
    autoAction,
    disabledCmps: [],
    // Prehiding hides the popup before it is answered and unhides it if
    // answering fails — a snapshot taken meanwhile would lie either way.
    enablePrehide: false,
    enableCosmeticRules: true,
    // One detection attempt per 500 ms; stop looking at about the cap.
    detectRetries: Math.max(1, Math.ceil(timeout / 500)),
    // Run eval snippets inline in whatever world evaluate() gave us instead of
    // round-tripping them through the message queue (see the header).
    isMainWorld: true
  };
  const initResp = { type: 'initResp', config, rules: { autoconsent: rulesFor(frame.url(), mainFrame) } };
  return `window.${QUEUE_KEY} = [];
window.autoconsentSendMessage = (m) => {
  if (${JSON.stringify(KEPT_MESSAGES)}.includes(m.type)) window.${QUEUE_KEY}.push(m);
  return Promise.resolve();
};
${loadBundle().script}
;window.autoconsentReceiveMessage(${JSON.stringify(initResp)});
true;`;
}

const DRAIN_SCRIPT = `(() => { const q = window.${QUEUE_KEY}; return q ? q.splice(0) : null; })()`;

// This frame's new messages; injects the content script into a document that
// has none yet (first poll, or the frame navigated since).
async function drainFrame(frame, autoAction, timeout, mainFrame) {
  try {
    const messages = await frame.evaluate(DRAIN_SCRIPT);
    if (messages) return messages;
    await frame.evaluate(injectScript(frame, autoAction, timeout, mainFrame));
  } catch {
    // Detached or navigating frame: the next poll sees its new document.
  }
  return [];
}

/**
 * Answer the page's consent wall, if it has one autoconsent knows.
 *
 * @param {Page} page - Playwright page, already navigated
 * @param {'off'|'reject'|'accept'} mode - browserOptions.consent
 * @param {{timeout?: number}} [options] - cap in ms (default 2000)
 * @returns {Promise<{cmp: string|null, action: string, ms: number}|null>}
 *   null for 'off'. `action` is 'optOut' / 'optIn' when the popup was
 *   answered, 'hide' when a cosmetic rule hid it, 'error' when the rule ran
 *   and failed, 'timeout' when a popup was found but not answered within the
 *   cap, and 'none' when no popup was found.
 */
export async function handleConsent(page, mode, { timeout = 2000 } = {}) {
  const autoAction = AUTO_ACTION[mode];
  if (!autoAction) return null;

  const start = Date.now();
  const deadline = start + Math.max(0, timeout);
  let cmp = null;
  let action = 'none';

  try {
    const mainFrame = page.mainFrame();
    // Frame -> true while a CMP it detected is still unanswered. One page can
    // need two frames: on theguardian.com a top-frame rule hides Sourcepoint's
    // container at once, and the rule in Sourcepoint's iframe then makes the
    // actual choice — returning on the first `done` would report the hide.
    const pending = new Map();
    let finished = false;
    while (!finished && Date.now() < deadline) {
      const frames = page.frames().filter((f) => f === mainFrame || /^https?:/i.test(f.url()));
      let timer;
      const batches = await Promise.race([
        Promise.all(frames.map((f) => drainFrame(f, autoAction, timeout, f === mainFrame))),
        new Promise((resolve) => { timer = setTimeout(() => resolve([]), deadline - Date.now()); })
      ]);
      clearTimeout(timer);

      batches.forEach((messages, i) => {
        for (const m of messages) {
          if (m.type === 'cmpDetected') {
            if (!pending.has(frames[i])) pending.set(frames[i], true);
            continue;
          }
          cmp = m.cmp;
          if (m.type === 'popupFound') {
            if (action === 'none') action = 'timeout';
          } else if (m.type === 'autoconsentDone') {
            action = m.isCosmetic ? 'hide' : autoAction;
            pending.set(frames[i], false);
          } else if (!m.result) {
            // optOutResult/optInResult false: the rule ran and did not work.
            action = 'error';
            pending.set(frames[i], false);
          }
        }
      });
      // A CMP iframe removed mid-answer was closed by its own choice
      // (Sourcepoint drops its iframe on one) — its done message goes with it.
      for (const [frame, open] of pending) {
        if (open && frame.isDetached()) pending.set(frame, false);
      }
      finished = action !== 'none' && action !== 'timeout' && ![...pending.values()].includes(true);
      if (!finished) await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(POLL_MS, deadline - Date.now()))));
    }
  } catch {
    action = 'error';
  }

  return { cmp, action, ms: Date.now() - start };
}
