/**
 * _brandingExtractor.js — design-token / branding extraction.
 *
 * Extracts a site's visual identity from HTML + CSS:
 *   - colors      (CSS custom properties, theme-color, declarations) -> hex + frequency
 *   - fonts       (font-family, @font-face, Google/Adobe webfont links)
 *   - logo        (favicons, og:image, header img/svg candidates)
 *   - tokens      (CSS custom properties, var() chains resolved, grouped; _brandingTokens.js)
 *   - roles       (background, text, heading, link, primary) plus button
 *                 components and type, from a rendered page's computed styles
 *                 when the caller passes a probe result (_brandingComputed.js),
 *                 otherwise guessed from variable names and marked "inferred"
 *
 * Without a probe result, JS-injected CSS is not visible. Linked CSS is
 * fetched through the SSRF guard, capped in count/size/time.
 *
 * Every helper is defensive: failures push to `warnings` and never throw.
 */

import { safeFetch } from '../../utils/ssrfGuard.js';
import { mediaAppliesToScreen } from '../../utils/hiddenContent.js';
import { parseColor, toHex } from './_brandingColor.js';
import { resolveValue, groupTokens, toDtcg } from './_brandingTokens.js';
import { buildComputedBranding, inferRoles, schemeOf } from './_brandingComputed.js';

const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'inherit',
  'initial', 'unset', 'revert', 'emoji', 'math', 'fangsong',
]);

// CSS variable names that strongly indicate brand colors.
const BRAND_VAR_RE = /(primary|secondary|brand|accent|theme|background|surface|foreground|text|link)/i;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Normalize a CSS color token to lowercase #rrggbb (drops alpha). Returns null
 * for values we can't confidently parse (gradients, currentColor, var(), etc.).
 */
export function normalizeColor(raw) {
  const c = parseColor(raw);
  return c ? toHex(c) : null;
}

function resolveUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/**
 * Gather raw CSS text from <style> blocks, inline style="" attributes, and
 * (optionally) linked stylesheets.
 */
export async function collectCssSources($, pageUrl, opts) {
  const warnings = [];
  const fetchedUrls = [];
  let styleBlocks = 0;
  let inlineStyleEls = 0;
  let cssText = '';

  // Print (and other non-screen) stylesheets never paint a screen render, so
  // neither branding nor the hidden-content pass may read them. `media:
  // 'unconditional-screen'` also drops sheets gated on a media query.
  const unconditional = opts.media === 'unconditional-screen';
  const applies = (el) => mediaAppliesToScreen($(el).attr('media'), { unconditional });

  $('style').each((_, el) => {
    if (!applies(el)) return;
    const t = $(el).html();
    if (t) { cssText += '\n' + t; styleBlocks++; }
  });

  // Inline style="" attributes are folded in as universal rules so branding
  // can mine their colours and fonts. They are NOT visibility rules: one
  // element carrying style="display:none" became `*{display:none}`, and the
  // hidden-content pass then deleted every element small enough to pass its
  // bulk guard — irs.gov's tax-bracket page came back as its header (R21,
  // 2026-09-09). That pass reads inline styles per element itself, so it
  // asks for `inlineStyles: false`.
  if (opts.inlineStyles !== false) {
    $('[style]').each((_, el) => {
      const t = $(el).attr('style');
      if (t) { cssText += '\n*{' + t + '}'; inlineStyleEls++; }
    });
  }

  if (opts.fetchLinkedCss) {
    const hrefs = [];
    $('link[rel~="stylesheet"][href]').each((_, el) => {
      if (!applies(el)) return;
      const href = $(el).attr('href');
      if (href) hrefs.push(resolveUrl(href, pageUrl));
    });
    const max = clamp(opts.maxStylesheets ?? 10, 0, 20);
    const targets = hrefs.slice(0, max);
    const perFileTimeoutMs = opts.perFileTimeoutMs ?? 8000;
    // Single wall-clock budget for ALL stylesheets combined, not just each
    // one individually — otherwise maxStylesheets slow/unresponsive hosts in
    // series can still block for maxStylesheets * perFileTimeoutMs (up to
    // ~160s at the schema max of 20). Capped to whatever the caller's overall
    // timeoutMs allows, defaulting to 10s.
    const overallTimeoutMs = opts.timeoutMs != null
      ? Math.min(opts.timeoutMs, 10000)
      : (opts.overallTimeoutMs ?? 10000);
    const deadline = Date.now() + overallTimeoutMs;

    // Small worker pool fetches stylesheets concurrently instead of one at a
    // time; results are written back by index so cssText concatenation order
    // stays deterministic regardless of completion order.
    const concurrency = clamp(opts.stylesheetConcurrency ?? 4, 1, Math.max(targets.length, 1));
    const results = new Array(targets.length);
    let cursor = 0;

    async function worker() {
      while (true) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return; // overall deadline hit — leave rest unfetched
        const i = cursor++;
        if (i >= targets.length) return;
        const href = targets[i];
        try {
          const res = await safeFetch(href, { signal: AbortSignal.timeout(Math.min(perFileTimeoutMs, remaining)) });
          if (!res.ok) { results[i] = { warning: `branding: stylesheet ${res.status} ${href}` }; continue; }
          let text = await res.text();
          if (text.length > 512 * 1024) text = text.slice(0, 512 * 1024); // size cap
          results[i] = { text, href };
        } catch (err) {
          results[i] = { warning: `branding: could not fetch stylesheet ${href} — ${err.message}` };
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    let skippedByDeadline = 0;
    for (let i = 0; i < targets.length; i++) {
      const r = results[i];
      if (!r) { skippedByDeadline++; continue; }
      if (r.warning) { warnings.push(r.warning); continue; }
      cssText += '\n' + r.text;
      fetchedUrls.push(r.href);
    }

    if (hrefs.length > max) warnings.push(`branding: ${hrefs.length - max} stylesheet(s) skipped (maxStylesheets=${max})`);
    if (skippedByDeadline > 0) warnings.push(`branding: ${skippedByDeadline} stylesheet(s) skipped — overall CSS fetch deadline (${overallTimeoutMs}ms) exceeded`);
  }

  return { cssText, fetchedUrls, styleBlocks, inlineStyleEls, warnings };
}

function extractCssVariables(cssText) {
  const vars = {};
  const re = /--([\w-]+)\s*:\s*([^;}]+)[;}]/g;
  let m;
  while ((m = re.exec(cssText)) !== null) {
    const name = m[1].trim();
    const value = m[2].trim();
    if (name && value && !(name in vars)) vars['--' + name] = value;
  }
  return vars;
}

