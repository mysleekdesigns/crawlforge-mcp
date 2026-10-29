/**
 * _brandingTokens.js — design tokens from a page's CSS custom properties.
 *
 *   resolveValue   follows var() chains (with fallbacks) to a literal value
 *   groupTokens    sorts the resolved variables into colour ramps, semantic
 *                  colours, type, spacing, radius and shadow, drops what is
 *                  not a design token (layout state such as --bar-index), and
 *                  caps each group so a design-system site stays readable
 *   toDtcg         writes the groups as W3C Design Tokens (DTCG 2025.10) JSON
 *
 * stats in the grouped result say how many variables each step dropped, so a
 * caller can tell a small design system from a capped one.
 */

import { parseColor, toHex, toHexAlpha } from './_brandingColor.js';

const MAX_DEPTH = 16;

const CAPS = { ramps: 24, steps: 24, semantic: 40, typography: 32, spacing: 40, radius: 16, shadow: 16 };

// Names that say a variable is page or animation state, not a design token.
const NOISE_RE = /(index|total|count|scale|aspect|ratio|progress|duration|delay|ease|opacity|columns?|rows?|translate|rotate|angle|fallback|graphic|z-)/i;
const TYPE_NAME_RE = /(font|text|heading|display|body|leading|tracking|letter-?spacing|line-?height|weight|typo)/i;
const SPACE_NAME_RE = /(space|spacing|gap|gutter|padding|margin|inset|stack)/i;
// Semantic colours whose names say what they are for are kept first.
const ROLE_NAME_RE = /(primary|secondary|brand|accent|background|surface|foreground|text|link|border)/i;

const LENGTH_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em)$|^0$/;
const NUMBER_RE = /^-?(?:\d+\.?\d*|\.\d+)$/;

const TYPE_PROPS = [
  [/-?-(?:font-?)?size$/, 'size'],
  [/-?-(?:line-?height|leading)$/, 'lineHeight'],
  [/-?-(?:font-?)?weight$/, 'weight'],
  [/-?-(?:letter-?spacing|tracking)$/, 'letterSpacing'],
  [/-?-(?:font-?)?family$/, 'family'],
];

// Split on commas (or on whitespace, when `ws`) that are outside parentheses.
function splitTopLevel(value, ws = false) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ws ? /\s/.test(ch) : ch === ',')) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

// The first var( reference at or after `from`, with its balanced inner text.
function findVar(value, from) {
  const start = value.indexOf('var(', from);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start + 3; i < value.length; i++) {
    if (value[i] === '(') depth++;
    else if (value[i] === ')' && --depth === 0) return { start, end: i + 1, inner: value.slice(start + 4, i) };
  }
  return null;
}

/**
 * Replace every var() in `value` with what it resolves to. Returns null when
 * a reference has neither a definition nor a fallback, or the chain cycles.
 * @param {string} value
 * @param {Record<string, string>} vars - '--name' -> raw value
 */
export function resolveValue(value, vars, seen = new Set(), depth = 0) {
  if (typeof value !== 'string' || depth > MAX_DEPTH) return null;
  let out = '';
  let cursor = 0;
  let ref;
  while ((ref = findVar(value, cursor))) {
    out += value.slice(cursor, ref.start);
    const comma = ref.inner.indexOf(',');
    const name = (comma < 0 ? ref.inner : ref.inner.slice(0, comma)).trim();
    const fallback = comma < 0 ? '' : ref.inner.slice(comma + 1).trim();
    let resolved = null;
    if (!seen.has(name) && vars[name] != null) {
      resolved = resolveValue(vars[name], vars, new Set([...seen, name]), depth + 1);
    }
    if (resolved == null && fallback) resolved = resolveValue(fallback, vars, seen, depth + 1);
    if (resolved == null) return null;
    out += resolved;
    cursor = ref.end;
  }
  return (out + value.slice(cursor)).replace(/\s+/g, ' ').trim();
}

