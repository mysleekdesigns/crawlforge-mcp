/**
 * ScrapeWithActionsTool - Execute action chains before scraping with result collection
 * Features: action chains, form interactions, intermediate state capture, error recovery
 */

import { z } from 'zod';
import { EventEmitter } from 'events';
import ActionExecutor from '../../core/ActionExecutor.js';
import { load } from 'cheerio';

// Import existing tool for content extraction
import ExtractContentTool from '../extract/extractContent.js';

// Action schemas (re-using from ActionExecutor but with tool-specific additions)
const BaseActionSchema = z.object({
  type: z.string(),
  timeout: z.number().optional(),
  description: z.string().optional(),
  continueOnError: z.boolean().default(false),
  retries: z.number().min(0).max(5).default(0),
  captureAfter: z.boolean().default(false) // Capture content after this action
});

const WaitActionSchema = BaseActionSchema.extend({
  type: z.literal('wait'),
  duration: z.number().min(0).max(30000).optional(),
  selector: z.string().optional(),
  condition: z.enum(['visible', 'hidden', 'enabled', 'disabled', 'stable']).optional(),
  text: z.string().optional()
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
  toElement: z.string().optional()
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
  ScreenshotActionSchema,
  ExecuteJavaScriptActionSchema
]);

// Form field schema for auto-fill
const FormFieldSchema = z.object({
  selector: z.string(),
  value: z.string(),
  type: z.enum(['text', 'select', 'checkbox', 'radio', 'file']).default('text'),
  waitAfter: z.number().min(0).max(5000).default(100)
});

// Main scrape with actions schema
const ScrapeWithActionsSchema = z.object({
  url: z.string().url(),
  actions: z.array(ActionSchema).min(1).max(20),
  
  // Output formats
  formats: z.array(z.enum(['markdown', 'html', 'json', 'text', 'screenshots'])).default(['json']),
  
  // Intermediate state capture
  captureIntermediateStates: z.boolean().default(false),
  captureScreenshots: z.boolean().default(true),
  
  // Form auto-fill
  formAutoFill: z.record(z.string()).optional(),
  
  // Browser options
  browserOptions: z.object({
    headless: z.boolean().default(true),
    userAgent: z.string().optional(),
    viewportWidth: z.number().min(800).max(1920).default(1280),
    viewportHeight: z.number().min(600).max(1080).default(720),
    timeout: z.number().min(10000).max(120000).default(30000)
  }).optional(),
  
  // Content extraction options
  extractionOptions: z.object({
    selectors: z.record(z.string()).optional(),
    includeMetadata: z.boolean().default(true),
    includeLinks: z.boolean().default(true),
    includeImages: z.boolean().default(true)
  }).optional(),
  
  // Error handling
  continueOnActionError: z.boolean().default(false),
  maxRetries: z.number().min(0).max(3).default(1),
  screenshotOnError: z.boolean().default(true)
});

export class ScrapeWithActionsTool extends EventEmitter {
  constructor(options = {}) {
    super();
    
    const {
      actionExecutor = null,
      extractContentTool = null,
      enableLogging = true,
      enableCaching = false,
      maxConcurrentSessions = 3,
      defaultBrowserOptions = {},
      screenshotPath = './screenshots'
    } = options;

    this.actionExecutor = actionExecutor || new ActionExecutor({
      enableLogging,
      enableScreenshotOnError: true,
      screenshotPath
    });
    
    this.extractContentTool = extractContentTool || new ExtractContentTool();
    this.enableLogging = enableLogging;
    this.enableCaching = enableCaching;
    this.maxConcurrentSessions = maxConcurrentSessions;
    this.defaultBrowserOptions = defaultBrowserOptions;

    // Active sessions tracking
    this.activeSessions = new Map();
    this.sessionResults = new Map();
    
    // Statistics
    this.stats = {
      totalSessions: 0,
      successfulSessions: 0,
      failedSessions: 0,
      totalActions: 0,
      successfulActions: 0,
      failedActions: 0,
      averageSessionTime: 0,
      averageActionsPerSession: 0,
      lastUpdated: Date.now()
    };
  }

