/**
 * _brandingExtractor.js — static design-token / branding extraction.
 *
 * Extracts a site's visual identity from HTML + CSS WITHOUT a browser:
 *   - colors      (CSS custom properties, theme-color, declarations) -> hex + frequency
 *   - fonts       (font-family, @font-face, Google/Adobe webfont links)
 *   - logo        (favicons, og:image, header img/svg candidates)
 *   - tokens      (border-radius, box-shadow, spacing custom props)
 *
 * Static-only limits (documented in the returned `notes`): computed/cascaded
 * styles and JS-injected CSS are not visible without rendering. Linked CSS is
 * fetched through the SSRF guard, capped in count/size/time.
 *
 * Every helper is defensive: failures push to `warnings` and never throw.
 */

import { safeFetch } from '../../utils/ssrfGuard.js';

const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'inherit',
  'initial', 'unset', 'revert', 'emoji', 'math', 'fangsong',
]);

const NAMED_COLORS = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000',
  blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500', purple: '#800080',
  gray: '#808080', grey: '#808080', silver: '#c0c0c0', navy: '#000080',
  teal: '#008080', maroon: '#800000', olive: '#808000', lime: '#00ff00',
  aqua: '#00ffff', fuchsia: '#ff00ff',
};

// CSS variable names that strongly indicate brand colors.
const BRAND_VAR_RE = /(primary|secondary|brand|accent|theme|background|surface|foreground|text|link)/i;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function toHex2(n) {
  return clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
}

/**
 * Normalize a CSS color token to lowercase #rrggbb (drops alpha). Returns null
 * for values we can't confidently parse (gradients, currentColor, var(), etc.).
 */
