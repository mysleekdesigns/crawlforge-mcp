/**
 * Authentication and Credit Management for CrawlForge MCP Server
 * Handles API key validation, credit tracking, and usage reporting
 */

// Using native fetch (Node.js 18+)
import fs from 'fs/promises';
import path from 'path';
import { isCreatorModeVerified } from './creatorMode.js';
import { resolveApiEndpoint } from './endpointGuard.js';

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
    // NOTE: Don't read creator mode in constructor - it's set dynamically in server.js
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
   */
  async initialize() {
    if (this.initialized) return;
    
    // Skip config loading in creator mode
    if (this.isCreatorMode()) {
      console.log('🚀 Creator Mode Active - Unlimited Access Enabled');
      this.initialized = true;
      return;
    }
    
    try {
      await this.loadConfig();
      this.initialized = true;
    } catch (error) {
      console.log('No existing CrawlForge configuration found. Run setup to configure.');
      this.initialized = true;
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

    const userId = this.config.userId;

    // Pre-decrement cache before fetch so network failures still deplete credits
    const cached = this.creditCache.get(userId);
    if (cached !== undefined) {
      this.creditCache.set(userId, Math.max(0, cached - creditsUsed));
    }

    const payload = {
      tool,
      creditsUsed,
      requestData,
      responseStatus,
      processingTime,
      timestamp: new Date().toISOString(),
      version: '3.0.3'
    };

    try {
      await fetch(`${this.apiEndpoint}/api/v1/usage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000)
      });

      await this._flushPendingUsage();
    } catch (error) {
      // Log but don't throw - usage reporting should not break tool execution
      console.error('Failed to report usage:', error.message);
      await this._appendPendingUsage({ toolName: tool, creditsUsed, userId, timestamp: payload.timestamp });
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

      entries.push(entry);

      // Cap at 1 MB — drop oldest entries until serialized size fits
      let serialized = JSON.stringify(entries);
      while (serialized.length > 1_048_576 && entries.length > 1) {
        entries.shift();
        serialized = JSON.stringify(entries);
      }

      await fs.writeFile(this.pendingUsagePath, serialized, { mode: 0o600 });
    } catch (error) {
      console.error('Failed to append pending usage:', error.message);
    }
  }

  async _flushPendingUsage() {
    if (!this.config) return;

    let entries;
    try {
      const raw = await fs.readFile(this.pendingUsagePath, 'utf-8');
      entries = JSON.parse(raw);
    } catch {
      return; // Nothing to flush
    }

    if (!Array.isArray(entries) || entries.length === 0) return;

    const remaining = [];
    for (const entry of entries) {
      try {
        await fetch(`${this.apiEndpoint}/api/v1/usage`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.config.apiKey
          },
          body: JSON.stringify({
            tool: entry.toolName,
            creditsUsed: entry.creditsUsed,
            timestamp: entry.timestamp,
            version: '3.0.3'
          }),
          signal: AbortSignal.timeout(5000)
        });
      } catch {
        remaining.push(entry);
      }
    }

    try {
      if (remaining.length === 0) {
        await fs.unlink(this.pendingUsagePath);
      } else {
        await fs.writeFile(this.pendingUsagePath, JSON.stringify(remaining), { mode: 0o600 });
      }
    } catch (error) {
      console.error('Failed to update pending usage file:', error.message);
    }
  }

  /**
   * Get credit cost for a tool
   */
  getToolCost(tool) {
    const costs = {
      // Basic tools (1 credit)
      fetch_url: 1,
      extract_text: 1,
      extract_links: 1,
      extract_metadata: 1,
      
      // Advanced tools (2-3 credits)
      scrape_structured: 2,
      search_web: 2,
      summarize_content: 2,
      analyze_content: 2,
      
      // Premium tools (5-10 credits)
      crawl_deep: 5,
      map_site: 5,
      batch_scrape: 5,
      deep_research: 10,
      stealth_mode: 10,
      
      // Heavy processing (3-5 credits)
      process_document: 3,
      extract_content: 3,
      scrape_with_actions: 5,
      generate_llms_txt: 3,
      localization: 5,
      track_changes: 3,
      
      // Phase 1: LLM-Powered Structured Extraction
      extract_structured: 4
    };

    return costs[tool] || 1;
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