  async execute(params) {
    try {
      const validated = ScrapeWithActionsSchema.parse(params);
      
      this.stats.totalSessions++;
      const sessionId = this.generateSessionId();
      const startTime = Date.now();

      if (this.enableLogging) {
        console.log(`Starting scrape session ${sessionId} with ${validated.actions.length} actions on ${validated.url}`);
      }

      // Check concurrent sessions limit
      if (this.activeSessions.size >= this.maxConcurrentSessions) {
        throw new Error(`Maximum concurrent sessions (${this.maxConcurrentSessions}) reached`);
      }

      // Create session context
      const sessionContext = {
        id: sessionId,
        url: validated.url,
        startTime,
        params: validated,
        states: [],
        screenshots: [],
        actionResults: [],
        errors: [],
        status: 'initializing'
      };

      this.activeSessions.set(sessionId, sessionContext);
      this.emit('sessionStarted', sessionContext);

      try {
        const result = await this.executeSession(sessionContext);
        
        this.stats.successfulSessions++;
        this.stats.totalActions += validated.actions.length;
        this.stats.successfulActions += result.actionResults.filter(r => r.success).length;
        this.stats.failedActions += result.actionResults.filter(r => !r.success).length;
        
        const executionTime = Date.now() - startTime;
        this.updateAverageSessionTime(executionTime);
        this.updateAverageActionsPerSession(validated.actions.length);
        this.updateStats();

        if (this.enableCaching) {
          this.sessionResults.set(sessionId, {
            result,
            timestamp: Date.now(),
            ttl: 3600000
          });
        }

        this.activeSessions.delete(sessionId);
        this.emit('sessionCompleted', result);

        return result;

      } catch (error) {
        this.stats.failedSessions++;
        this.activeSessions.delete(sessionId);
        this.emit('sessionFailed', { sessionId, url: validated.url, error });
        throw error;
      }

    } catch (error) {
      this.log('error', `Scrape with actions failed: ${error.message}`);
      throw new Error(`Scrape with actions failed: ${error.message}`);
    }
  }

  async executeSession(sessionContext) {
    const { params } = sessionContext;
    sessionContext.status = 'running';

    // Merge browser options
    const browserOptions = {
      ...this.defaultBrowserOptions,
      ...params.browserOptions
    };

    // Build action chain with form auto-fill if provided
    let actionChain = [...params.actions];
    
    if (params.formAutoFill) {
      actionChain = this.insertFormAutoFillActions(actionChain, params.formAutoFill);
    }

    // Add capture actions if intermediate states requested
    if (params.captureIntermediateStates) {
      actionChain = this.insertCaptureActions(actionChain);
    }

    // Execute action chain
    const chainResult = await this.actionExecutor.executeActionChain(
      params.url,
      {
        actions: actionChain,
        continueOnError: params.continueOnActionError,
        timeout: browserOptions.timeout || 30000,
        retryChain: params.maxRetries,
        metadata: {
          sessionId: sessionContext.id,
          originalActionCount: params.actions.length,
          formAutoFill: !!params.formAutoFill
        }
      },
      browserOptions
    );

    sessionContext.actionResults = chainResult.results;
    sessionContext.screenshots = chainResult.screenshots || [];

    // Process action results 
    const actionResults = this.processActionResults(chainResult.results);
    const intermediateStates = params.captureIntermediateStates ? 
      await this.extractIntermediateStates(actionResults, params) : [];

    // Get final page content after all actions
    const finalContent = await this.extractFinalContent(params);

    // Generate different formats
    const content = this.generateFormats(finalContent, params.formats, {
      actionResults,
      intermediateStates,
      screenshots: sessionContext.screenshots
    });

    const executionTime = Date.now() - sessionContext.startTime;

    return {
      success: chainResult.success,
      sessionId: sessionContext.id,
      url: params.url,
      executionTime,
      
      actionResults,
      totalActions: params.actions.length,
      successfulActions: actionResults.filter(r => r.success).length,
      failedActions: actionResults.filter(r => !r.success).length,
      actionsExecuted: actionResults.length, // Total executed (for validation)
      
      content,
      
      intermediateStates: params.captureIntermediateStates ? intermediateStates : undefined,
      screenshots: params.captureScreenshots ? sessionContext.screenshots : undefined,
      
      // Form auto-fill flag (for tests/validation)
      formAutoFillApplied: !!params.formAutoFill,
      
      metadata: {
        browserOptions,
        formAutoFillApplied: !!params.formAutoFill,
        intermediateStatesCount: intermediateStates.length,
        screenshotsCount: sessionContext.screenshots.length,
        finalUrl: chainResult.metadata?.finalUrl,
        timestamp: Date.now()
      },
      
      stats: {
        sessionTime: executionTime,
        averageActionTime: actionResults.length > 0 ? 
          actionResults.reduce((sum, r) => sum + (r.executionTime || 0), 0) / actionResults.length : 0,
        errorRecoveryCount: actionResults.filter(r => r.recovered).length
      }
    };
  }

