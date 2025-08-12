import { normalizeUrl } from './urlNormalizer.js';

/**
 * Advanced domain filtering system with whitelist/blacklist management,
 * subdomain handling, pattern matching, and domain-specific rules
 */
export class DomainFilter {
  constructor(options = {}) {
    const {
      allowSubdomains = true,
      defaultMaxDepth = 5,
      defaultRateLimit = 10
    } = options;

    this.allowSubdomains = allowSubdomains;
    this.defaultMaxDepth = defaultMaxDepth;
    this.defaultRateLimit = defaultRateLimit;

    // Core filtering lists
    this.whitelist = new Map(); // domain -> options
    this.blacklist = new Map(); // domain -> options
    this.patterns = {
      include: [], // { pattern: RegExp, options: Object }
      exclude: []  // { pattern: RegExp, options: Object }
    };

    // Domain-specific rules
    this.domainRules = new Map(); // domain -> rules object
    
    // Cache for performance
    this.cache = new Map(); // url -> decision
    this.cacheSize = 10000;
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Add domain to whitelist with options
   * @param {string} domain - Domain to whitelist
   * @param {Object} options - Configuration options
   */
  addWhitelistDomain(domain, options = {}) {
    const normalizedDomain = this.normalizeDomain(domain);
    const config = {
      includeSubdomains: options.includeSubdomains ?? this.allowSubdomains,
      maxDepth: options.maxDepth ?? this.defaultMaxDepth,
      rateLimit: options.rateLimit ?? this.defaultRateLimit,
      customHeaders: options.customHeaders || {},
      timeout: options.timeout || 30000,
      priority: options.priority || 1,
      addedAt: new Date().toISOString()
    };

    this.whitelist.set(normalizedDomain, config);
    this.clearCache();
    return this;
  }

  /**
   * Add domain to blacklist with options
   * @param {string} domain - Domain to blacklist
   * @param {Object} options - Configuration options
   */
  addBlacklistDomain(domain, options = {}) {
    const normalizedDomain = this.normalizeDomain(domain);
    const config = {
      includeSubdomains: options.includeSubdomains ?? this.allowSubdomains,
      reason: options.reason || 'Blacklisted',
      permanent: options.permanent ?? false,
      addedAt: new Date().toISOString()
    };

    this.blacklist.set(normalizedDomain, config);
    this.clearCache();
    return this;
  }

  /**
   * Add pattern-based filter
   * @param {string} pattern - RegExp pattern string
   * @param {string} type - 'include' or 'exclude'
   * @param {Object} options - Pattern options
   */
  addPattern(pattern, type = 'exclude', options = {}) {
    if (!['include', 'exclude'].includes(type)) {
      throw new Error('Pattern type must be "include" or "exclude"');
    }

    const config = {
      pattern: new RegExp(pattern, options.flags || 'i'),
      rawPattern: pattern,
      priority: options.priority || 1,
      description: options.description || '',
      addedAt: new Date().toISOString()
    };

    this.patterns[type].push(config);
    
    // Sort by priority (higher first)
    this.patterns[type].sort((a, b) => b.priority - a.priority);
    
    this.clearCache();
    return this;
  }

  /**
   * Remove domain from whitelist
   * @param {string} domain - Domain to remove
   */
  removeWhitelistDomain(domain) {
    const normalizedDomain = this.normalizeDomain(domain);
    const removed = this.whitelist.delete(normalizedDomain);
    if (removed) this.clearCache();
    return removed;
  }

  /**
   * Remove domain from blacklist
   * @param {string} domain - Domain to remove
   */
  removeBlacklistDomain(domain) {
    const normalizedDomain = this.normalizeDomain(domain);
    const removed = this.blacklist.delete(normalizedDomain);
    if (removed) this.clearCache();
    return removed;
  }

  /**
   * Remove pattern by index
   * @param {string} type - 'include' or 'exclude'
   * @param {number} index - Pattern index
   */
  removePattern(type, index) {
    if (!['include', 'exclude'].includes(type)) {
      throw new Error('Pattern type must be "include" or "exclude"');
    }

    if (index >= 0 && index < this.patterns[type].length) {
      this.patterns[type].splice(index, 1);
      this.clearCache();
      return true;
    }
    return false;
  }

  /**
   * Set domain-specific crawling rules
   * @param {string} domain - Domain for rules
   * @param {Object} rules - Domain-specific rules
   */
  setDomainRules(domain, rules) {
    const normalizedDomain = this.normalizeDomain(domain);
    const config = {
      maxDepth: rules.maxDepth ?? this.defaultMaxDepth,
      rateLimit: rules.rateLimit ?? this.defaultRateLimit,
      respectRobots: rules.respectRobots ?? true,
      allowedPaths: rules.allowedPaths || [],
      blockedPaths: rules.blockedPaths || [],
      customHeaders: rules.customHeaders || {},
      timeout: rules.timeout || 30000,
      maxPages: rules.maxPages || 100,
      concurrency: rules.concurrency || 10,
      updatedAt: new Date().toISOString()
    };

    this.domainRules.set(normalizedDomain, config);
    return this;
  }

  /**
   * Get domain-specific rules
   * @param {string} domain - Domain to get rules for
   * @returns {Object} Domain rules or defaults
   */
  getDomainRules(domain) {
    const normalizedDomain = this.normalizeDomain(domain);
    
    // Check exact match first
    if (this.domainRules.has(normalizedDomain)) {
      return { ...this.domainRules.get(normalizedDomain) };
    }

    // Check parent domains for subdomain inheritance
    const parts = normalizedDomain.split('.');
    for (let i = 1; i < parts.length; i++) {
      const parentDomain = parts.slice(i).join('.');
      if (this.domainRules.has(parentDomain)) {
        const parentRules = this.domainRules.get(parentDomain);
        if (parentRules.inheritToSubdomains !== false) {
          return { ...parentRules };
        }
      }
    }

    // Return defaults
    return {
      maxDepth: this.defaultMaxDepth,
      rateLimit: this.defaultRateLimit,
      respectRobots: true,
      allowedPaths: [],
      blockedPaths: [],
      customHeaders: {},
      timeout: 30000,
      maxPages: 100,
      concurrency: 10
    };
  }

  /**
   * Check if URL is allowed based on all filtering rules
   * @param {string} url - URL to check
   * @returns {Object} Decision object with allowed status and metadata
   */
  isAllowed(url) {
    try {
      const normalizedUrl = normalizeUrl(url);
      
      // Check cache first
      if (this.cache.has(normalizedUrl)) {
        this.cacheHits++;
        return this.cache.get(normalizedUrl);
      }

      this.cacheMisses++;
      const decision = this.evaluateUrl(normalizedUrl);
      
      // Cache the decision
      this.addToCache(normalizedUrl, decision);
      
      return decision;
    } catch (error) {
      return {
        allowed: false,
        reason: `Invalid URL: ${error.message}`,
        confidence: 1.0,
        metadata: { error: error.message }
      };
    }
  }

  /**
   * Internal URL evaluation logic
   * @param {string} url - Normalized URL to evaluate
   * @returns {Object} Decision object
   */
  evaluateUrl(url) {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    const path = urlObj.pathname;

    // 1. Check blacklist first (highest priority)
    const blacklistResult = this.checkBlacklist(domain, path);
    if (!blacklistResult.allowed) {
      return blacklistResult;
    }

    // 2. Check exclude patterns
    const excludePatternResult = this.checkExcludePatterns(url);
    if (!excludePatternResult.allowed) {
      return excludePatternResult;
    }

    // 3. Check whitelist
    const whitelistResult = this.checkWhitelist(domain, path);
    if (whitelistResult.allowed) {
      return whitelistResult;
    }

    // 4. Check include patterns
    const includePatternResult = this.checkIncludePatterns(url);
    if (includePatternResult.allowed) {
      return includePatternResult;
    }

    // 5. Default behavior - if no whitelist exists, allow; if whitelist exists, deny
    const hasWhitelist = this.whitelist.size > 0 || this.patterns.include.length > 0;
    
    return {
      allowed: !hasWhitelist,
      reason: hasWhitelist ? 'Not in whitelist or include patterns' : 'No restrictions',
      confidence: hasWhitelist ? 0.9 : 0.5,
      metadata: {
        domain,
        path,
        hasWhitelist,
        evaluatedAt: new Date().toISOString()
      }
    };
  }

  /**
   * Check blacklist rules
   * @param {string} domain - Domain to check
   * @param {string} path - URL path
   * @returns {Object} Decision object
   */
  checkBlacklist(domain, path) {
    // Check exact domain match
    if (this.blacklist.has(domain)) {
      const config = this.blacklist.get(domain);
      return {
        allowed: false,
        reason: `Blacklisted domain: ${domain} (${config.reason})`,
        confidence: 1.0,
        metadata: { blacklistConfig: config, matchType: 'exact' }
      };
    }

    // Check subdomain matches
    const parts = domain.split('.');
    for (let i = 1; i < parts.length; i++) {
      const parentDomain = parts.slice(i).join('.');
      if (this.blacklist.has(parentDomain)) {
        const config = this.blacklist.get(parentDomain);
        if (config.includeSubdomains) {
          return {
            allowed: false,
            reason: `Blacklisted parent domain: ${parentDomain} (${config.reason})`,
            confidence: 0.9,
            metadata: { blacklistConfig: config, matchType: 'subdomain', parentDomain }
          };
        }
      }
    }

    return { allowed: true, reason: 'Not blacklisted', confidence: 0.5 };
  }

  /**
   * Check whitelist rules
   * @param {string} domain - Domain to check
   * @param {string} path - URL path
   * @returns {Object} Decision object
   */
  checkWhitelist(domain, path) {
    // Check exact domain match
    if (this.whitelist.has(domain)) {
      const config = this.whitelist.get(domain);
      return {
        allowed: true,
        reason: `Whitelisted domain: ${domain}`,
        confidence: 1.0,
        metadata: { whitelistConfig: config, matchType: 'exact' }
      };
    }

    // Check subdomain matches
    const parts = domain.split('.');
    for (let i = 1; i < parts.length; i++) {
      const parentDomain = parts.slice(i).join('.');
      if (this.whitelist.has(parentDomain)) {
        const config = this.whitelist.get(parentDomain);
        if (config.includeSubdomains) {
          return {
            allowed: true,
            reason: `Whitelisted parent domain: ${parentDomain}`,
            confidence: 0.9,
            metadata: { whitelistConfig: config, matchType: 'subdomain', parentDomain }
          };
        }
      }
    }

    return { allowed: false, reason: 'Not whitelisted', confidence: 0.5 };
  }

  /**
   * Check exclude patterns
   * @param {string} url - URL to check
   * @returns {Object} Decision object
   */
  checkExcludePatterns(url) {
    for (const patternConfig of this.patterns.exclude) {
      if (patternConfig.pattern.test(url)) {
        return {
          allowed: false,
          reason: `Matches exclude pattern: ${patternConfig.rawPattern}`,
          confidence: 0.95,
          metadata: { 
            patternConfig, 
            matchType: 'exclude_pattern',
            description: patternConfig.description 
          }
        };
      }
    }

    return { allowed: true, reason: 'No exclude pattern match', confidence: 0.5 };
  }

  /**
   * Check include patterns
   * @param {string} url - URL to check
   * @returns {Object} Decision object
   */
  checkIncludePatterns(url) {
    for (const patternConfig of this.patterns.include) {
      if (patternConfig.pattern.test(url)) {
        return {
          allowed: true,
          reason: `Matches include pattern: ${patternConfig.rawPattern}`,
          confidence: 0.95,
          metadata: { 
            patternConfig, 
            matchType: 'include_pattern',
            description: patternConfig.description 
          }
        };
      }
    }

    return { allowed: false, reason: 'No include pattern match', confidence: 0.5 };
  }

  /**
   * Export filter configuration
   * @returns {Object} Serializable filter configuration
   */
  exportConfig() {
    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      options: {
        allowSubdomains: this.allowSubdomains,
        defaultMaxDepth: this.defaultMaxDepth,
        defaultRateLimit: this.defaultRateLimit
      },
      whitelist: Object.fromEntries(this.whitelist),
      blacklist: Object.fromEntries(this.blacklist),
      patterns: {
        include: this.patterns.include.map(p => ({
          ...p,
          pattern: p.rawPattern // Store raw pattern for re-import
        })),
        exclude: this.patterns.exclude.map(p => ({
          ...p,
          pattern: p.rawPattern
        }))
      },
      domainRules: Object.fromEntries(this.domainRules),
      stats: this.getStats()
    };
  }

