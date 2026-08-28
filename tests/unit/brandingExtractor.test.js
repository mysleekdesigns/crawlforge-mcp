/**
 * Branding extractor (v4.8) — static design-token extraction.
 * Run: node --test tests/unit/brandingExtractor.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { load } from 'cheerio';
import { extractBranding, normalizeColor } from '../../src/tools/scrape/_brandingExtractor.js';

const HTML = `<!doctype html><html><head>
<title>Acme</title>
<meta name="theme-color" content="#1a73e8">
<meta property="og:image" content="/og.png">
<link rel="icon" href="/favicon.ico">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700">
<style>
  :root{ --brand-primary:#ff5722; --space-4:16px; }
  body{ color: rgb(20,20,20); font-family: Inter, Arial, sans-serif; }
  .btn{ background:#1a73e8; border-radius:8px; box-shadow:0 2px 4px rgba(0,0,0,0.2); }
</style></head><body>
<header><a href="/"><img src="/logo.svg" alt="Acme logo"></a></header>
</body></html>`;

describe('normalizeColor', () => {
  test('normalizes hex/rgb/hsl/named to #rrggbb', () => {
    assert.equal(normalizeColor('#abc'), '#aabbcc');
    assert.equal(normalizeColor('#1A73E8'), '#1a73e8');
    assert.equal(normalizeColor('rgb(255,0,0)'), '#ff0000');
    assert.equal(normalizeColor('rgba(0,0,0,0.5)'), '#000000');
    assert.equal(normalizeColor('hsl(0,100%,50%)'), '#ff0000');
    assert.equal(normalizeColor('white'), '#ffffff');
    assert.equal(normalizeColor('var(--x)'), null);
  });
});

describe('extractBranding (static, no linked CSS)', () => {
  test('extracts colors, fonts, logo, and tokens', async () => {
    const $ = load(HTML);
    const b = await extractBranding($, 'https://acme.test/', { fetchLinkedCss: false });

    assert.ok(b.colors.some((c) => c.value === '#ff5722' && c.source === 'css-var'), 'brand CSS var color');
    assert.ok(b.colors.some((c) => c.value === '#1a73e8'), 'theme-color / declaration');
    assert.ok(b.fonts.some((f) => f.family === 'Inter'), 'Inter font family');
    assert.ok(!b.genericFallbacks.includes('inter'), 'Inter is not a generic fallback');
    assert.ok(b.genericFallbacks.includes('sans-serif'), 'generic fallback captured');
    assert.ok(b.webfontProviders.includes('google-fonts'), 'google-fonts provider');
    assert.equal(b.logo.favicons[0].href, 'https://acme.test/favicon.ico');
    assert.equal(b.logo.ogImage, 'https://acme.test/og.png');
    assert.ok(b.logo.candidates.some((c) => c.src === 'https://acme.test/logo.svg'));
    assert.ok(b.radii.some((r) => r.value === '8px'));
    assert.ok('--brand-primary' in b.cssVariables);
    assert.ok(Array.isArray(b.notes) && b.notes.length > 0);
  });

  test('never throws on empty / style-less HTML', async () => {
    const $ = load('<html><body><p>hi</p></body></html>');
    const b = await extractBranding($, 'https://x.test/', { fetchLinkedCss: false });
    assert.ok(Array.isArray(b.colors));
    assert.ok(Array.isArray(b.fonts));
  });
});

describe('font-family values containing var() (6.5)', () => {
  const branding = (css) =>
    extractBranding(load(`<html><head><style>${css}</style></head><body></body></html>`), 'https://v.test/', {
      fetchLinkedCss: false,
    });

  test('an undefined var() falls back instead of leaking a `var(` fragment', async () => {
    const b = await branding('body{ font-family: var(--default-font-family, sans-serif); }');
    assert.ok(!b.fonts.some((f) => f.family.includes('var(')), 'no var( fragment in fonts');
    assert.ok(b.genericFallbacks.includes('sans-serif'), 'the var() fallback is read as the generic');
  });

  test('a defined var() resolves to the families it stands for', async () => {
    const b = await branding(':root{ --font-sans: Inter, system-ui; } body{ font-family: var(--font-sans); }');
    assert.ok(b.fonts.some((f) => f.family === 'Inter'), 'Inter resolved through the variable');
    assert.ok(b.genericFallbacks.includes('system-ui'), 'generic inside the variable captured');
    assert.ok(!b.fonts.some((f) => f.family.includes('var(')), 'no var( fragment in fonts');
  });

  test('an unresolvable var() with no fallback contributes nothing', async () => {
    const b = await branding('body{ font-family: var(--missing); }');
    assert.deepEqual(b.fonts, []);
    assert.deepEqual(b.genericFallbacks, []);
  });

  test('self-referential variables terminate', async () => {
    const b = await branding(':root{ --a: var(--b); --b: var(--a); } body{ font-family: var(--a); }');
    assert.deepEqual(b.fonts, []);
  });

  test('a plain family list is unchanged', async () => {
    const b = await branding('body{ font-family: "JetBrains Mono", Menlo, monospace; }');
    assert.deepEqual(b.fonts.map((f) => f.family), ['JetBrains Mono', 'Menlo']);
    assert.ok(b.genericFallbacks.includes('monospace'));
  });
});
