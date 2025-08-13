/**
 * Security Middleware for MCP WebScraper
 * Integrates SSRF protection, input validation, and other security measures
 */

import { SSRFProtection } from './ssrfProtection.js';
import { InputValidator } from './inputValidation.js';
import { config } from '../constants/config.js';
import { Logger } from './Logger.js';

// Initialize security components
const ssrfProtection = new SSRFProtection({
  allowedProtocols: config.security.ssrfProtection.allowedProtocols,
  maxRequestSize: config.security.ssrfProtection.maxRequestSize,
  maxTimeout: config.security.ssrfProtection.maxTimeout,
  maxRedirects: config.security.ssrfProtection.maxRedirects,
  blockedHostnames: config.security.ssrfProtection.blockedDomains
});

const inputValidator = new InputValidator({
  maxStringLength: config.security.inputValidation.maxStringLength,
  maxArrayLength: config.security.inputValidation.maxArrayLength,
  maxObjectDepth: config.security.inputValidation.maxObjectDepth,
  maxRegexLength: config.security.inputValidation.maxRegexLength,
  allowedHTMLTags: config.security.contentSecurity.allowedHTMLTags
});

const logger = new Logger();

/**
 * Security middleware class for MCP tools
 */
export class SecurityMiddleware {
  constructor(options = {}) {
    this.ssrfProtection = ssrfProtection;
    this.inputValidator = inputValidator;
    this.logger = logger;
    this.config = config.security;
    this.violationStats = {
      totalViolations: 0,
      blockedRequests: 0,
      ssrfBlocked: 0,
      injectionBlocked: 0,
      validationErrors: 0
    };
  }

  /**
   * Validate URL parameter for SSRF protection
   * @param {string} url - URL to validate
   * @param {Object} context - Request context
   * @returns {Promise<Object>} - Validation result
   */
  async validateURL(url, context = {}) {
    if (!this.config.ssrfProtection.enabled) {
      return { allowed: true, sanitizedURL: url };
    }

    try {
      const result = await this.ssrfProtection.validateURL(url);
      
      if (!result.allowed) {
        this.violationStats.ssrfBlocked++;
        this.violationStats.blockedRequests++;
        
        this.logSecurityViolation('SSRF_BLOCKED', {
          url,
          violations: result.violations,
          context
        });
      }

      return {
        allowed: result.allowed,
        sanitizedURL: result.sanitizedURL || url,
        violations: result.violations
      };
    } catch (error) {
      this.logger.error('SSRF validation error:', error);
      return { allowed: false, error: error.message };
    }
  }

