/**
 * Authentication and Credit Management for CrawlForge MCP Server
 * Handles API key validation, credit tracking, and usage reporting
 */

// Using native fetch (Node.js 18+)
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { isCreatorModeVerified } from './creatorMode.js';
import { resolveApiEndpoint } from './endpointGuard.js';
import { logger } from '../utils/Logger.js';
// D1.4: Elicitation for low-credit warnings (lazy import to avoid circular dep)
let _ElicitationHelper = null;
function getElicitationHelper() {
  if (!_ElicitationHelper) {
    // Dynamic import to avoid circular dependency at module load time
    return null; // Will be set via setElicitation() from server.js
  }
  return _ElicitationHelper;
}

class AuthManager {
  constructor() {
    this.apiEndpoint = resolveApiEndpoint(process.env.CRAWLFORGE_API_URL || 'https://www.crawlforge.dev');
    this.configPath = path.join(process.env.HOME || process.env.USERPROFILE, '.crawlforge', 'config.json');
    this.pendingUsagePath = path.join(process.env.HOME || process.env.USERPROFILE, '.crawlforge', 'pending-usage.json');
    this.config = null;
    this.creditCache = new Map();
    this.lastCreditCheck = null;
    this.lastSuccessfulCreditCheck = new Map();
    this.CREDIT_CHECK_INTERVAL = 15000;
    this.initialized = false;
    // D2.1: simple async mutex to prevent concurrent reportUsage calls from
    // double-decrementing the credit cache before the backend ack arrives.
    this._usageQueue = Promise.resolve();
    // D1.4: Elicitation helper for low-credit warnings
    this._elicitation = null;
    // NOTE: Don't read creator mode in constructor - it's set dynamically in server.js
  }

  /**
   * D1.4: Set elicitation helper for low-credit warnings.
   * @param {object} elicitation - ElicitationHelper instance
   */
  setElicitation(elicitation) {
    this._elicitation = elicitation;
  }

  /**
   * Check if running in creator mode (unlimited access, no API required)
   * Uses module-scoped verified flag from server.js - cannot be bypassed via env vars
   */
  isCreatorMode() {
    return isCreatorModeVerified();
  }

  /**
   * Initialize the auth manager and load stored config
   *
   * Audit phase 5: re-validate the stored API key against the backend at startup.
   * If the backend explicitly reports the key as revoked/invalid, we throw —
   * the server must refuse to start rather than silently run with a dead key.
   * Network failures are tolerated (we already have a cached config and the
   * fail-closed credit check from audit phase 2 handles runtime revocation).
   */
  async initialize() {
    if (this.initialized) return;

    // Skip config loading in creator mode
    if (this.isCreatorMode()) {
      // Status → stderr; stdout is reserved for MCP JSON-RPC / CLI --json output.
      console.error('🚀 Creator Mode Active - Unlimited Access Enabled');
      this.initialized = true;
      return;
    }

    try {
      await this.loadConfig();
      this.initialized = true;
    } catch (error) {
      console.error('No existing CrawlForge configuration found. Run setup to configure.');
      this.initialized = true;
    }

    // Phase 5: re-validate cached API key with backend. Refuse to start if revoked.
    if (this.config?.apiKey && process.env.CRAWLFORGE_SKIP_STARTUP_VALIDATION !== 'true') {
      const validation = await this.validateApiKey(this.config.apiKey);
      if (!validation.valid) {
        const lower = (validation.error || '').toLowerCase();
        const isExplicitReject =
          lower.includes('invalid') ||
          lower.includes('revoked') ||
          lower.includes('not found') ||
          lower.includes('expired') ||
          lower.includes('unauthorized');
        if (isExplicitReject) {
          const rejectErr = new Error(
            `CrawlForge API key rejected by backend at startup: ${validation.error}. ` +
            `Run \`npm run setup\` with a current key, or set CRAWLFORGE_SKIP_STARTUP_VALIDATION=true to bypass.`
          );
          logger.error('Startup API key validation rejected by backend', rejectErr, {
            backendError: validation.error
          });
          throw rejectErr;
        }
        // Connection error — tolerate, log, continue. Runtime credit check will fail closed.
        logger.warn('Startup API key validation skipped (backend unreachable)', {
          error: validation.error
        });
      } else {
        logger.info('Startup API key validation OK', {
          userId: validation.userId,
          creditsRemaining: validation.creditsRemaining
        });
      }
    }

    try {
      await this._flushPendingUsage();
    } catch {
      // Best-effort flush — do not block startup
    }
  }