const isLength = (v) => LENGTH_RE.test(v);
const isLengthList = (v) => v.split(/\s+/).every(isLength);
const isFontList = (name, v) => /(font|family)/i.test(name) && /[a-z]/i.test(v) && !isLength(v) && !NUMBER_RE.test(v) && !/[(){}]/.test(v);

function classify(name, value) {
  if (/shadow|elevation/i.test(name)) return value !== 'none' && /\d/.test(value) ? 'shadow' : null;
  if (/radius|rounded|corner/i.test(name)) return isLengthList(value) ? 'radius' : null;
  if (parseColor(value)) return 'color';
  if (NOISE_RE.test(name)) return null;
  if (TYPE_NAME_RE.test(name) && (isLength(value) || NUMBER_RE.test(value) || isFontList(name, value))) return 'typography';
  if (SPACE_NAME_RE.test(name) && isLength(value)) return 'spacing';
  return null;
}

// A type variable's group (stem) and which property of it the value sets.
function typeProp(name, value) {
  const lower = name.toLowerCase();
  for (const [re, prop] of TYPE_PROPS) {
    const m = lower.match(re);
    if (m) return { stem: name.slice(0, m.index).replace(/-+$/, ''), prop };
  }
  let prop = null;
  if (isFontList(name, value)) prop = 'family';
  else if (/weight/.test(lower)) prop = 'weight';
  else if (/leading|line-?height/.test(lower)) prop = 'lineHeight';
  else if (/tracking|letter/.test(lower)) prop = 'letterSpacing';
  else if (isLength(value)) prop = 'size';
  return prop ? { stem: name, prop } : null;
}

function px(value) {
  const n = parseFloat(value);
  return /r?em$/.test(value) ? n * 16 : n;
}

function stepOrder(a, b) {
  return parseFloat(a) - parseFloat(b) || a.localeCompare(b);
}

/**
 * Sort CSS custom properties into design-token groups.
 * @param {Record<string, string>} vars - '--name' -> raw value, as extracted
 * @returns {object} { colors: { ramps, semantic }, typography, spacing, radius, shadow, stats }
 */
