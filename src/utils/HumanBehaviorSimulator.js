/**
 * HumanBehaviorSimulator - Simulate human-like interactions
 * Features: natural mouse movements, typing patterns, scroll behavior, idle periods
 */

import { z } from 'zod';

const BehaviorConfigSchema = z.object({
  mouseMovements: z.object({
    enabled: z.boolean().default(true),
    speed: z.enum(['slow', 'normal', 'fast']).default('normal'),
    accuracy: z.number().min(0.1).max(1.0).default(0.8), // 0.1 = very inaccurate, 1.0 = perfect
    naturalCurves: z.boolean().default(true),
    randomMicroMovements: z.boolean().default(true)
  }).default({}),
  
  typing: z.object({
    enabled: z.boolean().default(true),
    speed: z.enum(['slow', 'normal', 'fast']).default('normal'),
    variability: z.number().min(0).max(1).default(0.3), // Typing speed variation
    mistakes: z.object({
      enabled: z.boolean().default(true),
      frequency: z.number().min(0).max(0.1).default(0.02), // 2% mistake rate
      correctionDelay: z.number().min(100).max(2000).default(500)
    }).default({})
  }).default({}),
  
  scrolling: z.object({
    enabled: z.boolean().default(true),
    naturalAcceleration: z.boolean().default(true),
    randomPauses: z.boolean().default(true),
    scrollBackProbability: z.number().min(0).max(1).default(0.1)
  }).default({}),
  
  interactions: z.object({
    hoverBeforeClick: z.boolean().default(true),
    clickDelay: z.object({
      min: z.number().default(100),
      max: z.number().default(300)
    }).default({}),
    focusBlurSimulation: z.boolean().default(true),
    idlePeriods: z.object({
      enabled: z.boolean().default(true),
      frequency: z.number().min(0).max(1).default(0.1), // 10% chance
      minDuration: z.number().default(1000),
      maxDuration: z.number().default(5000)
    }).default({})
  }).default({})
});

export class HumanBehaviorSimulator {
  constructor(config = {}) {
    this.config = BehaviorConfigSchema.parse(config);
    
    // Speed multipliers for different speeds
    this.speedMultipliers = {
      slow: 1.5,
      normal: 1.0,
      fast: 0.7
    };

    // Base typing speeds (characters per minute)
    this.typingSpeeds = {
      slow: 200,
      normal: 350,
      fast: 500
    };

    // Common typing patterns and mistakes
    this.commonMistakes = {
      'e': ['r', 'w'],
      'r': ['e', 't'],
      't': ['r', 'y'],
      'y': ['t', 'u'],
      'u': ['y', 'i'],
      'i': ['u', 'o'],
      'o': ['i', 'p'],
      'a': ['s', 'q'],
      's': ['a', 'd'],
      'd': ['s', 'f'],
      'f': ['d', 'g'],
      'g': ['f', 'h'],
      'h': ['g', 'j'],
      'j': ['h', 'k'],
      'k': ['j', 'l'],
      'l': ['k', ';'],
      'n': ['b', 'm'],
      'm': ['n', ',']
    };

    this.stats = {
      mouseMovements: 0,
      typingActions: 0,
      scrollActions: 0,
      idlePeriods: 0,
      mistakesSimulated: 0,
      totalInteractions: 0
    };
  }

  /**
   * Simulate human-like mouse movement to target coordinates
   */
  async simulateMouseMovement(page, fromX, fromY, toX, toY) {
    if (!this.config.mouseMovements.enabled) {
      await page.mouse.move(toX, toY);
      return;
    }

    const path = this.generateMousePath(fromX, fromY, toX, toY);
    const speed = this.speedMultipliers[this.config.mouseMovements.speed];

    for (let i = 0; i < path.length; i++) {
      const point = path[i];
      await page.mouse.move(point.x, point.y);
      
      // Add realistic delay between movements
      const delay = (5 + Math.random() * 5) * speed;
      await this.delay(delay);

      // Occasionally add micro-movements
      if (this.config.mouseMovements.randomMicroMovements && Math.random() < 0.1) {
        const microX = point.x + (Math.random() - 0.5) * 2;
        const microY = point.y + (Math.random() - 0.5) * 2;
        await page.mouse.move(microX, microY);
        await this.delay(10 + Math.random() * 20);
      }
    }

    this.stats.mouseMovements++;
  }

