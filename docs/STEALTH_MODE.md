# Stealth Mode Features

The MCP WebScraper now includes comprehensive stealth mode capabilities for anti-detection web scraping. This feature set includes browser fingerprint randomization, human behavior simulation, and advanced anti-detection measures.

## Overview

Stealth mode helps avoid detection by websites that implement anti-bot measures. It includes:

- **Browser Fingerprint Randomization**: Randomize user agents, viewports, timezones, and other browser characteristics
- **Human Behavior Simulation**: Natural mouse movements, typing patterns, scroll behavior, and idle periods
- **Anti-Detection Measures**: WebRTC leak prevention, headless detection bypassing, and canvas/WebGL spoofing
- **Configurable Levels**: Choose from basic, medium, or advanced stealth levels

## Components

### 1. StealthBrowserManager (`src/core/StealthBrowserManager.js`)

Manages stealth-enabled browser instances with anti-detection features:

```javascript
import { StealthBrowserManager } from './src/core/StealthBrowserManager.js';

const stealthManager = new StealthBrowserManager();
const { context, contextId } = await stealthManager.createStealthContext({
  level: 'advanced',
  randomizeFingerprint: true,
  hideWebDriver: true,
  blockWebRTC: true
});
```

**Features:**
- Browser fingerprint randomization (user-agent, viewport, fonts, canvas)
- WebRTC leak prevention with IP spoofing
- Timezone spoofing across multiple regions
- Header randomization patterns
- Headless detection prevention
- Plugin and permission spoofing

### 2. HumanBehaviorSimulator (`src/utils/HumanBehaviorSimulator.js`)

Simulates human-like interactions to avoid behavioral detection:

```javascript
import { HumanBehaviorSimulator } from './src/utils/HumanBehaviorSimulator.js';

const simulator = new HumanBehaviorSimulator({
  mouseMovements: { enabled: true, speed: 'normal', naturalCurves: true },
  typing: { enabled: true, variability: 0.3, mistakes: { frequency: 0.02 } },
  scrolling: { enabled: true, naturalAcceleration: true }
});

// Simulate natural mouse movement
await simulator.simulateMouseMovement(page, 0, 0, 100, 100);

// Simulate human typing with mistakes
await simulator.simulateTyping(page, 'input[name="email"]', 'user@example.com');
```

**Features:**
- Mouse movement curves using Bezier-based natural paths
- Typing cadence variation with realistic delays and mistakes
- Scroll pattern simulation with acceleration/deceleration
- Focus/blur event simulation
- Random idle periods and reading time simulation

### 3. Enhanced BrowserProcessor

The existing `BrowserProcessor` has been enhanced to support stealth mode:

```javascript
import BrowserProcessor from './src/core/processing/BrowserProcessor.js';

const processor = new BrowserProcessor();

// Enable stealth mode
processor.enableStealthMode('advanced');

const result = await processor.processURL({
  url: 'https://example.com',
  options: {
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
      typingVariation: true,
      scrollBehavior: true,
      idlePeriods: true
    }
  }
});
```

## Configuration

### Environment Variables

Add these to your `.env` file to configure stealth mode globally:

```bash
# Global stealth settings
STEALTH_MODE_ENABLED=true
STEALTH_LEVEL=medium

# Browser fingerprinting
STEALTH_RANDOMIZE_USER_AGENT=true
STEALTH_RANDOMIZE_VIEWPORT=true
STEALTH_SPOOF_TIMEZONE=true
STEALTH_HIDE_WEBDRIVER=true
STEALTH_BLOCK_WEBRTC=true
STEALTH_CUSTOM_USER_AGENT=

# Human behavior simulation
STEALTH_HUMAN_BEHAVIOR_ENABLED=true
STEALTH_MOUSE_MOVEMENTS=true
STEALTH_NATURAL_TYPING=true
STEALTH_SCROLL_BEHAVIOR=true
STEALTH_IDLE_PERIODS=true

# Timing configurations
STEALTH_MOUSE_SPEED=normal
STEALTH_TYPING_SPEED=normal
STEALTH_TYPING_VARIABILITY=0.3
STEALTH_MISTAKE_FREQUENCY=0.02

# Advanced anti-detection
STEALTH_BYPASS_HEADLESS=true
STEALTH_PREVENT_CANVAS=true
STEALTH_PREVENT_WEBGL=true
STEALTH_NETWORK_EMULATION=true
```

### Stealth Levels

#### Basic Level
- Hide webdriver properties
- Block WebRTC leaks
- Minimal performance impact
- No human behavior simulation

#### Medium Level (Default)
- Browser fingerprint randomization
- Basic human behavior simulation
- Mouse movements and typing variation
- Balanced performance and stealth

#### Advanced Level
- Complete fingerprint spoofing
- Full human behavior simulation
- Canvas and WebGL fingerprint prevention
- Network condition emulation
- Maximum stealth, higher performance cost

### Programmatic Configuration

```javascript
import { getStealthConfig, getHumanBehaviorConfig } from './src/constants/config.js';

// Get configuration for specific level
const stealthConfig = getStealthConfig('advanced');
const behaviorConfig = getHumanBehaviorConfig('advanced');

// Use with tools
const result = await processor.processURL({
  url: 'https://example.com',
  options: {
    stealthMode: stealthConfig,
    humanBehavior: behaviorConfig
  }
});
```

## Integration with Existing Tools

### With ScrapeWithActionsTool

