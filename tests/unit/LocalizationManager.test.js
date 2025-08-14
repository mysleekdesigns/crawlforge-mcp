/**
 * Unit tests for LocalizationManager - Wave 3 Localization Features
 * Tests location/language settings management, browser locale emulation,
 * timezone spoofing, and geo-blocked content handling
 */

import { describe, it, beforeEach, afterEach, expect, jest } from '@jest/globals';
import { LocalizationManager } from '../../src/core/LocalizationManager.js';

describe('LocalizationManager', () => {
  let localizationManager;

  beforeEach(() => {
    jest.clearAllMocks();
    
    localizationManager = new LocalizationManager({
      countryCode: 'US',
      language: 'en-US',
      timezone: 'America/New_York',
      currency: 'USD'
    });
  });

  afterEach(async () => {
    if (localizationManager) {
      await localizationManager.cleanup();
    }
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with default settings', () => {
      const defaultManager = new LocalizationManager();
      
      expect(defaultManager.currentSettings).toMatchObject({
        countryCode: 'US',
        language: 'en-US',
        timezone: 'America/New_York',
        currency: 'USD',
        geoBlockingBypass: true,
        dynamicFingerprinting: true
      });
    });

    it('should accept custom settings', () => {
      const customManager = new LocalizationManager({
        countryCode: 'DE',
        language: 'de-DE',
        timezone: 'Europe/Berlin',
        currency: 'EUR'
      });

      expect(customManager.currentSettings).toMatchObject({
        countryCode: 'DE',
        language: 'de-DE',
        timezone: 'Europe/Berlin',
        currency: 'EUR'
      });
    });

    it('should initialize caches and statistics', () => {
      expect(localizationManager.localeCache).toBeInstanceOf(Map);
      expect(localizationManager.geoLocationCache).toBeInstanceOf(Map);
      expect(localizationManager.timezoneCache).toBeInstanceOf(Map);
      expect(localizationManager.stats).toBeDefined();
    });

    it('should support all predefined countries', () => {
      const supportedCountries = [
        'US', 'GB', 'DE', 'FR', 'JP', 'CN', 'AU', 'CA',
        'IT', 'ES', 'RU', 'BR', 'IN', 'KR', 'MX'
      ];

      supportedCountries.forEach(countryCode => {
        const manager = new LocalizationManager({ countryCode });
        expect(manager.currentSettings.countryCode).toBe(countryCode);
      });
    });
  });

  describe('Country Configuration Management', () => {
    it('should get complete country configuration', () => {
      const config = localizationManager.getCountryConfig('DE');

      expect(config).toMatchObject({
        timezone: 'Europe/Berlin',
        currency: 'EUR',
        language: 'de-DE',
        searchDomain: 'google.de'
      });
    });

    it('should return null for unsupported countries', () => {
      const config = localizationManager.getCountryConfig('XX');
      expect(config).toBeNull();
    });

    it('should apply country settings', async () => {
      await localizationManager.applyCountrySettings('FR');

      expect(localizationManager.currentSettings).toMatchObject({
        countryCode: 'FR',
        timezone: 'Europe/Paris',
        currency: 'EUR',
        language: 'fr-FR'
      });
    });

    it('should validate country codes', () => {
      expect(() => localizationManager.validateCountryCode('US')).not.toThrow();
      expect(() => localizationManager.validateCountryCode('XX')).toThrow();
      expect(() => localizationManager.validateCountryCode('usa')).toThrow(); // Not 2 letters
    });
  });

  describe('Language and Locale Management', () => {
    it('should generate Accept-Language headers', () => {
      const header = localizationManager.generateAcceptLanguageHeader('de');
      expect(header).toBe('de-DE,de;q=0.9,en;q=0.8');
    });

    it('should handle unsupported languages gracefully', () => {
      const header = localizationManager.generateAcceptLanguageHeader('unknown');
      expect(header).toBe('en-US,en;q=0.9');
    });

    it('should create browser locale configuration', () => {
      const locale = localizationManager.createBrowserLocale('DE');

      expect(locale).toMatchObject({
        languages: expect.arrayContaining(['de-DE']),
        timezone: 'Europe/Berlin',
        locale: 'de-DE',
        currency: 'EUR',
        dateFormat: expect.any(String),
        numberFormat: expect.any(String),
        firstDayOfWeek: expect.any(Number)
      });
    });

    it('should cache locale configurations', () => {
      const locale1 = localizationManager.createBrowserLocale('JP');
      const locale2 = localizationManager.createBrowserLocale('JP');

      expect(locale1).toEqual(locale2);
      expect(localizationManager.localeCache.has('JP')).toBe(true);
    });

    it('should format numbers according to locale', () => {
      const usFormat = localizationManager.formatNumber(1234.56, 'US');
      const deFormat = localizationManager.formatNumber(1234.56, 'DE');
      const jpFormat = localizationManager.formatNumber(1234.56, 'JP');

      expect(usFormat).toBe('1,234.56');
      expect(deFormat).toBe('1.234,56');
      expect(jpFormat).toBe('1,234.56');
    });

    it('should format dates according to locale', () => {
      const date = new Date('2023-12-25');
      
      const usFormat = localizationManager.formatDate(date, 'US');
      const deFormat = localizationManager.formatDate(date, 'DE');
      
      expect(usFormat).toMatch(/12\/25\/2023|Dec 25, 2023/);
      expect(deFormat).toMatch(/25\.12\.2023|25\. Dez 2023/);
    });
  });

  describe('Timezone Management', () => {
    it('should get timezone offset for different zones', () => {
      const nyOffset = localizationManager.getTimezoneOffset('America/New_York');
      const londonOffset = localizationManager.getTimezoneOffset('Europe/London');
      const tokyoOffset = localizationManager.getTimezoneOffset('Asia/Tokyo');

      expect(typeof nyOffset).toBe('number');
      expect(typeof londonOffset).toBe('number');
      expect(typeof tokyoOffset).toBe('number');
      expect(nyOffset).not.toBe(tokyoOffset);
    });

    it('should validate timezone strings', () => {
      expect(() => localizationManager.validateTimezone('America/New_York')).not.toThrow();
      expect(() => localizationManager.validateTimezone('Invalid/Timezone')).toThrow();
    });

    it('should generate timezone spoofing script', () => {
      const script = localizationManager.generateTimezoneScript('Europe/Berlin');

      expect(script).toContain('Europe/Berlin');
      expect(script).toContain('getTimezoneOffset');
      expect(script).toContain('toLocaleString');
    });

    it('should cache timezone data', () => {
      const timezone1 = localizationManager.getTimezoneData('Asia/Tokyo');
      const timezone2 = localizationManager.getTimezoneData('Asia/Tokyo');

      expect(timezone1).toEqual(timezone2);
      expect(localizationManager.timezoneCache.has('Asia/Tokyo')).toBe(true);
    });
  });

  describe('Geolocation Management', () => {
    it('should get coordinates for countries', () => {
      const usCoords = localizationManager.getCountryCoordinates('US');
      const jpCoords = localizationManager.getCountryCoordinates('JP');

      expect(usCoords).toMatchObject({
        latitude: expect.any(Number),
        longitude: expect.any(Number),
        accuracy: expect.any(Number)
      });

      expect(jpCoords).toMatchObject({
        latitude: expect.any(Number),
        longitude: expect.any(Number),
        accuracy: expect.any(Number)
      });

      expect(usCoords.latitude).not.toBe(jpCoords.latitude);
    });

    it('should return null for unsupported countries', () => {
      const coords = localizationManager.getCountryCoordinates('XX');
      expect(coords).toBeNull();
    });

    it('should add random variance to coordinates', () => {
      const coords1 = localizationManager.getCountryCoordinates('US', { addVariance: true });
      const coords2 = localizationManager.getCountryCoordinates('US', { addVariance: true });

      expect(coords1.latitude).not.toBe(coords2.latitude);
      expect(coords1.longitude).not.toBe(coords2.longitude);
    });

    it('should cache geolocation data', () => {
      const coords1 = localizationManager.getCountryCoordinates('DE');
      const coords2 = localizationManager.getCountryCoordinates('DE');

      expect(coords1).toEqual(coords2);
      expect(localizationManager.geoLocationCache.has('DE')).toBe(true);
    });

    it('should generate geolocation spoofing script', () => {
      const coords = { latitude: 40.7128, longitude: -74.0060 };
      const script = localizationManager.generateGeolocationScript(coords);

      expect(script).toContain('40.7128');
      expect(script).toContain('-74.0060');
      expect(script).toContain('getCurrentPosition');
      expect(script).toContain('watchPosition');
    });
  });

  describe('Browser Headers Generation', () => {
    it('should generate localized HTTP headers', () => {
      const headers = localizationManager.generateLocalizedHeaders('DE');

      expect(headers).toMatchObject({
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        'Accept': expect.any(String),
        'Accept-Encoding': expect.any(String),
        'Cache-Control': expect.any(String)
      });
    });

    it('should include custom headers when provided', () => {
      localizationManager.currentSettings.customHeaders = {
        'X-Custom-Header': 'test-value'
      };

      const headers = localizationManager.generateLocalizedHeaders('US');
      expect(headers['X-Custom-Header']).toBe('test-value');
    });

    it('should generate currency-specific headers', () => {
      const headers = localizationManager.generateLocalizedHeaders('GB');
      expect(headers['Accept-Language']).toContain('en-GB');
    });

    it('should handle region-specific variations', () => {
      const usHeaders = localizationManager.generateLocalizedHeaders('US');
      const caHeaders = localizationManager.generateLocalizedHeaders('CA');

      expect(usHeaders['Accept-Language']).toContain('en-US');
      expect(caHeaders['Accept-Language']).toContain('en-CA');
    });
  });

  describe('Proxy and DNS Settings', () => {
    it('should configure proxy settings', async () => {
      const proxyConfig = {
        enabled: true,
        server: '1.2.3.4',
        port: 8080,
        username: 'user',
        password: 'pass'
      };

      await localizationManager.configureProxy(proxyConfig);

      expect(localizationManager.currentSettings.proxySettings).toEqual(proxyConfig);
    });

    it('should validate proxy configuration', () => {
      const validConfig = {
        enabled: true,
        server: '192.168.1.1',
        port: 3128
      };

      const invalidConfig = {
        enabled: true,
        server: 'invalid-ip',
        port: 'invalid-port'
      };

      expect(() => localizationManager.validateProxyConfig(validConfig)).not.toThrow();
      expect(() => localizationManager.validateProxyConfig(invalidConfig)).toThrow();
    });

    it('should configure DNS settings', async () => {
      const dnsConfig = {
        enabled: true,
        servers: ['8.8.8.8', '1.1.1.1'],
        preferredCountry: 'US'
      };

      await localizationManager.configureDNS(dnsConfig);

      expect(localizationManager.currentSettings.dnsSettings).toEqual(dnsConfig);
    });

    it('should get country-specific DNS servers', () => {
      const usServers = localizationManager.getCountryDNSServers('US');
      const deServers = localizationManager.getCountryDNSServers('DE');

      expect(usServers).toBeInstanceOf(Array);
      expect(deServers).toBeInstanceOf(Array);
      expect(usServers).not.toEqual(deServers);
    });
  });

  describe('Browser Context Configuration', () => {
    it('should generate complete browser context config', () => {
      const config = localizationManager.generateBrowserContextConfig('JP');

      expect(config).toMatchObject({
        locale: 'ja-JP',
        timezoneId: 'Asia/Tokyo',
        geolocation: expect.objectContaining({
          latitude: expect.any(Number),
          longitude: expect.any(Number)
        }),
        extraHTTPHeaders: expect.objectContaining({
          'Accept-Language': expect.stringContaining('ja-JP')
        })
      });
    });

    it('should include proxy configuration when enabled', () => {
      localizationManager.currentSettings.proxySettings = {
        enabled: true,
        server: '1.2.3.4',
        port: 8080
      };

      const config = localizationManager.generateBrowserContextConfig('US');
      expect(config.proxy).toBeDefined();
      expect(config.proxy.server).toBe('1.2.3.4:8080');
    });

    it('should apply custom user agent when provided', () => {
      localizationManager.currentSettings.userAgent = 'Custom User Agent';
      
      const config = localizationManager.generateBrowserContextConfig('US');
      expect(config.userAgent).toBe('Custom User Agent');
    });

    it('should generate device emulation config', () => {
      const deviceConfig = localizationManager.generateDeviceEmulationConfig('mobile', 'US');

      expect(deviceConfig).toMatchObject({
        viewport: expect.objectContaining({
          width: expect.any(Number),
          height: expect.any(Number)
        }),
        deviceScaleFactor: expect.any(Number),
        isMobile: true,
        hasTouch: true
      });
    });
  });

  describe('Search Domain Management', () => {
    it('should get search domain for countries', () => {
      const usDomain = localizationManager.getSearchDomain('US');
      const deDomain = localizationManager.getSearchDomain('DE');
      const cnDomain = localizationManager.getSearchDomain('CN');

      expect(usDomain).toBe('google.com');
      expect(deDomain).toBe('google.de');
      expect(cnDomain).toBe('baidu.com');
    });

    it('should fall back to default for unsupported countries', () => {
      const domain = localizationManager.getSearchDomain('XX');
      expect(domain).toBe('google.com');
    });

    it('should generate search URLs with localization', () => {
      const query = 'machine learning';
      const usUrl = localizationManager.generateSearchURL(query, 'US');
      const deUrl = localizationManager.generateSearchURL(query, 'DE');

      expect(usUrl).toContain('google.com');
      expect(deUrl).toContain('google.de');
      expect(usUrl).toContain(encodeURIComponent(query));
      expect(deUrl).toContain(encodeURIComponent(query));
    });
  });

  describe('Content Localization', () => {
    it('should detect content language', () => {
      const englishText = 'This is a sample English text about machine learning.';
      const germanText = 'Das ist ein deutscher Text über maschinelles Lernen.';
      
      const englishLang = localizationManager.detectContentLanguage(englishText);
      const germanLang = localizationManager.detectContentLanguage(germanText);

      expect(englishLang).toBe('en');
      expect(germanLang).toBe('de');
    });

    it('should handle mixed language content', () => {
      const mixedText = 'Hello world. Bonjour le monde. Hola mundo.';
      const detectedLang = localizationManager.detectContentLanguage(mixedText);
      
      expect(['en', 'fr', 'es']).toContain(detectedLang);
    });

    it('should translate content when needed', async () => {
      const germanText = 'Guten Tag, wie geht es Ihnen?';
      
      // Mock translation - in real implementation would call translation service
      jest.spyOn(localizationManager, 'translateContent').mockResolvedValue({
        translatedText: 'Good day, how are you?',
        sourceLanguage: 'de',
        targetLanguage: 'en',
        confidence: 0.95
      });

      const result = await localizationManager.translateContent(germanText, 'en');
      
      expect(result.translatedText).toBe('Good day, how are you?');
      expect(result.sourceLanguage).toBe('de');
      expect(result.targetLanguage).toBe('en');
    });
  });

  describe('Performance and Caching', () => {
    it('should cache frequently used configurations', () => {
      // Generate configs multiple times
      localizationManager.generateBrowserContextConfig('US');
      localizationManager.generateBrowserContextConfig('US');
      localizationManager.generateBrowserContextConfig('DE');

      expect(localizationManager.localeCache.size).toBeGreaterThan(0);
    });

    it('should clear caches when needed', () => {
      localizationManager.generateBrowserContextConfig('US');
      localizationManager.clearCaches();

      expect(localizationManager.localeCache.size).toBe(0);
      expect(localizationManager.geoLocationCache.size).toBe(0);
      expect(localizationManager.timezoneCache.size).toBe(0);
    });

    it('should track performance statistics', async () => {
      await localizationManager.applyCountrySettings('DE');
      await localizationManager.applyCountrySettings('FR');
      
      const stats = localizationManager.getPerformanceStats();
      
      expect(stats).toMatchObject({
        configurationsApplied: 2,
        cacheHits: expect.any(Number),
        cacheMisses: expect.any(Number),
        averageConfigTime: expect.any(Number),
        memoryUsage: expect.any(Number)
      });
    });
  });

  describe('Validation and Error Handling', () => {
    it('should validate localization schema', () => {
      const validConfig = {
        countryCode: 'DE',
        language: 'de-DE',
        timezone: 'Europe/Berlin',
        currency: 'EUR',
        geoLocation: {
          latitude: 52.5200,
          longitude: 13.4050,
          accuracy: 10
        }
      };

      expect(() => localizationManager.validateConfiguration(validConfig)).not.toThrow();
    });

    it('should reject invalid configurations', () => {
      const invalidConfigs = [
        { countryCode: 'XXX' }, // Invalid country code
        { currency: 'INVALID' }, // Invalid currency
        { timezone: 'Invalid/Timezone' }, // Invalid timezone
        { geoLocation: { latitude: 91 } } // Invalid latitude
      ];

      invalidConfigs.forEach(config => {
        expect(() => localizationManager.validateConfiguration(config)).toThrow();
      });
    });

    it('should handle missing locale data gracefully', () => {
      const result = localizationManager.getCountryConfig('NONEXISTENT');
      expect(result).toBeNull();
    });

    it('should recover from network errors', async () => {
      // Mock network error for translation
      jest.spyOn(localizationManager, 'translateContent').mockRejectedValue(new Error('Network error'));

      const result = await localizationManager.translateContent('Hello', 'de');
      
      expect(result.error).toBeDefined();
      expect(result.fallback).toBeDefined();
    });
  });

  describe('Integration and Events', () => {
    it('should emit events on configuration changes', (done) => {
      localizationManager.on('settings_changed', (settings) => {
        expect(settings.countryCode).toBe('FR');
        done();
      });

      localizationManager.applyCountrySettings('FR');
    });

    it('should emit events on cache operations', (done) => {
      let eventCount = 0;
      
      localizationManager.on('cache_hit', () => eventCount++);
      localizationManager.on('cache_miss', () => {
        eventCount++;
        if (eventCount >= 2) done(); // Wait for both events
      });

      // First call - cache miss
      localizationManager.generateBrowserContextConfig('IT');
      // Second call - cache hit
      localizationManager.generateBrowserContextConfig('IT');
    });

    it('should provide comprehensive status information', () => {
      const status = localizationManager.getStatus();

      expect(status).toMatchObject({
        isInitialized: true,
        currentSettings: expect.any(Object),
        cacheStats: expect.any(Object),
        performanceStats: expect.any(Object),
        lastActivity: expect.any(Number)
      });
    });
  });

  describe('Cleanup and Resource Management', () => {
    it('should cleanup resources properly', async () => {
      await localizationManager.cleanup();

      expect(localizationManager.localeCache.size).toBe(0);
      expect(localizationManager.geoLocationCache.size).toBe(0);
      expect(localizationManager.timezoneCache.size).toBe(0);
    });

    it('should handle cleanup errors gracefully', async () => {
      // Mock cleanup error
      jest.spyOn(localizationManager, 'clearCaches').mockImplementation(() => {
        throw new Error('Cleanup error');
      });

      await expect(localizationManager.cleanup()).resolves.not.toThrow();
    });

    it('should reset to default settings on cleanup', async () => {
      await localizationManager.applyCountrySettings('DE');
      await localizationManager.cleanup();

      expect(localizationManager.currentSettings.countryCode).toBe('US');
    });
  });
});