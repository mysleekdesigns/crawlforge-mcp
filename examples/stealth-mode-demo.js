/**
 * Stealth Mode Demo - Phase 2.2 Features
 * Demonstrates advanced stealth capabilities for bypassing bot detection
 */

import StealthBrowserManager from '../src/core/StealthBrowserManager.js';
import ActionExecutor from '../src/core/ActionExecutor.js';
import BrowserProcessor from '../src/core/processing/BrowserProcessor.js';

async function demonstrateAdvancedStealth() {
  console.log('🔒 Stealth Mode Phase 2.2 Demo\n');
  
  // Create stealth browser manager with advanced configuration
  const stealthManager = new StealthBrowserManager();
  
  const advancedStealthConfig = {
    level: 'advanced',
    randomizeFingerprint: true,
    hideWebDriver: true,
    blockWebRTC: true,
    simulateHumanBehavior: true,
    
    // Advanced anti-detection features
    antiDetection: {
      cloudflareBypass: true,
      recaptchaHandling: true,
      hideAutomation: true,
      spoofMediaDevices: true,
      spoofBatteryAPI: true
    },
    
    // Comprehensive fingerprinting protection
    fingerprinting: {
      canvasNoise: true,
      webglSpoofing: true,
      audioContextSpoofing: true,
      fontSpoofing: true,
      hardwareSpoofing: true
    },
    
    // Optional proxy rotation
    proxyRotation: {
      enabled: false, // Set to true if you have proxy list
      proxies: [], // Add proxy URLs here
      rotationInterval: 300000 // 5 minutes
    }
  };
  
  try {
    console.log('1️⃣ Launching Stealth Browser...');
    
    // Launch stealth browser with advanced configuration
    await stealthManager.launchStealthBrowser(advancedStealthConfig);
    console.log('   ✅ Stealth browser launched with advanced anti-detection');
    
    console.log('\n2️⃣ Creating Stealth Context...');
    
    // Create stealth context with randomized fingerprint
    const { context, contextId, fingerprint } = await stealthManager.createStealthContext(advancedStealthConfig);
    
    console.log('   ✅ Stealth context created');
    console.log(`      Context ID: ${contextId}`);
    console.log(`      User Agent: ${fingerprint.userAgent.substring(0, 60)}...`);
    console.log(`      Viewport: ${fingerprint.viewport.width}x${fingerprint.viewport.height}`);
    console.log(`      Timezone: ${fingerprint.timezone}`);
    console.log(`      Canvas Seed: ${fingerprint.canvas.seed}`);
    console.log(`      Hardware Cores: ${fingerprint.hardware.hardwareConcurrency}`);
    
    console.log('\n3️⃣ Creating Stealth Page...');
    
    // Create stealth page with all protections
    const page = await stealthManager.createStealthPage(contextId);
    console.log('   ✅ Stealth page created with comprehensive protections');
    
    console.log('\n4️⃣ Demonstrating Human Behavior...');
    
    // Initialize human behavior simulator
    await stealthManager.initializeHumanBehaviorSimulator({
      mouseMovements: {
        enabled: true,
        speed: 'normal',
        accuracy: 0.85,
        naturalCurves: true,
        randomMicroMovements: true
      },
      typing: {
        enabled: true,
        speed: 'normal',
        variability: 0.3,
        mistakes: {
          enabled: true,
          frequency: 0.015, // 1.5% mistake rate
          correctionDelay: 600
        }
      },
      scrolling: {
        enabled: true,
        naturalAcceleration: true,
        randomPauses: true,
        scrollBackProbability: 0.12
      }
    });
    
    console.log('   ✅ Human behavior simulator initialized');
    
    console.log('\n5️⃣ Testing Navigation with Stealth Features...');
    
    // Navigate to a test page (using example.com for demo)
    await page.goto('http://example.com', { waitUntil: 'domcontentloaded' });
    
    // Simulate CloudFlare challenge detection
    await stealthManager.bypassCloudflareChallenge(page);
    
    // Simulate reCAPTCHA detection
    await stealthManager.handleRecaptcha(page);
    
    // Simulate realistic human interactions
    await stealthManager.simulateRealisticMouseMovements(page);
    await stealthManager.simulateNaturalScrolling(page);
    
    const title = await page.title();
    console.log(`   ✅ Successfully navigated to: "${title}"`);
    console.log('   ✅ Applied CloudFlare bypass techniques');
    console.log('   ✅ Applied reCAPTCHA handling');
    console.log('   ✅ Simulated realistic human behavior');
    
    console.log('\n6️⃣ Demonstrating Action Execution with Stealth...');
    
    // Create action executor with stealth-enabled browser processor
    const browserProcessor = new BrowserProcessor();
    browserProcessor.enableStealthMode('advanced');
    
    const actionExecutor = new ActionExecutor({
      enableLogging: true,
      actionDelay: 200, // Realistic delay between actions
      enableActionValidation: true
    });
    
    // Replace the browser processor to enable stealth integration
    actionExecutor.browserProcessor = browserProcessor;
    
    // Example action chain with human behavior
    const actions = [
      {
        type: 'wait',
        duration: 1000,
        description: 'Wait for page to settle'
      },
      {
        type: 'scroll',
        direction: 'down',
        distance: 200,
        description: 'Scroll to explore content'
      },
      {
        type: 'wait',
        duration: 2000,
        description: 'Reading time simulation'
      }
    ];
    
    console.log('   ✅ Action executor configured with stealth mode');
    console.log(`   ✅ Prepared ${actions.length} human-like actions`);
    
    console.log('\n7️⃣ Performance Metrics...');
    
    const stats = stealthManager.getStats();
    console.log('   📊 Stealth Manager Statistics:');
    console.log(`      - Active contexts: ${stats.activeContexts}`);
    console.log(`      - Browser running: ${stats.browserRunning}`);
    console.log(`      - Human behavior active: ${stats.humanBehaviorActive}`);
    console.log(`      - Detection attempts: ${stats.performanceMetrics.detectionAttempts}`);
    console.log(`      - Successful bypasses: ${stats.performanceMetrics.successfulBypasses}`);
    console.log(`      - Bypass cache size: ${stats.bypassCacheSize}`);
    
    console.log('\n8️⃣ Fingerprint Analysis...');
    
    console.log('   🔍 Generated Fingerprint Details:');
    console.log(`      - WebGL Vendor: ${fingerprint.webGL.vendor}`);
    console.log(`      - WebGL Renderer: ${fingerprint.webGL.renderer}`);
    console.log(`      - Audio Sample Rate: ${fingerprint.audioContext.sampleRate} Hz`);
    console.log(`      - Screen Resolution: ${fingerprint.screen.width}x${fingerprint.screen.height}`);
    console.log(`      - Platform: ${fingerprint.hardware.platform}`);
    console.log(`      - Font Count: ${fingerprint.fonts.length} fonts`);
    console.log(`      - Media Devices: ${fingerprint.mediaDevices.length} devices`);
    console.log(`      - Battery Level: ${(fingerprint.battery.level * 100).toFixed(1)}%`);
    console.log(`      - Geolocation: ${fingerprint.geolocation.latitude.toFixed(4)}, ${fingerprint.geolocation.longitude.toFixed(4)}`);
    
    console.log('\n9️⃣ Anti-Detection Features Summary...');
    
    console.log('   🛡️ Active Protections:');
    console.log('      ✅ WebDriver property completely hidden');
    console.log('      ✅ Canvas fingerprinting with noise injection');
    console.log('      ✅ WebGL parameters spoofed with realistic values');
    console.log('      ✅ Audio context fingerprint randomized');
    console.log('      ✅ Font detection protected with measurement variation');
    console.log('      ✅ Hardware concurrency spoofed');
    console.log('      ✅ Media devices list randomized');
    console.log('      ✅ Battery API spoofed');
    console.log('      ✅ WebRTC IP leak prevention active');
    console.log('      ✅ Timezone spoofing enabled');
    console.log('      ✅ Chrome runtime properly mocked');
    console.log('      ✅ Plugin array realistic and consistent');
    console.log('      ✅ Network conditions emulated');
    console.log('      ✅ Error stack traces filtered');
    
    console.log('\n🔟 Human Behavior Features...');
    
    console.log('   🤖 Realistic Automation:');
    console.log('      ✅ Bezier curve mouse movements');
    console.log('      ✅ Variable typing speed with mistakes');
    console.log('      ✅ Natural scrolling with acceleration');
    console.log('      ✅ Random idle periods and reading time');
    console.log('      ✅ Hover before click behavior');
    console.log('      ✅ Focus blur simulation');
    console.log('      ✅ Micro-movements and hesitations');
    
    console.log('\n✅ Demo completed successfully!');
    
  } catch (error) {
    console.error('❌ Demo failed:', error.message);
    console.error(error.stack);
  } finally {
    console.log('\n🧹 Cleaning up...');
    await stealthManager.cleanup();
    console.log('   ✅ Cleanup completed');
  }
}

