/**
 * Snapshot — the accessibility-style page tree that hands an agent stable
 * element refs (`@e1`, `@e2`, …) to act on instead of guessed CSS selectors.
 *
 * TWO SOURCES, one public format:
 *
 *   1. `page.ariaSnapshot({ mode: 'ai' })` (Playwright ≥ 1.59; verified on
 *      1.62.1, Chromium and Camoufox). It descends open shadow roots and
 *      iframes, and tags each visible node `[ref=e5]` (`[ref=f1e3]` in a
 *      frame) that the public `aria-ref=` selector engine resolves — shadow
 *      and frame refs included. Its YAML is translated into our tree below.
 *   2. The injected walk (snapshotScript), kept as the fallback for a page
 *      where the native call throws. It stamps `data-cf-ref="e1"` on the
 *      elements it refs and sees neither shadow roots nor frames.
 *
 * The result's `source` ('aria' | 'walk') says which one described the page.
 *
 * Refs are OURS, not Playwright's: `@e1…@eN`, contiguous, in document order
 * across the page, its shadow roots and its frames. Playwright numbers every
 * visible node (the body is usually its e1), so its ids have gaps and a page's
 * one button would be e2; each of our refs instead maps to the selector that
 * finds its element — `aria-ref=f1e3` natively, `[data-cf-ref="e1"]` from the
 * walk. A resolved selector is therefore NOT always CSS: a consumer must hand
 * it to page.locator()/waitForSelector(), never to document.querySelector().
 *
 * STALENESS lives in Node — a WeakMap<Page, state> cleared on every main-frame
 * navigation. Without it a ref from a previous page would merely fail to
 * match, and the caller would be told "selector not found" instead of "take a
 * new snapshot". So a stale ref fails loudly, with the reason and the fix
 * (StaleRefError), and never silently hits the wrong element.
 *
 * Not to be confused with src/core/SnapshotManager.js, which is change-
 * tracking history.
 */

import { randomUUID } from 'node:crypto';
import { settlePage } from './settle.js';

export const REF_ATTRIBUTE = 'data-cf-ref';
export const DEFAULT_MAX_NODES = 200;
export const MAX_NODES_LIMIT = 1000;

// Captures of one snapshot call, including the retry when the page navigates
// mid-capture (a fallback from the native snapshot to the walk is not one of
// them). Two: one retry is enough for a page that settles, and a page
// navigating repeatedly is not one a snapshot can describe.
const MAX_WALK_ATTEMPTS = 2;

// Indentation follows the nesting of EMITTED nodes, and stops deepening past
// this many levels so a deep DOM cannot produce runaway leading whitespace.
const MAX_INDENT = 10;
const MAX_NAME_LENGTH = 120;

const REF_PATTERN = /^@e[1-9]\d*$/;

// Shared by both sources: the walk gets them as arguments, the translation of
// the native snapshot reads them directly.
const INTERACTIVE_ROLES = [
  'button', 'link', 'checkbox', 'radio', 'textbox', 'combobox', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'tab', 'switch', 'option', 'searchbox',
  'slider', 'spinbutton'
];
const STRUCTURAL_ROLES = [
  'heading', 'banner', 'navigation', 'contentinfo', 'complementary', 'main',
  'form', 'region', 'search', 'iframe'
];
const INTERACTIVE_ROLE_SET = new Set(INTERACTIVE_ROLES);
const STRUCTURAL_ROLE_SET = new Set(STRUCTURAL_ROLES);

// An editing host (`contenteditable`) has no ARIA role, so the native snapshot
// shows it as a plain `generic`. Only a page that has one pays for the per-node
// check that finds it, and each check gets this long before it counts as "no".
const EDITABLE_SELECTOR = '[contenteditable]:not([contenteditable="false"])';
const EDITABLE_CHECK_TIMEOUT_MS = 1000;

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
function snapshotScript({
  refAttribute, interactiveOnly, maxNodes, maxIndent, maxNameLength, interactiveRoles, structuralRoles
}) {
  const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'head']);
  const INTERACTIVE_ROLES = new Set(interactiveRoles);
  const STRUCTURAL_ROLES = new Set(structuralRoles);
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

