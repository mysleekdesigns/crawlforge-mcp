/**
 * Unit tests for Stealth Mode features - Wave 3
 * Tests StealthBrowserManager and HumanBehaviorSimulator
 * for anti-detection browser management and human behavior simulation
 */

import { describe, it, beforeEach, afterEach, expect, jest } from '@jest/globals';
import { StealthBrowserManager } from '../../src/core/StealthBrowserManager.js';
import { HumanBehaviorSimulator } from '../../src/core/HumanBehaviorSimulator.js';

// Mock Playwright
jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn(),
    launchPersistentContext: jest.fn()
  }
}));

describe('StealthBrowserManager', () => {
  let stealthManager;
  let mockBrowser;
  let mockContext;
  let mockPage;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup mock browser objects
    mockPage = {
      setUserAgent: jest.fn(),
      setViewportSize: jest.fn(),
      setExtraHTTPHeaders: jest.fn(),
      evaluateOnNewDocument: jest.fn(),
      goto: jest.fn(),
      waitForLoadState: jest.fn(),
      screenshot: jest.fn(),
      close: jest.fn(),
      on: jest.fn(),
      route: jest.fn(),
      addInitScript: jest.fn()
    };

    mockContext = {
      newPage: jest.fn().mockResolvedValue(mockPage),
      setDefaultTimeout: jest.fn(),
      setDefaultNavigationTimeout: jest.fn(),
      close: jest.fn(),
      addInitScript: jest.fn(),
      grantPermissions: jest.fn(),
      setGeolocation: jest.fn()
    };

    mockBrowser = {
      newContext: jest.fn().mockResolvedValue(mockContext),
      close: jest.fn(),
      contexts: jest.fn().mockReturnValue([])
    };

    // Mock chromium.launch
    const { chromium } = require('playwright');
    chromium.launch.mockResolvedValue(mockBrowser);
    chromium.launchPersistentContext.mockResolvedValue(mockContext);

    stealthManager = new StealthBrowserManager();
  });

  afterEach(async () => {
    if (stealthManager && stealthManager.browser) {
      await stealthManager.close();
    }
  });

  describe('Constructor and Configuration', () => {
    it('should initialize with default stealth configuration', () => {
      expect(stealthManager.defaultConfig).toMatchObject({
        level: 'medium',
        randomizeFingerprint: true,
        hideWebDriver: true,
        blockWebRTC: true,
        spoofTimezone: true,
        randomizeHeaders: true,
        useRandomUserAgent: true,
        simulateHumanBehavior: true,
        locale: 'en-US'
      });
    });

    it('should have predefined user agent pools', () => {
      expect(stealthManager.userAgentPools.chrome).toBeInstanceOf(Array);
      expect(stealthManager.userAgentPools.chrome.length).toBeGreaterThan(0);
      expect(stealthManager.userAgentPools.firefox).toBeInstanceOf(Array);
      expect(stealthManager.userAgentPools.safari).toBeInstanceOf(Array);
    });

    it('should have predefined viewport sizes', () => {
      expect(stealthManager.viewportSizes).toBeInstanceOf(Array);
      expect(stealthManager.viewportSizes.length).toBeGreaterThan(0);
      expect(stealthManager.viewportSizes[0]).toHaveProperty('width');
      expect(stealthManager.viewportSizes[0]).toHaveProperty('height');
    });

    it('should have timezone and WebRTC IP options', () => {
      expect(stealthManager.timezones).toBeInstanceOf(Array);
      expect(stealthManager.timezones.length).toBeGreaterThan(0);
      expect(stealthManager.webRTCIPs).toBeInstanceOf(Array);
      expect(stealthManager.webRTCIPs.length).toBeGreaterThan(0);
    });
  });

  describe('Browser Launch', () => {
    it('should launch stealth browser with anti-detection configurations', async () => {
      await stealthManager.launch();

      expect(require('playwright').chromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: true,
          args: expect.arrayContaining([
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
          ])
        })
      );

      expect(stealthManager.browser).toBe(mockBrowser);
    });

    it('should apply different configurations based on stealth level', async () => {
      const basicManager = new StealthBrowserManager();
      await basicManager.launch({ level: 'basic' });

      const advancedManager = new StealthBrowserManager();
      await advancedManager.launch({ level: 'advanced' });

      // Both should launch but with different configurations
      expect(require('playwright').chromium.launch).toHaveBeenCalledTimes(2);
    });

    it('should handle launch failures gracefully', async () => {
      require('playwright').chromium.launch.mockRejectedValue(new Error('Launch failed'));

      await expect(stealthManager.launch()).rejects.toThrow('Launch failed');
      expect(stealthManager.browser).toBeNull();
    });

    it('should support persistent context launch', async () => {
      await stealthManager.launch({ 
        persistent: true,
        userDataDir: '/tmp/test-profile'
      });

      expect(require('playwright').chromium.launchPersistentContext).toHaveBeenCalled();
    });
  });

  describe('Context Creation and Management', () => {
    beforeEach(async () => {
      await stealthManager.launch();
    });

    it('should create stealth context with randomized fingerprint', async () => {
      const contextId = 'test-context';
      const context = await stealthManager.createStealthContext(contextId);

      expect(mockBrowser.newContext).toHaveBeenCalled();
      expect(stealthManager.contexts.has(contextId)).toBe(true);
      expect(stealthManager.fingerprints.has(contextId)).toBe(true);
    });

    it('should apply stealth configurations to context', async () => {
      const contextId = 'test-context';
      await stealthManager.createStealthContext(contextId, {
        randomizeFingerprint: true,
        hideWebDriver: true,
        blockWebRTC: true
      });

      expect(mockContext.addInitScript).toHaveBeenCalled();
      expect(mockContext.setDefaultTimeout).toHaveBeenCalled();
    });

    it('should generate unique fingerprints for each context', async () => {
      const context1 = await stealthManager.createStealthContext('ctx1');
      const context2 = await stealthManager.createStealthContext('ctx2');

      const fingerprint1 = stealthManager.fingerprints.get('ctx1');
      const fingerprint2 = stealthManager.fingerprints.get('ctx2');

      expect(fingerprint1).not.toEqual(fingerprint2);
      expect(fingerprint1.userAgent).toBeDefined();
      expect(fingerprint1.viewport).toBeDefined();
      expect(fingerprint1.timezone).toBeDefined();
    });

    it('should manage multiple contexts independently', async () => {
      await stealthManager.createStealthContext('ctx1');
      await stealthManager.createStealthContext('ctx2');

      expect(stealthManager.contexts.size).toBe(2);
      expect(stealthManager.fingerprints.size).toBe(2);
    });
  });

  describe('Page Creation and Stealth Setup', () => {
    let context;

    beforeEach(async () => {
      await stealthManager.launch();
      context = await stealthManager.createStealthContext('test-ctx');
    });

    it('should create stealth page with anti-detection scripts', async () => {
      const page = await stealthManager.createStealthPage('test-ctx');

      expect(mockContext.newPage).toHaveBeenCalled();
      expect(mockPage.setUserAgent).toHaveBeenCalled();
      expect(mockPage.setViewportSize).toHaveBeenCalled();
      expect(mockPage.evaluateOnNewDocument).toHaveBeenCalled();
    });

    it('should inject stealth scripts to hide webdriver', async () => {
      await stealthManager.createStealthPage('test-ctx');

      // Verify webdriver hiding scripts were injected
      expect(mockPage.evaluateOnNewDocument).toHaveBeenCalledWith(
        expect.stringContaining('navigator.webdriver')
      );
    });

    it('should block WebRTC when configured', async () => {
      await stealthManager.createStealthPage('test-ctx', { blockWebRTC: true });

      expect(mockPage.evaluateOnNewDocument).toHaveBeenCalledWith(
        expect.stringContaining('RTCPeerConnection')
      );
    });

    it('should spoof timezone when configured', async () => {
      const fingerprint = stealthManager.fingerprints.get('test-ctx');
      await stealthManager.createStealthPage('test-ctx', { spoofTimezone: true });

      expect(mockPage.evaluateOnNewDocument).toHaveBeenCalledWith(
        expect.stringContaining(fingerprint.timezone)
      );
    });

    it('should randomize headers when configured', async () => {
      await stealthManager.createStealthPage('test-ctx', { randomizeHeaders: true });

      expect(mockPage.setExtraHTTPHeaders).toHaveBeenCalledWith(
        expect.objectContaining({
          'Accept-Language': expect.any(String),
          'Accept-Encoding': expect.any(String)
        })
      );
    });
  });

  describe('Fingerprint Generation', () => {
    it('should generate realistic fingerprints', () => {
      const fingerprint = stealthManager.generateFingerprint();

      expect(fingerprint).toMatchObject({
        userAgent: expect.any(String),
        viewport: expect.objectContaining({
          width: expect.any(Number),
          height: expect.any(Number)
        }),
        timezone: expect.any(String),
        language: expect.any(String),
        platform: expect.any(String),
        webGL: expect.objectContaining({
          vendor: expect.any(String),
          renderer: expect.any(String)
        }),
        canvas: expect.any(String),
        audio: expect.any(String)
      });
    });

    it('should generate different fingerprints on each call', () => {
      const fingerprint1 = stealthManager.generateFingerprint();
      const fingerprint2 = stealthManager.generateFingerprint();

      expect(fingerprint1).not.toEqual(fingerprint2);
    });

    it('should use custom user agent when provided', () => {
      const customUA = 'Custom User Agent String';
      const fingerprint = stealthManager.generateFingerprint({
        customUserAgent: customUA
      });

      expect(fingerprint.userAgent).toBe(customUA);
    });

    it('should use custom viewport when provided', () => {
      const customViewport = { width: 1600, height: 900 };
      const fingerprint = stealthManager.generateFingerprint({
        customViewport
      });

      expect(fingerprint.viewport).toEqual(customViewport);
    });
  });

  describe('Anti-Detection Scripts', () => {
    it('should generate comprehensive anti-detection scripts', () => {
      const scripts = stealthManager.generateAntiDetectionScripts();

      expect(scripts).toBeInstanceOf(Array);
      expect(scripts.length).toBeGreaterThan(0);
      
      const combinedScript = scripts.join('\n');
      expect(combinedScript).toContain('navigator.webdriver');
      expect(combinedScript).toContain('chrome.runtime');
      expect(combinedScript).toContain('permissions.query');
    });

    it('should include WebRTC blocking scripts', () => {
      const scripts = stealthManager.generateWebRTCBlockingScript(['192.168.1.1']);

      expect(scripts).toContain('RTCPeerConnection');
      expect(scripts).toContain('192.168.1.1');
    });

    it('should generate timezone spoofing script', () => {
      const script = stealthManager.generateTimezoneScript('America/New_York');

      expect(script).toContain('America/New_York');
      expect(script).toContain('getTimezoneOffset');
    });

    it('should generate plugin and media device scripts', () => {
      const fingerprint = stealthManager.generateFingerprint();
      const scripts = stealthManager.generatePluginScript(fingerprint);

      expect(scripts).toContain('navigator.plugins');
      expect(scripts).toContain('navigator.mimeTypes');
    });
  });

  describe('Human Behavior Simulation Integration', () => {
    let behaviorSimulator;

    beforeEach(() => {
      behaviorSimulator = new HumanBehaviorSimulator();
    });

    it('should integrate with HumanBehaviorSimulator', () => {
      expect(behaviorSimulator).toBeDefined();
      expect(typeof behaviorSimulator.simulateTyping).toBe('function');
      expect(typeof behaviorSimulator.simulateMouseMovement).toBe('function');
      expect(typeof behaviorSimulator.simulateScrolling).toBe('function');
    });

    it('should simulate realistic typing patterns', async () => {
      const page = mockPage;
      const text = 'Hello World';
      const options = { minDelay: 50, maxDelay: 150 };

      await behaviorSimulator.simulateTyping(page, text, options);

      // Verify typing simulation was called appropriately
      expect(page.evaluateOnNewDocument).toHaveBeenCalled();
    });

    it('should simulate mouse movement patterns', async () => {
      const page = mockPage;
      const targetElement = '#submit-button';
      const options = { humanLike: true, duration: 1000 };

      await behaviorSimulator.simulateMouseMovement(page, targetElement, options);

      // Verify mouse movement simulation
      expect(page.evaluateOnNewDocument).toHaveBeenCalled();
    });

    it('should simulate natural scrolling behavior', async () => {
      const page = mockPage;
      const options = { 
        direction: 'down', 
        distance: 500, 
        speed: 'normal',
        pauses: true 
      };

      await behaviorSimulator.simulateScrolling(page, options);

      // Verify scrolling simulation
      expect(page.evaluateOnNewDocument).toHaveBeenCalled();
    });

    it('should add random delays between actions', async () => {
      const startTime = Date.now();
      await behaviorSimulator.addRandomDelay(100, 200);
      const elapsedTime = Date.now() - startTime;

      expect(elapsedTime).toBeGreaterThanOrEqual(100);
      expect(elapsedTime).toBeLessThan(300); // Allow some buffer
    });
  });

  describe('Page Navigation with Stealth', () => {
    let page;

    beforeEach(async () => {
      await stealthManager.launch();
      await stealthManager.createStealthContext('test-ctx');
      page = await stealthManager.createStealthPage('test-ctx');
    });

    it('should navigate with stealth configurations', async () => {
      const url = 'https://example.com';
      
      await stealthManager.stealthNavigate(page, url);

      expect(mockPage.goto).toHaveBeenCalledWith(url, expect.any(Object));
      expect(mockPage.waitForLoadState).toHaveBeenCalled();
    });

    it('should handle navigation timeouts', async () => {
      mockPage.goto.mockRejectedValue(new Error('Navigation timeout'));

      await expect(
        stealthManager.stealthNavigate(mockPage, 'https://example.com')
      ).rejects.toThrow('Navigation timeout');
    });

    it('should apply request interception for stealth', async () => {
      await stealthManager.createStealthPage('test-ctx', { 
        interceptRequests: true 
      });

      expect(mockPage.route).toHaveBeenCalled();
    });
  });

  describe('Resource Management', () => {
    beforeEach(async () => {
      await stealthManager.launch();
    });

    it('should close specific context', async () => {
      await stealthManager.createStealthContext('test-ctx');
      
      await stealthManager.closeContext('test-ctx');

      expect(stealthManager.contexts.has('test-ctx')).toBe(false);
      expect(stealthManager.fingerprints.has('test-ctx')).toBe(false);
    });

    it('should close all contexts and browser', async () => {
      await stealthManager.createStealthContext('ctx1');
      await stealthManager.createStealthContext('ctx2');

      await stealthManager.close();

      expect(stealthManager.contexts.size).toBe(0);
      expect(stealthManager.fingerprints.size).toBe(0);
      expect(mockBrowser.close).toHaveBeenCalled();
      expect(stealthManager.browser).toBeNull();
    });

    it('should handle cleanup errors gracefully', async () => {
      mockBrowser.close.mockRejectedValue(new Error('Close failed'));

      await expect(stealthManager.close()).resolves.not.toThrow();
    });
  });

  describe('Configuration Validation', () => {
    it('should validate stealth configuration schema', () => {
      const validConfig = {
        level: 'medium',
        randomizeFingerprint: true,
        hideWebDriver: true,
        locale: 'en-US'
      };

      expect(() => stealthManager.validateConfig(validConfig)).not.toThrow();
    });

    it('should reject invalid stealth levels', () => {
      const invalidConfig = { level: 'extreme' };

      expect(() => stealthManager.validateConfig(invalidConfig)).toThrow();
    });

    it('should reject invalid viewport dimensions', () => {
      const invalidConfig = {
        customViewport: { width: 500, height: 400 } // Too small
      };

      expect(() => stealthManager.validateConfig(invalidConfig)).toThrow();
    });
  });

  describe('Performance and Memory Management', () => {
    it('should track resource usage', async () => {
      await stealthManager.launch();
      await stealthManager.createStealthContext('ctx1');
      await stealthManager.createStealthContext('ctx2');

      const stats = stealthManager.getResourceStats();

      expect(stats).toMatchObject({
        activeContexts: 2,
        activePage: expect.any(Number),
        memoryUsage: expect.any(Number),
        uptime: expect.any(Number)
      });
    });

    it('should limit concurrent contexts', async () => {
      await stealthManager.launch();

      const maxContexts = 10;
      const contexts = [];
      
      for (let i = 0; i < maxContexts + 5; i++) {
        try {
          await stealthManager.createStealthContext(`ctx${i}`);
          contexts.push(`ctx${i}`);
        } catch (error) {
          // Should reject after reaching limit
          expect(error.message).toContain('context limit');
        }
      }

      expect(contexts.length).toBeLessThanOrEqual(maxContexts);
    });

    it('should implement context recycling for memory efficiency', async () => {
      await stealthManager.launch();
      
      // Create and close contexts multiple times
      for (let i = 0; i < 5; i++) {
        await stealthManager.createStealthContext(`ctx${i}`);
        await stealthManager.closeContext(`ctx${i}`);
      }

      const stats = stealthManager.getResourceStats();
      expect(stats.activeContexts).toBe(0);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should recover from browser crashes', async () => {
      await stealthManager.launch();
      
      // Simulate browser crash
      stealthManager.browser = null;
      
      // Should automatically recover
      await stealthManager.createStealthContext('recovery-test');
      
      expect(stealthManager.browser).not.toBeNull();
    });

    it('should handle context creation failures', async () => {
      await stealthManager.launch();
      mockBrowser.newContext.mockRejectedValue(new Error('Context creation failed'));

      await expect(
        stealthManager.createStealthContext('fail-test')
      ).rejects.toThrow('Context creation failed');
    });

    it('should maintain stability with concurrent operations', async () => {
      await stealthManager.launch();

      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(stealthManager.createStealthContext(`concurrent${i}`));
      }

      await Promise.all(promises);
      expect(stealthManager.contexts.size).toBe(5);
    });
  });

  describe('Stealth Effectiveness Metrics', () => {
    it('should track detection avoidance metrics', () => {
      const metrics = stealthManager.getStealthMetrics();

      expect(metrics).toMatchObject({
        fingerprintsGenerated: expect.any(Number),
        scriptsInjected: expect.any(Number),
        requestsIntercepted: expect.any(Number),
        detectionAttempts: expect.any(Number),
        successfulBypasses: expect.any(Number)
      });
    });

    it('should calculate stealth effectiveness score', () => {
      stealthManager.stats = {
        detectionAttempts: 100,
        successfulBypasses: 95,
        scriptsInjected: 50,
        fingerprintsGenerated: 10
      };

      const score = stealthManager.calculateStealthScore();
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });
});