  /**
   * Import filter configuration
   * @param {Object} config - Configuration to import
   */
  importConfig(config) {
    if (!config || config.version !== '1.0') {
      throw new Error('Invalid or unsupported configuration format');
    }

    // Clear existing configuration
    this.clearAll();

    // Import options
    if (config.options) {
      this.allowSubdomains = config.options.allowSubdomains ?? true;
      this.defaultMaxDepth = config.options.defaultMaxDepth ?? 5;
      this.defaultRateLimit = config.options.defaultRateLimit ?? 10;
    }

    // Import whitelist
    if (config.whitelist) {
      for (const [domain, options] of Object.entries(config.whitelist)) {
        this.whitelist.set(domain, options);
      }
    }

    // Import blacklist
    if (config.blacklist) {
      for (const [domain, options] of Object.entries(config.blacklist)) {
        this.blacklist.set(domain, options);
      }
    }

    // Import patterns
    if (config.patterns) {
      if (config.patterns.include) {
        this.patterns.include = config.patterns.include.map(p => ({
          ...p,
          pattern: new RegExp(p.pattern, p.flags || 'i'),
          rawPattern: p.pattern
        }));
      }
      if (config.patterns.exclude) {
        this.patterns.exclude = config.patterns.exclude.map(p => ({
          ...p,
          pattern: new RegExp(p.pattern, p.flags || 'i'),
          rawPattern: p.pattern
        }));
      }
    }

    // Import domain rules
    if (config.domainRules) {
      for (const [domain, rules] of Object.entries(config.domainRules)) {
        this.domainRules.set(domain, rules);
      }
    }

    this.clearCache();
    return this;
  }