// Configuration examples for different use cases
function showConfigurationExamples() {
  console.log('\n📋 Configuration Examples for Different Scenarios:\n');
  
  // Basic stealth for light protection
  const basicConfig = {
    level: 'basic',
    randomizeFingerprint: true,
    hideWebDriver: true,
    simulateHumanBehavior: false
  };
  
  // Medium stealth for moderate protection
  const mediumConfig = {
    level: 'medium',
    randomizeFingerprint: true,
    hideWebDriver: true,
    blockWebRTC: true,
    simulateHumanBehavior: true,
    antiDetection: {
      cloudflareBypass: true,
      hideAutomation: true
    },
    fingerprinting: {
      canvasNoise: true,
      webglSpoofing: true
    }
  };
  
  // Advanced stealth for maximum protection
  const advancedConfig = {
    level: 'advanced',
    randomizeFingerprint: true,
    hideWebDriver: true,
    blockWebRTC: true,
    simulateHumanBehavior: true,
    antiDetection: {
      cloudflareBypass: true,
      recaptchaHandling: true,
      hideAutomation: true,
      spoofMediaDevices: true,
      spoofBatteryAPI: true
    },
    fingerprinting: {
      canvasNoise: true,
      webglSpoofing: true,
      audioContextSpoofing: true,
      fontSpoofing: true,
      hardwareSpoofing: true
    },
    proxyRotation: {
      enabled: true,
      proxies: ['http://proxy1:8080', 'http://proxy2:8080'],
      rotationInterval: 300000
    }
  };
  
  console.log('1️⃣ Basic Configuration (Light Protection):');
  console.log(JSON.stringify(basicConfig, null, 2));
  
  console.log('\n2️⃣ Medium Configuration (Moderate Protection):');
  console.log(JSON.stringify(mediumConfig, null, 2));
  
  console.log('\n3️⃣ Advanced Configuration (Maximum Protection):');
  console.log(JSON.stringify(advancedConfig, null, 2));
}