describe('HumanBehaviorSimulator', () => {
  let simulator;
  let mockPage;

  beforeEach(() => {
    simulator = new HumanBehaviorSimulator();
    
    mockPage = {
      mouse: {
        move: jest.fn(),
        click: jest.fn()
      },
      keyboard: {
        type: jest.fn(),
        press: jest.fn()
      },
      evaluate: jest.fn(),
      waitForTimeout: jest.fn()
    };
  });

  describe('Typing Simulation', () => {
    it('should simulate human-like typing with random delays', async () => {
      const text = 'Hello World';
      await simulator.simulateTyping(mockPage, text, {
        minDelay: 50,
        maxDelay: 150,
        mistakeChance: 0.05
      });

      expect(mockPage.keyboard.type).toHaveBeenCalled();
    });

    it('should occasionally make and correct typing mistakes', async () => {
      await simulator.simulateTyping(mockPage, 'test', {
        mistakeChance: 1.0 // Force mistakes for testing
      });

      // Should have additional keystrokes for mistakes and corrections
      expect(mockPage.keyboard.type).toHaveBeenCalled();
    });
  });

  describe('Mouse Movement Simulation', () => {
    it('should simulate curved mouse movements', async () => {
      await simulator.simulateMouseMovement(mockPage, { x: 100, y: 100 }, {
        humanLike: true,
        duration: 1000
      });

      expect(mockPage.mouse.move).toHaveBeenCalled();
    });

    it('should add random pauses during movement', async () => {
      await simulator.simulateMouseMovement(mockPage, { x: 500, y: 500 }, {
        addPauses: true,
        pauseChance: 0.3
      });

      expect(mockPage.waitForTimeout).toHaveBeenCalled();
    });
  });

  describe('Scrolling Simulation', () => {
    it('should simulate natural scrolling patterns', async () => {
      await simulator.simulateScrolling(mockPage, {
        direction: 'down',
        distance: 1000,
        speed: 'normal'
      });

      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('should vary scrolling speed and add pauses', async () => {
      await simulator.simulateScrolling(mockPage, {
        direction: 'up',
        distance: 500,
        speed: 'slow',
        addPauses: true
      });

      expect(mockPage.waitForTimeout).toHaveBeenCalled();
    });
  });

  describe('Complex Behavior Patterns', () => {
    it('should simulate reading behavior with eye tracking patterns', async () => {
      await simulator.simulateReading(mockPage, {
        duration: 5000,
        focusAreas: ['.title', '.content', '.summary']
      });

      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('should simulate form filling with realistic patterns', async () => {
      const formData = {
        name: 'John Doe',
        email: 'john@example.com',
        message: 'Hello there!'
      };

      await simulator.simulateFormFilling(mockPage, formData, {
        tabBetweenFields: true,
        addThinkingPauses: true
      });

      expect(mockPage.keyboard.type).toHaveBeenCalledTimes(3);
    });

    it('should simulate shopping behavior patterns', async () => {
      await simulator.simulateShoppingBehavior(mockPage, {
        browsingTime: 10000,
        productViews: 3,
        addToCart: true,
        checkoutProbability: 0.7
      });

      expect(mockPage.evaluate).toHaveBeenCalled();
    });
  });
});