  insertFormAutoFillActions(actions, formAutoFill) {
    const fillActions = [];
    
    // Convert object with key-value pairs to fill actions
    for (const [selector, value] of Object.entries(formAutoFill)) {
      if (selector === 'submitSelector' || selector === 'waitAfterSubmit') {
        continue; // Skip special keys
      }
      
      fillActions.push({
        type: 'type',
        selector,
        text: value,
        description: `Auto-fill field: ${selector}`,
        continueOnError: true,
        retries: 1
      });
    }

    // Add submit action if specified
    if (formAutoFill.submitSelector) {
      fillActions.push({
        type: 'click',
        selector: formAutoFill.submitSelector,
        description: 'Auto-submit form',
        continueOnError: false,
        retries: 2
      });

      // Add wait after submit if specified
      const waitTime = parseInt(formAutoFill.waitAfterSubmit) || 2000;
      fillActions.push({
        type: 'wait',
        duration: waitTime,
        description: 'Wait after form submission'
      });
    }

    let insertIndex = 0;
    for (let i = 0; i < actions.length; i++) {
      if (actions[i].type !== 'wait') {
        insertIndex = i;
        break;
      }
    }

    return [
      ...actions.slice(0, insertIndex),
      ...fillActions,
      ...actions.slice(insertIndex)
    ];
  }

  insertCaptureActions(actions) {
    const modifiedActions = [];

    actions.forEach((action, index) => {
      modifiedActions.push(action);

      if (this.shouldCaptureAfterAction(action) || action.captureAfter) {
        modifiedActions.push({
          type: 'executeJavaScript',
          script: `return {url: window.location.href, title: document.title, html: document.documentElement.outerHTML, timestamp: Date.now(), capturePoint: ${index + 1}};`,
          description: `Capture state after action ${index + 1}`,
          returnResult: true,
          continueOnError: true
        });
      }
    });

    return modifiedActions;
  }

  shouldCaptureAfterAction(action) {
    const captureAfterTypes = ['click', 'type', 'press'];
    return captureAfterTypes.includes(action.type);
  }

  processActionResults(rawResults) {
    return rawResults.map(result => ({
      id: result.id,
      type: result.type,
      success: result.success,
      description: result.description,
      executionTime: result.executionTime,
      timestamp: result.timestamp,
      error: result.error,
      result: result.result,
      recovered: result.recovered,
      recoveryStrategy: result.recoveryStrategy,
      jsResult: result.type === 'executeJavaScript' && result.result ? result.result.result : undefined
    }));
  }

  async extractIntermediateStates(actionResults, params) {
    const states = [];

    for (const result of actionResults) {
      if (result.type === 'executeJavaScript' && result.jsResult && result.jsResult.html) {
        try {
          const stateData = result.jsResult;
          const $ = load(stateData.html);
          
          const state = {
            capturePoint: stateData.capturePoint,
            url: stateData.url,
            title: stateData.title,
            timestamp: stateData.timestamp,
            content: {}
          };

          if (params.formats.includes('text')) {
            state.content.text = $('body').text().replace(/\s+/g, ' ').trim();
          }

          if (params.formats.includes('html')) {
            state.content.html = stateData.html;
          }

          if (params.formats.includes('json')) {
            state.content.json = {
              title: stateData.title,
              headings: this.extractHeadings($),
              links: this.extractLinks($)
            };
          }

          if (params.extractionOptions?.selectors) {
            state.content.extracted = this.extractWithSelectors($, params.extractionOptions.selectors);
          }

          states.push(state);
        } catch (error) {
          this.log('warn', `Failed to process intermediate state: ${error.message}`);
        }
      }
    }

    return states;
  }

