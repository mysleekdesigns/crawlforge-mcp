/**
 * ActionExecutor - Browser automation with action chains and error recovery
 * Features: page interactions, action validation, error recovery, result collection
 */

import { z } from 'zod';
import BrowserProcessor from './processing/BrowserProcessor.js';
import { EventEmitter } from 'events';
import { createHash } from 'node:crypto';
import { assertUrlAllowed } from '../utils/ssrfGuard.js';
import { browserPreflight } from '../utils/robotsGate.js';

// executeJavaScript hardening limits (only relevant when the deploy-time flag
// ALLOW_JAVASCRIPT_EXECUTION=true is set; JS execution stays off by default).
const JS_MAX_SCRIPT_LENGTH = parseInt(process.env.JS_MAX_SCRIPT_LENGTH || '10000', 10);
const JS_EXECUTION_TIMEOUT_MS = parseInt(process.env.JS_EXECUTION_TIMEOUT_MS || '5000', 10);

// Headroom for the per-action backstop in executeActionInternal. The underlying
// Playwright call gets the action's real deadline, so the backstop must lose
// that race — Playwright's error names the selector and the state it waited
// for, the backstop can only say "timed out".
const ACTION_TIMEOUT_GRACE_MS = 2000;

// Ceiling for a single error-recovery strategy. By the time recovery runs the
// action has already spent its whole timeout failing, so each strategy gets a
// bounded slice — granting it another full deadline made a chain that was never
// going to work cost several times its stated timeout.
const RECOVERY_TIMEOUT_MS = 5000;

// The only states locator.waitFor()/page.waitForSelector() accept. The rest of
// the wait-action enum (enabled/disabled/stable) are ElementHandle states and
// have to go through waitForElementState instead — passing them here is
// rejected outright with "expected one of (attached|detached|visible|hidden)".
const SELECTOR_WAIT_STATES = new Set(['attached', 'detached', 'visible', 'hidden']);

// Action schemas
const BaseActionSchema = z.object({
  type: z.string(),
  timeout: z.number().optional(),
  description: z.string().optional(),
  continueOnError: z.boolean().default(false),
  // How many of the recovery strategies registered in
  // initializeErrorRecoveryStrategies() this action may try (in order, until
  // one succeeds); 0 opts out. Defaults to 1 — the previous 0 default combined
  // with the `action.retries > 0` gate in executeActionInternal left every
  // strategy unreachable. ScrapeWithActionsTool's form-autofill presets already
  // set 1 and 2 on exactly the actions that have that many strategies.
  retries: z.number().min(0).max(5).default(1),
  // When true, capture page state (page.content()/page.url()) natively right
  // after this action executes. Does not use in-page JS execution, so it
  // works regardless of the ALLOW_JAVASCRIPT_EXECUTION flag.
  captureAfter: z.boolean().default(false)
});

const WaitActionSchema = BaseActionSchema.extend({
  type: z.literal('wait'),
  duration: z.number().min(0).max(30000).optional(),
  milliseconds: z.number().min(0).max(30000).optional(), // Backwards compatibility
  selector: z.string().optional(),
  condition: z.enum(['visible', 'hidden', 'enabled', 'disabled', 'stable']).optional(),
  text: z.string().optional()
}).refine(data => data.duration || data.milliseconds || data.timeout || data.selector || data.text, {
  message: 'Wait action requires duration/milliseconds/timeout, selector, or text'
});

const ClickActionSchema = BaseActionSchema.extend({
  type: z.literal('click'),
  selector: z.string(),
  button: z.enum(['left', 'right', 'middle']).default('left'),
  clickCount: z.number().min(1).max(3).default(1),
  delay: z.number().min(0).max(1000).default(0),
  force: z.boolean().default(false),
  position: z.object({
    x: z.number(),
    y: z.number()
  }).optional()
});

const TypeActionSchema = BaseActionSchema.extend({
  type: z.literal('type'),
  selector: z.string(),
  text: z.string(),
  delay: z.number().min(0).max(1000).default(0),
  clear: z.boolean().default(false)
});

const PressActionSchema = BaseActionSchema.extend({
  type: z.literal('press'),
  key: z.string(),
  modifiers: z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).default([]),
  selector: z.string().optional()
});

const ScrollActionSchema = BaseActionSchema.extend({
  type: z.literal('scroll'),
  selector: z.string().optional(),
  direction: z.enum(['up', 'down', 'left', 'right']).default('down'),
  distance: z.number().min(0).default(100),
  smooth: z.boolean().default(true),
  toElement: z.string().optional(),
  // Absolute scroll-to coordinates (window.scrollTo). When present they take
  // precedence over direction/distance. Matches the CLI guide's documented
  // action-script format: { "type": "scroll", "x": 0, "y": 500 }.
  x: z.number().min(0).optional(),
  y: z.number().min(0).optional()
});

const SelectActionSchema = BaseActionSchema.extend({
  type: z.literal('select'),
  selector: z.string(),
  // Playwright's string form of selectOption matches an <option> by its `value`
  // OR its visible label, so one field covers both and the caller doesn't have
  // to know which one the page uses. `values` selects several in a multi-select.
  value: z.string().optional(),
  values: z.array(z.string()).optional()
}).refine(data => data.value !== undefined || (data.values && data.values.length > 0), {
  message: 'Select action requires value or values'
});

const HoverActionSchema = BaseActionSchema.extend({
  type: z.literal('hover'),
  selector: z.string(),
  force: z.boolean().default(false),
  position: z.object({
    x: z.number(),
    y: z.number()
  }).optional()
});