export function groupTokens(vars) {
  const stats = { variables: 0, kept: 0, unresolved: 0, notTokens: 0, overCap: 0 };
  const rampSteps = new Map(); // group -> Map(step -> hex)
  const colorEntries = [];
  const typography = new Map();
  const spacing = [];
  const radius = [];
  const shadow = [];

  for (const [key, raw] of Object.entries(vars)) {
    stats.variables++;
    const value = resolveValue(raw, vars, new Set([key]));
    if (value == null) { stats.unresolved++; continue; }
    const name = key.replace(/^--/, '');
    // --tw-* is Tailwind's per-element utility state (--tw-shadow, --tw-ring-color), not theme.
    const kind = name.startsWith('tw-') ? null : classify(name, value);
    if (!kind) { stats.notTokens++; continue; }

    if (kind === 'color') {
      colorEntries.push({ name, hex: toHexAlpha(parseColor(value)) });
    } else if (kind === 'typography') {
      const tp = typeProp(name, value);
      if (!tp) { stats.notTokens++; continue; }
      const entry = typography.get(tp.stem) || {};
      entry[tp.prop] = value;
      typography.set(tp.stem, entry);
    } else if (kind === 'spacing') {
      spacing.push([name, value]);
    } else if (kind === 'radius') {
      radius.push([name, value]);
    } else {
      shadow.push([name, value]);
    }
  }

  // A name ending in a step number (brand-600, neutral-50A) belongs to a
  // ramp; a ramp needs three steps, or its colours count as semantic.
  for (const { name, hex } of colorEntries) {
    const m = name.match(/^(.+?)-(\d+[a-z]?)$/i);
    if (!m) continue;
    if (!rampSteps.has(m[1])) rampSteps.set(m[1], new Map());
    rampSteps.get(m[1]).set(m[2], hex);
  }
  const ramps = {};
  const inRamp = new Set();
  for (const [group, steps] of rampSteps) {
    if (steps.size < 3) continue;
    if (Object.keys(ramps).length >= CAPS.ramps) { stats.overCap += steps.size; for (const s of steps.keys()) inRamp.add(`${group}-${s}`); continue; }
    const sorted = [...steps.keys()].sort(stepOrder);
    stats.overCap += Math.max(0, sorted.length - CAPS.steps);
    ramps[group] = Object.fromEntries(sorted.slice(0, CAPS.steps).map((s) => [s, steps.get(s)]));
    for (const s of steps.keys()) inRamp.add(`${group}-${s}`);
  }

  const semanticAll = colorEntries
    .filter(({ name }) => !inRamp.has(name))
    .sort((a, b) => Number(ROLE_NAME_RE.test(b.name)) - Number(ROLE_NAME_RE.test(a.name)) || a.name.length - b.name.length);
  stats.overCap += Math.max(0, semanticAll.length - CAPS.semantic);
  const semantic = Object.fromEntries(semanticAll.slice(0, CAPS.semantic).map(({ name, hex }) => [name, hex]));

  const capped = (entries, cap) => {
    stats.overCap += Math.max(0, entries.length - cap);
    return Object.fromEntries(entries.slice(0, cap));
  };
  spacing.sort((a, b) => px(a[1]) - px(b[1]));

  const result = {
    colors: { ramps, semantic },
    typography: capped([...typography.entries()], CAPS.typography),
    spacing: capped(spacing, CAPS.spacing),
    radius: capped(radius, CAPS.radius),
    shadow: capped(shadow, CAPS.shadow),
  };
  const count = (o) => Object.keys(o).length;
  stats.kept = Object.values(ramps).reduce((n, r) => n + count(r), 0) + count(semantic) +
    [...Object.values(result.typography)].reduce((n, t) => n + count(t), 0) +
    count(result.spacing) + count(result.radius) + count(result.shadow);
  result.stats = stats;
  return result;
}

// ── DTCG 2025.10 ─────────────────────────────────────────────────────────────

const round = (n) => Math.round(n * 10000) / 10000;

function dtcgColor(c) {
  return {
    colorSpace: 'srgb',
    components: [c.r, c.g, c.b].map((x) => round(x / 255)),
    // Alpha arrives through 8-bit hex (1/255 steps), so two places is all it holds.
    ...(c.a < 1 ? { alpha: Math.round(c.a * 100) / 100 } : {}),
    hex: toHex(c),
  };
}

// DTCG dimensions are px or rem only; em and % have no equivalent.
function dtcgDimension(value) {
  if (value === '0') return { value: 0, unit: 'px' };
  const m = String(value).match(/^(-?(?:\d+\.?\d*|\.\d+))(px|rem)$/);
  return m ? { value: parseFloat(m[1]), unit: m[2] } : null;
}

function dtcgShadow(value) {
  const layers = [];
  for (const layer of splitTopLevel(value)) {
    let color = null;
    let inset = false;
    const lengths = [];
    for (const part of splitTopLevel(layer, true)) {
      if (part === 'inset') { inset = true; continue; }
      const d = dtcgDimension(part);
      if (d) { lengths.push(d); continue; }
      const c = parseColor(part);
      if (!c || color) return null;
      color = c;
    }
    if (!color || lengths.length < 2 || lengths.length > 4) return null;
    const zero = { value: 0, unit: 'px' };
    layers.push({
      color: dtcgColor(color),
      offsetX: lengths[0],
      offsetY: lengths[1],
      blur: lengths[2] || zero,
      spread: lengths[3] || zero,
      ...(inset ? { inset: true } : {}),
    });
  }
  if (layers.length === 0) return null;
  return layers.length === 1 ? layers[0] : layers;
}

