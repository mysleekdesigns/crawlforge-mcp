/**
 * Integration tests for Wave 3 features
 * Tests the integration between all Wave 3 components:
 * - Deep Research Tool (ResearchOrchestrator)
 * - Stealth Mode (StealthBrowserManager, HumanBehaviorSimulator)
 * - Localization (LocalizationManager)
 * - Change Tracking (ChangeTracker)
 */

import { describe, it, beforeEach, afterEach, expect, jest } from '@jest/globals';
import { ResearchOrchestrator } from '../../src/core/ResearchOrchestrator.js';
import { StealthBrowserManager } from '../../src/core/StealthBrowserManager.js';
import { LocalizationManager } from '../../src/core/LocalizationManager.js';
import { ChangeTracker } from '../../src/core/ChangeTracker.js';
import { deepResearchTool } from '../../src/tools/research/deepResearch.js';
import { trackChangesTool } from '../../src/tools/tracking/trackChanges.js';

// Mock external dependencies
jest.mock('playwright');
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    readdir: jest.fn()
  }
}));

describe('Wave 3 Integration Tests', () => {
  let researchOrchestrator;
  let stealthManager;
  let localizationManager;
  let changeTracker;

  const mockPage = {
    goto: jest.fn(),
    content: jest.fn(),
    screenshot: jest.fn(),
    evaluate: jest.fn(),
    setUserAgent: jest.fn(),
    setViewportSize: jest.fn(),
    close: jest.fn()
  };

  const mockContext = {
    newPage: jest.fn().mockResolvedValue(mockPage),
    close: jest.fn()
  };

  const mockBrowser = {
    newContext: jest.fn().mockResolvedValue(mockContext),
    close: jest.fn()
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Setup browser mocks
    require('playwright').chromium = {
      launch: jest.fn().mockResolvedValue(mockBrowser)
    };

    // Initialize all Wave 3 components
    researchOrchestrator = new ResearchOrchestrator({
      maxDepth: 3,
      maxUrls: 20,
      timeLimit: 30000,
      enableSourceVerification: true
    });

    stealthManager = new StealthBrowserManager();
    
    localizationManager = new LocalizationManager({
      countryCode: 'US',
      language: 'en-US'
    });

    changeTracker = new ChangeTracker({
      enableRealTimeTracking: false,
      maxHistoryLength: 10
    });
  });

  afterEach(async () => {
    await Promise.all([
      researchOrchestrator?.cleanup(),
      stealthManager?.close(),
      localizationManager?.cleanup(),
      changeTracker?.cleanup()
    ]);
  });

  describe('Research + Stealth Integration', () => {
    it('should conduct research using stealth browser', async () => {
      // Mock successful browser launch and page creation
      await stealthManager.launch();
      const context = await stealthManager.createStealthContext('research-context');
      const page = await stealthManager.createStealthPage('research-context');

      // Mock page content for research
      mockPage.goto.mockResolvedValue(null);
      mockPage.content.mockResolvedValue(`
        <html>
          <head><title>AI in Healthcare Research</title></head>
          <body>
            <article>
              <h1>Machine Learning Applications in Healthcare</h1>
              <p>Artificial intelligence is revolutionizing healthcare through various applications...</p>
              <p>Deep learning models are showing promising results in medical diagnosis...</p>
            </article>
          </body>
        </html>
      `);

      // Configure research with stealth browsing
      const researchTopic = 'AI applications in healthcare';
      const researchOptions = {
        maxDepth: 2,
        maxUrls: 5,
        useStealthBrowsing: true,
        stealthContext: 'research-context'
      };

      // Mock research orchestrator to use stealth browser
      jest.spyOn(researchOrchestrator, 'performDeepContentAnalysis').mockImplementation(async (sources) => {
        // Simulate using stealth browser for content extraction
        for (const source of sources) {
          await page.goto(source.url);
          const content = await page.content();
          // Process content...
        }
        
        return {
          extractedContent: new Map([
            ['https://example.com/ai-healthcare', {
              title: 'AI in Healthcare',
              content: 'Comprehensive content about AI applications...',
              credibilityScore: 0.9
            }]
          ]),
          relatedSources: []
        };
      });

      const result = await researchOrchestrator.conductResearch(researchTopic, researchOptions);

      expect(result).toBeDefined();
      expect(result.status).toBe('completed');
      expect(result.findings).toBeInstanceOf(Array);
      expect(mockPage.goto).toHaveBeenCalled();
      expect(stealthManager.contexts.has('research-context')).toBe(true);
    });

    it('should apply human behavior simulation during research', async () => {
      await stealthManager.launch();
      const page = await stealthManager.createStealthPage('behavioral-context', {
        simulateHumanBehavior: true
      });

      // Mock HumanBehaviorSimulator integration
      const behaviorSimulator = stealthManager.behaviorSimulator;
      if (behaviorSimulator) {
        jest.spyOn(behaviorSimulator, 'simulateReading').mockResolvedValue(true);
        jest.spyOn(behaviorSimulator, 'simulateScrolling').mockResolvedValue(true);
        jest.spyOn(behaviorSimulator, 'addRandomDelay').mockResolvedValue(true);
      }

      // Simulate research with behavioral patterns
      mockPage.goto.mockResolvedValue(null);
      mockPage.evaluate.mockResolvedValue({ scrolled: true });

      const researchResult = await researchOrchestrator.conductResearch('test topic', {
        useStealthBrowsing: true,
        enableBehaviorSimulation: true,
        stealthContext: 'behavioral-context'
      });

      expect(researchResult).toBeDefined();
      // Verify behavioral simulation was applied during research
      if (behaviorSimulator) {
        expect(behaviorSimulator.simulateReading).toHaveBeenCalled();
      }
    });

    it('should handle stealth detection during research', async () => {
      await stealthManager.launch();
      const page = await stealthManager.createStealthPage('detection-test');

      // Simulate anti-bot detection
      mockPage.goto.mockRejectedValueOnce(new Error('Access denied - bot detected'));
      mockPage.goto.mockResolvedValueOnce(null); // Second attempt succeeds

      // Mock stealth manager's detection handling
      jest.spyOn(stealthManager, 'handleDetection').mockImplementation(async () => {
        // Regenerate fingerprint and retry
        const newFingerprint = stealthManager.generateFingerprint();
        stealthManager.fingerprints.set('detection-test', newFingerprint);
        return true;
      });

      const result = await researchOrchestrator.conductResearch('test topic', {
        useStealthBrowsing: true,
        retryOnDetection: true
      });

      expect(result.status).toBe('completed');
      expect(stealthManager.handleDetection).toHaveBeenCalled();
    });
  });

  describe('Research + Localization Integration', () => {
    it('should conduct localized research', async () => {
      // Configure localization for German market
      await localizationManager.applyCountrySettings('DE');
      
      const localizedHeaders = localizationManager.generateLocalizedHeaders('DE');
      const browserConfig = localizationManager.generateBrowserContextConfig('DE');

      // Mock localized search results
      jest.spyOn(researchOrchestrator.searchTool, 'execute').mockResolvedValue({
        results: [
          {
            title: 'KI in der Medizin',
            url: 'https://beispiel.de/ki-medizin',
            snippet: 'Künstliche Intelligenz revolutioniert das Gesundheitswesen...',
            credibilityScore: 0.8
          },
          {
            title: 'Maschinelles Lernen in Krankenhäusern',
            url: 'https://medizin.de/ml-krankenhaus',
            snippet: 'Deep Learning Modelle zeigen vielversprechende Ergebnisse...',
            credibilityScore: 0.9
          }
        ],
        totalResults: 2
      });

      const researchResult = await researchOrchestrator.conductResearch('KI in der Medizin', {
        localization: {
          countryCode: 'DE',
          language: 'de-DE',
          searchDomain: 'google.de'
        },
        useLocalizedSources: true
      });

      expect(researchResult.findings.length).toBeGreaterThan(0);
      expect(researchResult.localizationSettings).toMatchObject({
        countryCode: 'DE',
        language: 'de-DE'
      });
      expect(researchOrchestrator.searchTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          searchDomain: 'google.de',
          headers: expect.objectContaining({
            'Accept-Language': expect.stringContaining('de-DE')
          })
        })
      );
    });

    it('should handle multi-language content during research', async () => {
      const multiLanguageContent = [
        { url: 'https://example.com/en', content: 'English content about AI', language: 'en' },
        { url: 'https://beispiel.de/de', content: 'Deutscher Inhalt über KI', language: 'de' },
        { url: 'https://exemple.fr/fr', content: 'Contenu français sur IA', language: 'fr' }
      ];

      // Mock language detection and translation
      jest.spyOn(localizationManager, 'detectContentLanguage').mockImplementation((content) => {
        if (content.includes('Deutscher')) return 'de';
        if (content.includes('français')) return 'fr';
        return 'en';
      });

      jest.spyOn(localizationManager, 'translateContent').mockImplementation(async (content, targetLang) => ({
        translatedText: `Translated to ${targetLang}: ${content.substring(0, 50)}...`,
        sourceLanguage: 'de',
        targetLanguage: targetLang,
        confidence: 0.9
      }));

      const researchResult = await researchOrchestrator.conductResearch('AI research', {
        enableTranslation: true,
        targetLanguage: 'en',
        includeMultiLanguageSources: true
      });

      expect(researchResult.multiLanguageAnalysis).toBeDefined();
      expect(localizationManager.detectContentLanguage).toHaveBeenCalled();
      expect(localizationManager.translateContent).toHaveBeenCalled();
    });

    it('should respect regional content preferences', async () => {
      // Test research with different regional preferences
      const regions = ['US', 'DE', 'JP'];
      const results = {};

      for (const region of regions) {
        await localizationManager.applyCountrySettings(region);
        
        const searchDomain = localizationManager.getSearchDomain(region);
        const coordinates = localizationManager.getCountryCoordinates(region);
        
        // Mock region-specific search results
        jest.spyOn(researchOrchestrator.searchTool, 'execute').mockResolvedValue({
          results: [{
            title: `${region} specific AI research`,
            url: `https://example.${region.toLowerCase()}/ai-research`,
            snippet: `Regional content for ${region}...`,
            credibilityScore: 0.8,
            region: region
          }],
          searchDomain,
          coordinates
        });

        const researchResult = await researchOrchestrator.conductResearch('AI research', {
          regionalPreferences: {
            countryCode: region,
            prioritizeLocalSources: true
          }
        });

        results[region] = researchResult;
      }

      // Verify region-specific results
      expect(results.US.sources[0].region).toBe('US');
      expect(results.DE.sources[0].region).toBe('DE');
      expect(results.JP.sources[0].region).toBe('JP');
    });
  });

  describe('Research + Change Tracking Integration', () => {
    it('should track changes in research sources over time', async () => {
      const researchTopic = 'AI breakthrough research';
      const sourceUrl = 'https://example.com/ai-news';

      // Initial research
      jest.spyOn(researchOrchestrator.extractTool, 'execute').mockResolvedValueOnce({
        title: 'AI Breakthrough in Healthcare',
        content: 'Initial research content about AI breakthrough...',
        lastModified: '2023-01-01'
      });

      const initialResearch = await researchOrchestrator.conductResearch(researchTopic, {
        enableChangeTracking: true,
        trackingSources: [sourceUrl]
      });

      // Create initial snapshot in change tracker
      await changeTracker.createSnapshot(sourceUrl, initialResearch.findings[0].content);

      // Simulate content change after some time
      jest.spyOn(researchOrchestrator.extractTool, 'execute').mockResolvedValueOnce({
        title: 'Major AI Breakthrough in Healthcare - Updated',
        content: 'Updated research content with new findings about AI breakthrough...',
        lastModified: '2023-01-02'
      });

      const updatedResearch = await researchOrchestrator.conductResearch(researchTopic, {
        enableChangeTracking: true,
        trackingSources: [sourceUrl]
      });

      // Detect changes
      const changes = await changeTracker.detectChanges(sourceUrl, updatedResearch.findings[0].content);

      expect(changes.hasChanges).toBe(true);
      expect(changes.significance).not.toBe('none');
      expect(initialResearch.sessionId).not.toBe(updatedResearch.sessionId);
      expect(changeTracker.stats.changesDetected).toBe(1);
    });

    it('should integrate change tracking with research monitoring', async () => {
      const monitoringTopics = [
        'AI healthcare updates',
        'Machine learning breakthroughs'
      ];

      // Start continuous monitoring
      const monitoringPromises = monitoringTopics.map(async (topic) => {
        return new Promise((resolve) => {
          let researchCount = 0;
          
          const monitorCallback = async () => {
            const research = await researchOrchestrator.conductResearch(topic, {
              enableChangeTracking: true,
              maxUrls: 3
            });

            // Track changes in research findings
            for (const finding of research.findings) {
              const changes = await changeTracker.detectChanges(finding.url, finding.content);
              if (changes.hasChanges) {
                // Trigger re-research on significant changes
                if (changes.significance === 'major') {
                  await researchOrchestrator.conductResearch(topic, {
                    focusUrls: [finding.url],
                    deepAnalysis: true
                  });
                }
              }
            }

            researchCount++;
            if (researchCount >= 2) resolve(researchCount);
          };

          // Start monitoring
          setTimeout(monitorCallback, 100);
          setTimeout(monitorCallback, 200);
        });
      });

      const results = await Promise.all(monitoringPromises);
      
      expect(results.every(count => count >= 2)).toBe(true);
      expect(changeTracker.stats.pagesTracked).toBeGreaterThan(0);
    });

    it('should provide change impact analysis for research', async () => {
      const sourceUrl = 'https://example.com/research-paper';
      const originalContent = 'Original research findings show 80% accuracy in AI diagnosis.';
      const updatedContent = 'Updated research findings show 95% accuracy in AI diagnosis.';

      // Create initial snapshot
      await changeTracker.createSnapshot(sourceUrl, originalContent);

      // Detect changes and analyze impact
      const changes = await changeTracker.detectChanges(sourceUrl, updatedContent);
      
      // Integrate change analysis with research orchestrator
      const impactAnalysis = await researchOrchestrator.analyzeChangeImpact(changes, {
        researchContext: 'AI diagnosis accuracy',
        significanceThreshold: 0.3
      });

      expect(impactAnalysis).toMatchObject({
        impactScore: expect.any(Number),
        affectedTopics: expect.any(Array),
        recommendedActions: expect.any(Array),
        confidenceLevel: expect.any(Number)
      });

      expect(impactAnalysis.impactScore).toBeGreaterThan(0.5); // Significant change
      expect(impactAnalysis.affectedTopics).toContain('AI diagnosis accuracy');
    });
  });

  describe('Stealth + Localization Integration', () => {
    it('should apply localization to stealth browser configurations', async () => {
      // Configure for Japanese localization
      await localizationManager.applyCountrySettings('JP');
      
      const browserConfig = localizationManager.generateBrowserContextConfig('JP');
      const deviceConfig = localizationManager.generateDeviceEmulationConfig('desktop', 'JP');

      await stealthManager.launch();
      
      // Create stealth context with Japanese localization
      const stealthContext = await stealthManager.createStealthContext('jp-stealth', {
        ...browserConfig,
        locale: 'ja-JP',
        timezone: 'Asia/Tokyo',
        customHeaders: browserConfig.extraHTTPHeaders
      });

      const page = await stealthManager.createStealthPage('jp-stealth');

      // Verify localized stealth configuration
      expect(mockContext.newPage).toHaveBeenCalled();
      expect(mockPage.setUserAgent).toHaveBeenCalled();
      
      const fingerprint = stealthManager.fingerprints.get('jp-stealth');
      expect(fingerprint.timezone).toBe('Asia/Tokyo');
      expect(fingerprint.language).toBe('ja-JP');
    });

    it('should generate region-appropriate stealth fingerprints', async () => {
      const regions = ['US', 'DE', 'JP', 'GB'];
      const fingerprints = {};

      for (const region of regions) {
        await localizationManager.applyCountrySettings(region);
        const config = localizationManager.getCountryConfig(region);
        
        await stealthManager.launch();
        const fingerprint = stealthManager.generateFingerprint({
          locale: config.language,
          timezone: config.timezone,
          customUserAgent: localizationManager.generateUserAgent(region)
        });

        fingerprints[region] = fingerprint;
        await stealthManager.close();
      }

      // Verify each fingerprint matches its region
      expect(fingerprints.US.timezone).toBe('America/New_York');
      expect(fingerprints.DE.timezone).toBe('Europe/Berlin');
      expect(fingerprints.JP.timezone).toBe('Asia/Tokyo');
      expect(fingerprints.GB.timezone).toBe('Europe/London');

      expect(fingerprints.US.language).toContain('en-US');
      expect(fingerprints.DE.language).toContain('de-DE');
      expect(fingerprints.JP.language).toContain('ja-JP');
      expect(fingerprints.GB.language).toContain('en-GB');
    });

    it('should handle geo-blocked content with stealth and localization', async () => {
      // Simulate geo-blocked content scenario
      await localizationManager.applyCountrySettings('US');
      await stealthManager.launch();

      const context = await stealthManager.createStealthContext('geo-bypass', {
        geolocation: localizationManager.getCountryCoordinates('US'),
        locale: 'en-US',
        timezone: 'America/New_York'
      });

      // Mock geo-blocking detection and bypass
      mockPage.goto.mockRejectedValueOnce(new Error('Content not available in your region'));
      
      // Apply geo-blocking bypass techniques
      const bypassSuccess = await stealthManager.bypassGeoBlocking('geo-bypass', {
        targetRegion: 'US',
        useProxy: true,
        spoofLocation: true
      });

      expect(bypassSuccess).toBe(true);
      expect(stealthManager.fingerprints.get('geo-bypass').geolocation).toBeDefined();
    });
  });

  describe('Full Wave 3 Integration Scenarios', () => {
    it('should conduct comprehensive stealth research with localization and tracking', async () => {
      const researchTopic = 'Global AI regulations comparison';
      const targetRegions = ['US', 'DE', 'CN'];
      const researchResults = {};

      for (const region of targetRegions) {
        // Configure localization
        await localizationManager.applyCountrySettings(region);
        
        // Setup stealth browsing
        await stealthManager.launch();
        const contextId = `research-${region.toLowerCase()}`;
        const stealthConfig = localizationManager.generateBrowserContextConfig(region);
        
        await stealthManager.createStealthContext(contextId, {
          ...stealthConfig,
          randomizeFingerprint: true,
          simulateHumanBehavior: true
        });

        // Conduct localized research
        const researchResult = await researchOrchestrator.conductResearch(researchTopic, {
          localization: {
            countryCode: region,
            searchDomain: localizationManager.getSearchDomain(region),
            language: localizationManager.getCountryConfig(region).language
          },
          stealthBrowsing: {
            contextId: contextId,
            enableBehaviorSimulation: true
          },
          changeTracking: {
            enabled: true,
            trackingKey: `regulations-${region}`
          }
        });

        // Track changes in regulatory information
        for (const finding of researchResult.findings) {
          await changeTracker.createSnapshot(finding.url, finding.content, {
            metadata: { region, topic: researchTopic }
          });
        }

        researchResults[region] = researchResult;
        await stealthManager.close();
      }

      // Verify comprehensive results
      expect(Object.keys(researchResults)).toEqual(targetRegions);
      expect(changeTracker.stats.pagesTracked).toBeGreaterThan(0);
      
      // Analyze cross-regional differences
      const comparativeAnalysis = await researchOrchestrator.generateComparativeAnalysis(
        Object.values(researchResults)
      );

      expect(comparativeAnalysis).toMatchObject({
        regions: targetRegions,
        commonThemes: expect.any(Array),
        regionalDifferences: expect.any(Array),
        significantFindings: expect.any(Array)
      });
    });

    it('should handle complex research workflow with all Wave 3 features', async () => {
      const complexTopic = 'Emerging AI technologies market analysis';
      
      // Phase 1: Initial stealth research with US localization
      await localizationManager.applyCountrySettings('US');
      await stealthManager.launch();
      
      const initialContext = await stealthManager.createStealthContext('phase1', {
        level: 'advanced',
        simulateHumanBehavior: true
      });

      const phase1Research = await researchOrchestrator.conductResearch(complexTopic, {
        maxDepth: 3,
        enableSourceVerification: true,
        stealthBrowsing: { contextId: 'phase1' },
        localization: { countryCode: 'US' }
      });

      // Phase 2: Track changes in key sources
      const keyUrls = phase1Research.sources.slice(0, 3).map(s => s.url);
      for (const url of keyUrls) {
        await changeTracker.createSnapshot(url, 'initial content', {
          metadata: { phase: 1, importance: 'high' }
        });
        
        // Start monitoring for changes
        await changeTracker.startMonitoring(url, {
          interval: 5000,
          callback: async (changes) => {
            if (changes.significance === 'major') {
              // Trigger focused re-research
              await researchOrchestrator.conductResearch(complexTopic, {
                focusUrls: [url],
                deepAnalysis: true
              });
            }
          }
        });
      }

      // Phase 3: Multi-regional comparative analysis
      const regions = ['DE', 'JP'];
      const regionalResults = {};

      for (const region of regions) {
        await localizationManager.applyCountrySettings(region);
        
        const regionContext = await stealthManager.createStealthContext(`phase3-${region}`, {
          locale: localizationManager.getCountryConfig(region).language,
          timezone: localizationManager.getCountryConfig(region).timezone
        });

        const regionalResearch = await researchOrchestrator.conductResearch(complexTopic, {
          localization: { countryCode: region },
          stealthBrowsing: { contextId: `phase3-${region}` },
          comparativeMode: true,
          baselineFindings: phase1Research.findings
        });

        regionalResults[region] = regionalResearch;
      }

      // Phase 4: Comprehensive analysis and change impact assessment
      const allResults = [phase1Research, ...Object.values(regionalResults)];
      const finalAnalysis = await researchOrchestrator.generateComprehensiveReport(allResults, {
        includeChangeAnalysis: true,
        includeRegionalComparison: true,
        includeCredibilityAssessment: true
      });

      // Cleanup monitoring
      for (const url of keyUrls) {
        await changeTracker.stopMonitoring(url);
      }

      // Verify comprehensive workflow
      expect(finalAnalysis).toMatchObject({
        executiveSummary: expect.any(String),
        keyFindings: expect.any(Array),
        regionalAnalysis: expect.any(Object),
        changeImpactAssessment: expect.any(Object),
        credibilityReport: expect.any(Object),
        recommendations: expect.any(Array),
        methodology: expect.any(Object)
      });

      expect(finalAnalysis.methodology).toMatchObject({
        stealthBrowsingUsed: true,
        localizationApplied: true,
        changeTrackingEnabled: true,
        regionsAnalyzed: expect.arrayContaining(['US', 'DE', 'JP'])
      });
    });

    it('should handle error recovery across all Wave 3 components', async () => {
      const errorScenarios = {
        stealthDetection: false,
        localizationFailure: false,
        changeTrackingError: false,
        researchTimeout: false
      };

      try {
        // Simulate stealth detection
        mockPage.goto.mockRejectedValueOnce(new Error('Bot detected'));
        await stealthManager.launch();
        const context = await stealthManager.createStealthContext('error-test');
        
        try {
          await stealthManager.stealthNavigate(mockPage, 'https://example.com');
        } catch (error) {
          errorScenarios.stealthDetection = true;
          // Should recover with new fingerprint
          await stealthManager.regenerateFingerprint('error-test');
        }

        // Simulate localization service failure
        jest.spyOn(localizationManager, 'applyCountrySettings').mockRejectedValueOnce(new Error('Localization failed'));
        
        try {
          await localizationManager.applyCountrySettings('XX'); // Invalid country
        } catch (error) {
          errorScenarios.localizationFailure = true;
          // Should fallback to default settings
          await localizationManager.applyCountrySettings('US');
        }

        // Simulate change tracking error
        jest.spyOn(changeTracker, 'detectChanges').mockRejectedValueOnce(new Error('Tracking failed'));
        
        try {
          await changeTracker.detectChanges('invalid-url', 'content');
        } catch (error) {
          errorScenarios.changeTrackingError = true;
        }

        // Simulate research timeout
        jest.spyOn(researchOrchestrator, 'conductResearch').mockImplementation(async () => {
          await new Promise(resolve => setTimeout(resolve, 35000)); // Timeout after 30s
        });

        try {
          await researchOrchestrator.conductResearch('test topic', { timeLimit: 30000 });
        } catch (error) {
          errorScenarios.researchTimeout = true;
        }

      } catch (error) {
        // Overall error handling
      }

      // Verify error recovery mechanisms
      expect(errorScenarios.stealthDetection).toBe(true);
      expect(errorScenarios.localizationFailure).toBe(true);
      expect(errorScenarios.changeTrackingError).toBe(true);
      
      // All components should remain functional after errors
      expect(stealthManager.browser).toBeDefined();
      expect(localizationManager.currentSettings.countryCode).toBeDefined();
      expect(changeTracker.stats).toBeDefined();
    });
  });

  describe('MCP Tool Integration', () => {
    it('should integrate deepResearch MCP tool with all Wave 3 features', async () => {
      const mcpRequest = {
        arguments: {
          topic: 'Quantum computing applications',
          options: {
            maxDepth: 3,
            maxUrls: 10,
            enableStealthBrowsing: true,
            localization: {
              countryCode: 'US',
              language: 'en-US'
            },
            changeTracking: {
              enabled: true,
              monitorSources: true
            }
          }
        }
      };

      // Mock MCP tool execution
      const mcpResponse = await deepResearchTool.execute(mcpRequest);

      expect(mcpResponse).toMatchObject({
        content: expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: expect.any(String)
          })
        ])
      });

      // Verify integration with all Wave 3 components
      const responseText = mcpResponse.content[0].text;
      expect(responseText).toContain('research findings');
      expect(responseText).toContain('sources analyzed');
    });

    it('should integrate trackChanges MCP tool with research workflow', async () => {
      const baselineUrl = 'https://example.com/research-paper';
      
      // Create baseline with research context
      await changeTracker.createSnapshot(baselineUrl, 'Original research content');

      const mcpRequest = {
        arguments: {
          baselineUrl,
          currentUrl: baselineUrl,
          currentContent: 'Updated research content with new findings',
          options: {
            granularity: 'section',
            trackText: true,
            trackStructure: true,
            significanceThreshold: 0.3
          }
        }
      };

      const mcpResponse = await trackChangesTool.execute(mcpRequest);

      expect(mcpResponse).toMatchObject({
        content: expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: expect.any(String)
          })
        ])
      });

      // Verify change tracking integration
      const responseText = mcpResponse.content[0].text;
      expect(responseText).toContain('changes detected');
      expect(responseText).toContain('significance');
    });

    it('should provide comprehensive MCP responses with all Wave 3 data', async () => {
      const comprehensiveRequest = {
        arguments: {
          topic: 'AI regulation changes',
          options: {
            enableAllFeatures: true,
            stealthBrowsing: { level: 'advanced' },
            localization: { countryCode: 'EU' },
            changeTracking: { realTimeMonitoring: true },
            generateReport: true
          }
        }
      };

      // Simulate comprehensive research with all features
      const response = await deepResearchTool.execute(comprehensiveRequest);

      expect(response.content).toBeDefined();
      expect(response.content.length).toBeGreaterThan(0);

      const content = response.content[0];
      expect(content.type).toBe('text');
      
      // Parse response content for Wave 3 feature data
      const responseData = JSON.parse(content.text);
      expect(responseData).toMatchObject({
        research: expect.any(Object),
        stealthMetrics: expect.any(Object),
        localizationSettings: expect.any(Object),
        changeTrackingStats: expect.any(Object),
        integratedAnalysis: expect.any(Object)
      });
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle concurrent Wave 3 operations efficiently', async () => {
      const concurrentOperations = [
        researchOrchestrator.conductResearch('Topic 1', { maxUrls: 5 }),
        stealthManager.launch().then(() => stealthManager.createStealthContext('concurrent1')),
        localizationManager.applyCountrySettings('DE'),
        changeTracker.createSnapshot('https://example.com/1', 'content 1'),
        changeTracker.createSnapshot('https://example.com/2', 'content 2')
      ];

      const startTime = Date.now();
      const results = await Promise.all(concurrentOperations);
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(5);
      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds
      expect(results.every(result => result !== undefined)).toBe(true);
    });

    it('should manage memory usage across all Wave 3 components', async () => {
      const memoryBefore = process.memoryUsage().heapUsed;

      // Perform memory-intensive operations
      await researchOrchestrator.conductResearch('Memory test', { maxUrls: 20 });
      
      await stealthManager.launch();
      for (let i = 0; i < 5; i++) {
        await stealthManager.createStealthContext(`mem-test-${i}`);
      }

      for (let i = 0; i < 10; i++) {
        await changeTracker.createSnapshot(`https://example.com/mem${i}`, `Large content ${'x'.repeat(10000)}`);
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const memoryAfter = process.memoryUsage().heapUsed;
      const memoryIncrease = memoryAfter - memoryBefore;

      // Memory increase should be reasonable (less than 100MB for this test)
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);
    });

    it('should provide performance metrics across all components', () => {
      const performanceReport = {
        research: researchOrchestrator.getPerformanceMetrics(),
        stealth: stealthManager.getResourceStats(),
        localization: localizationManager.getPerformanceStats(),
        changeTracking: changeTracker.getStatistics()
      };

      expect(performanceReport.research).toMatchObject({
        totalProcessingTime: expect.any(Number),
        searchQueries: expect.any(Number),
        urlsProcessed: expect.any(Number)
      });

      expect(performanceReport.stealth).toMatchObject({
        activeContexts: expect.any(Number),
        memoryUsage: expect.any(Number),
        uptime: expect.any(Number)
      });

      expect(performanceReport.localization).toMatchObject({
        configurationsApplied: expect.any(Number),
        cacheHits: expect.any(Number),
        averageConfigTime: expect.any(Number)
      });

      expect(performanceReport.changeTracking).toMatchObject({
        pagesTracked: expect.any(Number),
        changesDetected: expect.any(Number),
        processingTime: expect.any(Number)
      });
    });
  });
});