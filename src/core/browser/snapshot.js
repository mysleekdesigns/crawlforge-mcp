/**
 * Snapshot — the accessibility-style page tree that hands an agent stable
 * element refs (`@e1`, `@e2`, …) to act on instead of guessed CSS selectors.
 *
 * Why ours and not Playwright's: 1.62's `locator.ariaSnapshot()` emits YAML
 * with no element refs at all, and `page._snapshotForAI()` is private API we
 * will not depend on. The walk below is injected by us and returns the tree
 * and the refs from one pass.
 *
 * A REF LIVES IN TWO PLACES, and the halves do different jobs:
 *
 *   1. In the page — the walk stamps `data-cf-ref="e1"` onto every element it
 *      refs, so a ref resolves to an ordinary CSS selector,
 *      `[data-cf-ref="e1"]`. That is what makes refs work with every existing
 *      action path for free, including the stealth human-behaviour code that
 *      takes a raw selector string.
 *   2. In Node — a WeakMap<Page, state> cleared on every main-frame
 *      navigation. This is the half that DETECTS staleness. Without it a ref
 *      from a previous page would merely fail to match, and the caller would
 *      be told "selector not found" instead of "take a new snapshot".
 *
 * So a stale ref fails loudly, with the reason and the fix (StaleRefError),
 * and never silently hits the wrong element.
 *
 * Not to be confused with src/core/SnapshotManager.js, which is change-
 * tracking history.
 */

import { randomUUID } from 'node:crypto';

export const REF_ATTRIBUTE = 'data-cf-ref';
export const DEFAULT_MAX_NODES = 200;
export const MAX_NODES_LIMIT = 1000;

// Walks of one snapshot call, including the retry when the page navigates
// mid-walk. Two: one retry is enough for a page that settles, and a page
// navigating repeatedly is not one a snapshot can describe.
const MAX_WALK_ATTEMPTS = 2;

// Indentation follows the nesting of EMITTED nodes, and stops deepening past
// this many levels so a deep DOM cannot produce runaway leading whitespace.
const MAX_INDENT = 10;
const MAX_NAME_LENGTH = 120;

const REF_PATTERN = /^@e[1-9]\d*$/;

/** Thrown when a ref cannot be resolved against the page's current snapshot. */
export class StaleRefError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StaleRefError';
  }
}

// Page -> { snapshotId, refs, invalidated, tracking }. WeakMap so a closed
// page's refs go with it.
const pageState = new WeakMap();

/** True for an element ref (`@e1`), false for anything else, including non-strings. */
export function isRef(selector) {
  return typeof selector === 'string' && REF_PATTERN.test(selector);
}

/**
 * The injected walk. Fixed source, written by us — it is not caller-supplied
 * JavaScript, so it has nothing to do with the ALLOW_JAVASCRIPT_EXECUTION flag
 * that gates the `executeJavaScript` action. Do not put it behind that flag.
 */
