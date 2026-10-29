/**
 * _brandingComputed.js — colour roles, buttons and type from the rendered page.
 *
 *   brandingProbe          runs in the browser and only COLLECTS computed
 *                          styles: the page background, body text, h1/h2, a
 *                          few links and the button-sized controls near the
 *                          top of the page. page.evaluate serializes it, so it
 *                          must not close over anything in this module.
 *   buildComputedBranding  decides, in Node where it can be tested, which
 *                          control is the primary button and what each role
 *                          is. Every value it returns is source:"computed".
 *   inferRoles             the fallback when no render ran: role guesses from
 *                          CSS variable names, marked source:"inferred".
 */

import { parseColor, toHex, chroma, luminance, distance } from './_brandingColor.js';

export function brandingProbe() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // Any computed colour (oklch, color(), lab) to rgba() through one canvas pixel.
  const rgba = (c) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillStyle = c || 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgba(${r},${g},${b},${Math.round((a / 255) * 1000) / 1000})`;
  };
  // The colour a reader sees is the fill of the element holding the text. On
  // a layered headline that is a child span, not the h1: stripe.com's h1
  // carries a decorative green while its first line is painted #061b31.
  const textColor = (el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    const holder = walker.nextNode()?.parentElement || el;
    const s = getComputedStyle(holder);
    return rgba(s.webkitTextFillColor || s.color);
  };
  const style = (el) => {
    const s = getComputedStyle(el);
    return {
      color: textColor(el),
      background: rgba(s.backgroundColor),
      borderColor: rgba(s.borderTopColor),
      borderWidth: s.borderTopWidth,
      borderStyle: s.borderTopStyle,
      borderRadius: s.borderTopLeftRadius,
      padding: `${s.paddingTop} ${s.paddingRight} ${s.paddingBottom} ${s.paddingLeft}`,
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      textTransform: s.textTransform,
      boxShadow: s.boxShadow,
    };
  };
  const OVERLAY = '[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[aria-modal="true"],dialog';
  // Painted, on the page and not a 1px screen-reader-only box (a "Skip to
  // content" link sits off-screen until focused).
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && r.right > 0 && r.bottom > 0 && s.visibility !== 'hidden' &&
      s.display !== 'none' && Number(s.opacity) > 0 && !el.closest(OVERLAY);
  };
  const text = (el) => (el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const find = (selector, ok = () => true) => {
    for (const el of document.querySelectorAll(selector)) if (shown(el) && ok(el)) return el;
    return null;
  };
  const describe = (el) => (el ? { tag: el.tagName.toLowerCase(), text: text(el), style: style(el) } : null);

  const collect = () => {
    const links = [];
    for (const el of document.querySelectorAll('p a, main a, a')) {
      if (links.length >= 6) break;
      if (shown(el) && text(el).length > 1) links.push(describe(el));
    }
    const buttons = [];
    const limit = window.innerHeight * 1.5;
    for (const el of document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]')) {
      if (buttons.length >= 40) break;
      const r = el.getBoundingClientRect();
      const t = text(el);
      if (r.top > limit || r.height < 24 || r.height > 96 || r.width < 40 || r.width > 480 || !t || t.length > 40) continue;
      if (!shown(el)) continue;
      buttons.push({
        ...describe(el),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        inHeader: Boolean(el.closest('header, nav')),
      });
    }
    return {
      url: location.href,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      background: { body: rgba(getComputedStyle(document.body).backgroundColor), html: rgba(getComputedStyle(document.documentElement).backgroundColor) },
      body: describe(document.body),
      heading: describe(find('h1')),
      h2: describe(find('h2')),
      // Body copy: a sentence-length paragraph at a reading size, so a large
      // lede set in a <p> is not taken for the body text.
      paragraph: describe(find('main p, article p, p', (el) => {
        const size = parseFloat(getComputedStyle(el).fontSize);
        return text(el).length >= 40 && size >= 14 && size <= 20;
      }) || find('main p, article p, p', (el) => text(el).length >= 40)),
      links,
      buttons,
    };
  };
  // Web fonts change the computed family only once loaded; wait at most 2s.
  return Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 2000))]).then(collect, collect);
}

const WHITE = { r: 255, g: 255, b: 255, a: 1 };
// Two colours closer than this read as the same to a reader.
const SAME = 24;

const opaque = (v) => {
  const c = parseColor(v);
  return c && c.a > 0.05 ? c : null;
};
const firstFamily = (stack) => (stack || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '') || null;

function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null && v !== '' && v !== 'none'));
}

/**
 * Colour roles, button components and type from a brandingProbe() result.
 * @param {object} probe
 * @returns {{ colorScheme: string, roles: object, components: object, typography: object }}
 */
export function buildComputedBranding(probe) {
  const pageBg = opaque(probe.background?.body) || opaque(probe.background?.html) || WHITE;
  const filled = (s) => {
    const bg = opaque(s.background);
    return Boolean(bg && distance(bg, pageBg) > SAME);
  };
  const outlined = (s) => {
    const border = opaque(s.borderColor);
    return parseFloat(s.borderWidth) >= 1 && s.borderStyle !== 'none' && Boolean(border && distance(border, pageBg) > SAME);
  };

  const roles = {};
  const role = (name, c, evidence) => {
    if (c) roles[name] = { value: toHex(c), source: 'computed', evidence };
  };
  role('background', pageBg, 'page background');
  const textEl = probe.paragraph || probe.body;
  role('text', textEl && opaque(textEl.style.color), probe.paragraph ? 'body paragraph' : 'body');
  role('heading', probe.heading && opaque(probe.heading.style.color), 'h1');
  const link = (probe.links || []).find((l) => !filled(l.style) && !outlined(l.style));
  role('link', link && opaque(link.style.color), link && `link "${link.text}"`);

  // The primary button is the filled control with the most visual weight:
  // area, boosted by saturation so a brand-coloured CTA beats a grey one.
  const buttons = (probe.buttons || []).map((b, i) => ({ ...b, i, bg: opaque(b.style.background) }));
  const filledButtons = buttons.filter((b) => filled(b.style));
  const weight = (b) => b.rect.w * b.rect.h * (1 + 2 * chroma(b.bg));
  const primary = [...filledButtons].sort((x, y) => weight(y) - weight(x) || x.i - y.i)[0] || null;
  // The secondary is the outline button nearest the primary and in the same
  // band (160px vertically), which keeps it in the CTA pair: linear.app has
  // no partner for its header CTA, and its nearest outline is an "iOS" pill.
  const gap = (b) => Math.hypot(b.rect.x - primary.rect.x, b.rect.y - primary.rect.y);
  const near = (b) => b !== primary && Math.abs(b.rect.y - primary.rect.y) <= 160;
  const secondary = primary
    ? buttons.filter((b) => near(b) && !filled(b.style) && outlined(b.style)).sort((x, y) => gap(x) - gap(y))[0] ||
      filledButtons.find((b) => near(b) && distance(b.bg, primary.bg) > SAME) ||
      null
    : null;
  if (primary) {
    role('primary', primary.bg, `button "${primary.text}"`);
    role('onPrimary', opaque(primary.style.color), `label of button "${primary.text}"`);
  }

  const component = (b) => compact({
    text: b.text,
    background: filled(b.style) ? toHex(b.bg) : null,
    color: opaque(b.style.color) ? toHex(opaque(b.style.color)) : null,
    borderColor: outlined(b.style) ? toHex(opaque(b.style.borderColor)) : null,
    borderWidth: outlined(b.style) ? b.style.borderWidth : null,
    // A pill computes to whatever its huge radius was (calc(infinity * 1px) is 3.35544e+07px).
    borderRadius: b.style.borderRadius === '0px' ? null : parseFloat(b.style.borderRadius) >= 9999 ? '9999px' : b.style.borderRadius,
    padding: b.style.padding,
    fontFamily: firstFamily(b.style.fontFamily),
    fontSize: b.style.fontSize,
    fontWeight: b.style.fontWeight,
    textTransform: b.style.textTransform,
    boxShadow: b.style.boxShadow,
    source: 'computed',
  });
  const components = {};
  if (primary) components.buttonPrimary = component(primary);
  if (secondary) components.buttonSecondary = component(secondary);

  const type = (el) => el && compact({
    fontFamily: firstFamily(el.style.fontFamily),
    fontStack: el.style.fontFamily,
    fontSize: el.style.fontSize,
    fontWeight: el.style.fontWeight,
    lineHeight: el.style.lineHeight,
    letterSpacing: el.style.letterSpacing === 'normal' ? null : el.style.letterSpacing,
    color: opaque(el.style.color) ? toHex(opaque(el.style.color)) : null,
    source: 'computed',
  });
  const typography = compact({ body: type(textEl), h1: type(probe.heading), h2: type(probe.h2) });

  return {
    colorScheme: schemeOf(toHex(pageBg)),
    roles,
    components,
    typography,
  };
}

/**
 * Role guesses from CSS variable names, for when the page was not rendered.
 * A name must end in the role word (optionally -default/-primary/-base), so
 * --color-background counts and --input-bg-hover does not.
 * @param {Record<string, string|null>} resolved - '--name' -> resolved value
 * @param {Array<{value: string, source: string}>} colors - the frequency list
 */
export function inferRoles(resolved, colors = []) {
  const roles = {};
  const pick = (re, ok = () => true) => {
    for (const [name, value] of Object.entries(resolved)) {
      if (value == null || !re.test(name)) continue;
      const c = parseColor(value);
      if (c && c.a > 0.5 && ok(c)) return { value: toHex(c), source: 'inferred', evidence: `CSS variable ${name}` };
    }
    return null;
  };
  const end = (words) => new RegExp(`(?:^--|-)(?:${words})(?:-(?:default|primary|base|500|600))?$`, 'i');
  const saturated = (c) => chroma(c) >= 0.25;

  const fromList = (source, evidence) => {
    const hit = colors.find((c) => c.source === source && saturated(parseColor(c.value)));
    return hit ? { value: hit.value, source: 'inferred', evidence } : null;
  };
  const primary = pick(end('primary|brand|accent'), saturated) ||
    fromList('theme-color', 'meta theme-color') ||
    fromList('css-var', 'most frequent saturated colour in brand-named CSS variables');
  const background = pick(end('background|bg|surface'));
  const text = pick(end('foreground|fg|text'));
  const link = pick(end('link'));

  if (background) roles.background = background;
  if (text) roles.text = text;
  if (link) roles.link = link;
  if (primary) roles.primary = primary;
  return roles;
}

/** 'light' or 'dark' from a background role, or null without one. */
export function schemeOf(backgroundHex) {
  const c = parseColor(backgroundHex);
  return c ? (luminance(c) < 0.4 ? 'dark' : 'light') : null;
}