// Same name rules as the walk's clean()/truncate(): one line, no double quotes.
const cleanName = (value) => (value || '').replace(/\s+/g, ' ').trim().replace(/"/g, "'");
const truncateName = (value) =>
  (value.length > MAX_NAME_LENGTH ? `${value.slice(0, MAX_NAME_LENGTH - 1)}…` : value);

/**
 * One line of `page.ariaSnapshot({ mode: 'ai' })`:
 *
 *   - role "name" [checked] [level=1] [ref=e5] [cursor=pointer]: text
 *
 * The name is JSON-quoted, or printed bare when it is itself `/…/`. A key YAML
 * would misread (a name holding `: ` or ` #`) comes wrapped in single quotes
 * with `''` for `'`; a text value that needs it is double-quoted. Property
 * lines (`- /url: …`) and bare text (`- text: …`) are not nodes and return null.
 */
function parseAriaLine(line) {
  const item = /^( *)- (.*)$/.exec(line);
  if (!item) return null;

  let key = item[2];
  let rest = '';
  const quoted = /^'((?:[^']|'')*)'(.*)$/.exec(key);
  if (quoted) {
    key = quoted[1].replace(/''/g, "'");
    rest = quoted[2];
  } else {
    // An unquoted key never contains `:` followed by a space or the end.
    const colon = key.search(/:(\s|$)/);
    if (colon >= 0) [key, rest] = [key.slice(0, colon), key.slice(colon)];
  }

  const parts = /^([a-z]+)(?: ("(?:[^"\\]|\\.)*"|\/.*\/(?= \[|$)))?(.*)$/.exec(key);
  if (!parts || parts[1] === 'text') return null;

  let text = rest.replace(/^:\s?/, '');
  if (text.startsWith('"')) {
    try {
      text = JSON.parse(text.replace(/\\x([0-9a-f]{2})/gi, '\\u00$1'));
    } catch {
      // keep the raw value; it is only ever a fallback name
    }
  }

  const ref = /\[ref=([^\]\s]+)\]/.exec(parts[3]);
  return {
    indent: item[1].length,
    role: parts[1],
    name: parts[2] ? (parts[2].startsWith('"') ? JSON.parse(parts[2]) : parts[2]) : '',
    text,
    ref: ref ? ref[1] : null,
    pointer: parts[3].includes('[cursor=pointer]')
  };
}

/** Playwright refs of the `generic` nodes that are contenteditable editing hosts. */
async function editingHosts(page, nodes) {
  const found = await Promise.all(page.frames().map((frame) =>
    frame.locator(EDITABLE_SELECTOR).count().catch(() => 0)));
  if (!found.some(Boolean)) return new Set();

  const generics = nodes.filter((node) => node.role === 'generic');
  const hosts = await Promise.all(generics.map((node) =>
    page.locator(`aria-ref=${node.ref}`)
      .evaluate(
        (el) => el.isContentEditable && !(el.parentElement && el.parentElement.isContentEditable),
        undefined,
        { timeout: EDITABLE_CHECK_TIMEOUT_MS }
      )
      .catch(() => false)));
  return new Set(generics.filter((_, i) => hosts[i]).map((node) => node.ref));
}

/**
 * Describe the page with Playwright's native snapshot, in the walk's format.
 *
 * A node is interactive by role; or, having no such role, when it is an
 * editing host (printed as the textbox it is typed into like) or the outermost
 * node with a pointer cursor — the mark an onclick `<div>` usually carries.
 * Nodes without a Playwright ref are left out: those are the invisible ones
 * (display:none, zero-size, a closed <select>'s options). A `tabindex` or
 * `onclick` element with neither a role nor a pointer cursor is not found —
 * the YAML does not carry those attributes.
 */
async function ariaCapture(page, { interactiveOnly, maxNodes, timeout }) {
  const yaml = await page.ariaSnapshot({ mode: 'ai', timeout });
  const nodes = yaml.split('\n').map(parseAriaLine).filter((node) => node && node.ref);
  const editable = await editingHosts(page, nodes);

  const lines = [];
  const refs = [];
  let truncated = false;
  // The emitted ancestors of the current node. Indentation follows EMITTED
  // nesting, as in the walk, so it is this stack's depth, not the YAML's.
  const emitted = [];

  for (const node of nodes) {
    while (emitted.length && emitted[emitted.length - 1].indent >= node.indent) emitted.pop();

    const isHost = editable.has(node.ref);
    const interactive = INTERACTIVE_ROLE_SET.has(node.role) || isHost ||
      (node.pointer && !emitted.some((ancestor) => ancestor.interactive));
    const structural = !interactive && !interactiveOnly && STRUCTURAL_ROLE_SET.has(node.role);
    if (!interactive && !structural) continue;

    if (lines.length >= maxNodes) {
      truncated = true;
      break;
    }
    const role = isHost ? 'textbox' : node.role;
    // A control with no accessible name is captioned by its text, as the walk
    // does; a landmark is named by its label only.
    const name = truncateName(cleanName(node.name || (interactive ? node.text : '')));
    let ref = '';
    if (interactive) {
      const id = `e${refs.length + 1}`;
      refs.push({ id, role, name, selector: `aria-ref=${node.ref}` });
      ref = `@${id} `;
    }
    lines.push(`${'  '.repeat(Math.min(emitted.length + 1, MAX_INDENT))}${ref}[${role}]${name ? ` "${name}"` : ''}`);
    emitted.push({ indent: node.indent, interactive });
  }

  return { title: cleanName(await page.title()), lines, refs, truncated };
}

