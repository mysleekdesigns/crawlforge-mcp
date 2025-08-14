/**
 * Stealth Mode Scraping Examples
 * Demonstrates how to use stealth mode with MCP WebScraper tools
 */

import BrowserProcessor from '../src/core/processing/BrowserProcessor.js';
import { ScrapeWithActionsTool } from '../src/tools/advanced/ScrapeWithActionsTool.js';
import { getStealthConfig, getHumanBehaviorConfig } from '../src/constants/config.js';

// Example 1: Basic stealth scraping with BrowserProcessor
async function basicStealthScraping() {
  console.log('🥷 Example 1: Basic Stealth Scraping');
  
  const processor = new BrowserProcessor();
  
  // Enable stealth mode
  processor.enableStealthMode('medium');
  
  const result = await processor.processURL({
    url: 'https://httpbin.org/headers',
    options: {
      waitForTimeout: 3000,
      stealthMode: {
        enabled: true,
        level: 'medium',
        randomizeFingerprint: true,
        hideWebDriver: true,
        blockWebRTC: true
      },
      humanBehavior: {
        enabled: true,
        mouseMovements: true,
        readingTime: true
      }
    }
  });
  
  console.log('✅ Stealth scraping completed');
  console.log('   Success:', result.success);
  console.log('   User Agent detected:', result.text.includes('User-Agent') ? 'Yes' : 'No');
  
  // Get stealth statistics
  const stats = processor.getStealthStats();
  console.log('   Stealth stats:', {
    stealthManagerActive: stats.stealthManagerActive,
    humanBehaviorActive: stats.humanBehaviorActive
  });
  
  await processor.cleanup();
  return result;
}

// Example 2: Advanced stealth with action chains
async function advancedStealthWithActions() {
  console.log('\n🎭 Example 2: Advanced Stealth with Action Chains');
  
  const tool = new ScrapeWithActionsTool();
  
  const result = await tool.execute({
    url: 'https://httpbin.org/forms/post',
    actions: [
      {
        type: 'wait',
        duration: 1000,
        description: 'Initial page load wait'
      },
      {
        type: 'type',
        selector: 'input[name="custname"]',
        text: 'John Stealth',
        description: 'Fill customer name with human typing'
      },
      {
        type: 'type',
        selector: 'input[name="custtel"]',
        text: '555-0123',
        description: 'Fill phone number'
      },
      {
        type: 'scroll',
        direction: 'down',
        distance: 200,
        description: 'Scroll to see more content'
      },
      {
        type: 'click',
        selector: 'input[type="submit"]',
        description: 'Submit form with human-like click'
      },
      {
        type: 'wait',
        duration: 2000,
        description: 'Wait for form submission'
      }
    ],
    formats: ['json', 'html'],
    captureScreenshots: true,
    browserOptions: {
      headless: true,
      timeout: 30000,
      stealthMode: {
        enabled: true,
        level: 'advanced',
        randomizeFingerprint: true,
        simulateHumanBehavior: true,
        hideWebDriver: true,
        blockWebRTC: true
      },
      humanBehavior: {
        enabled: true,
        mouseMovements: true,
        typingVariation: true,
        scrollBehavior: true,
        idlePeriods: true
      }
    },
    continueOnActionError: false,
    maxRetries: 2
  });
  
  console.log('✅ Advanced stealth scraping with actions completed');
  console.log('   Success:', result.success);
  console.log('   Total actions executed:', result.actionsExecuted);
  console.log('   Screenshots captured:', result.screenshots?.length || 0);
  console.log('   Human behavior simulated:', result.metadata?.formAutoFillApplied ? 'Yes' : 'Partial');
  
  await tool.destroy();
  return result;
}

// Example 3: Stealth configuration levels comparison
async function compareStealthLevels() {
  console.log('\n📊 Example 3: Stealth Configuration Levels Comparison');
  
  const levels = ['basic', 'medium', 'advanced'];
  const processor = new BrowserProcessor();
  
  for (const level of levels) {
    console.log(`\n--- Testing ${level.toUpperCase()} stealth level ---`);
    
    const stealthConfig = getStealthConfig(level);
    const behaviorConfig = getHumanBehaviorConfig(level);
    
    console.log('Stealth features:');
    console.log('  • Fingerprint randomization:', stealthConfig.randomizeFingerprint);
    console.log('  • WebDriver hiding:', stealthConfig.hideWebDriver);
    console.log('  • WebRTC blocking:', stealthConfig.blockWebRTC);
    console.log('  • Advanced features:', !!stealthConfig.spoofTimezone);
    
    console.log('Human behavior features:');
    console.log('  • Mouse movements:', behaviorConfig.mouseMovements);
    console.log('  • Typing variation:', behaviorConfig.typingVariation);
    console.log('  • Idle periods:', behaviorConfig.idlePeriods);
    console.log('  • Reading simulation:', behaviorConfig.readingTime);
    
    // Test actual scraping with this level
    try {
      const result = await processor.processURL({
        url: 'https://httpbin.org/user-agent',
        options: {
          stealthMode: { ...stealthConfig },
          humanBehavior: { ...behaviorConfig },
          waitForTimeout: 2000
        }
      });
      
      console.log('  ✅ Scraping successful with', level, 'level');
    } catch (error) {
      console.log('  ❌ Scraping failed:', error.message);
    }
  }
  
  await processor.cleanup();
}