  /**
   * Load configuration from disk
   */
  async loadConfig() {
    try {
      const configData = await fs.readFile(this.configPath, 'utf-8');
      this.config = JSON.parse(configData);
      
      // Validate config structure
      if (!this.config.apiKey || !this.config.userId) {
        throw new Error('Invalid configuration');
      }
    } catch (error) {
      this.config = null;
      throw error;
    }
  }

  /**
   * Save configuration to disk
   */
  async saveConfig(apiKey, userId, email) {
    const config = {
      apiKey,
      userId,
      email,
      createdAt: new Date().toISOString(),
      version: '1.0.0'
    };

    // Create config directory if it doesn't exist
    const configDir = path.dirname(this.configPath);
    await fs.mkdir(configDir, { recursive: true });
    
    // Save config with owner-only permissions (contains API key)
    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    this.config = config;
  }

  /**
   * Setup wizard for first-time users
   */
  async runSetup(apiKey) {
    console.log('🔧 Setting up CrawlForge MCP Server...\n');
    
    if (!apiKey) {
      console.log('❌ API key is required for setup');
      console.log('Get your API key from: https://www.crawlforge.dev/dashboard/api-keys');
      return false;
    }

    // Validate API key with backend
    const validation = await this.validateApiKey(apiKey);
    
    if (!validation.valid) {
      console.log(`❌ Invalid API key: ${validation.error}`);
      return false;
    }

    // Save configuration
    await this.saveConfig(apiKey, validation.userId, validation.email);
    
    console.log('✅ Setup complete!');
    console.log(`📧 Account: ${validation.email}`);
    console.log(`💳 Credits remaining: ${validation.creditsRemaining}`);
    console.log(`📦 Plan: ${validation.planId}`);
    
    return true;
  }