/** The injected walk, with each ref's selector pointing at the stamp it left. */
async function walkCapture(page, { interactiveOnly, maxNodes }) {
  const walk = await page.evaluate(snapshotScript, {
    refAttribute: REF_ATTRIBUTE,
    interactiveOnly,
    maxNodes,
    maxIndent: MAX_INDENT,
    maxNameLength: MAX_NAME_LENGTH,
    interactiveRoles: INTERACTIVE_ROLES,
    structuralRoles: STRUCTURAL_ROLES
  });
  return {
    ...walk,
    refs: walk.refs.map(({ id, role, name }) => ({ id, role, name, selector: `[${REF_ATTRIBUTE}="${id}"]` }))
  };
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
 * Describe the page and return its tree plus the refs it assigned. `source`
 * in the result says whether the native snapshot or the walk produced it.
 *
 * @param {import('playwright').Page} page
 * @param {object} [options]
 * @param {boolean} [options.interactiveOnly=true] — false also emits headings and landmarks, unreffed
 * @param {number} [options.maxNodes=200] — cap on emitted nodes, clamped to [1, MAX_NODES_LIMIT]
 * @param {number} [options.timeout] — budget for the render wait before the capture (see settle.js),
 *   and for the native snapshot itself
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

  // Walking before the page has rendered describes an empty shell. Both the
  // snapshot action and browser_session's snapshot operation come through here.
  const settle = await settlePage(page, { timeout: options.timeout });

  const state = stateFor(page);
  let title, lines, refs, truncated;
  // The native snapshot unless this page object has none (a stub, an old
  // Playwright) or it throws here; the walk is the fallback either way.
  let source = typeof page.ariaSnapshot === 'function' ? 'aria' : 'walk';

  // A navigation that commits WHILE the snapshot is running would otherwise
  // leave us holding refs for a document that has gone, so `@e1` would match
  // nothing and surface as a locator timeout instead of the named error D2
  // requires. `generation` moves on every main-frame navigation, so a change
  // across the capture means exactly that — whether the capture returned or
  // threw because its context was destroyed. Capture the new document instead;
  // if it navigates again, give up and leave the refs invalidated rather than
  // publishing a tree for a page nobody is on.
  for (let attempt = 0; ;) {
    const generation = state.generation;
    const capture = source === 'aria' ? ariaCapture : walkCapture;
    let result;
    try {
      result = await capture(page, { interactiveOnly, maxNodes, timeout: options.timeout });
    } catch (error) {
      if (state.generation === generation) {
        if (source === 'walk') throw error;
        source = 'walk'; // the native snapshot failed on a page that stayed put
        continue;
      }
    }
    if (state.generation === generation) {
      ({ title, lines, refs, truncated } = result);
      break;
    }
    if (++attempt >= MAX_WALK_ATTEMPTS) {
      clearRefs(page);
      throw new StaleRefError(
        'The page navigated while the snapshot was being taken — take a new snapshot.'
      );
    }
  }

  const snapshotId = randomUUID().slice(0, 8);
  state.snapshotId = snapshotId;
  state.refs = new Map(refs.map(({ id, role, name, selector }) => [id, { role, name, selector }]));
  state.invalidated = false;

  return {
    snapshotId,
    url: page.url(),
    title,
    tree: [`[document]${title ? ` "${title}"` : ''}`, ...lines].join('\n'),
    refCount: refs.length,
    nodeCount: lines.length,
    truncated,
    interactiveOnly,
    source,
    waited_ms: settle.waited_ms,
    settled_by: settle.settled_by
  };
}

/**
 * Turn `@e1` into the selector for the element it named: `aria-ref=…` from the
 * native snapshot, `[data-cf-ref="e1"]` from the walk. Either works anywhere a
 * Playwright selector does (locator, waitForSelector, page.type) — not in a
 * raw document.querySelector().
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

  return state.refs.get(id).selector;
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
