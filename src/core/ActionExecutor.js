/**
 * ActionExecutor - Browser automation with action chains and error recovery
 * Features: page interactions, action validation, error recovery, result collection
 */

import { z } from 'zod';
import BrowserProcessor from './processing/BrowserProcessor.js';
import { EventEmitter } from 'events';
import { createHash } from 'node:crypto';
import { assertUrlAllowed, assertNavigationAllowed } from '../utils/ssrfGuard.js';
import { browserPreflight, redirectGate, pageMoveGate, gateRefusalCode, paceBrowserAction } from '../utils/robotsGate.js';
import { isRef, resolveRef, captureSnapshot } from './browser/snapshot.js';
import { settlePage } from './browser/settle.js';
import { handleConsent } from './browser/consent.js';
import { stealthDocumentVerdict } from '../utils/stealthVerdict.js';

// Actions that can make the page send a request (follow a link, submit a form,
// trigger a load): each waits out the page host's Crawl-delay first.
const REQUESTING_ACTION_TYPES = new Set(['click', 'press', 'select', 'check']);

// executeJavaScript hardening limits (only relevant when the deploy-time flag
// ALLOW_JAVASCRIPT_EXECUTION=true is set; JS execution stays off by default).
const JS_MAX_SCRIPT_LENGTH = parseInt(process.env.JS_MAX_SCRIPT_LENGTH || '10000', 10);
const JS_EXECUTION_TIMEOUT_MS = parseInt(process.env.JS_EXECUTION_TIMEOUT_MS || '5000', 10);

// Headroom for the per-action backstop in executeActionInternal. The underlying
// Playwright call gets the action's real deadline, so the backstop must lose
// that race — Playwright's error names the selector and the state it waited
// for, the backstop can only say "timed out".
const ACTION_TIMEOUT_GRACE_MS = 2000;

// Total error-recovery budget per action, shared by every strategy it tries
// (their delay() pauses included). By the time recovery runs the action has
// already spent its whole timeout failing, so recovery gets one bounded slice —
// giving each strategy another full deadline made a chain that was never going
// to work cost several times its stated timeout.
const RECOVERY_TIMEOUT_MS = 3000;

// How long a navigation whose document reads as a wall is watched for the wall
// replacing itself before it is reported, re-read every NAVIGATION_WALL_POLL_MS.
// AWS WAF's interstitial reloads into amazon.com's homepage about 0.4 s after
// domcontentloaded (measured 2026-10-03); nothing here acts on the page.
const NAVIGATION_WALL_GRACE_MS = 3000;
const NAVIGATION_WALL_POLL_MS = 500;

// The only states locator.waitFor()/page.waitForSelector() accept. The rest of
// the wait-action enum (enabled/disabled/stable) are ElementHandle states and
// have to go through waitForElementState instead — passing them here is
// rejected outright with "expected one of (attached|detached|visible|hidden)".
const SELECTOR_WAIT_STATES = new Set(['attached', 'detached', 'visible', 'hidden']);

const withoutHash = (url) => url.split('#')[0];

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

