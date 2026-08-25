/**
 * hiddenContent -- remove content that a browser would not paint.
 *
 * Markup routinely carries text that is present in the DOM but invisible on
 * screen: screen-reader-only labels, and theme badges that are hidden until a
 * state class is applied. Serialising that markup to markdown or plain text
 * drops the CSS, so the hidden text reads as live page content and downstream
 * LLM extraction believes it.
 *
 * Observed on a Shopify Dawn storefront, whose price block ships every badge
 * unconditionally and hides them in component CSS:
 *
 *   <span class="visually-hidden">Regular price</span>   -> clip-rect hidden
 *   <span class="price__badge-sold-out">Sold out</span>  -> .price .price__badge-sold-out{display:none}
 *
 * Extraction read those and reported availability "Sold out" for a product with
 * 100 units in stock, and a compare-at price the page never displayed.
 *
 * Only rules a browser applies unconditionally are honoured:
 *   - rules inside @media / @supports / @container are ignored, because they
 *     depend on viewport or capability (a Tailwind `hidden md:inline-block`
 *     element is visible on desktop and must survive)
 *   - a hide rule is skipped when the element also matches a rule that puts
 *     display back to a visible value (Dawn's `.price--sold-out
 *     .price__badge-sold-out{display:inline-block}`)
 *   - selectors carrying interaction pseudo-classes (:hover, :focus) or
 *     pseudo-elements are ignored, since they describe transient state
 */

import { load } from 'cheerio';

/** Class tokens conventionally used to hide text from sighted users. */
const SCREEN_READER_CLASSES = [
  'visually-hidden',
  'visuallyhidden',
  'sr-only',
  'screen-reader-text',
  'screen-reader-only',
  'a11y-hidden',
  'hidden-visually'
];

/**
 * Selectors we never act on even if a rule hides them, to stay conservative.
 * '*' matters in particular: callers may flatten inline style attributes into
 * synthetic `*{...}` rules, and honouring that would empty the document.
 */
const NEVER_REMOVE = new Set(['html', 'body', 'head', 'main', '*', ':root']);

/**
 * An element holding more than this share of the page's text is treated as a
 * JS-revealed wrapper rather than hidden furniture, and is left alone.
 */
const MAX_REMOVAL_FRACTION = 0.3;

/**
 * Below this much content the share test is meaningless — in a short fragment a
 * single badge can be a third of the content — so the wrapper guard is skipped.
 */
const MIN_TEXT_FOR_BULK_GUARD = 2000;
const MIN_MARKUP_FOR_BULK_GUARD = 20000;