const NavigateActionSchema = BaseActionSchema.extend({
  type: z.literal('navigate'),
  url: z.string().url(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle', 'commit']).optional()
});

const ScreenshotActionSchema = BaseActionSchema.extend({
  type: z.literal('screenshot'),
  selector: z.string().optional(),
  fullPage: z.boolean().default(false),
  quality: z.number().min(0).max(100).default(80),
  format: z.enum(['png', 'jpeg']).default('png')
});

const ExecuteJavaScriptActionSchema = BaseActionSchema.extend({
  type: z.literal('executeJavaScript'),
  script: z.string(),
  args: z.array(z.any()).default([]),
  returnResult: z.boolean().default(true)
});

const ActionSchema = z.union([
  WaitActionSchema,
  ClickActionSchema,
  TypeActionSchema,
  PressActionSchema,
  ScrollActionSchema,
  SelectActionSchema,
  HoverActionSchema,
  NavigateActionSchema,
  ScreenshotActionSchema,
  ExecuteJavaScriptActionSchema
]);

const ActionChainSchema = z.object({
  actions: z.array(ActionSchema),
  continueOnError: z.boolean().default(false),
  timeout: z.number().min(1000).max(300000).default(30000),
  retryChain: z.number().min(0).max(3).default(0),
  metadata: z.record(z.any()).default({})
});

export class ActionExecutor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    const {
      defaultTimeout = 10000,
      enableLogging = true,
      enableScreenshotOnError = true,
      maxConcurrentActions = 1,
      actionDelay = 100, // Default delay between actions
      enableActionValidation = true,
      enableErrorRecovery = true,
      screenshotPath = './screenshots'
    } = options;

    this.defaultTimeout = defaultTimeout;
    this.enableLogging = enableLogging;
    this.enableScreenshotOnError = enableScreenshotOnError;
    this.maxConcurrentActions = maxConcurrentActions;
    this.actionDelay = actionDelay;
    this.enableActionValidation = enableActionValidation;
    this.enableErrorRecovery = enableErrorRecovery;
    this.screenshotPath = screenshotPath;

    // Browser processor for page interactions
    this.browserProcessor = new BrowserProcessor();

    // Action execution state
    this.activeChains = new Map();
    this.executionHistory = [];
    this.errorRecoveryStrategies = new Map();

    // Statistics
    this.stats = {
      totalChains: 0,
      successfulChains: 0,
      failedChains: 0,
      totalActions: 0,
      successfulActions: 0,
      failedActions: 0,
      recoveredErrors: 0,
      averageChainTime: 0,
      lastUpdated: Date.now()
    };

    // Initialize error recovery strategies
    this.initializeErrorRecoveryStrategies();
  }

  /**
   * Execute action chain on a page
   * @param {string} url - URL to execute actions on
   * @param {Object|Array} chainConfig - Action chain configuration or array of actions
   * @param {Object} browserOptions - Browser options
   * @returns {Promise<Object>} Execution result
   */
  async executeActionChain(url, chainConfig, browserOptions = {}) {
    const startTime = Date.now();
    const chainId = this.generateChainId();
    // Declared here (not inside the try block below) so the outer catch can
    // still report partial results/screenshots/capturedStates on failure.
    let executionContext = null;

    try {
      // Handle simplified signature: executeActionChain(url, actionsArray)
      let actualChainConfig;
      if (Array.isArray(chainConfig)) {
        actualChainConfig = {
          actions: chainConfig,
          continueOnError: false,
          timeout: 30000,
          retryChain: 0
        };
      } else {
        actualChainConfig = chainConfig;
      }

      // (v3.0.19 cleanup) The legacy example.com mock branch was removed — no
      // test depended on it and it short-circuited real validation. See §A3.

      // Validate chain configuration
      const validatedChain = ActionChainSchema.parse(actualChainConfig);
      
      this.stats.totalChains++;
      
      // Create execution context
      executionContext = {
        id: chainId,
        url,
        chain: validatedChain,
        browserOptions,
        startTime,
        results: [],
        errors: [],
        screenshots: [],
        metadata: {
          ...validatedChain.metadata,
          userAgent: browserOptions.userAgent,
          viewport: {
            width: browserOptions.viewportWidth || 1280,
            height: browserOptions.viewportHeight || 720
          }
        }
      };

      this.activeChains.set(chainId, executionContext);
      this.emit('chainStarted', executionContext);

      // D2.4: initialize page INSIDE try/finally so it is always closed even on
      // errors thrown between acquisition and the inner try block.
      let page = null;
      let chainResult;
      
      try {
        page = await this.initializePage(url, browserOptions);
        executionContext.page = page;

        // Execute chain with potential retries
        chainResult = await this.executeChainWithRetries(executionContext);

        // Capture the LIVE post-action page state before the page is closed,
        // so callers can extract final content reflecting all actions
        // (instead of re-fetching the original URL).
        try {
          executionContext.finalHtml = await page.content();
          executionContext.finalUrl = page.url();
        } catch (captureErr) {
          this.log('warn', 'Failed to capture final page content: ' + captureErr.message);
        }

        this.stats.successfulChains++;
        executionContext.success = true;

      } catch (error) {
        this.stats.failedChains++;
        executionContext.success = false;
        executionContext.error = error.message;

        // Capture error screenshot if enabled
        if (this.enableScreenshotOnError && page) {
          try {
            const errorScreenshot = await this.captureScreenshot(page, {
              fullPage: true,
              description: 'Error screenshot'
            });
            executionContext.screenshots.push(errorScreenshot);
          } catch (screenshotError) {
            this.log('warn', 'Failed to capture error screenshot: ' + screenshotError.message);
          }
        }

        throw error;
      } finally {
        // D2.4: always close page to prevent leaks. Also close the owning
        // context for non-stealth pages — createPage() gives each call its
        // own dedicated BrowserContext that is never tracked/closed
        // elsewhere, so leaving it open here leaks it until server shutdown.
        // A stealth context belongs to StealthBrowserManager's pool, so it is
        // released through the manager instead of closed directly here.
        if (page) {
          if (browserOptions.stealthMode?.enabled) {
            await this.browserProcessor.releaseStealthPage(page);
          } else {
            const ctx = page.context();
            try { await page.close(); } catch (_) { /* ignore close errors */ }
            try { await ctx.close(); } catch (_) { /* ignore close errors */ }
          }
        }

        // Update execution time
        const executionTime = Date.now() - startTime;
        executionContext.executionTime = executionTime;
        this.updateAverageChainTime(executionTime);
        
        // Remove from active chains
        this.activeChains.delete(chainId);
        
        // Add to execution history. Strip finalHtml (full post-action page
        // HTML, often 100KB-2MB), screenshots (base64 PNGs), capturedStates
        // (full intermediate-page HTML), and each screenshot action's base64
        // payload inside results — getExecutionHistory() only reads scalar
        // fields and results[].success, so retaining the heavy payloads just
        // pins them in memory for the life of the 100-entry history.
        this.executionHistory.push({
          ...executionContext,
          page: undefined, // Don't store page in history
          finalHtml: undefined,
          screenshots: undefined,
          screenshotCount: executionContext.screenshots.length,
          capturedStates: undefined,
          capturedStateCount: (executionContext.capturedStates || []).length,
          results: executionContext.results.map(r => (
            r?.result?.data !== undefined
              ? { ...r, result: { ...r.result, data: undefined, dataBytes: typeof r.result.data === 'string' ? r.result.data.length : undefined } }
              : r
          ))
        });
        
        // Keep only last 100 executions in history
        if (this.executionHistory.length > 100) {
          this.executionHistory.shift();
        }
        
        this.emit('chainCompleted', executionContext);
      }

      return {
        success: true,
        chainId,
        url,
        finalUrl: executionContext.finalUrl || url,
        finalHtml: executionContext.finalHtml,
        executionTime: Date.now() - startTime,
        results: executionContext.results,
        screenshots: executionContext.screenshots,
        capturedStates: executionContext.capturedStates || [],
        metadata: executionContext.metadata,
        stats: {
          totalActions: executionContext.results.length,
          successfulActions: executionContext.results.filter(r => r.success).length,
          failedActions: executionContext.results.filter(r => !r.success).length
        }
      };

    } catch (error) {
      this.emit('chainFailed', { chainId, url, error });
      return {
        success: false,
        chainId,
        url,
        executionTime: Date.now() - startTime,
        error: error.message,
        // Preserve whatever was captured before the failure (per-action
        // results, the error screenshot, and any intermediate-state
        // captures) instead of discarding them.
        results: executionContext?.results || [],
        screenshots: executionContext?.screenshots || [],
        capturedStates: executionContext?.capturedStates || []
      };
    }
  }

  /**
   * Execute chain with retries
   * @param {Object} executionContext - Execution context
   * @returns {Promise<Object>} Chain result
   */
  async executeChainWithRetries(executionContext) {
    const { chain, page } = executionContext;
    let lastError;

    for (let attempt = 0; attempt <= chain.retryChain; attempt++) {
      try {
        if (attempt > 0) {
          this.log('info', 'Retrying chain execution, attempt ' + (attempt + 1));
          executionContext.results = []; // Clear previous results on retry
          executionContext.capturedStates = []; // Clear previous captures on retry
          // Replaying the chain against whatever the failed attempt left behind
          // (form half-filled, menu open, possibly a different URL) is not a
          // retry. Reload the starting URL so every attempt begins where the
          // first one did.
          await this.navigateToUrl(page, executionContext.url);
        }

        // Execute actions in sequence
        for (let i = 0; i < chain.actions.length; i++) {
          const action = chain.actions[i];
          const actionResult = await this.executeActionInternal(page, action, executionContext);
          
          executionContext.results.push(actionResult);
          this.stats.totalActions++;

          // Collect screenshots produced by successful screenshot actions so
          // they surface in the tool result (not just error screenshots).
          if (actionResult.success && action.type === 'screenshot' && actionResult.result?.data) {
            executionContext.screenshots.push({
              actionId: actionResult.id,
              data: actionResult.result.data,
              format: actionResult.result.format,
              fullPage: actionResult.result.fullPage,
              timestamp: actionResult.timestamp
            });
          }

          if (actionResult.success) {
            this.stats.successfulActions++;
          } else {
            this.stats.failedActions++;
            
            // Handle action failure
            if (!action.continueOnError && !chain.continueOnError) {
              throw new Error('Action failed: ' + actionResult.error);
            }
          }

          // Native intermediate-state capture: page.content()/page.url()
          // directly (no in-page JS execution), so it works regardless of
          // the ALLOW_JAVASCRIPT_EXECUTION flag and doesn't add phantom
          // actions to the chain's failure/success counts.
          if (action.captureAfter) {
            try {
              const capturedHtml = await page.content();
              executionContext.capturedStates = executionContext.capturedStates || [];
              executionContext.capturedStates.push({
                afterActionIndex: i,
                afterActionId: actionResult.id,
                url: page.url(),
                html: capturedHtml,
                timestamp: Date.now()
              });
            } catch (captureErr) {
              this.log('warn', 'Failed to capture intermediate state: ' + captureErr.message);
            }
          }

          // Add delay between actions
          if (i < chain.actions.length - 1 && this.actionDelay > 0) {
            await this.delay(this.actionDelay);
          }
        }

        return { success: true, attempt: attempt + 1 };

      } catch (error) {
        lastError = error;
        this.log('warn', 'Chain execution attempt ' + (attempt + 1) + ' failed: ' + error.message);
        
        if (attempt < chain.retryChain) {
          // Wait before retry
          await this.delay(1000 * Math.pow(2, attempt));
        }
      }
    }

    throw lastError;
  }

  /**
   * Execute individual action (original internal method)
   * @param {Page} page - Playwright page
   * @param {Object} action - Action to execute
   * @param {Object} executionContext - Execution context
   * @returns {Promise<Object>} Action result
   */
  async executeActionInternal(page, action, executionContext) {
    const actionStartTime = Date.now();
    const actionId = this.generateActionId();
    
    try {
      // Validate action
      if (this.enableActionValidation) {
        ActionSchema.parse(action);
      }

      this.emit('actionStarted', { actionId, action, chainId: executionContext.id });

      let result;
      // Deadline handed to the underlying Playwright call — see actionTimeout().
      let timeout = this.actionTimeout(action);

      // A `wait` action that uses `timeout` as its pause duration (no
      // duration/milliseconds/selector/text) must not also use that same value
      // as its abort deadline, or the abort would race the wait. Give headroom.
      if (action.type === 'wait' &&
          !action.duration && !action.milliseconds && !action.selector && !action.text &&
          action.timeout) {
        timeout = Math.max(this.defaultTimeout, action.timeout + 5000);
      }

      // Execute based on action type. Playwright owns the real deadline (every
      // call below is given `timeout`), so this race is only a backstop for a
      // call that hangs past it — a wedged browser, say. Without the grace
      // period it fired first on every ordinary failure and replaced
      // Playwright's "waiting for locator('#x') to be visible" with a bare
      // "Action timeout".
      const backstopMs = timeout + ACTION_TIMEOUT_GRACE_MS;
      let backstopTimer;
      const executionPromise = this.executeActionByType(page, action, executionContext);
      const timeoutPromise = new Promise((_, reject) => {
        backstopTimer = setTimeout(
          () => reject(new Error(
            'Action backstop timeout: ' + action.type +
            (action.selector ? ' (' + action.selector + ')' : '') +
            ' did not settle within ' + backstopMs + 'ms'
          )),
          backstopMs
        );
      });

      try {
        result = await Promise.race([executionPromise, timeoutPromise]);
      } finally {
        // Without this every action left a live timer behind for its full
        // deadline, keeping the event loop busy long after the chain finished.
        clearTimeout(backstopTimer);
      }

      const actionResult = {
        id: actionId,
        type: action.type,
        success: true,
        result,
        executionTime: Date.now() - actionStartTime,
        timestamp: Date.now(),
        description: action.description
      };

      this.emit('actionCompleted', actionResult);
      return actionResult;

    } catch (error) {
      const actionResult = {
        id: actionId,
        type: action.type,
        success: false,
        error: error.message,
        executionTime: Date.now() - actionStartTime,
        timestamp: Date.now(),
        description: action.description
      };

      // Attempt error recovery if enabled
      if (this.enableErrorRecovery && action.retries > 0) {
        const recoveryResult = await this.attemptErrorRecovery(page, action, error, executionContext);
        if (recoveryResult.success) {
          this.stats.recoveredErrors++;
          actionResult.success = true;
          actionResult.result = recoveryResult.result;
          actionResult.recovered = true;
          actionResult.recoveryStrategy = recoveryResult.strategy;
        }
      }

      this.emit('actionCompleted', actionResult);
      return actionResult;
    }
  }

  /**
   * Deadline to hand the underlying Playwright call for an action, so a failure
   * surfaces Playwright's own error rather than the generic backstop.
   * @param {Object} action - Action configuration
   * @returns {number} Timeout in ms
   */
  actionTimeout(action) {
    return action?.timeout || this.defaultTimeout;
  }

  /**
   * Deadline for one recovery strategy — bounded, see RECOVERY_TIMEOUT_MS.
   * @param {Object} action - Action configuration
   * @returns {number} Timeout in ms
   */
  recoveryTimeout(action) {
    return Math.min(this.actionTimeout(action), RECOVERY_TIMEOUT_MS);
  }

  /**
   * Locator for an action's selector.
   *
   * `.first()` preserves the first-match semantics of the page.waitForSelector()
   * calls this replaced: locators are strict by default and throw on any
   * selector matching more than one element, which would break action chains
   * that work today.
   * @param {Page} page - Playwright page
   * @param {string} selector - CSS/text selector
   * @returns {Locator} Playwright locator
   */
  elementLocator(page, selector) {
    return page.locator(selector).first();
  }

  /**
   * Wait for a selector to reach a condition.
   *
   * Playwright splits these across two APIs: attached/detached/visible/hidden
   * are selector states (locator.waitFor), while enabled/disabled/stable are
   * element states (ElementHandle.waitForElementState). Handing the latter to
   * waitForSelector is rejected outright, which is what made those three
   * documented wait conditions unusable.
   * @param {Page} page - Playwright page
   * @param {string} selector - CSS/text selector
   * @param {string} [condition] - Wait condition
   * @param {number} timeout - Timeout in ms
   * @returns {Promise<void>}
   */
  async waitForCondition(page, selector, condition, timeout) {
    const locator = this.elementLocator(page, selector);

    if (!condition || SELECTOR_WAIT_STATES.has(condition)) {
      await locator.waitFor({ state: condition || 'visible', timeout });
      return;
    }

    await locator.waitFor({ state: 'attached', timeout });
    const handle = await locator.elementHandle({ timeout });
    if (!handle) {
      throw new Error('No element matched selector: ' + selector);
    }
    try {
      await handle.waitForElementState(condition, { timeout });
    } finally {
      await handle.dispose();
    }
  }

  /**
   * Give a navigation started by the action that just ran a chance to commit.
   *
   * Playwright auto-waits on the element it acts on, but nothing waits on the
   * *document* a click or keypress may have replaced, so the next action could
   * run against the outgoing page. A page that never navigated is already past
   * this state and returns immediately; a page that doesn't settle in time is
   * not itself an action failure, hence the catch.
   * @param {Page} page - Playwright page
   * @param {number} timeout - Timeout in ms
   * @returns {Promise<void>}
   */
  async settleAfterInteraction(page, timeout) {
    try {
      await page.waitForLoadState('domcontentloaded', { timeout });
    } catch {
      // Ignored on purpose — see above.
    }
  }

  /**
   * Execute action based on its type
   * @param {Page} page - Playwright page
   * @param {Object} action - Action configuration
   * @param {Object} [executionContext] - Execution context (navigate reads its browserOptions)
   * @returns {Promise<any>} Action result
   */
  async executeActionByType(page, action, executionContext) {
    switch (action.type) {
      case 'wait':
        return await this.executeWaitAction(page, action);
      case 'click':
        return await this.executeClickAction(page, action);
      case 'type':
        return await this.executeTypeAction(page, action);
      case 'press':
        return await this.executePressAction(page, action);
      case 'scroll':
        return await this.executeScrollAction(page, action);
      case 'select':
        return await this.executeSelectAction(page, action);
      case 'hover':
        return await this.executeHoverAction(page, action);
      case 'navigate':
        return await this.executeNavigateAction(page, action, executionContext);
      case 'screenshot':
        return await this.executeScreenshotAction(page, action);
      case 'executeJavaScript':
        return await this.executeJavaScriptAction(page, action);
      default:
        throw new Error('Unknown action type: ' + action.type);
    }
  }

  /**
   * Execute wait action
   * @param {Page} page - Playwright page
   * @param {Object} action - Wait action
   * @returns {Promise<Object>} Wait result
   */
  async executeWaitAction(page, action) {
    // Handle 'duration'/'milliseconds' (and 'timeout' as a pause duration only
    // when no selector/text is given — selector/text waits use 'timeout' as
    // their abort deadline instead).
    const waitTime = action.duration || action.milliseconds ||
      (!action.selector && !action.text ? action.timeout : undefined);
    if (waitTime) {
      await this.delay(waitTime);
      return { waited: waitTime };
    }

    const timeout = this.actionTimeout(action);

    if (action.selector) {
      await this.waitForCondition(page, action.selector, action.condition, timeout);
      return { selector: action.selector, condition: action.condition };
    }

    if (action.text) {
      await page.waitForFunction(
        text => document.body.innerText.includes(text),
        action.text,
        { timeout }
      );
      return { text: action.text };
    }

    throw new Error('Wait action requires duration/milliseconds/timeout, selector, or text');
  }

  /**
   * Execute click action with human behavior simulation
   * @param {Page} page - Playwright page
   * @param {Object} action - Click action
   * @returns {Promise<Object>} Click result
   */
  async executeClickAction(page, action) {
    const timeout = this.actionTimeout(action);
    const locator = this.elementLocator(page, action.selector);

    // Check if stealth mode is enabled and use human behavior
    const humanBehaviorSimulator = this.browserProcessor.stealthManager?.humanBehaviorSimulator;
    
    if (humanBehaviorSimulator) {
      // The simulator drives the mouse by selector, so the element still has to
      // be there before it starts (locator.click() would have waited for it).
      await locator.waitFor({ state: 'visible', timeout });
      // Use human-like clicking behavior
      await humanBehaviorSimulator.simulateClick(page, action.selector, {
        button: action.button,
        clickCount: action.clickCount,
        delay: action.delay,
        force: action.force
      });
    } else {
      // Standard click behavior
      const clickOptions = {
        button: action.button,
        clickCount: action.clickCount,
        delay: action.delay,
        force: action.force,
        timeout
      };

      if (action.position) {
        clickOptions.position = action.position;
      }

      await locator.click(clickOptions);
    }

    // A click can follow a link or submit a form; let that navigation commit
    // before the next action runs against the outgoing document.
    await this.settleAfterInteraction(page, timeout);

    return {
      selector: action.selector,
      button: action.button,
      clickCount: action.clickCount,
      position: action.position
    };
  }

  /**
   * Execute type action with human behavior simulation
   * @param {Page} page - Playwright page
   * @param {Object} action - Type action
   * @returns {Promise<Object>} Type result
   */
  async executeTypeAction(page, action) {
    const timeout = this.actionTimeout(action);
    const locator = this.elementLocator(page, action.selector);

    // Check if stealth mode is enabled and use human behavior
    const humanBehaviorSimulator = this.browserProcessor.stealthManager?.humanBehaviorSimulator;

    if (action.clear) {
      await locator.selectText({ timeout });
      await locator.press('Delete', { timeout });
    }

    if (humanBehaviorSimulator) {
      // Same as click: the simulator works from the selector, so wait first.
      await locator.waitFor({ state: 'visible', timeout });
      // Use human-like typing behavior
      await humanBehaviorSimulator.simulateTyping(page, action.selector, action.text);
    } else {
      // Standard typing behavior
      await locator.pressSequentially(action.text, { delay: action.delay, timeout });
    }
    
    return {
      selector: action.selector,
      text: action.text,
      cleared: action.clear
    };
  }

  /**
   * Execute press action
   * @param {Page} page - Playwright page
   * @param {Object} action - Press action
   * @returns {Promise<Object>} Press result
   */
  async executePressAction(page, action) {
    const timeout = this.actionTimeout(action);
    const keyOptions = { timeout };
    if (action.modifiers?.length > 0) {
      keyOptions.modifiers = action.modifiers;
    }

    if (action.selector) {
      await this.elementLocator(page, action.selector).press(action.key, keyOptions);
    } else {
      await page.keyboard.press(action.key);
    }

    // Enter on a form field navigates as often as a click does.
    await this.settleAfterInteraction(page, timeout);

    return {
      key: action.key,
      modifiers: action.modifiers,
      selector: action.selector
    };
  }

  /**
   * Execute scroll action with human behavior simulation
   * @param {Page} page - Playwright page
   * @param {Object} action - Scroll action
   * @returns {Promise<Object>} Scroll result
   */
  async executeScrollAction(page, action) {
    const timeout = this.actionTimeout(action);

    // Check if stealth mode is enabled and use human behavior
    const humanBehaviorSimulator = this.browserProcessor.stealthManager?.humanBehaviorSimulator;
    
    if (action.toElement) {
      if (humanBehaviorSimulator) {
        // Use human-like scrolling to element
        await humanBehaviorSimulator.simulateScroll(page, {
          target: action.toElement
        });
      } else {
        // scrollIntoViewIfNeeded, not scrollIntoView — the latter is a DOM API
        // that does not exist on a Playwright handle/locator and threw
        // "scrollIntoView is not a function" every time this branch ran.
        await this.elementLocator(page, action.toElement)
          .scrollIntoViewIfNeeded({ timeout });
      }
      return { scrolledToElement: action.toElement };
    }

    // Absolute scroll-to coordinates take precedence over direction/distance.
    // window.scrollTo (not scrollBy/mouse.wheel, which are relative deltas) is
    // the standard Playwright pattern for absolute positioning. A missing axis
    // defaults to 0, matching the plain window.scrollTo(x, y) call form.
    if (action.x !== undefined || action.y !== undefined) {
      const targetX = action.x ?? 0;
      const targetY = action.y ?? 0;
      await page.evaluate(
        ([x, y]) => window.scrollTo(x, y),
        [targetX, targetY]
      );
      return { scrolledTo: { x: targetX, y: targetY }, mode: 'absolute' };
    }

    if (humanBehaviorSimulator) {
      // Use human-like scrolling behavior
      await humanBehaviorSimulator.simulateScroll(page, {
        direction: action.direction,
        distance: action.distance,
        duration: 1000 + Math.random() * 1000 // Variable duration
      });
    } else {
      // Standard scroll behavior
      let deltaX = 0, deltaY = 0;
      switch (action.direction) {
        case 'up':
          deltaY = -action.distance;
          break;
        case 'down':
          deltaY = action.distance;
          break;
        case 'left':
          deltaX = -action.distance;
          break;
        case 'right':
          deltaX = action.distance;
          break;
      }

      if (action.selector) {
        await this.elementLocator(page, action.selector).hover({ timeout });
        await page.mouse.wheel(deltaX, deltaY);
      } else {
        await page.mouse.wheel(deltaX, deltaY);
      }
    }

    return {
      direction: action.direction,
      distance: action.distance,
      selector: action.selector
    };
  }

  /**
   * Execute select action on a <select> dropdown
   * @param {Page} page - Playwright page
   * @param {Object} action - Select action
   * @returns {Promise<Object>} Select result
   */
  async executeSelectAction(page, action) {
    const timeout = this.actionTimeout(action);
    const values = action.values?.length ? action.values : [action.value];

    const selected = await this.elementLocator(page, action.selector)
      .selectOption(values, { timeout });

    // Faceted-search dropdowns commonly submit the form on change, so let any
    // navigation commit before the next action runs.
    await this.settleAfterInteraction(page, timeout);

    return {
      selector: action.selector,
      requested: values,
      selected
    };
  }

  /**
   * Execute hover action
   * @param {Page} page - Playwright page
   * @param {Object} action - Hover action
   * @returns {Promise<Object>} Hover result
   */
  async executeHoverAction(page, action) {
    const timeout = this.actionTimeout(action);
    const hoverOptions = { force: action.force, timeout };
    if (action.position) {
      hoverOptions.position = action.position;
    }

    await this.elementLocator(page, action.selector).hover(hoverOptions);

    // No settle: a hover reveals a menu, it does not replace the document.
    return {
      selector: action.selector,
      position: action.position
    };
  }

  /**
   * Execute navigate action - load a new URL in the running page.
   *
   * A navigate action is a fetch of a new URL, so it goes through the same gate
   * order as the chain's initial load: SSRF, then blocklist/robots, then the
   * navigation itself. Routing it here rather than straight at page.goto() is
   * what stops a chain from using `navigate` to reach a URL the gate would have
   * refused at initializePage.
   * @param {Page} page - Playwright page
   * @param {Object} action - Navigate action
   * @param {Object} [executionContext] - Execution context (for browserOptions)
   * @returns {Promise<Object>} Navigate result
   */
  async executeNavigateAction(page, action, executionContext) {
    const timeout = this.actionTimeout(action);

    await assertUrlAllowed(action.url, { resolveDns: true });
    await this.assertRobotsAllowed(action.url, executionContext?.browserOptions);

    await this.navigateToUrl(page, action.url, {
      waitUntil: action.waitUntil,
      timeout
    });

    return {
      url: action.url,
      finalUrl: page.url(),
      waitUntil: action.waitUntil || 'domcontentloaded'
    };
  }

  /**
   * Execute screenshot action
   * @param {Page} page - Playwright page
   * @param {Object} action - Screenshot action
   * @returns {Promise<Object>} Screenshot result
   */
  async executeScreenshotAction(page, action) {
    return await this.captureScreenshot(page, action);
  }

  /**
   * Execute JavaScript action
   * @param {Page} page - Playwright page
   * @param {Object} action - JavaScript action
   * @returns {Promise<Object>} JavaScript result
   */

  async executeJavaScriptAction(page, action) {
    // SECURITY: JavaScript execution is disabled by default for security
    // Set ALLOW_JAVASCRIPT_EXECUTION=true to enable (NOT recommended in production)
    const allowJsExecution = process.env.ALLOW_JAVASCRIPT_EXECUTION === 'true';
    
    if (!allowJsExecution) {
      throw new Error(
        'JavaScript execution is disabled for security reasons. ' +
        'Set ALLOW_JAVASCRIPT_EXECUTION=true environment variable to enable (NOT recommended in production). ' +
        'This feature allows arbitrary code execution and should only be used in trusted environments.'
      );
    }
    
    const script = typeof action.script === 'string' ? action.script : '';
    const args = Array.isArray(action.args) ? action.args : [];

    // Defense-in-depth: bound script size before evaluating.
    if (script.length > JS_MAX_SCRIPT_LENGTH) {
      throw new Error(
        `JavaScript execution rejected: script length ${script.length} exceeds limit of ${JS_MAX_SCRIPT_LENGTH} ` +
        `(set JS_MAX_SCRIPT_LENGTH to raise it).`
      );
    }

    // Structured audit log to stderr (stdout is reserved for the MCP JSON-RPC stream).
    const scriptHash = createHash('sha256').update(script).digest('hex').slice(0, 16);
    let targetUrl = 'unknown';
    try { targetUrl = page.url(); } catch { /* page may be closed */ }
    console.warn(
      '[security] executeJavaScript ' + JSON.stringify({
        ts: new Date().toISOString(),
        url: targetUrl,
        scriptSha256: scriptHash,
        scriptLength: script.length,
        argCount: args.length
      })
    );

    // Bound execution time independent of the generic per-action timeout.
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`JavaScript execution timed out after ${JS_EXECUTION_TIMEOUT_MS}ms`)),
        JS_EXECUTION_TIMEOUT_MS
      );
    });

    let result;
    try {
      result = await Promise.race([
        page.evaluate(new Function('...args', script), ...args),
        timeout
      ]);
    } finally {
      clearTimeout(timer);
    }

    return {
      script,
      args,
      result: action.returnResult ? result : undefined
    };
  }
  /**
   * Capture screenshot
   * @param {Page} page - Playwright page
   * @param {Object} options - Screenshot options
   * @returns {Promise<Object>} Screenshot result
   */
  async captureScreenshot(page, options = {}) {
    const format = options.format || 'png';
    const screenshotOptions = {
      type: format,
      fullPage: options.fullPage || false
    };

    // Quality option is only supported for JPEG screenshots
    if (format === 'jpeg' || format === 'jpg') {
      screenshotOptions.quality = options.quality || 80;
    }

    let screenshot;
    if (options.selector) {
      screenshot = await this.elementLocator(page, options.selector)
        .screenshot({ ...screenshotOptions, timeout: this.actionTimeout(options) });
    } else {
      screenshot = await page.screenshot(screenshotOptions);
    }

    return {
      data: screenshot.toString('base64'),
      format: screenshotOptions.type,
      fullPage: screenshotOptions.fullPage,
      selector: options.selector,
      timestamp: Date.now(),
      description: options.description
    };
  }

  /**
   * Navigate an existing page to a URL under the SSRF checks every load needs.
   * Used for the initial load, again before each chain retry, and by the
   * `navigate` action.
   * @param {Page} page - Playwright page
   * @param {string} url - URL to navigate to
   * @param {{ waitUntil?: string, timeout?: number }} [options] - Navigation options
   * @returns {Promise<void>}
   */
  async navigateToUrl(page, url, options = {}) {
    // resolveDns:true because Playwright does its own DNS resolution, so
    // hostname-based checks alone would miss DNS-rebinding/private-IP targets.
    await assertUrlAllowed(url, { resolveDns: true });

    await page.goto(url, {
      waitUntil: options.waitUntil || 'domcontentloaded',
      timeout: options.timeout || 30000
    });

    // Re-validate the landed URL: a redirect during navigation could have
    // taken us into a blocked range even though the original URL was safe.
    const landedUrl = page.url();
    if (/^https?:\/\//i.test(landedUrl)) {
      await assertUrlAllowed(landedUrl, { resolveDns: true });
    }
  }

  /**
   * Platform blocklist (G7), robots.txt (G5) and politeness (G6) gate for a URL
   * this executor is about to load.
   *
   * The gate is deliberately asked about the canonical CrawlForge product
   * token: no `userAgent` is passed through, so a caller setting
   * browserOptions.userAgent — or a stealth context presenting a randomized
   * UA — still matches the same robots rules our own token is bound by.
   * Matching robots as whatever identity the caller asked us to wear would let
   * browser traffic slip our own rules, which is the hole this gate closes.
   * @param {string} url - URL about to be loaded
   * @param {Object} [browserOptions] - Browser options (`respectRobots` override)
   * @returns {Promise<void>}
   * @throws {BlockedHostError|RobotsDisallowedError}
   */
  async assertRobotsAllowed(url, browserOptions = {}) {
    await browserPreflight(url, {
      respectRobots: browserOptions?.respectRobots,
      tool: 'scrape_with_actions'
    });
  }

  /**
   * Initialize page with browser options (supports stealth mode)
   * @param {string} url - URL to navigate to
   * @param {Object} browserOptions - Browser options
   * @returns {Promise<Page>} Playwright page
   */
  async initializePage(url, browserOptions) {
    // SSRF guard: validate before any page/context creation or navigation.
    // resolveDns:true because Playwright does its own DNS resolution, so
    // hostname-based checks alone would miss DNS-rebinding/private-IP targets.
    await assertUrlAllowed(url, { resolveDns: true });

    // Then the compliance gate — before the browser launches, so a blocked host
    // or a disallowed path never costs a Chromium process. preflightFetch is
    // deliberately not used here: its identity/signature headers belong on an
    // HTTP fetch, not on a browser context.
    await this.assertRobotsAllowed(url, browserOptions);

    const isStealth = !!browserOptions.stealthMode?.enabled;

    // Use the enhanced BrowserProcessor initialization that supports stealth mode
    const page = await this.browserProcessor.initializePage(browserOptions);

    try {
      // Apply CloudFlare and reCAPTCHA detection if stealth mode is enabled
      if (isStealth && this.browserProcessor.stealthManager) {
        // Initialize human behavior simulator for the page
        await this.browserProcessor.stealthManager.initializeHumanBehaviorSimulator();
      }

      // Navigate to URL. The pre-flight above repeats inside navigateToUrl —
      // that one is deliberately before page creation so a blocked URL never
      // launches a browser (tests/unit/phase1-ssrf-paths.test.js pins it).
      await this.navigateToUrl(page, url);

      // Handle CloudFlare challenges and reCAPTCHA if stealth mode is enabled
      if (isStealth && this.browserProcessor.stealthManager) {
        await this.browserProcessor.stealthManager.bypassCloudflareChallenge(page);
        await this.browserProcessor.stealthManager.handleRecaptcha(page);

        // Simulate initial human behavior on page load
        if (browserOptions.humanBehavior?.enabled) {
          await this.simulateInitialPageInteraction(page);
        }
      }

      return page;
    } catch (error) {
      // Any failure between page creation and return (navigation, SSRF
      // re-check, stealth challenge handling) must not leak the page it
      // already created — close it, and its dedicated context for
      // non-stealth pages, before rethrowing. A stealth context goes back to
      // the manager's pool the same way it does after a successful chain.
      if (isStealth) {
        await this.browserProcessor.releaseStealthPage(page);
      } else {
        const ctx = page.context();
        await page.close().catch(() => {});
        await ctx.close().catch(() => {});
      }
      throw error;
    }
  }
  
  /**
   * Simulate initial human behavior when landing on a page
   * @param {Page} page - Playwright page
   * @returns {Promise<void>}
   */
  async simulateInitialPageInteraction(page) {
    if (!this.browserProcessor.stealthManager?.humanBehaviorSimulator) return;
    
    const simulator = this.browserProcessor.stealthManager.humanBehaviorSimulator;
    
    // Brief reading time for page load
    await simulator.simulateReadingTime(page);
    
    // Random mouse movements
    await this.browserProcessor.stealthManager.simulateRealisticMouseMovements(page);
    
    // Possible scroll behavior
    if (Math.random() < 0.4) { // 40% chance
      await this.browserProcessor.stealthManager.simulateNaturalScrolling(page);
    }
    
    // Random idle period
    await simulator.simulateIdlePeriod();
  }

  /**
   * Attempt error recovery
   * @param {Page} page - Playwright page
   * @param {Object} action - Failed action
   * @param {Error} error - Error that occurred
   * @param {Object} executionContext - Execution context
   * @returns {Promise<Object>} Recovery result
   */
  async attemptErrorRecovery(page, action, error, executionContext) {
    const strategies = this.errorRecoveryStrategies.get(action.type) || [];
    // `retries` caps how many strategies get a turn. Walking all of them
    // unconditionally would add a second full round of timeouts to every action
    // that was never going to succeed.
    const budget = Math.max(0, action.retries ?? 1);

    for (const strategy of strategies.slice(0, budget)) {
      try {
        this.log('info', 'Attempting error recovery with strategy: ' + strategy.name);
        const result = await strategy.recover(page, action, error, executionContext);
        
        if (result.success) {
          return {
            success: true,
            result: result.data,
            strategy: strategy.name
          };
        }
      } catch (recoveryError) {
        this.log('warn', 'Recovery strategy failed: ' + recoveryError.message);
      }
    }

    return { success: false };
  }

  /**
   * Initialize error recovery strategies
   */
  initializeErrorRecoveryStrategies() {
    // Click action recovery strategies
    this.errorRecoveryStrategies.set('click', [
      {
        name: 'waitAndRetry',
        recover: async (page, action) => {
          await this.delay(1000);
          await this.elementLocator(page, action.selector)
            .click({ force: true, timeout: this.recoveryTimeout(action) });
          return { success: true, data: { recovered: true, strategy: 'waitAndRetry' } };
        }
      },
      {
        name: 'scrollIntoView',
        recover: async (page, action) => {
          const timeout = this.recoveryTimeout(action);
          const locator = this.elementLocator(page, action.selector);
          await locator.scrollIntoViewIfNeeded({ timeout });
          await this.delay(500);
          await locator.click({ timeout });
          return { success: true, data: { recovered: true, strategy: 'scrollIntoView' } };
        }
      }
    ]);

    // Type action recovery strategies
    this.errorRecoveryStrategies.set('type', [
      {
        name: 'focusAndRetry',
        recover: async (page, action) => {
          const timeout = this.recoveryTimeout(action);
          const locator = this.elementLocator(page, action.selector);
          await locator.focus({ timeout });
          await this.delay(500);
          await locator.pressSequentially(action.text, { delay: action.delay, timeout });
          return { success: true, data: { recovered: true, strategy: 'focusAndRetry' } };
        }
      }
    ]);

    // Wait action recovery strategies
    this.errorRecoveryStrategies.set('wait', [
      {
        name: 'extendTimeout',
        recover: async (page, action) => {
          if (!action.selector) return { success: false };
          // One more bounded window, not a doubled one: the action has already
          // waited its full timeout, so doubling made a wait that could never
          // resolve cost 3x what the caller asked for.
          await this.waitForCondition(
            page, action.selector, action.condition, this.recoveryTimeout(action)
          );
          return { success: true, data: { recovered: true, strategy: 'extendTimeout' } };
        }
      }
    ]);
  }

  /**
   * Generate unique chain ID
   * @returns {string} Chain ID
   */
  generateChainId() {
    return 'chain_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Generate unique action ID
   * @returns {string} Action ID
   */
  generateActionId() {
    return 'action_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Update average chain time statistic
   * @param {number} chainTime - Chain execution time in milliseconds
   */
  updateAverageChainTime(chainTime) {
    const currentAverage = this.stats.averageChainTime;
    const completedChains = this.stats.successfulChains + this.stats.failedChains;
    
    if (completedChains === 1) {
      this.stats.averageChainTime = chainTime;
    } else {
      this.stats.averageChainTime = 
        ((currentAverage * (completedChains - 1)) + chainTime) / completedChains;
    }
  }

  /**
   * Utility delay function
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise} Delay promise
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Log message if logging is enabled
   * @param {string} level - Log level
   * @param {string} message - Log message
   */
  log(level, message) {
    if (this.enableLogging) {
      // → stderr so stdout stays clean for MCP JSON-RPC / CLI --json output.
      console.error('[ActionExecutor:' + level.toUpperCase() + '] ' + message);
    }
  }

  /**
   * Get comprehensive statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return Object.assign({}, this.stats, {
      activeChainsCount: this.activeChains.size,
      executionHistoryCount: this.executionHistory.length,
      lastUpdated: Date.now()
    });
  }

  /**
   * Get statistics (alias for getStats for compatibility)
   * @returns {Object} Statistics object
   */
  getStatistics() {
    return {
      totalChains: this.stats.totalChains || 0,
      successfulChains: this.stats.successfulChains || 0,
      totalActions: this.stats.totalActions || 0,
      successfulActions: this.stats.successfulActions || 0,
      failedActions: this.stats.failedActions || 0,
      lastUpdated: this.stats.lastUpdated || Date.now()
    };
  }

  /**
   * Execute single action (simplified interface for testing)
   * @param {Object} action - Action to execute
   * @param {string} url - URL to execute action on
   * @returns {Promise<Object>} Action result
   */
  async executeAction(action, url) {
    // If called with original signature (page, action, context), delegate to internal method
    if (arguments.length === 3 && action && typeof action === 'object' && url && typeof url === 'object') {
      const page = action;
      const actualAction = url;
      const context = arguments[2];
      return this.executeActionInternal(page, actualAction, context);
    }

    // Simplified interface: execute action on URL
    try {
      // For testing, provide a simple mock for basic actions
      if (action.type === 'wait' && (action.duration || action.milliseconds)) {
        const waitTime = action.duration || action.milliseconds;
        await this.delay(waitTime);
        return {
          success: true,
          result: { waited: waitTime },
          type: action.type,
          executionTime: waitTime
        };
      }

      // For other actions or complex wait actions, use full chain execution
      const chainResult = await this.executeActionChain(url, {
        actions: [action],
        continueOnError: false,
        timeout: 30000,
        retryChain: 0
      }, { headless: true });

      if (!chainResult.success) {
        return {
          success: false,
          error: chainResult.error,
          type: action.type
        };
      }

      const actionResult = chainResult.results[0];
      return {
        success: actionResult ? actionResult.success : false,
        result: actionResult ? actionResult.result : null,
        error: actionResult ? actionResult.error : 'No result',
        type: action.type,
        executionTime: actionResult ? actionResult.executionTime : 0
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        type: action.type
      };
    }
  }

  /**
   * Get active chains information
   * @returns {Array} Active chains
   */
  getActiveChains() {
    return Array.from(this.activeChains.values()).map(context => ({
      id: context.id,
      url: context.url,
      startTime: context.startTime,
      actionsTotal: context.chain.actions.length,
      actionsCompleted: context.results.length,
      currentAction: context.results.length < context.chain.actions.length 
        ? context.chain.actions[context.results.length].type 
        : null
    }));
  }

  /**
   * Get execution history
   * @param {number} limit - Number of recent executions to return
   * @returns {Array} Execution history
   */
  getExecutionHistory(limit = 10) {
    return this.executionHistory
      .slice(-limit)
      .map(context => ({
        id: context.id,
        url: context.url,
        success: context.success,
        executionTime: context.executionTime,
        actionsTotal: context.chain.actions.length,
        successfulActions: context.results.filter(r => r.success).length,
        failedActions: context.results.filter(r => !r.success).length,
        timestamp: context.startTime
      }));
  }

  /**
   * Cleanup resources
   */
  async destroy() {
    // Cancel active chains
    for (const context of this.activeChains.values()) {
      if (context.page) {
        try { await context.page.close(); } catch (_) { /* ignore close errors */ }
      }
    }

    // Clear data
    this.activeChains.clear();
    this.executionHistory = [];
    this.errorRecoveryStrategies.clear();

    // Cleanup browser processor
    await this.browserProcessor.cleanup();

    // Remove event listeners
    this.removeAllListeners();
    
    this.emit('destroyed');
  }
}

export default ActionExecutor;