// Token and group names may not contain { } . or start with $.
const safeName = (name) => String(name).replace(/[{}.]/g, '-').replace(/^\$/, '_');

/**
 * The branding result as a DTCG 2025.10 token file. Values DTCG has no type
 * for (em letter-spacing, multi-value radii, unparsable shadows) are left out
 * and listed under $extensions["dev.crawlforge"].skipped.
 * @param {{ tokens: object, roles?: object, fonts?: Array<{family: string}>, url: string }} input
 */
export function toDtcg({ tokens, roles = {}, fonts = [], url }) {
  const skipped = [];
  const color = (hex) => ({ $type: 'color', $value: dtcgColor(parseColor(hex)) });
  const dimension = (group, name, value) => {
    const d = dtcgDimension(value);
    if (d) group[safeName(name)] = { $type: 'dimension', $value: d };
    else skipped.push(name);
  };

  const doc = { $description: `Design tokens read from ${url} by CrawlForge` };

  const colorGroup = {};
  const roleEntries = Object.entries(roles).filter(([, r]) => r?.value);
  if (roleEntries.length) {
    colorGroup.role = Object.fromEntries(roleEntries.map(([name, r]) => [
      safeName(name),
      { ...color(r.value), $description: `${r.source}: ${r.evidence}` },
    ]));
  }
  for (const [group, steps] of Object.entries(tokens.colors.ramps)) {
    colorGroup[safeName(group)] = Object.fromEntries(Object.entries(steps).map(([s, hex]) => [safeName(s), color(hex)]));
  }
  if (Object.keys(tokens.colors.semantic).length) {
    colorGroup.semantic = Object.fromEntries(Object.entries(tokens.colors.semantic).map(([n, hex]) => [safeName(n), color(hex)]));
  }
  if (Object.keys(colorGroup).length) doc.color = colorGroup;

  const font = {};
  if (fonts.length) {
    font.family = Object.fromEntries(fonts.slice(0, 6).map(({ family }) => [
      safeName(family.toLowerCase().replace(/\s+/g, '-')),
      { $type: 'fontFamily', $value: family },
    ]));
  }
  for (const [stem, props] of Object.entries(tokens.typography)) {
    const group = {};
    if (props.size) dimension(group, 'size', props.size);
    if (props.lineHeight) {
      if (NUMBER_RE.test(props.lineHeight)) group.lineHeight = { $type: 'number', $value: parseFloat(props.lineHeight) };
      else dimension(group, 'lineHeight', props.lineHeight);
    }
    if (props.weight && NUMBER_RE.test(props.weight)) group.weight = { $type: 'fontWeight', $value: parseFloat(props.weight) };
    if (props.letterSpacing) {
      const d = dtcgDimension(props.letterSpacing);
      if (d) group.letterSpacing = { $type: 'dimension', $value: d };
      else skipped.push(`${stem}-letterSpacing`);
    }
    if (props.family) group.family = { $type: 'fontFamily', $value: splitTopLevel(props.family).map((f) => f.replace(/^['"]|['"]$/g, '')) };
    if (Object.keys(group).length) font[safeName(stem)] = group;
  }
  if (Object.keys(font).length) doc.font = font;

  for (const kind of ['spacing', 'radius']) {
    const group = {};
    for (const [name, value] of Object.entries(tokens[kind])) dimension(group, name, value);
    if (Object.keys(group).length) doc[kind] = group;
  }

  const shadows = {};
  for (const [name, value] of Object.entries(tokens.shadow)) {
    const v = dtcgShadow(value);
    if (v) shadows[safeName(name)] = { $type: 'shadow', $value: v };
    else skipped.push(name);
  }
  if (Object.keys(shadows).length) doc.shadow = shadows;

  if (skipped.length) doc.$extensions = { 'dev.crawlforge': { skipped: skipped.slice(0, 50) } };
  return doc;
}