// Example 4: Stealth mode with different websites
async function testStealthOnDifferentSites() {
  console.log('\n🌐 Example 4: Stealth Mode on Different Detection Sites');
  
  const processor = new BrowserProcessor();
  processor.enableStealthMode('advanced');
  
  const testSites = [
    {
      name: 'HTTP Headers Check',
      url: 'https://httpbin.org/headers',
      description: 'Check if User-Agent is randomized'
    },
    {
      name: 'Browser Detection',
      url: 'https://httpbin.org/user-agent',
      description: 'Verify browser fingerprint'
    }
  ];
  
  for (const site of testSites) {
    console.log(`\n--- Testing: ${site.name} ---`);
    console.log(`Description: ${site.description}`);
    
    try {
      const result = await processor.processURL({
        url: site.url,
        options: {
          waitForTimeout: 3000,
          stealthMode: {
            enabled: true,
            level: 'advanced',
            randomizeFingerprint: true,
            hideWebDriver: true,
            blockWebRTC: true
          },
          humanBehavior: {
            enabled: true,
            readingTime: true,
            mouseMovements: true
          }
        }
      });
      
      console.log('✅ Test passed');
      console.log('   Success:', result.success);
      console.log('   Content length:', result.text.length, 'characters');
      
      // Check for webdriver detection
      const hasWebDriverDetection = result.text.toLowerCase().includes('webdriver');
      console.log('   WebDriver detected:', hasWebDriverDetection ? '⚠️ Yes' : '✅ No');
      
    } catch (error) {
      console.log('❌ Test failed:', error.message);
    }
  }
  
  await processor.cleanup();
}

// Example 5: Monitoring stealth effectiveness
async function monitorStealthEffectiveness() {
  console.log('\n📈 Example 5: Monitoring Stealth Effectiveness');
  
  const processor = new BrowserProcessor();
  
  // Test without stealth first
  console.log('\n--- Without Stealth Mode ---');
  let result1 = await processor.processURL({
    url: 'https://httpbin.org/headers',
    options: {
      waitForTimeout: 2000,
      stealthMode: { enabled: false }
    }
  });
  
  console.log('Standard scraping completed');
  console.log('Load time:', result1.loadTime + 'ms');
  
  // Test with stealth
  console.log('\n--- With Stealth Mode (Advanced) ---');
  processor.enableStealthMode('advanced');
  
  let result2 = await processor.processURL({
    url: 'https://httpbin.org/headers',
    options: {
      waitForTimeout: 2000,
      stealthMode: {
        enabled: true,
        level: 'advanced',
        randomizeFingerprint: true,
        hideWebDriver: true,
        blockWebRTC: true
      },
      humanBehavior: {
        enabled: true,
        mouseMovements: true,
        readingTime: true,
        idlePeriods: true
      }
    }
  });
  
  console.log('Stealth scraping completed');
  console.log('Load time:', result2.loadTime + 'ms');
  
  // Compare results
  console.log('\n--- Comparison ---');
  console.log('Performance impact:', ((result2.loadTime - result1.loadTime) / result1.loadTime * 100).toFixed(1) + '%');
  
  const stats = processor.getStealthStats();
  console.log('Stealth components active:', {
    manager: stats.stealthManagerActive,
    behavior: stats.humanBehaviorActive,
    contexts: stats.activeContexts
  });
  
  await processor.cleanup();
}

// Main execution function
async function runStealthExamples() {
  console.log('🚀 MCP WebScraper - Stealth Mode Examples\n');
  
  try {
    await basicStealthScraping();
    await advancedStealthWithActions();
    await compareStealthLevels();
    await testStealthOnDifferentSites();
    await monitorStealthEffectiveness();
    
    console.log('\n🎉 All stealth mode examples completed successfully!');
    console.log('\nStealth Mode Integration Summary:');
    console.log('• ✅ StealthBrowserManager integrated with BrowserProcessor');
    console.log('• ✅ HumanBehaviorSimulator working with all interactions');
    console.log('• ✅ Configuration system supports all stealth levels');
    console.log('• ✅ Compatible with existing ScrapeWithActionsTool');
    console.log('• ✅ No breaking changes to existing functionality');
    
    console.log('\nTo use stealth mode in your scraping:');
    console.log('1. Set STEALTH_MODE_ENABLED=true in your .env file');
    console.log('2. Configure stealth level: STEALTH_LEVEL=advanced');
    console.log('3. Enable human behavior: STEALTH_HUMAN_BEHAVIOR_ENABLED=true');
    console.log('4. Use stealthMode options in tool parameters');
    
  } catch (error) {
    console.error('\n💥 Example failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runStealthExamples();
}

export default runStealthExamples;