  /**
   * Validate API key with backend
   */
  async validateApiKey(apiKey) {
    try {
      const response = await fetch(`${this.apiEndpoint}/api/v1/auth/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        }
      });

      if (!response.ok) {
        const error = await response.json();
        return {
          valid: false,
          error: error.message || 'Invalid API key'
        };
      }

      const data = await response.json();
      return {
        valid: true,
        userId: data.userId,
        email: data.email,
        creditsRemaining: data.creditsRemaining,
        planId: data.planId
      };
    } catch (error) {
      return {
        valid: false,
        error: `Connection error: ${error.message}`
      };
    }
  }

  /**
   * Check if user has enough credits for a tool
   */
  async checkCredits(estimatedCredits = 1) {
    // Creator mode has unlimited credits
    if (this.isCreatorMode()) {
      return true;
    }
    
    if (!this.config) {
      throw new Error('CrawlForge not configured. Run setup first.');
    }

    // Use cached credits if recent
    const now = Date.now();
    if (this.lastCreditCheck && (now - this.lastCreditCheck) < this.CREDIT_CHECK_INTERVAL) {
      const cached = this.creditCache.get(this.config.userId);
      if (cached !== undefined) {
        return cached >= estimatedCredits;
      }
    }

    // Fetch current credits from backend
    try {
      const response = await fetch(`${this.apiEndpoint}/api/v1/credits`, {
        headers: {
          'X-API-Key': this.config.apiKey
        },
        signal: AbortSignal.timeout(5000)
      });

      if (response.ok) {
        const data = await response.json();
        this.creditCache.set(this.config.userId, data.creditsRemaining);
        this.lastCreditCheck = now;
        this.lastSuccessfulCreditCheck.set(this.config.userId, now);

        // D1.4: If credits are close to running out, elicit confirmation instead of hard-failing
        if (data.creditsRemaining < estimatedCredits) {
          if (this._elicitation) {
            const proceed = await this._elicitation.confirm(
              `Low credits: ${data.creditsRemaining} remaining, this tool needs ~${estimatedCredits}. Proceed anyway?`,
              {
                credits_remaining: data.creditsRemaining,
                credits_needed: estimatedCredits,
                note: 'Top up at https://www.crawlforge.dev/dashboard',
              }
            );
            if (!proceed) return false;
            return true; // user confirmed — let tool attempt it
          }
          return false; // no elicitation — standard hard-fail behavior
        }

        return data.creditsRemaining >= estimatedCredits;
      }
    } catch (error) {
      console.error('Failed to check credits:', error.message);

      const lastOk = this.lastSuccessfulCreditCheck.get(this.config.userId) ?? 0;
      const withinGrace = Date.now() - lastOk < 30_000;
      const cached = this.creditCache.get(this.config.userId);
      if (withinGrace && cached !== undefined && cached >= estimatedCredits) return true;
      throw new Error('Unable to verify credits. Please check your connection and try again.');
    }
  }

  /**
   * Report usage to backend for credit deduction
   */
  async reportUsage(tool, creditsUsed, requestData = {}, responseStatus = 200, processingTime = 0) {
    // Skip usage reporting in creator mode
    if (this.isCreatorMode()) {
      return;
    }

    if (!this.config) {
      return; // Silently skip if not configured
    }

    // D2.1: serialize via promise queue so concurrent tool calls do not race
    // on creditCache and double-decrement before the backend ack arrives.
    this._usageQueue = this._usageQueue.then(() =>
      this._reportUsageOnce(tool, creditsUsed, requestData, responseStatus, processingTime)
    );
    return this._usageQueue;
  }

  async _reportUsageOnce(tool, creditsUsed, requestData = {}, responseStatus = 200, processingTime = 0) {
    const userId = this.config.userId;

    // Decrement only inside the serialized task -- no concurrent races
    const cached = this.creditCache.get(userId);
    if (cached !== undefined) {
      this.creditCache.set(userId, Math.max(0, cached - creditsUsed));
    }

    // Audit phase A2: every usage report gets a request ID and idempotency key
    // so retries (in-memory or via pending-usage.json) are safe to replay.
    const requestId = randomUUID();
    const idempotencyKey = randomUUID();

    const payload = {
      tool,
      creditsUsed,
      requestData,
      responseStatus,
      processingTime,
      timestamp: new Date().toISOString(),
      requestId,
      idempotencyKey,
      version: '3.0.3'
    };

    try {
      await fetch(`${this.apiEndpoint}/api/v1/usage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey,
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000)
      });

