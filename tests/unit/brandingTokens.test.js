/**
 * Branding roles, tokens and DTCG (6.25): colour parsing, var() resolution,
 * token grouping and caps, the computed-style role picker, the inferred
 * fallback, and the DTCG 2025.10 writer.
 * Run: node --test --test-force-exit tests/unit/brandingTokens.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { load } from 'cheerio';
import { parseColor, toHex, distance } from '../../src/tools/scrape/_brandingColor.js';
import { resolveValue, groupTokens, toDtcg } from '../../src/tools/scrape/_brandingTokens.js';
import { buildComputedBranding, inferRoles } from '../../src/tools/scrape/_brandingComputed.js';
import { extractBranding } from '../../src/tools/scrape/_brandingExtractor.js';

describe('parseColor', () => {
  test('oklch and oklab convert to sRGB', () => {
    const red = parseColor('oklch(62.8% 0.2577 29.23)');
    assert.ok(distance(red, { r: 255, g: 0, b: 0 }) < 4, `oklch red came back ${toHex(red)}`);
    assert.equal(toHex(parseColor('oklch(1 0 0)')), '#ffffff');
    assert.equal(toHex(parseColor('oklab(0 0 0)')), '#000000');
  });

  test('lab and lch (what Tailwind v4 builds ship) convert to sRGB', () => {
    // Tailwind v4 red-500 and red-600, as tailwindcss.com serves them.
    assert.equal(toHex(parseColor('lab(55.4814% 75.0732 48.8528)')), '#fb2c36');
    assert.equal(toHex(parseColor('lab(48.4493% 77.4328 61.5452)')), '#e7000b');
    assert.equal(toHex(parseColor('lch(54.29% 106.8 40.86)')), '#ff0000');
  });

  test('keeps alpha from hex8 and rgba', () => {
    assert.ok(Math.abs(parseColor('#acacff1f').a - 0x1f / 255) < 1e-9);
    assert.equal(parseColor('rgba(0,0,0,0.5)').a, 0.5);
    assert.equal(parseColor('rgb(0 0 0 / 25%)').a, 0.25);
  });

  test('rejects what is not a literal colour', () => {
    for (const v of ['var(--x)', 'currentColor', 'linear-gradient(red, blue)', 'transparent', '12px']) {
      assert.equal(parseColor(v), null, v);
    }
  });
});

describe('resolveValue', () => {
  const vars = {
    '--a': 'var(--b)',
    '--b': '#533afd',
    '--loop1': 'var(--loop2)',
    '--loop2': 'var(--loop1)',
    '--pad': 'var(--x) var(--y)',
    '--x': '4px',
    '--y': '8px',
  };

  test('follows a chain to its literal', () => {
    assert.equal(resolveValue('var(--a)', vars), '#533afd');
  });

  test('uses the fallback, which may itself hold a var()', () => {
    assert.equal(resolveValue('var(--missing, var(--b))', vars), '#533afd');
    assert.equal(resolveValue('var(--missing, rgba(0, 0, 0, 0.5))', vars), 'rgba(0, 0, 0, 0.5)');
  });

  test('resolves several references in one value', () => {
    assert.equal(resolveValue('var(--pad)', vars), '4px 8px');
  });

  test('returns null for a cycle or a dangling reference', () => {
    assert.equal(resolveValue('var(--loop1)', vars), null);
    assert.equal(resolveValue('var(--missing)', vars), null);
  });
});

describe('groupTokens', () => {
  // The shapes Stripe's stylesheet uses (R: stripe.com, 2026-10-28).
  const stripeLike = {
    '--hds-color-core-brand-25': '#f5f5ff',
    '--hds-color-core-brand-600': '#533afd',
    '--hds-color-core-brand-700': '#4032c8',
    '--hds-color-core-brand-50A': '#a3a7ff40',
    '--hds-color-text-solid': 'var(--hds-color-core-brand-700)',
    '--hds-font-heading-xl-size': '3rem',
    '--hds-font-heading-xl-lineHeight': '1.03',
    '--hds-font-heading-xl-weight': '300',
    '--hds-font-heading-xl-letterSpacing': '-0.02em',
    '--hds-space-core-200': '16px',
    '--hds-space-core-50': '4px',
    '--hds-radius-md': 'var(--base-radius)',
    '--base-radius': '4px',
    '--hds-shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.1)',
    '--bar-index': '30',
    '--graphic-scale': '1',
    '--fallback-width-mobile': '624px',
    '--hds-space-layout-columns': '12',
  };

  test('sorts variables into ramps, semantic colours, type, spacing, radius and shadow', () => {
    const t = groupTokens(stripeLike);
    assert.deepEqual(t.colors.ramps['hds-color-core-brand'], { 25: '#f5f5ff', '50A': '#a3a7ff40', 600: '#533afd', 700: '#4032c8' });
    assert.equal(t.colors.semantic['hds-color-text-solid'], '#4032c8', 'semantic colour resolved through var()');
    assert.deepEqual(t.typography['hds-font-heading-xl'], { size: '3rem', lineHeight: '1.03', weight: '300', letterSpacing: '-0.02em' });
    assert.deepEqual(Object.keys(t.spacing), ['hds-space-core-50', 'hds-space-core-200'], 'spacing sorted by size');
    assert.equal(t.radius['hds-radius-md'], '4px', 'radius resolved through var()');
    assert.equal(t.shadow['hds-shadow-sm'], '0 1px 2px rgba(0, 0, 0, 0.1)');
  });

  test('drops layout state that is not a design token', () => {
    const t = groupTokens(stripeLike);
    const all = JSON.stringify(t);
    for (const name of ['bar-index', 'graphic-scale', 'fallback-width-mobile', 'layout-columns']) {
      assert.ok(!all.includes(name), name);
    }
    assert.equal(t.stats.notTokens, 4);
  });

  test('reads Tailwind v4 theme variables', () => {
    const t = groupTokens({
      '--color-blue-500': 'oklch(62.3% 0.214 259.815)',
      '--color-blue-600': 'oklch(54.6% 0.245 262.881)',
      '--color-blue-700': 'oklch(48.8% 0.243 264.376)',
      '--text-sm': '0.875rem',
      '--text-sm--line-height': 'calc(1.25 / 0.875)',
      '--font-sans': 'ui-sans-serif, system-ui, sans-serif',
      '--spacing': '0.25rem',
    });
    assert.equal(Object.keys(t.colors.ramps['color-blue']).length, 3);
    assert.match(t.colors.ramps['color-blue'][500], /^#[0-9a-f]{6}$/);
    assert.equal(t.typography['text-sm'].size, '0.875rem');
    assert.equal(t.typography['font-sans'].family, 'ui-sans-serif, system-ui, sans-serif');
    assert.equal(t.spacing.spacing, '0.25rem');
  });

  test("skips Tailwind's --tw-* utility state", () => {
    const t = groupTokens({ '--tw-font-weight': '500', '--tw-shadow': '0 1px 2px #000', '--font-weight-medium': '500' });
    assert.deepEqual(Object.keys(t.typography), ['font-weight-medium']);
    assert.deepEqual(t.shadow, {});
  });

  test('caps each group and counts what it cut', () => {
    const vars = {};
    for (let i = 0; i < 60; i++) vars[`--space-${i}`] = `${i + 1}px`;
    for (let i = 0; i < 400; i++) vars[`--hds-color-input-thing-${'x'.repeat(i % 5)}state${i}x`] = '#123456';
    const t = groupTokens(vars);
    assert.equal(Object.keys(t.spacing).length, 40);
    assert.equal(Object.keys(t.colors.semantic).length, 40);
    assert.equal(t.stats.overCap, 20 + 360);
  });
});

// A probe result shaped like brandingProbe() returns on stripe.com's hero.
const style = (over) => ({
  color: 'rgba(6,27,49,1)', background: 'rgba(0,0,0,0)', borderColor: 'rgba(6,27,49,1)', borderWidth: '0px',
  borderStyle: 'none', borderRadius: '0px', padding: '0px 0px 0px 0px', fontFamily: 'sohne-var, "SF Pro Display", sans-serif',
  fontSize: '16px', fontWeight: '400', lineHeight: '22.4px', letterSpacing: 'normal', textTransform: 'none', boxShadow: 'none',
  ...over,
});
const PROBE = {
  background: { body: 'rgba(255,255,255,1)', html: 'rgba(0,0,0,0)' },
  body: { tag: 'body', text: '', style: style({ fontWeight: '300' }) },
  heading: { tag: 'h1', text: 'Financial infrastructure', style: style({ color: 'rgba(2,8,38,1)', fontSize: '56px', fontWeight: '300', letterSpacing: '-1.4px' }) },
  h2: null,
  paragraph: { tag: 'p', text: 'Accept payments…', style: style({ color: 'rgba(64,102,141,1)', fontWeight: '300' }) },
  links: [
    { tag: 'a', text: 'Get started', style: style({ background: 'rgba(83,58,253,1)', color: 'rgba(255,255,255,1)' }) },
    { tag: 'a', text: 'Pricing', style: style({ color: 'rgba(6,27,49,1)' }) },
  ],
  buttons: [
    { tag: 'a', text: 'Sign in', rect: { x: 1000, y: 20, w: 140, h: 44 }, inHeader: true, style: style({ background: 'rgba(229,237,245,1)' }) },
    { tag: 'a', text: 'Get started', rect: { x: 136, y: 447, w: 137, h: 48 }, inHeader: false,
      style: style({ background: 'rgba(83,58,253,1)', color: 'rgba(255,255,255,1)', borderRadius: '4px', padding: '14px 24px 14px 24px' }) },
    { tag: 'a', text: 'Sign up with Google', rect: { x: 285, y: 447, w: 212, h: 48 }, inHeader: false,
      style: style({ color: 'rgba(83,58,253,1)', borderColor: 'rgba(185,185,249,1)', borderWidth: '1px', borderStyle: 'solid', borderRadius: '4px' }) },
  ],
};

describe('buildComputedBranding', () => {
  const c = buildComputedBranding(PROBE);

  test('names each role from the element that shows it', () => {
    assert.deepEqual(
      Object.fromEntries(Object.entries(c.roles).map(([k, r]) => [k, r.value])),
      { background: '#ffffff', text: '#40668d', heading: '#020826', link: '#061b31', primary: '#533afd', onPrimary: '#ffffff' },
    );
    assert.ok(Object.values(c.roles).every((r) => r.source === 'computed'));
    assert.equal(c.roles.primary.evidence, 'button "Get started"');
    assert.equal(c.colorScheme, 'light');
  });

  test('a saturated CTA beats a larger grey one, and the outline button is secondary', () => {
    assert.equal(c.components.buttonPrimary.text, 'Get started');
    assert.equal(c.components.buttonPrimary.borderRadius, '4px');
    assert.equal(c.components.buttonPrimary.fontFamily, 'sohne-var');
    assert.equal(c.components.buttonSecondary.text, 'Sign up with Google');
    assert.equal(c.components.buttonSecondary.borderColor, '#b9b9f9');
    assert.equal(c.components.buttonSecondary.background, undefined, 'an outline button has no fill');
  });

  test('the secondary is the outline button nearest the primary; a pill radius reads 9999px', () => {
    const outline = (text, x, y) => ({ tag: 'a', text, rect: { x, y, w: 120, h: 40 },
      style: style({ borderColor: 'rgba(185,185,249,1)', borderWidth: '1px', borderStyle: 'solid' }) });
    const pill = { ...PROBE.buttons[1], style: { ...PROBE.buttons[1].style, borderRadius: '3.35544e+07px' } };
    const c2 = buildComputedBranding({ ...PROBE, buttons: [outline('Performance', 600, 900), pill, outline('Talk to sales', 300, 447)] });
    assert.equal(c2.components.buttonSecondary.text, 'Talk to sales');
    assert.equal(c2.components.buttonPrimary.borderRadius, '9999px');
    const lone = buildComputedBranding({ ...PROBE, buttons: [pill, outline('iOS', 400, 1200)] });
    assert.equal(lone.components.buttonSecondary, undefined, 'an outline far below the CTA is not its partner');
  });

  test('reads type from the paragraph and the h1', () => {
    assert.equal(c.typography.body.fontWeight, '300');
    assert.equal(c.typography.h1.fontSize, '56px');
    assert.equal(c.typography.h1.letterSpacing, '-1.4px');
    assert.equal(c.typography.h2, undefined);
  });

  test('a dark page reads as dark', () => {
    const dark = buildComputedBranding({ ...PROBE, background: { body: 'rgba(13,23,56,1)' }, buttons: [] });
    assert.equal(dark.colorScheme, 'dark');
    assert.equal(dark.roles.primary, undefined);
  });
});

describe('inferRoles', () => {
  test('guesses roles from names that end in the role word', () => {
    const roles = inferRoles({
      '--color-primary': '#533afd',
      '--background': '#ffffff',
      '--input-bg-hover': '#000000',
      '--color-text': '#061b31',
    });
    assert.equal(roles.primary.value, '#533afd');
    assert.equal(roles.background.value, '#ffffff');
    assert.equal(roles.text.value, '#061b31');
    assert.ok(Object.values(roles).every((r) => r.source === 'inferred'));
  });

  test('a grey "primary" is not taken for the brand colour', () => {
    assert.equal(inferRoles({ '--primary': '#333333' }).primary, undefined);
  });
});

describe('extractBranding with a probe result', () => {
  const html = `<html><head><style>
    :root{ --r: 6px; --color-link: #0a66c2; }
    .btn{ border-radius: var(--r); }
  </style></head><body></body></html>`;

  test('computed roles win and inferred guesses fill only the gaps', async () => {
    const probe = { ...PROBE, links: [] };
    const b = await extractBranding(load(html), 'https://acme.test/', { fetchLinkedCss: false, computed: probe });
    assert.equal(b.roles.primary.source, 'computed');
    assert.deepEqual(b.roles.link, { value: '#0a66c2', source: 'inferred', evidence: 'CSS variable --color-link' });
    assert.equal(b.sources.rendered, true);
    assert.equal(b.provenance.inferred.length > 0, true);
  });

  test('declarations that use a var() count under the resolved value', async () => {
    const b = await extractBranding(load(html), 'https://acme.test/', { fetchLinkedCss: false });
    assert.ok(b.radii.some((r) => r.value === '6px'));
    assert.equal(b.sources.rendered, false);
    assert.deepEqual(b.components, {});
  });
});

describe('toDtcg', () => {
  const tokens = groupTokens({
    '--brand-100': '#f5f5ff',
    '--brand-500': '#533afd',
    '--brand-900': '#1c1e54',
    '--overlay': 'rgba(0, 0, 0, 0.5)',
    '--space-4': '16px',
    '--space-lg': '1.5rem',
    '--text-lg-size': '1.125rem',
    '--text-lg-lineHeight': '1.4',
    '--text-lg-weight': '300',
    '--text-lg-letterSpacing': '-0.01em',
    '--radius-pill': '9999px',
    '--radius-card': '8px 8px 0 0',
    '--shadow-md': '0 4px 8px rgba(0, 0, 0, 0.2), inset 0 1px 0 #ffffff',
  });
  const doc = toDtcg({
    tokens,
    roles: { primary: { value: '#533afd', source: 'computed', evidence: 'button "Get started"' } },
    fonts: [{ family: 'SF Pro Display', count: 3 }],
    url: 'https://acme.test/',
  });

  test('colours use the 2025.10 colour object', () => {
    assert.deepEqual(doc.color.brand[500], {
      $type: 'color',
      $value: { colorSpace: 'srgb', components: [0.3255, 0.2275, 0.9922], hex: '#533afd' },
    });
    assert.equal(doc.color.semantic.overlay.$value.alpha, 0.5);
    assert.equal(doc.color.role.primary.$description, 'computed: button "Get started"');
  });

  test('dimensions are { value, unit } in px or rem', () => {
    assert.deepEqual(doc.spacing['space-lg'].$value, { value: 1.5, unit: 'rem' });
    assert.deepEqual(doc.font['text-lg'].size.$value, { value: 1.125, unit: 'rem' });
    assert.deepEqual(doc.font['text-lg'].lineHeight, { $type: 'number', $value: 1.4 });
    assert.deepEqual(doc.font['text-lg'].weight, { $type: 'fontWeight', $value: 300 });
    assert.deepEqual(doc.font.family['sf-pro-display'], { $type: 'fontFamily', $value: 'SF Pro Display' });
  });

  test('a layered shadow becomes an array of shadow objects', () => {
    const [outer, inner] = doc.shadow['shadow-md'].$value;
    assert.deepEqual(outer.offsetY, { value: 4, unit: 'px' });
    assert.equal(outer.color.alpha, 0.2);
    assert.equal(inner.inset, true);
  });

  test('values DTCG has no type for are listed, not guessed', () => {
    assert.deepEqual(doc.$extensions['dev.crawlforge'].skipped, ['text-lg-letterSpacing', 'radius-card']);
    assert.equal(doc.font['text-lg'].letterSpacing, undefined);
    assert.equal(doc.radius['radius-card'], undefined);
  });
});
