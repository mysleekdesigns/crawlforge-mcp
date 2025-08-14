/**
 * Advanced LocalizationManager Tests - Phase 2.3 Features
 * Tests for enhanced localization capabilities including:
 * - Geo-specific content access with proxy integration
 * - Browser locale emulation with RTL support
 * - Content localization with translation integration
 * - Advanced geo-blocking bypass strategies
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import LocalizationManager, { 
  SUPPORTED_COUNTRIES, 
  RTL_LANGUAGES, 
  PROXY_PROVIDERS,
  TRANSLATION_SERVICES 
} from '../../src/core/LocalizationManager.js';

describe('LocalizationManager - Advanced Features (Phase 2.3)', () => {
  let localizationManager;

  beforeEach(() => {
    localizationManager = new LocalizationManager({
      enableProxyRotation: true,
      enableTranslation: true,
      geoBlockingBypass: true
    });
    
    // Mock fetch for network operations
    global.fetch = vi.fn();
  });

  afterEach(async () => {
    await localizationManager.cleanup();
    vi.clearAllMocks();
  });

  describe('Enhanced Country Support', () => {
    it('should support 25+ countries with complete configurations', () => {
      const countries = Object.keys(SUPPORTED_COUNTRIES);
      expect(countries.length).toBeGreaterThanOrEqual(25);
      
      // Verify each country has required properties
      countries.forEach(countryCode => {
        const config = SUPPORTED_COUNTRIES[countryCode];
        expect(config).toHaveProperty('timezone');
        expect(config).toHaveProperty('currency');
        expect(config).toHaveProperty('language');
        expect(config).toHaveProperty('searchDomain');
        expect(config).toHaveProperty('isRTL');
        expect(config).toHaveProperty('proxyRegion');
        expect(config).toHaveProperty('countryName');
      });
    });

    it('should correctly identify RTL languages', () => {
      const rtlCountries = Object.entries(SUPPORTED_COUNTRIES)
        .filter(([, config]) => config.isRTL)
        .map(([code]) => code);
      
      expect(rtlCountries).toContain('SA'); // Saudi Arabia
      expect(rtlCountries).toContain('AE'); // UAE
      expect(rtlCountries).toContain('IL'); // Israel
    });

    it('should provide comprehensive geo-location data', async () => {
      await localizationManager.initialize();
      
      const usLocation = localizationManager.getCountryCoordinates('US');
      expect(usLocation).toHaveProperty('latitude');
      expect(usLocation).toHaveProperty('longitude');
      expect(usLocation).toHaveProperty('city');
      
      const saLocation = localizationManager.getCountryCoordinates('SA');
      expect(saLocation).toHaveProperty('latitude');
      expect(saLocation).toHaveProperty('longitude');
    });
  });

  describe('Proxy Integration and Geo-specific Access', () => {
    beforeEach(() => {
      // Mock environment variables for proxy configuration
      process.env.PROXY_US_EAST_ENABLED = 'true';
      process.env.PROXY_EU_WEST_ENABLED = 'true';
      process.env.PROXY_ASIA_PACIFIC_ENABLED = 'true';
    });

    afterEach(() => {
      delete process.env.PROXY_US_EAST_ENABLED;
      delete process.env.PROXY_EU_WEST_ENABLED;
      delete process.env.PROXY_ASIA_PACIFIC_ENABLED;
    });

    it('should initialize proxy system with regional configurations', async () => {
      await localizationManager.initializeProxySystem();
      
      expect(localizationManager.proxyManager.activeProxies.size).toBeGreaterThan(0);
      expect(localizationManager.proxyManager.activeProxies.has('us-east')).toBe(true);
    });

    it('should select optimal proxy for target country', async () => {
      await localizationManager.initializeProxySystem();
      
      const proxy = await localizationManager.getOptimalProxy('DE', {
        enabled: true,
        type: 'https'
      });
      
      expect(proxy).toBeTruthy();
      expect(proxy.server).toContain('https://');
    });

    it('should perform proxy health checks', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ip: '192.0.2.1' })
      });

      await localizationManager.initializeProxySystem();
      
      const proxy = { healthScore: 50, failureCount: 0 };
      await localizationManager.checkProxyHealth('us-east', proxy);
      
      expect(proxy.healthScore).toBeGreaterThan(50);
      expect(proxy.lastCheck).toBeGreaterThan(0);
    });

    it('should handle proxy rotation strategies', async () => {
      await localizationManager.initializeProxySystem();
      
      const proxySettings = {
        enabled: true,
        rotation: {
          enabled: true,
          strategy: 'round-robin'
        }
      };
      
      const proxy1 = await localizationManager.getOptimalProxy('US', proxySettings);
      const proxy2 = await localizationManager.getOptimalProxy('US', proxySettings);
      
      // Should potentially return different proxies based on rotation
      expect(proxy1).toBeTruthy();
      expect(proxy2).toBeTruthy();
    });
  });

  describe('Browser Locale Emulation with RTL Support', () => {
    it('should generate enhanced browser locale with RTL support', async () => {
      const config = await localizationManager.configureCountry('SA', {
        language: 'ar-SA'
      });
      
      expect(config.browserLocale.isRTL).toBe(true);
      expect(config.browserLocale.textDirection).toBe('rtl');
      expect(config.browserLocale.languages).toContain('ar-SA');
    });

    it('should include cultural behavior patterns', async () => {
      const config = await localizationManager.configureCountry('JP');
      
      expect(config.browserLocale.culturalBehavior).toBeDefined();
      expect(config.browserLocale.culturalBehavior.scrollSpeed).toBeDefined();
      expect(config.browserLocale.culturalBehavior.readingSpeed).toBeDefined();
    });

    it('should configure measurement systems correctly', async () => {
      const usConfig = await localizationManager.configureCountry('US');
      const deConfig = await localizationManager.configureCountry('DE');
      
      expect(usConfig.browserLocale.measurementSystem).toBe('imperial');
      expect(deConfig.browserLocale.measurementSystem).toBe('metric');
    });

    it('should set appropriate time formats', async () => {
      const usConfig = await localizationManager.configureCountry('US');
      const deConfig = await localizationManager.configureCountry('DE');
      
      expect(usConfig.browserLocale.timeFormat).toBe('12h');
      expect(deConfig.browserLocale.timeFormat).toBe('24h');
    });

    it('should generate regional HTTP headers', async () => {
      const headers = localizationManager.generateRegionalHeaders('DE');
      
      expect(headers).toHaveProperty('DNT', '1'); // Privacy-focused country
      expect(headers).toHaveProperty('Sec-GPC', '1');
    });
  });

  describe('Enhanced Geo-blocking Detection and Bypass', () => {
    it('should detect geo-blocking from various indicators', async () => {
      const response = {
        status: 403,
        body: 'Content not available in your region'
      };
      
      const result = await localizationManager.handleGeoBlocking('https://example.com', response);
      
      expect(result.blocked).toBe(true);
      expect(result.bypassStrategies).toBeDefined();
      expect(result.bypassStrategies.length).toBeGreaterThan(0);
    });

    it('should generate comprehensive bypass strategies', async () => {
      const strategies = await localizationManager.generateBypassStrategies(
        'https://example.com',
        { status: 403 }
      );
      
      expect(strategies).toHaveLength(4);
      expect(strategies[0].type).toBe('country_change');
      expect(strategies[1].type).toBe('proxy_rotation');
      expect(strategies[2].type).toBe('user_agent_rotation');
      expect(strategies[3].type).toBe('header_manipulation');
      
      // Strategies should be ordered by priority
      expect(strategies[0].priority).toBeLessThan(strategies[1].priority);
    });

    it('should execute auto-bypass attempts', async () => {
      const strategies = [
        { type: 'country_change', priority: 1 },
        { type: 'proxy_rotation', priority: 2 }
      ];
      
      // Mock successful bypass
      vi.spyOn(localizationManager, 'attemptBypass').mockResolvedValue({
        success: true,
        statusCode: 200,
        method: 'country_change'
      });
      
      const result = await localizationManager.executeAutoBypass('https://example.com', strategies);
      
      expect(result.success).toBe(true);
      expect(result.method).toBe('country_change');
    });

    it('should suggest optimal countries for specific URLs', () => {
      const bbcCountries = localizationManager.getOptimalCountriesForUrl('https://bbc.co.uk/news');
      const cnnCountries = localizationManager.getOptimalCountriesForUrl('https://cnn.com/news');
      
      expect(bbcCountries).toContain('GB');
      expect(cnnCountries).toContain('US');
    });
  });

  describe('Content Localization and Translation', () => {
    beforeEach(() => {
      // Mock translation API keys
      process.env.GOOGLE_TRANSLATE_API_KEY = 'test-key';
    });

    afterEach(() => {
      delete process.env.GOOGLE_TRANSLATE_API_KEY;
    });

    it('should initialize translation services', async () => {
      await localizationManager.initializeTranslationServices();
      
      expect(localizationManager.translationProviders.size).toBeGreaterThan(0);
      expect(localizationManager.translationProviders.has('google')).toBe(true);
    });

    it('should perform advanced language detection', async () => {
      const content = `
        <html lang="de-DE">
          <head><title>Beispiel</title></head>
          <body>Das ist ein Beispiel für deutsche Inhalte.</body>
        </html>
      `;
      
      const detection = await localizationManager.autoDetectLocalization(content, 'https://example.de');
      
      expect(detection.detectedLanguage).toBe('de-DE');
      expect(detection.detectedCountry).toBe('DE');
      expect(detection.confidence).toBeGreaterThan(0.5);
    });

    it('should detect RTL languages and scripts', async () => {
      const arabicContent = `
        <html lang="ar-SA">
          <body>هذا مثال على المحتوى العربي</body>
        </html>
      `;
      
      const detection = await localizationManager.autoDetectLocalization(arabicContent, 'https://example.sa');
      
      expect(detection.isRTL).toBe(true);
      expect(detection.detectedScript).toBe('arabic');
    });

    it('should provide translation recommendations', async () => {
      const content = '<html lang="fr-FR"><body>Contenu français</body></html>';
      
      const detection = await localizationManager.autoDetectLocalization(content, 'https://example.fr');
      
      const translationRec = detection.recommendations.find(r => r.type === 'translation_available');
      expect(translationRec).toBeDefined();
      expect(translationRec.sourceLanguage).toBe('fr-FR');
    });

    it('should translate text using available providers', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            translations: [{ translatedText: 'Hello' }]
          }
        })
      });

      await localizationManager.initializeTranslationServices();
      
      const result = await localizationManager.translateText('Hola', 'es', 'en', 'google');
      
      expect(result).toBe('Hello');
      expect(localizationManager.stats.translationRequests).toBe(1);
    });
  });

  describe('Cultural Browsing Pattern Simulation', () => {
    it('should load cultural patterns for different countries', async () => {
      await localizationManager.loadCulturalPatterns();
      
      const usPattern = localizationManager.getCulturalBehavior('US');
      const jpPattern = localizationManager.getCulturalBehavior('JP');
      
      expect(usPattern.scrollSpeed).toBe('fast');
      expect(jpPattern.scrollSpeed).toBe('medium');
      expect(jpPattern.readingSpeed).toBeGreaterThan(usPattern.readingSpeed);
    });

    it('should adapt behavior for RTL languages', async () => {
      const saPattern = localizationManager.getCulturalBehavior('SA');
      
      expect(saPattern.rtlBehavior).toBe(true);
      expect(saPattern.scrollSpeed).toBe('slow');
    });

    it('should generate enhanced fingerprints with cultural data', async () => {
      const fingerprint = await localizationManager.generateEnhancedFingerprint('JP');
      
      expect(fingerprint.culturalIndicators).toBeDefined();
      expect(fingerprint.culturalIndicators.scrollSpeed).toBe('medium');
      expect(fingerprint.culturalIndicators.isRTL).toBe(false);
    });
  });

  describe('Timezone Spoofing and Locale Injection', () => {
    it('should generate comprehensive timezone spoofing script', async () => {
      const script = await localizationManager.generateTimezoneSpoof('JP');
      
      expect(script).toContain('Asia/Tokyo');
      expect(script).toContain('ja-JP');
      expect(script).toContain('Date.prototype.getTimezoneOffset');
      expect(script).toContain('navigator.language');
    });

    it('should include RTL-specific modifications for RTL countries', async () => {
      const script = await localizationManager.generateTimezoneSpoof('SA');
      
      expect(script).toContain('ar-SA');
      // Should include RTL-specific browser modifications
      expect(script).toContain('document.documentElement');
    });

    it('should override screen properties with regional variations', () => {
      const usOverrides = localizationManager.generateScreenOverrides('US');
      const saOverrides = localizationManager.generateScreenOverrides('SA');
      
      expect(usOverrides).toContain('screen.width');
      expect(saOverrides).toContain('dir: \'rtl\''); // RTL-specific
    });
  });

  describe('Multi-language Site Navigation', () => {
    it('should configure browser context with full localization', async () => {
      const browserOptions = {
        viewport: { width: 1280, height: 720 }
      };
      
      const localizedOptions = await localizationManager.localizeBrowserContext(browserOptions, 'DE');
      
      expect(localizedOptions.locale).toBe('de-DE');
      expect(localizedOptions.timezoneId).toBe('Europe/Berlin');
      expect(localizedOptions.extraHTTPHeaders['Accept-Language']).toContain('de-DE');
      expect(localizedOptions.extraHTTPHeaders['DNT']).toBe('1'); // Privacy-focused
    });

    it('should configure RTL-specific browser settings', async () => {
      const browserOptions = {};
      
      const localizedOptions = await localizationManager.localizeBrowserContext(browserOptions, 'SA');
      
      expect(localizedOptions.extraHTTPHeaders['X-RTL-Support']).toBe('true');
      expect(localizedOptions.extraHTTPHeaders['Content-Language']).toBe('ar-SA');
    });
  });

  describe('Error Handling and Fallbacks', () => {
    it('should handle proxy failures gracefully', async () => {
      // Mock failed proxy health check
      global.fetch.mockRejectedValue(new Error('Connection failed'));
      
      await localizationManager.initializeProxySystem();
      
      const proxy = { healthScore: 100, failureCount: 0 };
      await localizationManager.checkProxyHealth('test-region', proxy);
      
      expect(proxy.healthScore).toBeLessThan(100);
      expect(proxy.failureCount).toBe(1);
    });

    it('should fallback to alternative translation providers', async () => {
      // Mock Google Translate failure, Azure success
      global.fetch
        .mockRejectedValueOnce(new Error('Google API error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ([{ translations: [{ text: 'Hello' }] }])
        });

      await localizationManager.initializeTranslationServices();
      
      const result = await localizationManager.translateText('Hola', 'es', 'en', 'auto');
      
      expect(result).toBeTruthy();
    });

    it('should handle initialization failures', async () => {
      const eventSpy = vi.fn();
      localizationManager.on('error', eventSpy);
      
      // Mock initialization failure
      vi.spyOn(localizationManager, 'loadTimezoneData').mockRejectedValue(new Error('Init failed'));
      
      await expect(localizationManager.initialize()).rejects.toThrow('Init failed');
      expect(eventSpy).toHaveBeenCalledWith({
        type: 'initialization_failed',
        error: 'Init failed'
      });
    });
  });

  describe('Performance and Caching', () => {
    it('should cache localization configurations', async () => {
      const config1 = await localizationManager.configureCountry('US');
      const config2 = await localizationManager.configureCountry('US');
      
      // Second call should use cache
      expect(localizationManager.localeCache.size).toBeGreaterThan(0);
    });

    it('should cache translation results', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { translations: [{ translatedText: 'Hello' }] }
        })
      });

      await localizationManager.initializeTranslationServices();
      
      await localizationManager.translateText('Hola', 'es', 'en');
      await localizationManager.translateText('Hola', 'es', 'en'); // Should use cache
      
      expect(localizationManager.translationCache.size).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(1); // Only one API call
    });

    it('should provide comprehensive statistics', async () => {
      await localizationManager.configureCountry('US');
      await localizationManager.handleGeoBlocking('https://example.com', { status: 403 });
      
      const stats = localizationManager.getStats();
      
      expect(stats.localizationApplied).toBe(1);
      expect(stats.geoBlocksBypass).toBe(1);
      expect(stats.supportedCountries).toBeGreaterThanOrEqual(25);
      expect(stats.activeProxies).toBeDefined();
      expect(stats.translationProviders).toBeDefined();
    });
  });

  describe('Integration Tests', () => {
    it('should perform end-to-end localization for RTL country', async () => {
      const url = 'https://example.sa';
      const content = '<html lang="ar-SA"><body>محتوى عربي</body></html>';
      
      // Configure for Saudi Arabia
      const config = await localizationManager.configureCountry('SA');
      
      // Detect content localization
      const detection = await localizationManager.autoDetectLocalization(content, url);
      
      // Generate browser context
      const browserOptions = await localizationManager.localizeBrowserContext({}, 'SA');
      
      // Generate timezone spoofing
      const timezoneScript = await localizationManager.generateTimezoneSpoof('SA');
      
      // Verify comprehensive localization
      expect(config.browserLocale.isRTL).toBe(true);
      expect(detection.isRTL).toBe(true);
      expect(browserOptions.extraHTTPHeaders['X-RTL-Support']).toBe('true');
      expect(timezoneScript).toContain('ar-SA');
    });

    it('should handle complex geo-blocking scenario', async () => {
      const response = {
        status: 451,
        body: 'This content is not available in your country due to legal restrictions'
      };
      
      const result = await localizationManager.handleGeoBlocking('https://restricted-site.com', response);
      
      expect(result.blocked).toBe(true);
      expect(result.bypassStrategies).toHaveLength(4);
      
      if (result.autoBypass) {
        expect(result.bypassResult).toBeDefined();
      }
    });
  });
});