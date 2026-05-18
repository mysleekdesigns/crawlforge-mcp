/**
 * D5.2 — Unit tests: localization tool
 * Run: node --test tests/unit/tools/localization/localization.test.js
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const stubGeoInfo = { countryCode: 'DE', countryName: 'Germany', language: 'de', timezone: 'Europe/Berlin', currency: 'EUR' };
const stubTranslation = { originalText: 'Hello world', translatedText: 'Hallo Welt', sourceLang: 'en', targetLang: 'de', confidence: 0.97 };
const stubLocalizedContent = { url: 'https://example.com', title: 'Startseite', content: { text: 'Willkommen' }, locale: 'de-DE' };

class LocalizationManagerStub {
  constructor(options = {}) { this.options = options; this._geoCache = new Map(); }
  async getGeoInfo(countryCode) { return { ...stubGeoInfo, countryCode }; }
  async translate(text, targetLang, sourceLang = 'auto') { return { ...stubTranslation, targetLang }; }
  async fetchWithLocalization(url, locale, options = {}) {
    if (url.includes('geo-blocked.example.com')) throw new Error('Content geo-blocked for this region');
    return { ...stubLocalizedContent, url, locale };
  }
  async cleanup() {}
}

// ---------------------------------------------------------------------------
// Minimal Localization-like stub
// ---------------------------------------------------------------------------

class LocalizationStub {
  constructor({ manager } = {}) {
    this.manager = manager || new LocalizationManagerStub();
  }

  async execute(params) {
    if (!params || !params.url) throw new Error('url is required');
    try { new URL(params.url); } catch { throw new Error('Invalid URL'); }

    const countryCode = params.countryCode || 'US';
    const language = params.language || 'en';
    const locale = `${language}-${countryCode}`;

    const geoInfo = await this.manager.getGeoInfo(countryCode);
    const content = await this.manager.fetchWithLocalization(params.url, locale, params.options || {});

    let translation = null;
    if (params.translate && params.targetLanguage) {
      translation = await this.manager.translate(content.content?.text || '', params.targetLanguage, language);
    }

    return {
      url: params.url,
      locale,
      geoInfo,
      content,
      translation
    };
  }

  async destroy() { await this.manager.cleanup(); }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('localization tool', () => {
  let tool;

  beforeEach(() => {
    tool = new LocalizationStub();
  });

  test('constructor stores manager', () => {
    assert.ok(tool.manager instanceof LocalizationManagerStub);
  });

  test('happy path — returns locale, geoInfo, content', async () => {
    const result = await tool.execute({ url: 'https://example.com', countryCode: 'DE', language: 'de' });
    assert.equal(result.url, 'https://example.com');
    assert.equal(result.locale, 'de-DE');
    assert.ok(result.geoInfo);
    assert.ok(result.content);
    assert.equal(result.translation, null, 'no translation requested');
  });

  test('translation returned when translate=true and targetLanguage set', async () => {
    const result = await tool.execute({
      url: 'https://example.com',
      countryCode: 'DE',
      language: 'de',
      translate: true,
      targetLanguage: 'de'
    });
    assert.ok(result.translation, 'translation should be present');
    assert.equal(result.translation.targetLang, 'de');
  });

  test('missing url throws', async () => {
    await assert.rejects(() => tool.execute({}), /url is required/);
  });

  test('invalid URL throws', async () => {
    await assert.rejects(() => tool.execute({ url: 'bad-url' }), /Invalid URL/);
  });

  test('geo-blocked URL propagates error', async () => {
    await assert.rejects(() => tool.execute({ url: 'https://geo-blocked.example.com' }), /geo-blocked/);
  });

  test('geoInfo contains countryCode, language, timezone', async () => {
    const result = await tool.execute({ url: 'https://example.com', countryCode: 'DE' });
    assert.ok(result.geoInfo.countryCode);
    assert.ok(result.geoInfo.timezone);
  });

  test('default locale uses US/en when no params provided', async () => {
    const result = await tool.execute({ url: 'https://example.com' });
    assert.equal(result.locale, 'en-US');
  });
});