// Usage examples for integration
function showUsageExamples() {
  console.log('\n💡 Usage Examples:\n');
  
  console.log('// Basic stealth scraping');
  console.log(`
const stealthManager = new StealthBrowserManager();
const { context, contextId } = await stealthManager.createStealthContext({
  level: 'medium',
  randomizeFingerprint: true,
  simulateHumanBehavior: true
});

const page = await stealthManager.createStealthPage(contextId);
await page.goto('https://example.com');

// Automatic CloudFlare and reCAPTCHA handling
await stealthManager.bypassCloudflareChallenge(page);
await stealthManager.handleRecaptcha(page);
`);

  console.log('\n// Integration with ActionExecutor');
  console.log(`
const actionExecutor = new ActionExecutor();
const browserProcessor = new BrowserProcessor();
browserProcessor.enableStealthMode('advanced');
actionExecutor.browserProcessor = browserProcessor;

// Actions will automatically use human behavior simulation
const result = await actionExecutor.executeActionChain('https://example.com', [
  { type: 'wait', duration: 1000 },
  { type: 'click', selector: '#button' },
  { type: 'type', selector: '#input', text: 'Hello World' }
], {
  stealthMode: { enabled: true, level: 'advanced' },
  humanBehavior: { enabled: true }
});
`);

  console.log('\n// Advanced fingerprint customization');
  console.log(`
const customFingerprint = stealthManager.generateAdvancedFingerprint({
  customUserAgent: 'Mozilla/5.0 (Custom Agent)',
  customViewport: { width: 1366, height: 768 },
  timezone: 'America/New_York',
  fingerprinting: {
    canvasNoise: true,
    webglSpoofing: true,
    hardwareSpoofing: true
  }
});
`);
}

// Main demo function
async function runDemo() {
  console.log('🚀 Starting Comprehensive Stealth Mode Demo\n');
  console.log('=' * 60);
  
  await demonstrateAdvancedStealth();
  showConfigurationExamples();
  showUsageExamples();
  
  console.log('\n' + '=' * 60);
  console.log('🎯 Stealth Mode Phase 2.2 Demo Complete!');
  console.log('\n🔒 Your browser automation is now equipped with:');
  console.log('   • Advanced fingerprint randomization');
  console.log('   • Human behavior simulation');
  console.log('   • CloudFlare bypass capabilities');
  console.log('   • reCAPTCHA handling');
  console.log('   • Comprehensive anti-detection');
  console.log('   • Proxy rotation support');
  console.log('\n🎉 Happy stealthy scraping!');
}

// Export for use in other files
export { demonstrateAdvancedStealth, showConfigurationExamples, showUsageExamples };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runDemo().catch(console.error);
}