  /**
   * Validate search query parameters
   * @param {string} query - Search query to validate
   * @param {Object} context - Request context
   * @returns {Object} - Validation result
   */
  validateSearchQuery(query, context = {}) {
    if (!this.config.inputValidation.enabled) {
      return { isValid: true, sanitizedValue: query };
    }

    try {
      const result = this.inputValidator.validateSearchQuery(query);
      
      if (!result.isValid) {
        this.violationStats.injectionBlocked++;
        this.violationStats.blockedRequests++;
        
        this.logSecurityViolation('INJECTION_BLOCKED', {
          query,
          violations: result.violations,
          context
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Query validation error:', error);
      this.violationStats.validationErrors++;
      return { isValid: false, error: error.message };
    }
  }

  /**
   * Validate CSS selector parameters
   * @param {string} selector - CSS selector to validate
   * @param {Object} context - Request context
   * @returns {Object} - Validation result
   */
  validateCSSSelector(selector, context = {}) {
    if (!this.config.inputValidation.enabled) {
      return { isValid: true, sanitizedValue: selector };
    }

    try {
      const result = this.inputValidator.validateCSSSelector(selector);
      
      if (!result.isValid) {
        this.violationStats.injectionBlocked++;
        this.violationStats.blockedRequests++;
        
        this.logSecurityViolation('CSS_INJECTION_BLOCKED', {
          selector,
          violations: result.violations,
          context
        });
      }

      return result;
    } catch (error) {
      this.logger.error('CSS validation error:', error);
      this.violationStats.validationErrors++;
      return { isValid: false, error: error.message };
    }
  }

  /**
   * Validate object parameters
   * @param {Object} obj - Object to validate
   * @param {Object} context - Request context
   * @returns {Object} - Validation result
   */
  validateObject(obj, context = {}) {
    if (!this.config.inputValidation.enabled) {
      return { isValid: true, sanitizedValue: obj };
    }

    try {
      const result = this.inputValidator.validateObject(obj);
      
      if (!result.isValid) {
        this.violationStats.validationErrors++;
        
        this.logSecurityViolation('OBJECT_VALIDATION_FAILED', {
          objectKeys: Object.keys(obj || {}),
          violations: result.violations,
          context
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Object validation error:', error);
      this.violationStats.validationErrors++;
      return { isValid: false, error: error.message };
    }
  }

  /**
   * Validate HTML content
   * @param {string} html - HTML content to validate
   * @param {Object} context - Request context
   * @returns {Object} - Validation result
   */
  validateHTML(html, context = {}) {
    if (!this.config.contentSecurity.sanitizeHTML) {
      return { isValid: true, sanitizedValue: html };
    }

    try {
      const result = this.inputValidator.validateHTML(html);
      
      if (!result.isValid) {
        this.violationStats.injectionBlocked++;
        
        this.logSecurityViolation('HTML_XSS_BLOCKED', {
          htmlLength: html.length,
          violations: result.violations,
          context
        });
      }

      return result;
    } catch (error) {
      this.logger.error('HTML validation error:', error);
      this.violationStats.validationErrors++;
      return { isValid: false, error: error.message };
    }
  }

  /**
   * Create secure fetch function with SSRF protection
   * @param {Object} options - Fetch options
   * @returns {Function} - Secure fetch function
   */
  createSecureFetch(options = {}) {
    return this.ssrfProtection.createSecureFetch({
      allowedDomains: this.config.ssrfProtection.allowedDomains,
      maxRequestSize: this.config.ssrfProtection.maxRequestSize,
      ...options
    });
  }

  /**
   * Validate tool parameters based on schema
   * @param {Object} params - Tool parameters
   * @param {string} toolName - Name of the tool
   * @returns {Promise<Object>} - Validation result
   */
  async validateToolParameters(params, toolName) {
    const results = {
      isValid: true,
      violations: [],
      sanitizedParams: { ...params }
    };

    const context = { toolName, timestamp: new Date().toISOString() };

    // URL validation for tools that accept URLs
    if (params.url) {
      const urlResult = await this.validateURL(params.url, context);
      if (!urlResult.allowed) {
        results.isValid = false;
        results.violations.push(...(urlResult.violations || []));
      } else {
        results.sanitizedParams.url = urlResult.sanitizedURL;
      }
    }

    // Search query validation
    if (params.query) {
      const queryResult = this.validateSearchQuery(params.query, context);
      if (!queryResult.isValid) {
        results.isValid = false;
        results.violations.push(...(queryResult.violations || []));
      } else {
        results.sanitizedParams.query = queryResult.sanitizedValue;
      }
    }

    // CSS selectors validation
    if (params.selectors) {
      for (const [key, selector] of Object.entries(params.selectors)) {
        const selectorResult = this.validateCSSSelector(selector, context);
        if (!selectorResult.isValid) {
          results.isValid = false;
          results.violations.push(...(selectorResult.violations || []));
        } else {
          results.sanitizedParams.selectors[key] = selectorResult.sanitizedValue;
        }
      }
    }

    // Object validation for complex parameters
    if (params.options && typeof params.options === 'object') {
      const objectResult = this.validateObject(params.options, context);
      if (!objectResult.isValid) {
        results.isValid = false;
        results.violations.push(...(objectResult.violations || []));
      } else {
        results.sanitizedParams.options = objectResult.sanitizedValue;
      }
    }

    // Validate arrays (like include_patterns, exclude_patterns)
    ['include_patterns', 'exclude_patterns'].forEach(paramName => {
      if (params[paramName] && Array.isArray(params[paramName])) {
        for (const pattern of params[paramName]) {
          if (typeof pattern === 'string') {
            const regexResult = this.inputValidator.validateRegex(pattern);
            if (!regexResult.isValid) {
              results.isValid = false;
              results.violations.push(...(regexResult.violations || []));
              this.logSecurityViolation('REGEX_VALIDATION_FAILED', {
                pattern,
                violations: regexResult.violations,
                context
              });
            }
          }
        }
      }
    });

    return results;
  }

  /**
   * Log security violations
   * @param {string} type - Violation type
   * @param {Object} details - Violation details
   */
  logSecurityViolation(type, details) {
    this.violationStats.totalViolations++;

    if (this.config.monitoring?.violationLogging !== false) {
      this.logger.warn('Security violation detected', {
        type,
        details,
        timestamp: new Date().toISOString(),
        severity: this.getViolationSeverity(details.violations)
      });
    }

    // Log high-severity violations to security log
    if (this.config.monitoring?.securityLogging !== false) {
      const severity = this.getViolationSeverity(details.violations);
      if (severity === 'HIGH') {
        this.logger.error('High-severity security violation', {
          type,
          details: {
            ...details,
            // Don't log full content for security
            input: details.query ? details.query.substring(0, 100) : undefined,
            url: details.url ? details.url.substring(0, 200) : undefined
          }
        });
      }
    }
  }

  /**
   * Get violation severity level
   * @param {Array} violations - Array of violations
   * @returns {string} - Severity level
   */
  getViolationSeverity(violations = []) {
    if (violations.some(v => v.severity === 'HIGH')) return 'HIGH';
    if (violations.some(v => v.severity === 'MEDIUM')) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Get security statistics
   * @returns {Object} - Security statistics
   */
  getSecurityStats() {
    return {
      violations: this.violationStats,
      ssrfStats: this.ssrfProtection.getStats(),
      validationStats: this.inputValidator.getStats(),
      configEnabled: {
        ssrfProtection: this.config.ssrfProtection.enabled,
        inputValidation: this.config.inputValidation.enabled,
        contentSecurity: this.config.contentSecurity.sanitizeHTML,
        auditLogging: this.config.apiSecurity.auditLogging
      }
    };
  }

  /**
   * Reset security statistics
   */
  resetStats() {
    this.violationStats = {
      totalViolations: 0,
      blockedRequests: 0,
      ssrfBlocked: 0,
      injectionBlocked: 0,
      validationErrors: 0
    };
    this.ssrfProtection.clearCache();
    this.inputValidator.clearViolationLog();
  }

  /**
   * Check if request should be authenticated
   * @param {Object} request - Request object
   * @returns {boolean} - Whether authentication is required
   */
  requiresAuthentication(request) {
    return this.config.apiSecurity.requireAuthentication;
  }

  /**
   * Validate API key
   * @param {string} apiKey - API key to validate
   * @returns {boolean} - Whether API key is valid
   */
  validateAPIKey(apiKey) {
    if (!this.config.apiSecurity.requireAuthentication) {
      return true;
    }

    return apiKey === this.config.apiSecurity.apiKey && 
           this.config.apiSecurity.apiKey.length > 0;
  }
}

// Export singleton instance
export const securityMiddleware = new SecurityMiddleware();

export default securityMiddleware;