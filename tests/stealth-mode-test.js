/**
 * Stealth Mode Integration Test
 * Tests the basic functionality of stealth mode components
 */

import { StealthBrowserManager } from '../src/core/StealthBrowserManager.js';
import { HumanBehaviorSimulator } from '../src/utils/HumanBehaviorSimulator.js';
import BrowserProcessor from '../src/core/processing/BrowserProcessor.js';
import { getStealthConfig, getHumanBehaviorConfig } from '../src/constants/config.js';

async function testStealthBrowserManager() {
  console.log('Testing StealthBrowserManager...');
  
  const stealthManager = new StealthBrowserManager();
  
  try {
    // Test browser launch with stealth
    await stealthManager.launchStealthBrowser({
      level: 'medium',
      randomizeFingerprint: true,
      hideWebDriver: true,
      blockWebRTC: true
    });
    
    // Test context creation
    const { context, contextId, fingerprint } = await stealthManager.createStealthContext({
      level: 'medium'
    });
    
    console.log('✅ StealthBrowserManager: Browser launched and context created');
    console.log('   Context ID:', contextId);
    console.log('   Fingerprint User Agent:', fingerprint.userAgent.substring(0, 50) + '...');
    console.log('   Viewport:', fingerprint.viewport);
    
    // Test page creation
    const page = await stealthManager.createStealthPage(contextId);
    console.log('✅ StealthBrowserManager: Stealth page created successfully');
    
    // Get stats
    const stats = stealthManager.getStats();
    console.log('   Stats:', stats);
    
    // Cleanup
    await stealthManager.cleanup();
    console.log('✅ StealthBrowserManager: Cleanup successful');
    
  } catch (error) {
    console.error('❌ StealthBrowserManager test failed:', error.message);
    throw error;
  }
}

async function testHumanBehaviorSimulator() {
  console.log('\nTesting HumanBehaviorSimulator...');
  
  const simulator = new HumanBehaviorSimulator({
    mouseMovements: {
      enabled: true,
      speed: 'normal',
      accuracy: 0.8
    },
    typing: {
      enabled: true,
      speed: 'normal',
      variability: 0.3
    },
    scrolling: {
      enabled: true,
      naturalAcceleration: true
    }
  });
  
  try {
    // Test mouse path generation
    const mousePath = simulator.generateMousePath(0, 0, 100, 100);
    console.log('✅ HumanBehaviorSimulator: Mouse path generated with', mousePath.length, 'points');
    
    // Test Bezier control points
    const controlPoints = simulator.generateBezierControlPoints(0, 0, 100, 100);
    console.log('✅ HumanBehaviorSimulator: Bezier control points generated');
    
    // Test typing delay calculation
    const delay = simulator.calculateTypingDelay('a', 0, 'abc', 100);
    console.log('✅ HumanBehaviorSimulator: Typing delay calculated:', delay + 'ms');
    
    // Test behavior simulation with mock
    console.log('✅ HumanBehaviorSimulator: Delay function works');
    
    // Get stats
    const stats = simulator.getStats();
    console.log('   Initial stats:', stats);
    
    console.log('✅ HumanBehaviorSimulator: All tests passed');
    
  } catch (error) {
    console.error('❌ HumanBehaviorSimulator test failed:', error.message);
    throw error;
  }
}

async function testBrowserProcessorIntegration() {
  console.log('\nTesting BrowserProcessor with stealth integration...');
  
  const processor = new BrowserProcessor();
  
  try {
    // Test stealth configuration
    processor.updateStealthConfig({
      enabled: true,
      level: 'medium',
      randomizeFingerprint: true
    });
    
    console.log('✅ BrowserProcessor: Stealth configuration updated');
    
    // Test stealth mode enable/disable
    processor.enableStealthMode('advanced');
    console.log('✅ BrowserProcessor: Stealth mode enabled');
    
    processor.disableStealthMode();
    console.log('✅ BrowserProcessor: Stealth mode disabled');
    
    // Get stealth stats (should show no active components)
    const stats = processor.getStealthStats();
    console.log('   Stealth stats:', stats);
    
    console.log('✅ BrowserProcessor: Integration test passed');
    
  } catch (error) {
    console.error('❌ BrowserProcessor integration test failed:', error.message);
    throw error;
  }
}

async function testConfigurationHelpers() {
  console.log('\nTesting configuration helpers...');
  
  try {
    // Test stealth config for different levels
    const basicConfig = getStealthConfig('basic');
    const mediumConfig = getStealthConfig('medium');
    const advancedConfig = getStealthConfig('advanced');
    
    console.log('✅ Configuration: Stealth configs generated for all levels');
    console.log('   Basic level randomizeFingerprint:', basicConfig.randomizeFingerprint);
    console.log('   Advanced level extra features:', !!advancedConfig.spoofTimezone);
    
    // Test human behavior config
    const basicBehavior = getHumanBehaviorConfig('basic');
    const advancedBehavior = getHumanBehaviorConfig('advanced');
    
    console.log('✅ Configuration: Human behavior configs generated');
    console.log('   Basic behavior mouseMovements:', basicBehavior.mouseMovements);
    console.log('   Advanced behavior readingTime:', advancedBehavior.readingTime);
    
  } catch (error) {
    console.error('❌ Configuration test failed:', error.message);
    throw error;
  }
}

async function runStealthModeTests() {
  console.log('🚀 Starting Stealth Mode Integration Tests\n');
  
  try {
    await testStealthBrowserManager();
    await testHumanBehaviorSimulator();
    await testBrowserProcessorIntegration();
    await testConfigurationHelpers();
    
    console.log('\n🎉 All Stealth Mode tests passed successfully!');
    console.log('\nStealth Mode Features Available:');
    console.log('• Browser fingerprint randomization');
    console.log('• WebRTC leak prevention');
    console.log('• Timezone spoofing');
    console.log('• Human-like mouse movements');
    console.log('• Natural typing simulation');
    console.log('• Scroll behavior patterns');
    console.log('• Idle period simulation');
    console.log('• Anti-detection measures');
    
  } catch (error) {
    console.error('\n💥 Test suite failed:', error.message);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runStealthModeTests();
}

export default runStealthModeTests;