function snapshotScript({ refAttribute, interactiveOnly, maxNodes, maxIndent, maxNameLength }) {
  const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'head']);
  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'checkbox', 'radio', 'textbox', 'combobox', 'menuitem',
    'menuitemcheckbox', 'menuitemradio', 'tab', 'switch', 'option', 'searchbox',
    'slider', 'spinbutton'
  ]);
  const STRUCTURAL_ROLES = new Set([
    'heading', 'banner', 'navigation', 'contentinfo', 'complementary', 'main',
    'form', 'region', 'search'
  ]);
  const LANDMARK_TAGS = {
    main: 'main', nav: 'navigation', header: 'banner', footer: 'contentinfo',
    aside: 'complementary', form: 'form'
  };
  const INPUT_ROLES = {
    text: 'textbox', search: 'textbox', email: 'textbox', tel: 'textbox',
    url: 'textbox', password: 'textbox', checkbox: 'checkbox', radio: 'radio',
    submit: 'button', button: 'button', reset: 'button'
  };

  // Double quotes delimit the name in the tree, so a name may not contain one.
  const clean = (value) => (value || '').replace(/\s+/g, ' ').trim().replace(/"/g, "'");
  const truncate = (value) =>
    (value.length > maxNameLength ? `${value.slice(0, maxNameLength - 1)}…` : value);

  function roleOf(el, tag) {
    const explicit = (el.getAttribute('role') || '').trim().toLowerCase();
    if (explicit) return explicit.split(/\s+/)[0];
    if (tag === 'input') return INPUT_ROLES[(el.getAttribute('type') || 'text').toLowerCase()] || tag;
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : tag;
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    return LANDMARK_TAGS[tag] || tag;
  }

  function nameOf(el, tag, allowTextContent) {
    const ariaLabel = clean(el.getAttribute('aria-label'));
    if (ariaLabel) return ariaLabel;

    const labelledBy = (el.getAttribute('aria-labelledby') || '').trim();
    if (labelledBy) {
      const referenced = clean(labelledBy.split(/\s+/)
        .map((id) => (document.getElementById(id) || {}).textContent || '')
        .join(' '));
      if (referenced) return referenced;
    }

    // el.labels covers both `label[for=id]` and an ancestor <label>; closest()
    // is the fallback for elements that have no .labels (a contenteditable).
    const labels = el.labels;
    const labelText = clean(labels && labels.length
      ? labels[0].textContent
      : (el.closest('label') || {}).textContent);
    if (labelText) return labelText;

    for (const attribute of ['placeholder', 'title', 'alt']) {
      const value = clean(el.getAttribute(attribute));
      if (value) return value;
    }

    // A push button's label is its value; a text field's value is user data,
    // not a name, which is why this is narrowed to the button types.
    if (tag === 'input' && /^(button|submit|reset)$/.test((el.getAttribute('type') || '').toLowerCase())) {
      const value = clean(el.value);
      if (value) return value;
    }

    // A landmark is named by its label, never by everything inside it —
    // otherwise <main> would be captioned with the whole page.
    return allowTextContent ? clean(el.textContent) : '';
  }

  function isInteractive(el, tag, role) {
    if (INTERACTIVE_ROLES.has(role)) return true;
    if (tag === 'a') return el.hasAttribute('href');
    if (tag === 'input') return (el.getAttribute('type') || '').toLowerCase() !== 'hidden';
    if (tag === 'select' || tag === 'textarea' || tag === 'button' || tag === 'summary') return true;
    const editable = el.getAttribute('contenteditable');
    if (editable !== null && editable !== 'false') return true;
    const tabindex = el.getAttribute('tabindex');
    if (tabindex !== null && tabindex.trim() !== '-1') return true;
    return el.hasAttribute('onclick');
  }

  function isHidden(el, tag) {
    if (SKIP_TAGS.has(tag)) return true;
    if (el.hasAttribute('hidden')) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    const style = getComputedStyle(el);
    return style.display === 'none' || style.visibility === 'hidden';
  }

  const hasSize = (el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const lines = [];
  const refs = [];
  let truncated = false;

  function walk(el, depth) {
    if (truncated) return;
    const tag = el.tagName.toLowerCase();
    if (isHidden(el, tag)) return; // the subtree is hidden with it

    const role = roleOf(el, tag);
    const interactive = isInteractive(el, tag, role);
    const structural = !interactive && !interactiveOnly &&
      (/^h[1-6]$/.test(tag) || Boolean(LANDMARK_TAGS[tag]) || STRUCTURAL_ROLES.has(role));
    let childDepth = depth;

    // A zero-size element is not emitted, but its children still are: a
    // collapsed wrapper is common, an unreachable subtree is not.
    if ((interactive || structural) && hasSize(el)) {
      if (lines.length >= maxNodes) {
        truncated = true;
        return;
      }
      const name = truncate(nameOf(el, tag, interactive || role === 'heading'));
      let ref = '';
      // Only interactive nodes get a ref — a structural line is context, not a target.
      if (interactive) {
        const id = `e${refs.length + 1}`;
        el.setAttribute(refAttribute, id);
        refs.push({ id, role, name, tag });
        ref = `@${id} `;
      }
      lines.push(`${'  '.repeat(Math.min(depth, maxIndent))}${ref}[${role}]${name ? ` "${name}"` : ''}`);
      childDepth = depth + 1;
    }

    for (const child of el.children) walk(child, childDepth);
  }

  // Drop refs from an earlier walk so a re-snapshot of the same page numbers
  // cleanly instead of leaving elements answering to a retired id.
  for (const stale of document.querySelectorAll(`[${refAttribute}]`)) {
    stale.removeAttribute(refAttribute);
  }
  walk(document.body || document.documentElement, 1);

  return { title: clean(document.title), lines, refs, truncated };
}

function stateFor(page) {
  let state = pageState.get(page);
  if (!state) {
    state = { snapshotId: null, refs: null, invalidated: false, tracking: false, generation: 0 };
    pageState.set(page, state);
  }
  return state;
}

/**
 * Walk the page and return its tree plus the refs it assigned.
 *
 * @param {import('playwright').Page} page
 * @param {object} [options]
 * @param {boolean} [options.interactiveOnly=true] — false also emits headings and landmarks, unreffed
 * @param {number} [options.maxNodes=200] — cap on emitted nodes, clamped to [1, MAX_NODES_LIMIT]
 */
export async function captureSnapshot(page, options = {}) {
  const interactiveOnly = options.interactiveOnly !== false;
  const requested = Number(options.maxNodes);
  const maxNodes = Number.isFinite(requested)
    ? Math.min(Math.max(Math.floor(requested), 1), MAX_NODES_LIMIT)
    : DEFAULT_MAX_NODES;

  // Idempotent, and the guarantee that a later navigation invalidates these
  // refs rather than leaving them to fail as a missing selector.
  attachRefTracking(page);

  const state = stateFor(page);
  let title, lines, refs, truncated;

  // A navigation that commits WHILE the walk is running would otherwise leave us
  // holding refs for a document that has gone — the attributes were stamped on
  // the old page, so `@e1` would match nothing and surface as a locator timeout
  // instead of the named error D2 requires. `generation` moves on every
  // main-frame navigation, so a change across the evaluate means exactly that.
  // Walk the new document instead; if it navigates again, give up and leave the
  // refs invalidated rather than publishing a tree for a page nobody is on.
  for (let attempt = 0; ; attempt++) {
    const generation = state.generation;
    ({ title, lines, refs, truncated } = await page.evaluate(snapshotScript, {
      refAttribute: REF_ATTRIBUTE,
      interactiveOnly,
      maxNodes,
      maxIndent: MAX_INDENT,
      maxNameLength: MAX_NAME_LENGTH
    }));
    if (state.generation === generation) break;
    if (attempt >= MAX_WALK_ATTEMPTS - 1) {
      clearRefs(page);
      throw new StaleRefError(
        'The page navigated while the snapshot was being taken — take a new snapshot.'
      );
    }
  }

  const snapshotId = randomUUID().slice(0, 8);
  state.snapshotId = snapshotId;
  state.refs = new Map(refs.map(({ id, role, name, tag }) => [id, { role, name, tag }]));
  state.invalidated = false;

  return {
    snapshotId,
    url: page.url(),
    title,
    tree: [`[document]${title ? ` "${title}"` : ''}`, ...lines].join('\n'),
    refCount: refs.length,
    nodeCount: lines.length,
    truncated,
    interactiveOnly
  };
}

/**
 * Turn `@e1` into the CSS selector every action path already understands.
 * Throws StaleRefError when the ref does not belong to the page's current
 * snapshot — it never guesses.
 */
export function resolveRef(page, selector) {
  if (!isRef(selector)) {
    // A programming error, not a stale ref: callers gate on isRef().
    throw new Error(`resolveRef expects an element ref like "@e1", got ${JSON.stringify(selector)}`);
  }

  const state = pageState.get(page);
  if (!state || (!state.refs && !state.invalidated)) {
    throw new StaleRefError(
      `Unknown element ref ${selector}: no snapshot has been taken on this page — add a { "type": "snapshot" } action before acting on refs.`
    );
  }
  if (!state.refs) {
    throw new StaleRefError(
      `Stale element ref ${selector}: the page navigated since the last snapshot — take a new snapshot before acting on refs.`
    );
  }

  const id = selector.slice(1);
  if (!state.refs.has(id)) {
    const count = state.refs.size;
    throw new StaleRefError(count === 0
      ? `Unknown element ref ${selector}: the current snapshot has no refs — take a new snapshot.`
      : `Unknown element ref ${selector}: the current snapshot has ${count} refs (@e1-@e${count}) — take a new snapshot.`);
  }

  return `[${REF_ATTRIBUTE}="${id}"]`;
}

/** Register the navigation listener that invalidates this page's refs. Idempotent. */
export function attachRefTracking(page) {
  const state = stateFor(page);
  if (state.tracking) return;
  state.tracking = true;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) clearRefs(page);
  });
}

/** Drop the page's refs. A ref resolved afterwards reports the navigation, not a miss. */
export function clearRefs(page) {
  const state = pageState.get(page);
  if (!state) return;
  // `invalidated` is only meaningful once a snapshot existed — it is what
  // separates "the page navigated" from "no snapshot has been taken".
  if (state.refs) state.invalidated = true;
  state.refs = null;
  state.snapshotId = null;
  // Bumped on every clear so a walk in flight can tell the document changed
  // under it — see captureSnapshot.
  state.generation++;
}