```javascript
import { ScrapeWithActionsTool } from './src/tools/advanced/ScrapeWithActionsTool.js';

const tool = new ScrapeWithActionsTool();

const result = await tool.execute({
  url: 'https://example.com/login',
  actions: [
    { type: 'type', selector: '#username', text: 'user@example.com' },
    { type: 'type', selector: '#password', text: 'password123' },
    { type: 'click', selector: '#login-button' }
  ],
  browserOptions: {
    stealthMode: {
      enabled: true,
      level: 'advanced',
      simulateHumanBehavior: true
    },
    humanBehavior: {
      enabled: true,
      mouseMovements: true,
      typingVariation: true
    }
  }
});
```

### With ProcessDocument Tool

Stealth mode automatically applies to document processing when enabled:

```javascript
import ProcessDocumentTool from './src/tools/extract/processDocument.js';

const tool = new ProcessDocumentTool();
const result = await tool.execute({
  url: 'https://example.com/document.pdf',
  options: {
    stealthMode: { enabled: true, level: 'medium' }
  }
});
```

## Monitoring and Statistics

### Get Stealth Statistics

```javascript
const processor = new BrowserProcessor();
processor.enableStealthMode('advanced');

// After processing
const stats = processor.getStealthStats();
console.log('Stealth stats:', stats);
// {
//   stealthManagerActive: true,
//   humanBehaviorActive: true,
//   activeContexts: 1,
//   stealthStats: { activeContexts: 1, totalFingerprintsSaved: 1 },
//   behaviorStats: { mouseMovements: 5, typingActions: 2, ... }
// }
```

### Human Behavior Statistics

```javascript
const simulator = new HumanBehaviorSimulator();
const stats = simulator.getStats();
console.log('Behavior stats:', stats);
// {
//   mouseMovements: 15,
//   typingActions: 8,
//   scrollActions: 3,
//   mistakesSimulated: 1,
//   totalInteractions: 26
// }
```

## Performance Considerations

### Performance Impact by Level

- **Basic**: ~5-10% slower than standard scraping
- **Medium**: ~15-25% slower, balanced approach
- **Advanced**: ~30-50% slower, maximum stealth

### Optimization Tips

1. **Use appropriate level**: Don't use advanced level unless necessary
2. **Disable unused features**: Turn off mouse movements for simple scraping
3. **Batch operations**: Reuse browser contexts when possible
4. **Resource blocking**: Block images/fonts to improve speed in stealth mode

```javascript
// Optimized stealth configuration
const processor = new BrowserProcessor();
processor.updateStealthConfig({
  level: 'medium',
  humanBehavior: {
    mouseMovements: false, // Disable if not clicking
    readingTime: false     // Disable for fast scraping
  }
});
```

## Troubleshooting

### Common Issues

1. **Timeout errors**: Increase timeout values when using human behavior simulation
2. **Detection still occurring**: Try advanced level or custom user agents
3. **Performance too slow**: Disable unnecessary human behavior features
4. **Memory usage**: Limit concurrent contexts with `STEALTH_MAX_CONTEXTS`

### Debug Mode

Enable detailed logging for troubleshooting:

```javascript
const processor = new BrowserProcessor();
processor.enableLogging = true;
processor.enableStealthMode('advanced');
```

### Testing Stealth Effectiveness

Use detection testing websites to verify stealth mode:

```javascript
// Test on detection sites
const testSites = [
  'https://httpbin.org/headers',     // Check User-Agent
  'https://httpbin.org/user-agent',  // Verify fingerprint
];

for (const site of testSites) {
  const result = await processor.processURL({
    url: site,
    options: { stealthMode: { enabled: true, level: 'advanced' } }
  });
  console.log('Detection test result:', result.text);
}
```

## Security Considerations

1. **Not foolproof**: Advanced detection systems may still identify automated behavior
2. **Use responsibly**: Respect websites' terms of service and robots.txt
3. **Rate limiting**: Always implement appropriate delays between requests
4. **Legal compliance**: Ensure your use case complies with applicable laws

## Examples

See `examples/stealth-scraping-example.js` for comprehensive usage examples including:

- Basic stealth scraping
- Advanced action chains with stealth
- Stealth level comparisons
- Effectiveness monitoring
- Performance impact analysis

## API Reference

### StealthBrowserManager Methods

- `launchStealthBrowser(config)`: Launch browser with stealth features
- `createStealthContext(config)`: Create stealth-enabled browser context
- `createStealthPage(contextId)`: Create stealth page
- `getStats()`: Get stealth statistics
- `cleanup()`: Clean up resources

### HumanBehaviorSimulator Methods

- `simulateMouseMovement(page, fromX, fromY, toX, toY)`: Natural mouse movement
- `simulateTyping(page, selector, text)`: Human-like typing
- `simulateClick(page, selector)`: Click with hover and delays
- `simulateScroll(page, options)`: Natural scrolling behavior
- `getStats()`: Get behavior statistics

### BrowserProcessor Stealth Methods

- `enableStealthMode(level)`: Enable stealth with specified level
- `disableStealthMode()`: Disable stealth mode
- `updateStealthConfig(config)`: Update stealth configuration
- `getStealthStats()`: Get comprehensive stealth statistics

## Contributing

When adding new stealth features:

1. Update the appropriate component (StealthBrowserManager or HumanBehaviorSimulator)
2. Add configuration options to `src/constants/config.js`
3. Update schemas and validation
4. Add tests to `tests/stealth-mode-test.js`
5. Update this documentation

The stealth mode system is designed to be extensible and maintainable while providing powerful anti-detection capabilities for legitimate web scraping use cases.