// Not on any tool's public action list: scrape_with_actions' formAutoFill emits
// it for a field declared `type: "checkbox"` or `type: "radio"`. `fieldType`
// is a plain string so that a field type nothing here can fill ("file")
// arrives as an action that fails, instead of being typed into as text.
const CheckActionSchema = BaseActionSchema.extend({
  type: z.literal('check'),
  selector: z.string(),
  value: z.string(),
  fieldType: z.string()
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

// camelCase (interactiveOnly/maxNodes) to match every other field in the same
// action object: clickCount, fullPage, toElement, captureAfter.
const SnapshotActionSchema = BaseActionSchema.extend({
  type: z.literal('snapshot'),
  interactiveOnly: z.boolean().default(true),
  maxNodes: z.number().min(1).max(1000).optional()
});

const ActionSchema = z.union([
  WaitActionSchema,
  ClickActionSchema,
  TypeActionSchema,
  PressActionSchema,
  ScrollActionSchema,
  SelectActionSchema,
  CheckActionSchema,
  HoverActionSchema,
  NavigateActionSchema,
  ScreenshotActionSchema,
  ExecuteJavaScriptActionSchema,
  SnapshotActionSchema
]);

const ActionChainSchema = z.object({
  actions: z.array(ActionSchema),
  continueOnError: z.boolean().default(false),
  timeout: z.number().min(1000).max(300000).default(30000),
  retryChain: z.number().min(0).max(3).default(0),
  // Per-chain override of the constructor's enableScreenshotOnError.
  screenshotOnError: z.boolean().optional(),
  metadata: z.record(z.any()).prefault({})
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
        // One entry per run of the chain (retryChain replays it); `attempt` is
        // the 1-based run whose per-action results are in `results`.
        attempt: 0,
        attempts: [],
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

        // Cookie/consent wall on the landing page (browserOptions.consent,
        // off unless asked for). A `navigate` action does the same for its
        // page — see executeNavigateAction.
        if (browserOptions.consent && browserOptions.consent !== 'off') {
          executionContext.consent = await handleConsent(page, browserOptions.consent);
        }

        // navigations[0] is the initial load; each `navigate` action appends
        // its own (executeNavigateAction).
        executionContext.navigations = [await this.checkNavigation(page, url, browserOptions)];

        // Execute chain with potential retries
        chainResult = await this.executeChainWithRetries(executionContext);

        // Capture the LIVE post-action page state before the page is closed,
        // so callers can extract final content reflecting all actions
        // (instead of re-fetching the original URL).
        const finalState = await this.captureState(page, browserOptions, 'final page content');
        if (finalState) {
          executionContext.finalHtml = finalState.html;
          executionContext.finalUrl = finalState.url;
        }

        this.stats.successfulChains++;
        executionContext.success = true;

      } catch (error) {
        this.stats.failedChains++;
        executionContext.success = false;
        executionContext.error = error.message;

        // Capture error screenshot if enabled
        if ((validatedChain.screenshotOnError ?? this.enableScreenshotOnError) && page) {
          try {
            // Not of a page the gate has not passed: the chain may have failed
            // for another reason after the page moved.
            await this.assertPageAllowed(page, browserOptions);
            const errorScreenshot = await this.captureScreenshot(page, {
              fullPage: true,
              description: 'Error screenshot'
            });
            // An actionId is what lets the server publish the shot as a
            // crawlforge://screenshot/{actionId} resource and drop the base64
            // from the result; without one a failed chain shipped 1.7 MB of
            // PNG inline (R21, 2026-09-09).
            executionContext.screenshots.push({
              ...errorScreenshot,
              actionId: this.generateActionId(),
              error: true
            });
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
          attempts: undefined, // each carries a copy of a results array
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
        navigationStatus: executionContext.page?.__crawlforgeNavigation?.status ?? null,
        navigations: executionContext.navigations || [],
        consent: executionContext.consent,
        executionTime: Date.now() - startTime,
        results: executionContext.results,
        attempt: executionContext.attempt,
        attempts: executionContext.attempts,
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
        navigations: executionContext?.navigations || [],
        attempt: executionContext?.attempt ?? 0,
        attempts: executionContext?.attempts || [],
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
      executionContext.attempt = attempt + 1;
      try {
        if (attempt > 0) {
          this.log('info', 'Retrying chain execution, attempt ' + (attempt + 1));
          // The failed run's results are already recorded in attempts[].
          executionContext.results = []; // Clear previous results on retry
          executionContext.capturedStates = []; // Clear previous captures on retry
          // Replaying the chain against whatever the failed attempt left behind
          // (form half-filled, menu open, possibly a different URL) is not a
          // retry. Reload the starting URL so every attempt begins where the
          // first one did.
          await this.navigateToUrl(page, executionContext.url, {
            browserOptions: executionContext.browserOptions
          });
          // Only the last attempt's navigations are reported, so the reload
          // that starts this one is navigations[0].
          executionContext.navigations = [
            await this.checkNavigation(page, executionContext.url, executionContext.browserOptions)
          ];
        }

        // Execute actions in sequence
        for (let i = 0; i < chain.actions.length; i++) {
          // chain.timeout is the deadline for actions that name none and the
          // ceiling for those that do — actionTimeout() reads it off the
          // action, so without this the chain's timeout never reached a
          // Playwright call (executeActionsOnPage applies the same default).
          const action = {
            ...chain.actions[i],
            timeout: Math.min(chain.actions[i].timeout || chain.timeout, chain.timeout)
          };
          const actionResult = await this.executeGatedAction(page, action, executionContext);
          
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
              throw Object.assign(new Error('Action failed: ' + actionResult.error), { code: actionResult.errorCode });
            }
          }

          // Native intermediate-state capture: page.content()/page.url()
          // directly (no in-page JS execution), so it works regardless of
          // the ALLOW_JAVASCRIPT_EXECUTION flag and doesn't add phantom
          // actions to the chain's failure/success counts.
          if (action.captureAfter) {
            const captured = await this.captureState(page, executionContext.browserOptions, 'intermediate state');
            if (captured) {
              executionContext.capturedStates = executionContext.capturedStates || [];
              executionContext.capturedStates.push({
                afterActionIndex: i,
                afterActionId: actionResult.id,
                url: captured.url,
                html: captured.html,
                timestamp: Date.now()
              });
            }
          }

          // Add delay between actions
          if (i < chain.actions.length - 1 && this.actionDelay > 0) {
            await this.delay(this.actionDelay);
          }
        }

        executionContext.attempts.push({
          attempt: attempt + 1, success: true, results: [...executionContext.results]
        });
        return { success: true, attempt: attempt + 1 };

      } catch (error) {
        lastError = error;
        executionContext.attempts.push({
          attempt: attempt + 1, success: false, error: error.message, results: [...executionContext.results]
        });
        this.log('warn', 'Chain execution attempt ' + (attempt + 1) + ' failed: ' + error.message);

        // A refusal is the gate's answer, not a fault. Replaying the chain
        // asks the same question again, after sending the site every request
        // that led up to it a second time.
        if (gateRefusalCode(error)) break;

        if (attempt < chain.retryChain) {
          // Wait before retry
          await this.delay(1000 * Math.pow(2, attempt));
        }
      }
    }

    throw lastError;
  }

  /**
   * Run actions against a page this executor does NOT own.
   *
   * executeActionChain() is the one-shot path and owns its page: it creates it,
   * closes it in `finally`, and re-navigates to the chain's starting URL before
   * each retry. None of that is right for a browser session, where the page
   * outlives the call and "the starting URL" is wherever the last call left it —
   * re-navigating there would throw away the very state the session exists to
   * keep. So this is the same per-action loop with the lifecycle removed: it
   * opens nothing, closes nothing, never re-navigates, and deliberately does not
   * register in `activeChains` (destroy() closes the pages of everything in
   * there, which would take a live session's page out from under its store).
   *
   * Gating comes for free and must not be duplicated by callers: a `navigate`
   * action goes through executeNavigateAction, which re-runs the SSRF guard and
   * the blocklist/robots gate on every hop (see the comment at its definition),
   * and every action is run through executeGatedAction, which holds the page to
   * the same gate wherever a click or a script has taken it. A refusal there
   * throws rather than failing one action: the page has been emptied, and
   * nothing after it could run. `browserOptions.respectRobots` is what reaches
   * both gates.
   *
   * No `finalHtml` here, unlike the chain: the page is still open afterwards, so
   * content is read from it when it is asked for rather than on every call.
   *
   * @param {Page} page - a live page owned by the caller
   * @param {Array} actions - actions to run, in order
   * @param {Object} [options]
   * @param {boolean} [options.continueOnError=false] - keep going past a failed action
   * @param {number} [options.timeout] - per-action deadline for actions that name none
   * @param {Object} [options.browserOptions] - carries `respectRobots` to the navigate gate
   * @returns {Promise<Object>} Same results/screenshots/capturedStates shape the chain returns
   */
  async executeActionsOnPage(page, actions, { continueOnError = false, timeout, browserOptions = {} } = {}) {
    const startTime = Date.now();
    // executeActionInternal reads `id` for its events and `browserOptions` for
    // the navigate action's robots gate; nothing else on a chain context is
    // consulted from there.
    const executionContext = {
      id: this.generateChainId(),
      url: page.url(),
      browserOptions,
      startTime,
      results: [],
      screenshots: [],
      capturedStates: []
    };

    let success = true;
    let error;

    for (let i = 0; i < actions.length; i++) {
      // actionTimeout() reads the deadline off the action itself, so a caller's
      // per-call timeout is applied as the default for actions that set none.
      const action = timeout && !actions[i].timeout ? { ...actions[i], timeout } : actions[i];

      const actionResult = await this.executeGatedAction(page, action, executionContext);
      executionContext.results.push(actionResult);
      this.stats.totalActions++;

      if (actionResult.success) {
        this.stats.successfulActions++;
      } else {
        this.stats.failedActions++;
      }

      // Collection kept in step with executeChainWithRetries — a screenshot
      // action's payload and a captureAfter snapshot of the page reach the
      // caller in the same fields either way.
      if (actionResult.success && action.type === 'screenshot' && actionResult.result?.data) {
        executionContext.screenshots.push({
          actionId: actionResult.id,
          data: actionResult.result.data,
          format: actionResult.result.format,
          fullPage: actionResult.result.fullPage,
          timestamp: actionResult.timestamp
        });
      }

      if (action.captureAfter) {
        const captured = await this.captureState(page, browserOptions, 'intermediate state');
        if (captured) {
          executionContext.capturedStates.push({
            afterActionIndex: i,
            afterActionId: actionResult.id,
            url: captured.url,
            html: captured.html,
            timestamp: Date.now()
          });
        }
      }

      if (!actionResult.success && !action.continueOnError && !continueOnError) {
        success = false;
        error = actionResult.error;
        break;
      }

      if (i < actions.length - 1 && this.actionDelay > 0) {
        await this.delay(this.actionDelay);
      }
    }

    return {
      success,
      error,
      finalUrl: page.url(),
      executionTime: Date.now() - startTime,
      results: executionContext.results,
      screenshots: executionContext.screenshots,
      capturedStates: executionContext.capturedStates,
      stats: {
        totalActions: executionContext.results.length,
        successfulActions: executionContext.results.filter(r => r.success).length,
        failedActions: executionContext.results.filter(r => !r.success).length
      }
    };
  }

  /**
   * Hold the page to the gate wherever it stands now.
   *
   * navigateToUrl gates a load and its redirects. After that a page moves
   * without being sent anywhere: a click follows a link, a form posts, a
   * script redirects, a client-side router rewrites the address. Any URL the
   * page has reached since it was last checked gets what a `navigate` to it
   * would: the SSRF guard, then the blocklist/robots gate with this call's
   * `respectRobots`. A refusal leaves the page empty and throws.
   *
   * Cheap when nothing moved (one string comparison), so it is called on both
   * sides of everything that touches the page.
   * @param {Page} page - Playwright page
   * @param {Object} [browserOptions] - Browser options (`respectRobots` override)
   * @returns {Promise<void>}
   * @throws {Error} SSRF_BLOCKED, BlockedHostError or RobotsDisallowedError
   */
  async assertPageAllowed(page, browserOptions = {}) {
    const gatedUrl = page.__crawlforgeGatedUrl;
    if (page.url() === gatedUrl) return;
    page.__crawlforgeGatedUrl = await assertNavigationAllowed(page, gatedUrl, null, pageMoveGate(gatedUrl, {
      respectRobots: browserOptions?.respectRobots,
      tool: browserOptions?.tool || 'scrape_with_actions'
    }));
  }

  /**
   * Read from the page with the gate held on both sides of the read, so what
   * comes back is from a document that passed it: the check after the read
   * discards anything read while the page was moving somewhere it may not be.
   * @param {Page} page - Playwright page
   * @param {Object} [browserOptions] - Browser options (`respectRobots` override)
   * @param {() => Promise<T>} read - the read to make
   * @returns {Promise<T>}
   * @template T
   */
  async readGated(page, browserOptions, read) {
    await this.assertPageAllowed(page, browserOptions);
    const value = await read();
    await this.assertPageAllowed(page, browserOptions);
    return value;
  }

  /**
   * The page's URL and HTML, read natively (no in-page JS execution, so it
   * works regardless of ALLOW_JAVASCRIPT_EXECUTION). A page that cannot be
   * read yields null and a warning; a page the gate refuses throws.
   * @param {Page} page - Playwright page
   * @param {Object} [browserOptions] - Browser options (`respectRobots` override)
   * @param {string} what - names the capture in the warning
   * @returns {Promise<{ url: string, html: string }|null>}
   */
  async captureState(page, browserOptions, what) {
    return await this.readGated(page, browserOptions, async () => {
      try {
        return { html: await page.content(), url: page.url() };
      } catch (captureErr) {
        this.log('warn', 'Failed to capture ' + what + ': ' + captureErr.message);
        return null;
      }
    });
  }

  /**
   * Run one action with the page held to the gate before it and after it.
   * Before, because an action must not read or drive a page that moved while
   * nothing was looking; after, because the action is what usually moves it,
   * and its result is not kept if where it led is refused.
   * @param {Page} page - Playwright page
   * @param {Object} action - Action to execute
   * @param {Object} executionContext - Execution context (`browserOptions` feeds the gate)
   * @returns {Promise<Object>} Action result
   */
  async executeGatedAction(page, action, executionContext) {
    const browserOptions = executionContext?.browserOptions;
    // A navigate leaves the page it is on and gates the URL it is sent to.
    if (action.type !== 'navigate') await this.assertPageAllowed(page, browserOptions);
    const urlBefore = page.url();
    // A navigate waits its turn in its own pre-flight; these can send the page
    // somewhere too, and the request goes out before anything can ask.
    if (REQUESTING_ACTION_TYPES.has(action.type)) await paceBrowserAction(urlBefore);
    const actionResult = await this.executeActionInternal(page, action, executionContext);
    await this.assertPageAllowed(page, browserOptions);
    // A click that followed a link or a submit that posted a form is a
    // navigation nobody asked for by name. It has just passed the gate above;
    // it gets the same wall check and the same `navigations` entry a navigate
    // action's does, with `trigger` naming the action that caused it (R24: the
    // chain reported only its start URL). A fragment change is the same document.
    if (action.type !== 'navigate' && executionContext?.navigations &&
        withoutHash(page.url()) !== withoutHash(urlBefore)) {
      executionContext.navigations.push({
        ...await this.checkNavigation(page, page.url(), browserOptions),
        trigger: action.type
      });
    }
    return actionResult;
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
      const refusalCode = gateRefusalCode(error);
      const actionResult = {
        id: actionId,
        type: action.type,
        success: false,
        error: error.message,
        // Only when the gate refused (a `navigate` to a URL it would not
        // load), so the chain can tell an answer from a fault.
        ...(refusalCode ? { errorCode: refusalCode } : {}),
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
   * Deadline for one Playwright call inside a recovery strategy: what is left
   * of the shared budget (see RECOVERY_TIMEOUT_MS), never more than the
   * action's own timeout. Strategies call it after their delay() so the pause
   * is charged to the same budget. Floored at 1 because Playwright reads a
   * timeout of 0 as "wait forever".
   * @param {Object} action - Action configuration
   * @param {number} [deadline] - Epoch ms at which the recovery budget ends
   * @returns {number} Timeout in ms
   */
  recoveryTimeout(action, deadline) {
    const left = deadline === undefined ? RECOVERY_TIMEOUT_MS : deadline - Date.now();
    return Math.max(1, Math.min(this.actionTimeout(action), left));
  }

  /**
   * Resolve a caller-supplied selector.
   *
   * A selector starting with `@` names a ref a prior snapshot action assigned,
   * and resolves to the Playwright selector that snapshot recorded for it
   * (`aria-ref=…` from the native snapshot, `[data-cf-ref=…]` from the walk
   * fallback); anything else is already a CSS selector. Every selector a caller
   * writes goes through here, so refs work in every action type without any
   * schema change — including the stealth human-behaviour paths, which take
   * Playwright selectors.
   * @param {Page} page - Playwright page
   * @param {string} selector - CSS selector, or an `@e1` snapshot ref
   * @returns {string} Playwright selector
   */
  resolveSelector(page, selector) {
    return isRef(selector) ? resolveRef(page, selector) : selector;
  }

  /**
   * Locator for an action's selector.
   *
   * `.first()` preserves the first-match semantics of the page.waitForSelector()
   * calls this replaced: locators are strict by default and throw on any
   * selector matching more than one element, which would break action chains
   * that work today.
   * @param {Page} page - Playwright page
   * @param {string} selector - CSS/text selector, or an `@e1` snapshot ref
   * @returns {Locator} Playwright locator
   */
  elementLocator(page, selector) {
    return page.locator(this.resolveSelector(page, selector)).first();
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
   * Let the page settle after the action that just ran — a navigation commit
   * and load, or an SPA re-render that fires no load event at all.
   *
   * Playwright auto-waits on the element it acts on, but nothing waits on the
   * *document* a click or keypress may have changed, so the next action could
   * run against the outgoing page. settlePage waits for `load` and then a quiet
   * window (no DOM mutations, no requests in flight), capped and never longer
   * than what is left of the action's `timeout`; a page that doesn't settle in
   * time is not itself an action failure, so it never throws.
   * @param {Page} page - Playwright page
   * @param {number} timeout - The action's timeout in ms
   * @param {number} startedAt - When the action started (Date.now()); the settle
   *   gets only the remainder, so a slow element wait plus a busy page cannot
   *   outrun the backstop and turn a successful action into a timeout
   * @returns {Promise<{waited_ms: number, settled_by: string}>}
   */
  async settleAfterInteraction(page, timeout, startedAt) {
    const remaining = Math.max(1, timeout - (Date.now() - startedAt));
    return await settlePage(page, { timeout: remaining });
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
      case 'check':
        return await this.executeCheckAction(page, action);
      case 'hover':
        return await this.executeHoverAction(page, action);
      case 'navigate':
        return await this.executeNavigateAction(page, action, executionContext);
      case 'screenshot':
        return await this.executeScreenshotAction(page, action);
      case 'executeJavaScript':
        return await this.executeJavaScriptAction(page, action);
      case 'snapshot':
        return await this.executeSnapshotAction(page, action);
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
    const startedAt = Date.now();
    const timeout = this.actionTimeout(action);
    const locator = this.elementLocator(page, action.selector);

    // Check if stealth mode is enabled and use human behavior
    const humanBehaviorSimulator = this.browserProcessor.stealthManager?.humanBehaviorSimulator;
    
    if (humanBehaviorSimulator) {
      // The simulator drives the mouse by selector, so the element still has to
      // be there before it starts (locator.click() would have waited for it).
      await locator.waitFor({ state: 'visible', timeout });
      // Use human-like clicking behavior
      // The simulator takes a raw selector string rather than a locator, so
      // it needs the resolved form — it never goes through elementLocator.
      await humanBehaviorSimulator.simulateClick(page, this.resolveSelector(page, action.selector), {
        button: action.button,
        clickCount: action.clickCount,
        delay: action.delay,
        force: action.force,
        timeout
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
    await this.settleAfterInteraction(page, timeout, startedAt);

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
      await humanBehaviorSimulator.simulateTyping(page, this.resolveSelector(page, action.selector), action.text);
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
    const startedAt = Date.now();
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
    await this.settleAfterInteraction(page, timeout, startedAt);

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
          target: this.resolveSelector(page, action.toElement)
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
    const startedAt = Date.now();
    const timeout = this.actionTimeout(action);
    const values = action.values?.length ? action.values : [action.value];

    const selected = await this.elementLocator(page, action.selector)
      .selectOption(values, { timeout });

    // Faceted-search dropdowns commonly submit the form on change, so let any
    // navigation commit before the next action runs.
    await this.settleAfterInteraction(page, timeout, startedAt);

    return {
      selector: action.selector,
      requested: values,
      selected
    };
  }

  /**
   * Execute check action — a formAutoFill checkbox or radio field.
   *
   * A selector that names a whole group (`input[name="size"]`) is narrowed to
   * the member whose `value` attribute is the field's value, the way the form
   * itself pairs name and value; `.first()` would check whichever came first.
   * A selector that names one input checks that input, except a checkbox with
   * value "false", which is unchecked.
   * @param {Page} page - Playwright page
   * @param {Object} action - Check action
   * @returns {Promise<Object>} Check result
   */
  async executeCheckAction(page, action) {
    if (action.fieldType !== 'checkbox' && action.fieldType !== 'radio') {
      throw new Error(
        `formAutoFill field type "${action.fieldType}" is not supported ` +
        '(supported: text, select, checkbox, radio)'
      );
    }

    const timeout = this.actionTimeout(action);
    const matches = page.locator(this.resolveSelector(page, action.selector));
    await matches.first().waitFor({ state: 'attached', timeout });

    const isGroup = (await matches.count()) > 1;
    const target = isGroup
      ? matches.and(page.locator(`[value=${JSON.stringify(action.value)}]`)).first()
      : matches.first();
    const checked = isGroup || action.fieldType === 'radio' || action.value !== 'false';

    await target.setChecked(checked, { timeout });

    return {
      selector: action.selector,
      value: action.value,
      checked
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
    const startedAt = Date.now();
    const timeout = this.actionTimeout(action);

    await assertUrlAllowed(action.url, { resolveDns: true });
    const gateWarnings = await this.assertRobotsAllowed(action.url, executionContext?.browserOptions);

    await this.navigateToUrl(page, action.url, {
      waitUntil: action.waitUntil,
      timeout,
      browserOptions: executionContext?.browserOptions
    });
    page.__crawlforgeGateWarnings = gateWarnings;

    // Consent handling gets at most what is left of the action's deadline, so
    // it cannot push a navigation that succeeded past the backstop.
    const consentMode = executionContext?.browserOptions?.consent;
    const consent = consentMode && consentMode !== 'off'
      ? await handleConsent(page, consentMode, { timeout: Math.min(2000, timeout - (Date.now() - startedAt)) })
      : undefined;

    // Reporting only: the navigation happened, so the action succeeds whether
    // or not the document it reached is a wall. The wait for a wall to clear
    // gets what is left of the deadline, like consent above.
    const navigation = await this.checkNavigation(page, action.url, executionContext?.browserOptions, {
      graceMs: Math.min(NAVIGATION_WALL_GRACE_MS, timeout - (Date.now() - startedAt))
    });
    executionContext?.navigations?.push(navigation);

    return {
      url: action.url,
      finalUrl: navigation.finalUrl,
      waitUntil: action.waitUntil || 'domcontentloaded',
      httpStatus: navigation.httpStatus,
      ...(navigation.blocked ? { blocked: navigation.blocked } : {}),
      ...(consent ? { consent } : {})
    };
  }

  /**
   * What the navigation that just finished reached: the page, or a wall. The
   * same verdict the chain's final document gets, run on this document with
   * the status of this navigation. A document that reads as a wall is re-read
   * for up to `graceMs` first, because some walls replace themselves (AWS WAF's
   * interstitial reloads into the page); one that cannot be read at all is
   * reported without a verdict rather than as a wall.
   * @param {Page} page - Playwright page, just navigated
   * @param {string} url - the URL the navigation was sent to
   * @param {Object} [browserOptions] - Browser options (`respectRobots` for the read's gate)
   * @param {{ graceMs?: number }} [options]
   * @returns {Promise<{ url: string, finalUrl: string, httpStatus: number|null, blocked?: { vendor: string, evidence: string } }>}
   */
  async checkNavigation(page, url, browserOptions, { graceMs = NAVIGATION_WALL_GRACE_MS } = {}) {
    const httpStatus = page.__crawlforgeNavigation?.status ?? null;
    const read = () => this.readGated(page, browserOptions, async () => {
      try {
        const [title, html, text] = await Promise.all([
          page.title(),
          page.content(),
          page.evaluate(() => (document.body ? document.body.innerText : ''))
        ]);
        return stealthDocumentVerdict(
          { url: page.url(), title, html, text, status: httpStatus },
          { allowEmpty: true, fetcher: browserOptions?.stealthMode?.enabled ? 'the stealth browser' : 'the browser' }
        );
      } catch {
        return null; // mid-navigation, or a page that cannot be read
      }
    });

    let verdict = await read();
    const deadline = Date.now() + graceMs;
    while (verdict?.blocked && Date.now() + NAVIGATION_WALL_POLL_MS <= deadline) {
      await this.delay(NAVIGATION_WALL_POLL_MS);
      const next = await read();
      // A read that fails mid-reload says nothing yet; keep the wall until a
      // document answers.
      if (next) verdict = next;
    }

    return {
      url,
      finalUrl: page.url(),
      httpStatus,
      ...(verdict?.blocked ? { blocked: verdict.blocked } : {})
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
   * Execute snapshot action - the page's interactive elements, each carrying
   * a ref later actions can target instead of a guessed CSS selector.
   * @param {Page} page - Playwright page
   * @param {Object} action - Snapshot action
   * @returns {Promise<Object>} Snapshot tree with refs
   */
  async executeSnapshotAction(page, action) {
    return await captureSnapshot(page, {
      interactiveOnly: action.interactiveOnly,
      maxNodes: action.maxNodes,
      // The render wait before the walk stays inside the action's deadline.
      timeout: this.actionTimeout(action)
    });
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
   * Navigate an existing page to a URL under the SSRF checks every load needs,
   * and put wherever it is redirected to through the same blocklist/robots
   * gate the URL itself passed (assertRobotsAllowed). Used for the initial
   * load, again before each chain retry, and by the `navigate` action.
   * @param {Page} page - Playwright page
   * @param {string} url - URL to navigate to
   * @param {{ waitUntil?: string, timeout?: number, browserOptions?: Object }} [options] -
   *   Navigation options; `browserOptions` carries `respectRobots` to the redirect gate
   * @returns {Promise<void>}
   */
  async navigateToUrl(page, url, options = {}) {
    // resolveDns:true because Playwright does its own DNS resolution, so
    // hostname-based checks alone would miss DNS-rebinding/private-IP targets.
    await assertUrlAllowed(url, { resolveDns: true });

    // The initial load and a retry's reload pass no timeout of their own, so
    // browserOptions.timeout bounds them as it bounds the actions (0.2); a
    // navigate action's own timeout comes first.
    const response = await page.goto(url, {
      waitUntil: options.waitUntil || 'domcontentloaded',
      timeout: options.timeout || options.browserOptions?.timeout || 30000
    });

    // Re-validate where the navigation went: a redirect could have taken us
    // into a blocked range, onto a blocklisted host or into a path robots.txt
    // disallows, even though the original URL was fine. A refusal leaves the
    // page empty, so a session that keeps it cannot read the refused document.
    const landedUrl = await assertNavigationAllowed(page, url, response, redirectGate(url, {
      respectRobots: options.browserOptions?.respectRobots,
      tool: options.browserOptions?.tool || 'scrape_with_actions'
    }));
    // What assertPageAllowed compares the page against from here on.
    page.__crawlforgeGatedUrl = landedUrl;

    // Remembered on the page so the chain result can report the status of
    // the last navigation: tesla.com's Akamai denial ran a full action chain
    // and came back success:true (R18, 2026-09-04).
    let status = null;
    try { status = response ? response.status() : null; } catch { status = null; }
    page.__crawlforgeNavigation = { url: landedUrl, status };
    return { url: landedUrl, status };
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
    return await browserPreflight(url, {
      respectRobots: browserOptions?.respectRobots,
      // The audit row is the record of the CUSTOMER's decision (G5), so it has
      // to name the tool that actually made it. browser_session borrows this
      // executor, and until R23 every session's override was filed against
      // scrape_with_actions.
      tool: browserOptions?.tool || 'scrape_with_actions'
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
    const gateWarnings = await this.assertRobotsAllowed(url, browserOptions);

    const isStealth = !!browserOptions.stealthMode?.enabled;

    // Use the enhanced BrowserProcessor initialization that supports stealth mode
    const page = await this.browserProcessor.initializePage(browserOptions);

    // Stamped on the page for the same reason __crawlforgeNavigation is: the
    // caller's result is assembled a layer up, and the gate ran a layer down.
    page.__crawlforgeGateWarnings = gateWarnings;

    // A click or a form post loads a document no goto() returns a response
    // for, so its status is taken off the wire: last main-frame navigation
    // wins, the rule navigateToUrl's own stamp follows.
    page.on?.('response', (response) => {
      if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
        page.__crawlforgeNavigation = { url: response.url(), status: response.status() };
      }
    });

    try {
      // Apply CloudFlare and reCAPTCHA detection if stealth mode is enabled
      if (isStealth && this.browserProcessor.stealthManager) {
        // Initialize human behavior simulator for the page
        await this.browserProcessor.stealthManager.initializeHumanBehaviorSimulator();
      }

      // Navigate to URL. The pre-flight above repeats inside navigateToUrl —
      // that one is deliberately before page creation so a blocked URL never
      // launches a browser (tests/unit/phase1-ssrf-paths.test.js pins it).
      await this.navigateToUrl(page, url, { browserOptions });

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
    // A stale ref names an element that went away with the old document, so no
    // strategy here can find it again. Re-snapshotting is the caller's job:
    // fail the action now rather than spend the recovery budget on it.
    if (error?.name === 'StaleRefError') {
      return { success: false };
    }

    // An element that is not in the document cannot be force-clicked, scrolled
    // into view or focused, so every strategy below would only spend the
    // budget re-waiting for it. count() answers at once without waiting.
    if (action.selector) {
      let matches = 1;
      try {
        matches = await this.elementLocator(page, action.selector).count();
      } catch (_) {
        // A ref that cannot be resolved, or a page stub in tests: let the
        // strategies decide.
      }
      if (matches === 0) return { success: false };
    }

    const strategies = this.errorRecoveryStrategies.get(action.type) || [];
    // `retries` caps how many strategies get a turn. Walking all of them
    // unconditionally would add a second full round of timeouts to every action
    // that was never going to succeed.
    const budget = Math.max(0, action.retries ?? 1);
    // One deadline shared by every strategy this action tries, so recovery
    // costs at most RECOVERY_TIMEOUT_MS on top of the action's own timeout
    // however many strategies are registered.
    const deadline = Date.now() + RECOVERY_TIMEOUT_MS;

    for (const strategy of strategies.slice(0, budget)) {
      if (Date.now() >= deadline) break;
      try {
        this.log('info', 'Attempting error recovery with strategy: ' + strategy.name);
        const result = await strategy.recover(page, action, error, executionContext, deadline);
        
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
        recover: async (page, action, _error, _context, deadline) => {
          await this.delay(1000);
          await this.elementLocator(page, action.selector)
            .click({ force: true, timeout: this.recoveryTimeout(action, deadline) });
          return { success: true, data: { recovered: true, strategy: 'waitAndRetry' } };
        }
      },
      {
        name: 'scrollIntoView',
        recover: async (page, action, _error, _context, deadline) => {
          const locator = this.elementLocator(page, action.selector);
          await locator.scrollIntoViewIfNeeded({ timeout: this.recoveryTimeout(action, deadline) });
          await this.delay(500);
          await locator.click({ timeout: this.recoveryTimeout(action, deadline) });
          return { success: true, data: { recovered: true, strategy: 'scrollIntoView' } };
        }
      }
    ]);

    // Type action recovery strategies
    this.errorRecoveryStrategies.set('type', [
      {
        name: 'focusAndRetry',
        recover: async (page, action, _error, _context, deadline) => {
          const locator = this.elementLocator(page, action.selector);
          await locator.focus({ timeout: this.recoveryTimeout(action, deadline) });
          await this.delay(500);
          await locator.pressSequentially(action.text, {
            delay: action.delay, timeout: this.recoveryTimeout(action, deadline)
          });
          return { success: true, data: { recovered: true, strategy: 'focusAndRetry' } };
        }
      }
    ]);

    // No strategies for `wait`: the wait already was the retry, so a failed
    // one has nothing to recover and gets no second window.
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