function extractColors(cssText, $, cssVariables) {
  const counts = new Map(); // hex -> { count, sources:Set }
  const add = (hex, source) => {
    if (!hex) return;
    const cur = counts.get(hex) || { count: 0, sources: new Set() };
    cur.count++;
    cur.sources.add(source);
    counts.set(hex, cur);
  };

  // meta theme colors (high confidence)
  const themeColor = $('meta[name="theme-color"]').attr('content');
  if (themeColor) add(normalizeColor(themeColor), 'theme-color');
  const tileColor = $('meta[name="msapplication-TileColor"]').attr('content');
  if (tileColor) add(normalizeColor(tileColor), 'theme-color');

  // brand-ish CSS variables (high confidence)
  for (const [name, value] of Object.entries(cssVariables)) {
    if (BRAND_VAR_RE.test(name)) {
      const hex = normalizeColor(resolveValue(value, cssVariables, new Set([name])));
      if (hex) add(hex, 'css-var');
    }
  }

  // color values in declarations
  const colorProp = /(?:color|background(?:-color)?|border(?:-[a-z]+)?-color|fill|stroke|outline-color)\s*:\s*([^;}!]+)/gi;
  let m;
  while ((m = colorProp.exec(cssText)) !== null) {
    const raw = m[1].trim();
    const hex = normalizeColor(raw);
    if (hex) add(hex, 'declaration');
  }
  // also catch standalone hex/rgb/hsl tokens
  const token = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\)/g;
  while ((m = token.exec(cssText)) !== null) {
    const hex = normalizeColor(m[0]);
    if (hex) add(hex, 'declaration');
  }

  const rank = { 'css-var': 0, 'theme-color': 1, 'declaration': 2 };
  return [...counts.entries()]
    .map(([value, info]) => ({
      value,
      count: info.count,
      source: [...info.sources].sort((a, b) => rank[a] - rank[b])[0],
    }))
    .sort((a, b) => rank[a.source] - rank[b.source] || b.count - a.count)
    .slice(0, 24);
}

// Splits a CSS value on commas that are not inside parentheses, so a
// `var(--x, sans-serif)` reference survives as one entry instead of being cut in half.
function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

// Resolves a `var(--x)` / `var(--x, fallback)` entry against the collected variables,
// returning the family names it stands for. An unresolvable reference yields nothing
// rather than leaking `var(` text into the font list.
function resolveVarRef(entry, cssVariables, seen) {
  const m = entry.match(/^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/);
  if (!m) return [entry];
  const name = m[1];
  const fallback = m[2];
  if (!seen.has(name)) {
    seen.add(name);
    const value = cssVariables[name];
    if (value) return splitTopLevel(value).flatMap((v) => resolveVarRef(v, cssVariables, seen));
  }
  return fallback ? splitTopLevel(fallback).flatMap((v) => resolveVarRef(v, cssVariables, seen)) : [];
}