  async extractFinalContent(params) {
    try {
      const extractResult = await this.extractContentTool.execute({
        url: params.url,
        options: {
          includeMetadata: params.extractionOptions?.includeMetadata !== false,
          includeLinks: params.extractionOptions?.includeLinks !== false,
          includeImages: params.extractionOptions?.includeImages !== false,
          customSelectors: params.extractionOptions?.selectors
        }
      });

      return extractResult;
    } catch (error) {
      this.log('warn', `Final content extraction failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        content: {},
        metadata: {}
      };
    }
  }

  generateFormats(finalContent, formats, additionalData) {
    const content = {};

    if (formats.includes('json')) {
      content.json = {
        finalContent: finalContent.content || {},
        metadata: finalContent.metadata || {},
        actionSummary: {
          totalActions: additionalData.actionResults.length,
          successfulActions: additionalData.actionResults.filter(r => r.success).length,
          failedActions: additionalData.actionResults.filter(r => !r.success).length,
          actions: additionalData.actionResults.map(r => ({
            type: r.type,
            success: r.success,
            description: r.description,
            executionTime: r.executionTime
          }))
        }
      };
    }

    if (formats.includes('html')) {
      content.html = finalContent.content?.html || '';
    }

    if (formats.includes('text')) {
      content.text = finalContent.content?.text || '';
    }

    if (formats.includes('markdown')) {
      content.markdown = finalContent.content?.markdown || 'Content not available in markdown format';
    }

    if (formats.includes('screenshots')) {
      content.screenshots = additionalData.screenshots || [];
    }

    return content;
  }

  extractHeadings($) {
    const headings = [];
    $('h1, h2, h3, h4, h5, h6').each((_, el) => {
      headings.push({
        level: parseInt(el.name.substring(1)),
        text: $(el).text().trim(),
        id: $(el).attr('id') || null
      });
    });
    return headings;
  }

  extractLinks($) {
    const links = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      
      if (href && text) {
        links.push({
          href,
          text,
          title: $(el).attr('title') || null
        });
      }
    });
    return links;
  }

  extractWithSelectors($, selectors) {
    const extracted = {};

    for (const [key, selector] of Object.entries(selectors)) {
      try {
        const elements = $(selector);
        
        if (elements.length === 0) {
          extracted[key] = null;
        } else if (elements.length === 1) {
          extracted[key] = elements.text().trim();
        } else {
          extracted[key] = elements.map((_, el) => $(el).text().trim()).get();
        }
      } catch (error) {
        extracted[key] = { error: `Invalid selector: ${selector}` };
      }
    }

    return extracted;
  }

  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  updateAverageSessionTime(sessionTime) {
    const currentAverage = this.stats.averageSessionTime;
    const completedSessions = this.stats.successfulSessions + this.stats.failedSessions;
    
    if (completedSessions === 1) {
      this.stats.averageSessionTime = sessionTime;
    } else {
      this.stats.averageSessionTime = 
        ((currentAverage * (completedSessions - 1)) + sessionTime) / completedSessions;
    }
  }

  updateAverageActionsPerSession(actionCount) {
    const currentAverage = this.stats.averageActionsPerSession;
    const totalSessions = this.stats.totalSessions;
    
    if (totalSessions === 1) {
      this.stats.averageActionsPerSession = actionCount;
    } else {
      this.stats.averageActionsPerSession = 
        ((currentAverage * (totalSessions - 1)) + actionCount) / totalSessions;
    }
  }

  updateStats() {
    this.stats.lastUpdated = Date.now();
  }

  log(level, message) {
    if (this.enableLogging) {
      console.log(`[ScrapeWithActionsTool:${level.toUpperCase()}] ${message}`);
    }
  }

  getStats() {
    return {
      ...this.stats,
      activeSessions: this.activeSessions.size,
      cachedResults: this.sessionResults.size,
      actionExecutorStats: this.actionExecutor ? this.actionExecutor.getStats() : null
    };
  }

  async destroy() {
    this.activeSessions.clear();
    this.sessionResults.clear();

    if (this.actionExecutor) {
      await this.actionExecutor.destroy();
    }

    this.removeAllListeners();
    this.emit('destroyed');
  }
}

export default ScrapeWithActionsTool;