  /**
   * Generate natural mouse movement path using Bezier curves
   */
  generateMousePath(fromX, fromY, toX, toY) {
    const points = [];
    const distance = Math.sqrt(Math.pow(toX - fromX, 2) + Math.pow(toY - fromY, 2));
    const steps = Math.max(10, Math.min(100, Math.floor(distance / 5)));

    if (!this.config.mouseMovements.naturalCurves || distance < 50) {
      // Simple linear movement for short distances
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        points.push({
          x: fromX + (toX - fromX) * t,
          y: fromY + (toY - fromY) * t
        });
      }
    } else {
      // Bezier curve for natural movement
      const controlPoints = this.generateBezierControlPoints(fromX, fromY, toX, toY);
      
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const point = this.calculateBezierPoint(t, 
          { x: fromX, y: fromY },
          controlPoints.cp1,
          controlPoints.cp2,
          { x: toX, y: toY }
        );
        
        // Add accuracy variation
        const accuracy = this.config.mouseMovements.accuracy;
        const deviation = (1 - accuracy) * 10;
        
        points.push({
          x: point.x + (Math.random() - 0.5) * deviation,
          y: point.y + (Math.random() - 0.5) * deviation
        });
      }
    }

    return points;
  }

  /**
   * Generate control points for Bezier curve
   */
  generateBezierControlPoints(x1, y1, x2, y2) {
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    
    // Add some randomness to make the curve more natural
    const curvature = Math.random() * 100 + 50;
    const direction = Math.random() < 0.5 ? 1 : -1;
    
    const cp1 = {
      x: midX + direction * curvature * Math.random(),
      y: midY + direction * curvature * Math.random()
    };
    
    const cp2 = {
      x: midX - direction * curvature * Math.random(),
      y: midY - direction * curvature * Math.random()
    };

    return { cp1, cp2 };
  }

  /**
   * Calculate point on cubic Bezier curve
   */
  calculateBezierPoint(t, p0, p1, p2, p3) {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;

    return {
      x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
      y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y
    };
  }

  /**
   * Simulate human-like typing with realistic delays and mistakes
   */
  async simulateTyping(page, selector, text) {
    if (!this.config.typing.enabled) {
      await page.type(selector, text);
      return;
    }

    const element = await page.waitForSelector(selector);
    await element.focus();

    // Calculate base typing speed
    const baseSpeed = this.typingSpeeds[this.config.typing.speed];
    const baseDelay = 60000 / baseSpeed; // Convert CPM to milliseconds per character

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      
      // Simulate typing mistake
      if (this.config.typing.mistakes.enabled && Math.random() < this.config.typing.mistakes.frequency) {
        await this.simulateTypingMistake(element, char);
        continue;
      }

      // Calculate realistic delay for this character
      const delay = this.calculateTypingDelay(char, i, text, baseDelay);
      
      // Type the character
      await element.type(char);
      await this.delay(delay);

      // Occasionally add brief pauses (like thinking)
      if (Math.random() < 0.05) {
        await this.delay(200 + Math.random() * 800);
      }
    }

    this.stats.typingActions++;
  }

  /**
   * Simulate a typing mistake and correction
   */
  async simulateTypingMistake(element, correctChar) {
    // Type wrong character
    const mistakes = this.commonMistakes[correctChar.toLowerCase()] || [correctChar];
    const wrongChar = mistakes[Math.floor(Math.random() * mistakes.length)];
    
    await element.type(wrongChar);
    await this.delay(this.config.typing.mistakes.correctionDelay + Math.random() * 500);
    
    // Correct the mistake
    await element.press('Backspace');
    await this.delay(100 + Math.random() * 200);
    await element.type(correctChar);
    
    this.stats.mistakesSimulated++;
  }

  /**
   * Calculate realistic typing delay based on character and context
   */
  calculateTypingDelay(char, index, text, baseDelay) {
    let delay = baseDelay;

    // Add variability
    const variability = this.config.typing.variability;
    delay += (Math.random() - 0.5) * delay * variability;

    // Longer delays for certain characters
    if (char === ' ') {
      delay *= 1.2; // Space takes slightly longer
    } else if (char.match(/[.!?]/)) {
      delay *= 1.5; // Punctuation takes longer
    } else if (char.match(/[A-Z]/)) {
      delay *= 1.3; // Capital letters take longer (shift key)
    } else if (char.match(/[0-9]/)) {
      delay *= 1.4; // Numbers take longer
    }

    // Longer delay after punctuation (thinking pause)
    if (index > 0 && text[index - 1].match(/[.!?]/)) {
      delay *= 2;
    }

    // Shorter delay for repeated characters
    if (index > 0 && text[index - 1] === char) {
      delay *= 0.8;
    }

    return Math.max(50, delay); // Minimum 50ms delay
  }

  /**
   * Simulate human-like clicking with hover and delay
   */
  async simulateClick(page, selector, options = {}) {
    const element = await page.waitForSelector(selector);
    const boundingBox = await element.boundingBox();
    
    if (!boundingBox) {
      throw new Error('Element not visible for clicking');
    }

    // Calculate click position with slight randomness
    const clickX = boundingBox.x + boundingBox.width * (0.3 + Math.random() * 0.4);
    const clickY = boundingBox.y + boundingBox.height * (0.3 + Math.random() * 0.4);

    // Get current mouse position (approximate)
    const currentX = boundingBox.x - 50 + Math.random() * 100;
    const currentY = boundingBox.y - 50 + Math.random() * 100;

    // Simulate hover before click
    if (this.config.interactions.hoverBeforeClick) {
      await this.simulateMouseMovement(page, currentX, currentY, clickX, clickY);
      await this.delay(100 + Math.random() * 200); // Brief hover
    }

    // Add click delay
    const clickDelay = this.config.interactions.clickDelay.min + 
      Math.random() * (this.config.interactions.clickDelay.max - this.config.interactions.clickDelay.min);
    await this.delay(clickDelay);

    // Perform the click
    await page.mouse.click(clickX, clickY, options);

    this.stats.totalInteractions++;
  }

  /**
   * Simulate human-like scrolling with natural acceleration
   */
  async simulateScroll(page, options = {}) {
    if (!this.config.scrolling.enabled) {
      await page.mouse.wheel(0, options.deltaY || 100);
      return;
    }

    const {
      direction = 'down',
      distance = 300,
      duration = 1000,
      target = null
    } = options;

    if (target) {
      // Scroll to specific element
      await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, target);
      return;
    }

    // Calculate scroll parameters
    const steps = Math.max(10, Math.min(50, duration / 50));
    const stepDistance = distance / steps;
    const stepDelay = duration / steps;

    let deltaY = direction === 'up' ? -stepDistance : stepDistance;

    for (let i = 0; i < steps; i++) {
      // Apply natural acceleration curve
      let acceleration = 1;
      if (this.config.scrolling.naturalAcceleration) {
        const progress = i / steps;
        // Ease-in-out curve
        acceleration = progress < 0.5 
          ? 2 * progress * progress 
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      }

      const currentDelta = deltaY * acceleration;
      await page.mouse.wheel(0, currentDelta);

      // Variable delay between scroll steps
      const delay = stepDelay * (0.8 + Math.random() * 0.4);
      await this.delay(delay);

      // Random pauses during scrolling
      if (this.config.scrolling.randomPauses && Math.random() < 0.1) {
        await this.delay(200 + Math.random() * 500);
      }
    }

    // Occasionally scroll back slightly (human behavior)
    if (this.config.scrolling.scrollBackProbability > 0 && 
        Math.random() < this.config.scrolling.scrollBackProbability) {
      await this.delay(500 + Math.random() * 1000);
      await page.mouse.wheel(0, -deltaY * 0.3);
    }

    this.stats.scrollActions++;
  }

  /**
   * Simulate focus and blur events
   */
  async simulateFocusBlur(page, selector) {
    if (!this.config.interactions.focusBlurSimulation) {
      return;
    }

    const element = await page.waitForSelector(selector);
    
    // Brief unfocus/refocus to simulate human attention
    if (Math.random() < 0.3) {
      await page.evaluate(() => document.activeElement?.blur());
      await this.delay(100 + Math.random() * 300);
      await element.focus();
      await this.delay(50 + Math.random() * 150);
    }
  }

  /**
   * Simulate idle periods (human pauses)
   */
  async simulateIdlePeriod() {
    if (!this.config.interactions.idlePeriods.enabled || 
        Math.random() > this.config.interactions.idlePeriods.frequency) {
      return;
    }

    const minDuration = this.config.interactions.idlePeriods.minDuration;
    const maxDuration = this.config.interactions.idlePeriods.maxDuration;
    const duration = minDuration + Math.random() * (maxDuration - minDuration);

    await this.delay(duration);
    this.stats.idlePeriods++;
  }

  /**
   * Simulate reading time based on content
   */
  async simulateReadingTime(page, selector = null) {
    let textLength = 0;
    
    if (selector) {
      textLength = await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        return element ? element.textContent.length : 0;
      }, selector);
    } else {
      textLength = await page.evaluate(() => document.body.textContent.length);
    }

    // Average reading speed: 250 words per minute
    // Average word length: 5 characters
    const wordsCount = textLength / 5;
    const readingTime = (wordsCount / 250) * 60 * 1000; // Convert to milliseconds
    
    // Add randomness (50% to 150% of calculated time)
    const actualReadingTime = readingTime * (0.5 + Math.random());
    
    // Cap reading time at 30 seconds for practical purposes
    const finalTime = Math.min(actualReadingTime, 30000);
    
    await this.delay(finalTime);
  }

  /**
   * Simulate form filling behavior
   */
  async simulateFormFilling(page, formData) {
    for (const [selector, value] of Object.entries(formData)) {
      // Focus on field
      await this.simulateFocusBlur(page, selector);
      
      // Possible idle period before typing
      await this.simulateIdlePeriod();
      
      // Type with human-like behavior
      await this.simulateTyping(page, selector, value);
      
      // Brief pause after typing
      await this.delay(200 + Math.random() * 500);
    }
  }

  /**
   * Generate realistic viewport interactions
   */
  async simulateViewportInteraction(page, action) {
    switch (action.type) {
      case 'resize':
        const newSize = action.size || { width: 1280 + Math.random() * 640, height: 720 + Math.random() * 360 };
        await page.setViewportSize(newSize);
        break;
        
      case 'zoom':
        const zoomLevel = action.level || (0.8 + Math.random() * 0.4); // 80% to 120%
        await page.evaluate((zoom) => {
          document.body.style.zoom = zoom;
        }, zoomLevel);
        break;
        
      case 'fullscreen':
        // Simulate fullscreen behavior
        await page.keyboard.press('F11');
        await this.delay(1000);
        if (action.exit) {
          await page.keyboard.press('F11');
        }
        break;
    }
  }

  /**
   * Utility delay function with slight randomness
   */
  delay(ms, randomness = 0.1) {
    const variation = ms * randomness;
    const actualDelay = ms + (Math.random() - 0.5) * variation;
    return new Promise(resolve => setTimeout(resolve, Math.max(0, actualDelay)));
  }

  /**
   * Get behavior statistics
   */
  getStats() {
    return {
      ...this.stats,
      configuration: this.config,
      timestamp: Date.now()
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      mouseMovements: 0,
      typingActions: 0,
      scrollActions: 0,
      idlePeriods: 0,
      mistakesSimulated: 0,
      totalInteractions: 0
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = BehaviorConfigSchema.parse({ ...this.config, ...newConfig });
  }
}

export default HumanBehaviorSimulator;