      await this._flushPendingUsage();
    } catch (error) {
      // Log but don't throw - usage reporting should not break tool execution
      logger.error('Failed to report usage; queued for retry', error, {
        tool,
        creditsUsed,
        requestId,
        idempotencyKey
      });
      await this._appendPendingUsage({
        toolName: tool,
        creditsUsed,
        userId,
        timestamp: payload.timestamp,
        requestId,
        idempotencyKey
      });
    }
  }

  async _appendPendingUsage(entry) {
    try {
      const configDir = path.dirname(this.pendingUsagePath);
      await fs.mkdir(configDir, { recursive: true });

      let entries = [];
      try {
        const raw = await fs.readFile(this.pendingUsagePath, 'utf-8');
        entries = JSON.parse(raw);
      } catch {
        // File absent or corrupt — start fresh
      }

      // Audit phase A2: stamp every pending entry with a request ID and idempotency key
      // so the backend (when it ships support) can dedupe, and so we can log dropped
      // entries by ID when the flush retry path fails permanently.
      const stamped = {
        requestId: entry.requestId || randomUUID(),
        idempotencyKey: entry.idempotencyKey || randomUUID(),
        ...entry
      };

      entries.push(stamped);

      // Cap at 1 MB — drop oldest entries until serialized size fits
      let serialized = JSON.stringify(entries);
      const dropped = [];
      while (serialized.length > 1_048_576 && entries.length > 1) {
        dropped.push(entries.shift());
        serialized = JSON.stringify(entries);
      }
      if (dropped.length > 0) {
        logger.warn('Pending usage queue truncated to 1 MB cap', {
          droppedCount: dropped.length,
          droppedIds: dropped.map(d => d.requestId).filter(Boolean)
        });
      }

      await fs.writeFile(this.pendingUsagePath, serialized, { mode: 0o600 });
    } catch (error) {
      logger.error('Failed to append pending usage', error, {
        toolName: entry?.toolName,
        requestId: entry?.requestId
      });
    }
  }

  async _flushPendingUsage() {
    if (!this.config) return;

    let entries;
    try {
      const raw = await fs.readFile(this.pendingUsagePath, 'utf-8');
      entries = JSON.parse(raw);
    } catch (err) {
      // ENOENT is normal (nothing pending). Anything else is corruption — log it.
      if (err && err.code !== 'ENOENT') {
        logger.warn('Pending usage file unreadable; treating as empty', {
          error: err.message,
          path: this.pendingUsagePath
        });
      }
      return;
    }

    if (!Array.isArray(entries) || entries.length === 0) return;

    const remaining = [];
    const flushedIds = [];
    const failedIds = [];
    for (const entry of entries) {
      try {
        const idempotencyKey = entry.idempotencyKey || randomUUID();
        await fetch(`${this.apiEndpoint}/api/v1/usage`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.config.apiKey,
            'Idempotency-Key': idempotencyKey
          },
          body: JSON.stringify({
            tool: entry.toolName,
            creditsUsed: entry.creditsUsed,
            timestamp: entry.timestamp,
            requestId: entry.requestId,
            idempotencyKey,
            version: '3.0.3'
          }),
          signal: AbortSignal.timeout(5000)
        });
        flushedIds.push(entry.requestId);
      } catch (err) {
        failedIds.push(entry.requestId);
        remaining.push(entry);
      }
    }

    if (flushedIds.length > 0) {
      logger.info('Flushed pending usage entries', {
        count: flushedIds.length,
        requestIds: flushedIds.filter(Boolean)
      });
    }
    if (failedIds.length > 0) {
      logger.warn('Pending usage entries failed to flush; retained for next attempt', {
        count: failedIds.length,
        requestIds: failedIds.filter(Boolean)
      });
    }

    try {
      if (remaining.length === 0) {
        await fs.unlink(this.pendingUsagePath);
      } else {
        await fs.writeFile(this.pendingUsagePath, JSON.stringify(remaining), { mode: 0o600 });
      }
    } catch (error) {
      logger.error('Failed to update pending usage file', error, {
        path: this.pendingUsagePath
      });
    }
  }

  /**
   * Get credit cost for a tool.
   *
   * Open-core Phase 1 (docs/tier-map.md): this table is the single source of
   * truth shared with the backend (crawlforge-website/src/lib/credits.ts).
   * Tier 0 tools run locally on the user's machine and cost 0; Tier 1 tools
   * are metered per COGS.
   *
   * @param {string} tool
   * @param {object} [params] — invocation params; only used for per-call
   *        exceptions (scrape's screenshot format needs a server browser).
   */
  getToolCost(tool, params) {
    // Tier-0 exception: the screenshot format of `scrape` is browser-backed
    if (tool === 'scrape' && Array.isArray(params?.formats) && params.formats.includes('screenshot')) {
      return 2;
    }

    const costs = {
      // Tier 0 — free, local (key optional)
      fetch_url: 0,
      extract_text: 0,
      extract_links: 0,
      extract_metadata: 0,
      scrape_structured: 0,
      scrape_template: 0,
      extract_content: 0,
      scrape: 0, // 2 if formats includes 'screenshot' (handled above)
      summarize_content: 0,
      analyze_content: 0,
      extract_with_llm: 0,
      extract_structured: 0,
      process_document: 0,
      list_ollama_models: 0,
      get_batch_results: 0, // retrieval of an already-paid batch job

      // Tier 1 — metered (costs reflect COGS)
      map_site: 3,
      track_changes: 3,
      generate_llms_txt: 5,
      search_web: 5,
      crawl_deep: 5,
      batch_scrape: 5,
      scrape_with_actions: 5,
      localization: 5,
      agent: 8, // projectCost() scales with maxUrls
      deep_research: 10,
      stealth_mode: 10
    };

    return costs[tool] ?? 1;
  }

  /**
   * D3.5: Project the cost of calling a tool with given params.
   *
   * Returns a lower-bound estimate.  Dynamic tools (deep_research, crawl_deep)
   * have variable costs that depend on runtime behaviour (e.g. how many URLs
   * get fetched).  The projection is a MINIMUM — actual cost may be higher.
   * Accuracy caveats are documented in each tool description.
   *
   * @param {string} toolName
   * @param {object} params
   * @returns {{ projected: number, note: string }}
   */
  projectCost(toolName, params) {
    const base = this.getToolCost(toolName, params);

    // Override for tools whose cost scales with params
    let projected = base;
    let note = base === 0 ? 'Free local tool — no credits charged.' : 'Fixed cost per invocation.';

    switch (toolName) {
      case 'batch_scrape': {
        const urlCount = Array.isArray(params?.urls) ? params.urls.length : 1;
        projected = Math.max(base, Math.ceil(urlCount / 10));
        note = `Estimated from ${urlCount} URLs. Actual may be higher for slow/large pages.`;
        break;
      }
      case 'deep_research': {
        const maxUrls = params?.maxUrls || params?.options?.maxUrls || 20;
        projected = Math.max(base, Math.ceil(maxUrls / 5) + base);
        note = `Lower-bound estimate. deep_research cost grows with source count (${maxUrls} max URLs).`;
        break;
      }
      case 'crawl_deep': {
        const maxPages = params?.maxPages || params?.options?.maxPages || 10;
        projected = Math.max(base, Math.ceil(maxPages / 20) * base);
        note = `Lower-bound estimate. crawl_deep cost grows with page count (${maxPages} max).`;
        break;
      }
      case 'extract_with_llm':
        note = 'Free local tool. External LLM API call billed by your LLM provider, not in credits.';
        break;
      case 'scrape': {
        // Free local tool; only the browser-backed screenshot format is metered
        projected = base;
        note = base > 0
          ? 'screenshot format requires a server browser (2 credits). Other formats are free.'
          : 'Free local tool — no credits charged. json format may incur external LLM cost.';
        break;
      }
      case 'agent': {
        const agentUrls = params?.maxUrls || 10;
        const isPro = params?.model === 'pro';
        projected = Math.max(base, base + Math.ceil(agentUrls / 5) + (isPro ? 5 : 0));
        note = `Lower-bound estimate. Scales with maxUrls (${agentUrls}).${isPro ? ' pro model adds deep-research cost.' : ''} External LLM billed separately.`;
        break;
      }
      default:
        note = base === 0 ? 'Free local tool — no credits charged.' : 'Fixed cost per invocation.';
    }

    return { projected, note };
  }

  /**
   * Check if authenticated
   */
  isAuthenticated() {
    // Creator mode is always authenticated
    if (this.isCreatorMode()) {
      return true;
    }
    return this.config !== null && this.config.apiKey !== undefined;
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return this.config;
  }

  /**
   * Clear stored configuration
   */
  async clearConfig() {
    try {
      await fs.unlink(this.configPath);
      this.config = null;
      this.creditCache.clear();
      console.log('Configuration cleared.');
    } catch (error) {
      console.error('Failed to clear configuration:', error.message);
    }
  }
}

// Export singleton instance
export default new AuthManager();