/** Strip CSS comments and any at-rule block whose contents are conditional. */
function stripConditionalBlocks(css) {
  let out = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // Remove @media/@supports/@container blocks wholesale, tracking nesting so a
  // block containing other rules is removed in full.
  const conditional = /@(?:media|supports|container)[^{]*\{/gi;
  let match;
  while ((match = conditional.exec(out)) !== null) {
    const start = match.index;
    let depth = 1;
    let i = conditional.lastIndex;
    while (i < out.length && depth > 0) {
      if (out[i] === '{') depth++;
      else if (out[i] === '}') depth--;
      i++;
    }
    out = out.slice(0, start) + out.slice(i);
    conditional.lastIndex = start;
  }
  return out;
}

/** True when cheerio cannot meaningfully evaluate the selector. */
function isUnsupportedSelector(selector) {
  return (
    // Progressive-enhancement rules. Themes ship <html class="no-js"> and swap
    // the class to "js" on load, so static markup always looks like the no-JS
    // case and these rules would hide content every real visitor sees.
    /(^|[\s.#\[])no-js(\b|[.\[])/.test(selector) ||
    selector.includes('::') ||
    /:(hover|focus|focus-within|focus-visible|active|target|checked|disabled|placeholder|before|after|root|host|where|is|not\()/i.test(selector) ||
    selector.includes('@') ||
    selector.length === 0
  );
}

/**
 * Approximate CSS specificity as a single comparable number.
 * Ids weigh most, then classes/attributes/pseudo-classes, then element names.
 * Enough to settle the cases that matter here, e.g. Dawn's
 * `.price .price__badge-sold-out` (two classes) beating a bare `.badge`.
 * @param {string} selector
 * @returns {number}
 */
function specificity(selector) {
  const ids = (selector.match(/#[\w-]+/g) || []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) || []).length;
  const elements = (selector.match(/(?:^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return ids * 10000 + classes * 100 + elements;
}

/**
 * Parse CSS into rules that hide content and rules that re-show it, each
 * carrying the specificity and source order a browser would use to resolve
 * the conflict.
 * @param {string} css - Concatenated stylesheet text
 * @returns {{hide: Array<{selector:string,spec:number,order:number,important:boolean}>, show: Array}}
 */
export function collectVisibilitySelectors(css) {
  const hide = [];
  const show = [];
  if (!css) return { hide, show };

  const flat = stripConditionalBlocks(css);
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  let order = 0;

  while ((m = rule.exec(flat)) !== null) {
    const selectorList = m[1];
    const body = m[2];
    order++;

    const display = /(?:^|[;{\s])display\s*:\s*([a-z-]+)/i.exec(body);
    const visibility = /(?:^|[;{\s])visibility\s*:\s*(hidden|collapse)/i.exec(body);
    // The standard visually-hidden recipe: collapsed to a 1px clipped box.
    const clipped =
      /clip\s*:\s*rect\(\s*0[\s,]/i.test(body) ||
      /clip-path\s*:\s*inset\(\s*50%\s*\)/i.test(body);

    const hides = (display && display[1].toLowerCase() === 'none') || visibility || clipped;
    const shows = display && display[1].toLowerCase() !== 'none';

    if (!hides && !shows) continue;

    const important = /!\s*important/i.test(body);

    for (const raw of selectorList.split(',')) {
      const selector = raw.trim();
      if (isUnsupportedSelector(selector) || NEVER_REMOVE.has(selector)) continue;
      const entry = { selector, spec: specificity(selector), order, important };
      if (hides) hide.push(entry);
      else show.push(entry);
    }
  }

  return { hide, show };
}

/**
 * True when rule `a` beats rule `b` in the cascade: !important first, then
 * specificity, then source order.
 */
function wins(a, b) {
  if (a.important !== b.important) return a.important;
  if (a.spec !== b.spec) return a.spec > b.spec;
  return a.order > b.order;
}

/** Elements whose contents a browser never renders as page text. */
const NON_RENDERED = 'script, style, noscript, template';

/**
 * Size of the content a browser would actually render inside an element.
 *
 * Script and style payloads must not count: on a commercial storefront they are
 * an order of magnitude larger than the visible copy, and including them in the
 * bulk-removal denominator made a wrapper holding the entire product section
 * look like a minor fragment of the page.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @param {*} el - Element, or a cheerio selection
 * @returns {{text: number, markup: number}} lengths in characters
 */
function renderedSize($, el) {
  const $clone = $(el).clone();
  $clone.find(NON_RENDERED).remove();
  return {
    text: $clone.text().replace(/\s+/g, ' ').trim().length,
    markup: ($clone.html() || '').length
  };
}

/** Gather the text of every inline <style> block in the document. */
export function inlineStyleText($) {
  const parts = [];
  $('style').each((_, el) => {
    const text = $(el).html();
    if (text) parts.push(text);
  });
  return parts.join('\n');
}

/**
 * Remove browser-invisible content from a cheerio document, in place.
 *
 * @param {import('cheerio').CheerioAPI} $ - Parsed document
 * @param {Object} [options]
 * @param {string} [options.css] - Extra stylesheet text (e.g. linked sheets)
 * @param {boolean} [options.useInlineStyles=true] - Honour inline <style> blocks
 * @param {number} [options.maxRemovalFraction=0.3] - Skip elements holding more
 *   than this share of the page text (JS-revealed wrappers)
 * @returns {{removed: number, skippedBulk: number}}
 */
export function stripHiddenFromDom($, options = {}) {
  const { css = '', useInlineStyles = true, maxRemovalFraction = MAX_REMOVAL_FRACTION } = options;
  let removed = 0;
  let skippedBulk = 0;

  // Genuinely invisible furniture is small: a badge, a label, a tooltip. An
  // element holding a large share of the page is a wrapper that JavaScript
  // reveals on load, and removing it would delete the page. Two real cases:
  // Shopify's EasyLockdown app ships the whole storefront inside
  // <div class="easylockdown-content" style="display:none">, and Next.js
  // App Router streams the rendered page inside <div id="S:0" hidden> before
  // moving it into place.
  //
  // Share is measured by markup as well as text, because the streamed Next.js
  // wrapper is only ~8% of the page's text but half its markup — the visible
  // copy is there while the remaining "text" is script payload.
  //
  // Both sides of the ratio count rendered content only. Measuring raw text
  // put ~58KB of inline script into the denominator on a Shopify storefront,
  // so the EasyLockdown wrapper — which held the whole product section,
  // price included — scored 0.27 against a 0.3 threshold and was deleted.
  const document = renderedSize($, 'body');
  const documentTextLength = document.text || 1;
  const documentMarkupLength = document.markup || 1;
  const guardApplies =
    documentTextLength >= MIN_TEXT_FOR_BULK_GUARD ||
    documentMarkupLength >= MIN_MARKUP_FOR_BULK_GUARD;

  const remove = (el) => {
    const $el = $(el);
    if (!$el.length || !$el.parent().length) return;
    if (guardApplies) {
      const size = renderedSize($, el);
      const textShare = size.text / documentTextLength;
      const markupShare = size.markup / documentMarkupLength;
      if (Math.max(textShare, markupShare) > maxRemovalFraction) {
        skippedBulk++;
        return;
      }
    }
    $el.remove();
    removed++;
  };

  // 1. The hidden attribute.
  $('[hidden]').each((_, el) => remove(el));

  // 2. Inline display:none / visibility:hidden.
  $('[style]').each((_, el) => {
    const style = ($(el).attr('style') || '').toLowerCase();
    if (/display\s*:\s*none/.test(style) || /visibility\s*:\s*(hidden|collapse)/.test(style)) {
      remove(el);
    }
  });

  // 3. Conventional screen-reader-only classes.
  for (const cls of SCREEN_READER_CLASSES) {
    $(`.${cls}`).each((_, el) => remove(el));
  }

  // 4. Rules from the page's own stylesheets.
  const sheetText = [useInlineStyles ? inlineStyleText($) : '', css].filter(Boolean).join('\n');
  if (sheetText) {
    const { hide, show } = collectVisibilitySelectors(sheetText);
    if (hide.length) {
      // Query each distinct selector once, keeping the strongest hide rule.
      const strongest = new Map();
      for (const rule of hide) {
        const prev = strongest.get(rule.selector);
        if (!prev || wins(rule, prev)) strongest.set(rule.selector, rule);
      }

      for (const rule of strongest.values()) {
        let matches;
        try {
          matches = $(rule.selector);
        } catch {
          continue; // selector cheerio cannot parse
        }
        matches.each((_, el) => {
          // Keep the element only when a re-showing rule actually wins the
          // cascade. A bare `.badge{display:inline-block}` must not override
          // `.price .price__badge-sold-out{display:none}`.
          const reshown = show.some(s => {
            if (!wins(s, rule)) return false;
            try { return $(el).is(s.selector); } catch { return false; }
          });
          if (!reshown) remove(el);
        });
      }
    }
  }

  return { removed, skippedBulk };
}

/**
 * Remove browser-invisible content from an HTML string.
 *
 * @param {string} html
 * @param {Object} [options] - Same options as stripHiddenFromDom
 * @returns {string} - HTML with hidden content removed
 */
export function stripHiddenHtml(html, options = {}) {
  if (!html) return html;
  try {
    const $ = load(html);
    stripHiddenFromDom($, options);
    return $.html();
  } catch {
    return html; // never let cleanup break the caller
  }
}