export function normalizeColor(raw) {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase();

  if (NAMED_COLORS[v]) return NAMED_COLORS[v];

  // hex
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    const h = m[1];
    if (h.length === 3) return '#' + h.split('').map((c) => c + c).join('');
    if (h.length === 4) return '#' + h.slice(0, 3).split('').map((c) => c + c).join('');
    if (h.length === 6) return '#' + h;
    if (h.length === 8) return '#' + h.slice(0, 6);
    return null;
  }

  // rgb()/rgba()
  m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[,/\s]+/).filter(Boolean);
    if (parts.length >= 3) {
      const [r, g, b] = parts;
      const pn = (x) => (x.endsWith('%') ? (parseFloat(x) / 100) * 255 : parseFloat(x));
      const rr = pn(r), gg = pn(g), bb = pn(b);
      if ([rr, gg, bb].every((x) => !Number.isNaN(x))) return '#' + toHex2(rr) + toHex2(gg) + toHex2(bb);
    }
    return null;
  }

  // hsl()/hsla()
  m = v.match(/^hsla?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[,/\s]+/).filter(Boolean);
    if (parts.length >= 3) {
      const h = parseFloat(parts[0]);
      const s = parseFloat(parts[1]) / 100;
      const l = parseFloat(parts[2]) / 100;
      if (![h, s, l].some((x) => Number.isNaN(x))) {
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const mm = l - c / 2;
        let r = 0, g = 0, b = 0;
        const hh = ((h % 360) + 360) % 360;
        if (hh < 60) [r, g, b] = [c, x, 0];
        else if (hh < 120) [r, g, b] = [x, c, 0];
        else if (hh < 180) [r, g, b] = [0, c, x];
        else if (hh < 240) [r, g, b] = [0, x, c];
        else if (hh < 300) [r, g, b] = [x, 0, c];
        else [r, g, b] = [c, 0, x];
        return '#' + toHex2((r + mm) * 255) + toHex2((g + mm) * 255) + toHex2((b + mm) * 255);
      }
    }
    return null;
  }

  return null;
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
async function collectCssSources($, pageUrl, opts) {
  const warnings = [];
  const fetchedUrls = [];
  let styleBlocks = 0;
  let inlineStyleEls = 0;
  let cssText = '';

  $('style').each((_, el) => {
    const t = $(el).html();
    if (t) { cssText += '\n' + t; styleBlocks++; }
  });

  $('[style]').each((_, el) => {
    const t = $(el).attr('style');
    if (t) { cssText += '\n*{' + t + '}'; inlineStyleEls++; }
  });

  if (opts.fetchLinkedCss) {
    const hrefs = [];
    $('link[rel~="stylesheet"][href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) hrefs.push(resolveUrl(href, pageUrl));
    });
    const max = clamp(opts.maxStylesheets ?? 10, 0, 20);
    for (const href of hrefs.slice(0, max)) {
      try {
        const res = await safeFetch(href, { signal: AbortSignal.timeout(opts.perFileTimeoutMs ?? 8000) });
        if (!res.ok) { warnings.push(`branding: stylesheet ${res.status} ${href}`); continue; }
        let text = await res.text();
        if (text.length > 512 * 1024) text = text.slice(0, 512 * 1024); // size cap
        cssText += '\n' + text;
        fetchedUrls.push(href);
      } catch (err) {
        warnings.push(`branding: could not fetch stylesheet ${href} — ${err.message}`);
      }
    }
    if (hrefs.length > max) warnings.push(`branding: ${hrefs.length - max} stylesheet(s) skipped (maxStylesheets=${max})`);
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
      const hex = normalizeColor(value);
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

function extractFonts(cssText, $) {
  const families = new Map();
  const generics = new Set();
  const fontFaces = [];

  const ffRe = /font-family\s*:\s*([^;}{]+)/gi;
  let m;
  while ((m = ffRe.exec(cssText)) !== null) {
    const list = m[1].split(',').map((f) => f.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
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
  const collect = (re) => {
    const counts = new Map();
    let m;
    while ((m = re.exec(cssText)) !== null) {
      const v = m[1].trim();
      if (v && !v.includes('var(')) counts.set(v, (counts.get(v) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([value, count]) => ({ value, count }));
  };

  const spacing = {};
  for (const [name, value] of Object.entries(cssVariables)) {
    if (/(space|spacing|gap|radius|size)/i.test(name)) spacing[name] = value;
  }

  return {
    radii: collect(/border-radius\s*:\s*([^;}{]+)/gi),
    shadows: collect(/box-shadow\s*:\s*([^;}{]+)/gi),
    spacingVariables: spacing,
  };
}

/**
 * Extract the full branding object from a loaded cheerio $.
 * @param {import('cheerio').CheerioAPI} $
 * @param {string} pageUrl
 * @param {{ fetchLinkedCss?: boolean, maxStylesheets?: number, perFileTimeoutMs?: number }} [opts]
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
  const fontInfo = safe(() => extractFonts(sources.cssText, $), { fonts: [], genericFallbacks: [], webfontProviders: [], fontFaces: [] }, 'fonts');
  const logo = safe(() => extractLogo($, pageUrl), { favicons: [], ogImage: null, candidates: [], inlineHeaderSvg: null }, 'logo');
  const tokens = safe(() => extractTokens(sources.cssText, cssVariables), { radii: [], shadows: [], spacingVariables: {} }, 'tokens');

  return {
    colors,
    fonts: fontInfo.fonts,
    genericFallbacks: fontInfo.genericFallbacks,
    webfontProviders: fontInfo.webfontProviders,
    fontFaces: fontInfo.fontFaces,
    logo,
    cssVariables,
    radii: tokens.radii,
    shadows: tokens.shadows,
    spacing: tokens.spacingVariables,
    sources: {
      styleBlocks: sources.styleBlocks,
      inlineStyleEls: sources.inlineStyleEls,
      linkedStylesheetsFetched: sources.fetchedUrls,
    },
    notes: [
      'Static extraction from HTML + linked/inline CSS. Computed/cascaded colors and JS-injected styles require browser rendering and are not reflected here.',
    ],
    warnings: warnings.length ? warnings : undefined,
  };
}

export default extractBranding;