  /**
   * Get filter statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      whitelist: {
        domains: this.whitelist.size,
        withSubdomains: Array.from(this.whitelist.values()).filter(c => c.includeSubdomains).length
      },
      blacklist: {
        domains: this.blacklist.size,
        withSubdomains: Array.from(this.blacklist.values()).filter(c => c.includeSubdomains).length
      },
      patterns: {
        include: this.patterns.include.length,
        exclude: this.patterns.exclude.length
      },
      domainRules: this.domainRules.size,
      cache: {
        size: this.cache.size,
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate: this.cacheHits / (this.cacheHits + this.cacheMisses) || 0
      }
    };
  }

  /**
   * Clear all filters and rules
   */
  clearAll() {
    this.whitelist.clear();
    this.blacklist.clear();
    this.patterns.include = [];
    this.patterns.exclude = [];
    this.domainRules.clear();
    this.clearCache();
    return this;
  }

  /**
   * Clear the decision cache
   */
  clearCache() {
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Add decision to cache with size management
   * @param {string} url - URL key
   * @param {Object} decision - Decision object
   */
  addToCache(url, decision) {
    if (this.cache.size >= this.cacheSize) {
      // Remove oldest entries (simple FIFO)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(url, decision);
  }

  /**
   * Normalize domain name for consistent lookup
   * @param {string} domain - Domain to normalize
   * @returns {string} Normalized domain
   */
  normalizeDomain(domain) {
    return domain.toLowerCase().trim();
  }

  /**
   * Validate and get effective configuration for a crawl operation
   * @param {string} startUrl - Starting URL for crawl
   * @param {Object} crawlOptions - Crawl options
   * @returns {Object} Effective configuration
   */
  getEffectiveConfig(startUrl, crawlOptions = {}) {
    try {
      const urlObj = new URL(startUrl);
      const domain = urlObj.hostname;
      const domainRules = this.getDomainRules(domain);
      
      return {
        domain,
        isAllowed: this.isAllowed(startUrl),
        domainRules,
        effectiveOptions: {
          maxDepth: crawlOptions.maxDepth ?? domainRules.maxDepth,
          maxPages: crawlOptions.maxPages ?? domainRules.maxPages,
          rateLimit: crawlOptions.rateLimit ?? domainRules.rateLimit,
          concurrency: crawlOptions.concurrency ?? domainRules.concurrency,
          timeout: crawlOptions.timeout ?? domainRules.timeout,
          respectRobots: crawlOptions.respectRobots ?? domainRules.respectRobots,
          customHeaders: { ...domainRules.customHeaders, ...(crawlOptions.customHeaders || {}) }
        }
      };
    } catch (error) {
      throw new Error(`Invalid start URL: ${error.message}`);
    }
  }
}

export default DomainFilter;