function extractFonts(cssText, $, cssVariables) {
  const families = new Map();
  const generics = new Set();
  const fontFaces = [];

  const ffRe = /font-family\s*:\s*([^;}{]+)/gi;
  let m;
  while ((m = ffRe.exec(cssText)) !== null) {
    const list = splitTopLevel(m[1])
      .flatMap((f) => resolveVarRef(f, cssVariables, new Set()))
      .map((f) => f.trim().replace(/^['"]|['"]$/g, ''))
      .filter((f) => f && !f.includes('var('));
    for (const f of list) {
      const lf = f.toLowerCase();
      if (GENERIC_FAMILIES.has(lf)) { generics.add(lf); continue; }
      families.set(f, (families.get(f) || 0) + 1);
    }
  }

  const faceRe = /@font-face\s*\{([^}]*)\}/gi;
  while ((m = faceRe.exec(cssText)) !== null) {
    const block = m[1];
    const fam = (block.match(/font-family\s*:\s*([^;]+)/i) || [])[1];
    const src = (block.match(/src\s*:\s*([^;]+)/i) || [])[1];
    if (fam) fontFaces.push({ family: fam.trim().replace(/^['"]|['"]$/g, ''), src: src ? src.trim().slice(0, 300) : null });
  }

  // webfont providers
  const providers = new Set();
  $('link[href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"]').each((_, el) => {
    providers.add('google-fonts');
    const href = $(el).attr('href') || '';
    const fam = href.match(/[?&]family=([^&]+)/);
    if (fam) {
      decodeURIComponent(fam[1]).split('|').forEach((entry) => {
        const name = entry.split(':')[0].replace(/\+/g, ' ').trim();
        if (name && !GENERIC_FAMILIES.has(name.toLowerCase())) families.set(name, (families.get(name) || 0) + 1);
      });
    }
  });
  $('link[href*="use.typekit"], link[href*="typekit.net"]').each(() => providers.add('adobe-fonts'));

  return {
    fonts: [...families.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([family, count]) => ({ family, count })),
    genericFallbacks: [...generics],
    webfontProviders: [...providers],
    fontFaces: fontFaces.slice(0, 12),
  };
}

function extractLogo($, pageUrl) {
  const favicons = [];
  $('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) favicons.push({ href: resolveUrl(href, pageUrl), rel: $(el).attr('rel') || null, sizes: $(el).attr('sizes') || null, type: $(el).attr('type') || null });
  });

  const ogImage = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || null;

  const candidates = [];
  const pushImg = (el, where) => {
    const src = $(el).attr('src') || $(el).attr('data-src');
    if (src) candidates.push({ src: resolveUrl(src, pageUrl), alt: $(el).attr('alt') || null, where });
  };
  $('header img, a[href="/"] img, img[alt*="logo" i], img[class*="logo" i], [class*="logo" i] img').each((_, el) => pushImg(el, 'logo-candidate'));
  const headerSvg = $('header svg').first();
  let inlineSvg = null;
  if (headerSvg.length) {
    try { inlineSvg = $.html(headerSvg).slice(0, 2000); } catch { /* ignore */ }
  }

  // de-dup candidates by src
  const seen = new Set();
  const deduped = candidates.filter((c) => (seen.has(c.src) ? false : seen.add(c.src)));

  return {
    favicons: favicons.slice(0, 8),
    ogImage: ogImage ? resolveUrl(ogImage, pageUrl) : null,
    candidates: deduped.slice(0, 8),
    inlineHeaderSvg: inlineSvg,
  };
}

function extractTokens(cssText, cssVariables) {
  // Declarations that reference a variable count under the value it resolves to.
  const collect = (re) => {
    const counts = new Map();
    let m;
    while ((m = re.exec(cssText)) !== null) {
      const v = resolveValue(m[1].replace(/!important/i, '').trim(), cssVariables);
      if (v && !v.includes('var(')) counts.set(v, (counts.get(v) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([value, count]) => ({ value, count }));
  };

  return {
    radii: collect(/border-radius\s*:\s*([^;}{]+)/gi),
    shadows: collect(/box-shadow\s*:\s*([^;}{]+)/gi),
  };
}

// What each `source` value in the result means, returned with it so a reader
// of the output can audit any value without this file.
const PROVENANCE = {
  computed: 'read from the rendered page with getComputedStyle',
  'css-variable': 'a CSS custom property, var() references resolved',
  'css-var': 'counted in brand-named CSS custom properties',
  'theme-color': 'the page\'s theme-color meta tag',
  declaration: 'counted in CSS declarations',
  inferred: 'a guess from CSS variable names; no rendered element confirmed it',
};

/**
 * Extract the full branding object from a loaded cheerio $.
 * @param {import('cheerio').CheerioAPI} $
 * @param {string} pageUrl
 * @param {{ fetchLinkedCss?: boolean, maxStylesheets?: number, perFileTimeoutMs?: number, timeoutMs?: number, overallTimeoutMs?: number, stylesheetConcurrency?: number, media?: 'screen'|'unconditional-screen', inlineStyles?: boolean, computed?: object|null, rawVariables?: boolean, dtcg?: boolean }} [opts]
 *   `computed` is a brandingProbe() result from a render of the same page.
 * @returns {Promise<object>}
 */
export async function extractBranding($, pageUrl, opts = {}) {
  const options = { fetchLinkedCss: true, maxStylesheets: 10, perFileTimeoutMs: 8000, ...opts };
  const warnings = [];

  let sources = { cssText: '', fetchedUrls: [], styleBlocks: 0, inlineStyleEls: 0, warnings: [] };
  try {
    sources = await collectCssSources($, pageUrl, options);
    warnings.push(...sources.warnings);
  } catch (err) {
    warnings.push(`branding: CSS collection failed — ${err.message}`);
  }

  const safe = (fn, fallback, label) => {
    try { return fn(); } catch (err) { warnings.push(`branding: ${label} failed — ${err.message}`); return fallback; }
  };

  const cssVariables = safe(() => extractCssVariables(sources.cssText), {}, 'css-variables');
  const colors = safe(() => extractColors(sources.cssText, $, cssVariables), [], 'colors');
  const fontInfo = safe(() => extractFonts(sources.cssText, $, cssVariables), { fonts: [], genericFallbacks: [], webfontProviders: [], fontFaces: [] }, 'fonts');
  const logo = safe(() => extractLogo($, pageUrl), { favicons: [], ogImage: null, candidates: [], inlineHeaderSvg: null }, 'logo');
  const declTokens = safe(() => extractTokens(sources.cssText, cssVariables), { radii: [], shadows: [] }, 'tokens');
  const tokens = safe(() => groupTokens(cssVariables), null, 'token grouping');

  const computed = options.computed ? safe(() => buildComputedBranding(options.computed), null, 'computed styles') : null;
  const resolved = safe(() => Object.fromEntries(Object.entries(cssVariables).map(([k, v]) => [k, resolveValue(v, cssVariables, new Set([k]))])), {}, 'variable resolution');
  // Computed roles win; an inferred guess fills only a role no element showed.
  const roles = { ...(computed?.roles || {}) };
  for (const [name, guess] of Object.entries(safe(() => inferRoles(resolved, colors), {}, 'role inference'))) {
    if (!roles[name]) roles[name] = guess;
  }

  const result = {
    colorScheme: computed?.colorScheme || schemeOf(roles.background?.value) || undefined,
    roles,
    components: computed?.components || {},
    typography: computed?.typography || {},
    fonts: fontInfo.fonts,
    genericFallbacks: fontInfo.genericFallbacks,
    webfontProviders: fontInfo.webfontProviders,
    fontFaces: fontInfo.fontFaces,
    logo,
    colors,
    tokens: tokens ? { source: 'css-variable', ...tokens } : undefined,
    radii: declTokens.radii,
    shadows: declTokens.shadows,
  };
  if (options.rawVariables) result.cssVariables = cssVariables;
  if (options.dtcg && tokens) {
    result.dtcg = safe(() => toDtcg({ tokens, roles, fonts: fontInfo.fonts, url: pageUrl }), undefined, 'dtcg');
  }

  return {
    ...result,
    sources: {
      styleBlocks: sources.styleBlocks,
      inlineStyleEls: sources.inlineStyleEls,
      linkedStylesheetsFetched: sources.fetchedUrls,
      rendered: Boolean(computed),
    },
    provenance: PROVENANCE,
    notes: [
      computed
        ? 'Roles, components and typography were read from the rendered page (source "computed"); tokens come from CSS custom properties with var() references resolved.'
        : 'Not rendered: roles marked "inferred" are guesses from CSS variable names, and components and typography are empty. JS-injected styles are not reflected.',
      ...(options.rawVariables ? [] : ['cssVariables (every custom property as found) is left out; pass brandingOptions.rawVariables:true to include it.']),
    ],
    warnings: warnings.length ? warnings : undefined,
  };
}

export default extractBranding;
