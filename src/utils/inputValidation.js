/**
 * Enhanced Input Validation and Sanitization Module
 * Provides comprehensive input validation, sanitization, and security checks
 */

import { z } from 'zod';
import DOMPurify from 'isomorphic-dompurify';

/**
 * Security patterns and rules
 */
const SECURITY_PATTERNS = {
  // SQL injection patterns
  sqlInjection: [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/i,
    /'[^']*'|"[^"]*"/g,
    /;\s*--/g,
    /\/\*[\s\S]*?\*\//g
  ],

  // XSS patterns
  xssPatterns: [
    /<script[^>]*>[\s\S]*?<\/script>/gi,
    /<iframe[^>]*>[\s\S]*?<\/iframe>/gi,
    /javascript:/gi,
    /vbscript:/gi,
    /onload\s*=/gi,
    /onerror\s*=/gi,
    /onclick\s*=/gi,
    /onmouseover\s*=/gi
  ],

  // Path traversal patterns
  pathTraversal: [
    /\.\.\//g,
    /\.\.\\g,
    /%2e%2e%2f/gi,
    /%2e%2e%5c/gi,
    /\.\.\%2f/gi,
    /\.\.\%5c/gi
  ],

  // Command injection patterns
  commandInjection: [
    /[;&|`$(){}[\]]/g,
    /\beval\b/gi,
    /\bexec\b/gi,
    /\bsystem\b/gi,
    /\bshell_exec\b/gi
  ],

  // CSS selector injection
  cssSelectorInjection: [
    /['"]/g,
    /\/\*/g,
    /\*\//g,
    /expression\s*\(/gi,
    /javascript\s*:/gi,
    /@import/gi
  ],

  // Regular expression DoS patterns
  redosPatterns: [
    /(a+)+$/,
    /(a|a)*$/,
    /a*a*$/,
    /(a|b)*a*a*a*a*a*a*c/
  ]
};

/**
 * Input validation configuration
 */
const VALIDATION_CONFIG = {
  maxStringLength: 10000,
  maxArrayLength: 1000,
  maxObjectDepth: 10,
  maxRegexLength: 500,
  allowedHTMLTags: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  allowedCSSProperties: ['color', 'font-size', 'font-weight', 'text-align'],
  maxFileSize: 100 * 1024 * 1024, // 100MB
  allowedFileTypes: ['pdf', 'txt', 'html', 'json', 'xml', 'csv']
};

/**
 * Enhanced Input Validator Class
 */
export class InputValidator {
  constructor(options = {}) {
    this.config = { ...VALIDATION_CONFIG, ...options };
    this.violationLog = [];
    this.maxViolationLogSize = 1000;
  }

  /**
   * Validate and sanitize URL input
   * @param {string} url - URL to validate
   * @param {Object} options - Validation options
   * @returns {Object} - Validation result
   */
  validateURL(url, options = {}) {
    const result = {
      isValid: false,
      sanitizedValue: null,
      violations: [],
      metadata: {}
    };

    try {
      // Basic format validation
      if (typeof url !== 'string' || url.length === 0) {
        result.violations.push({
          type: 'INVALID_FORMAT',
          message: 'URL must be a non-empty string',
          severity: 'HIGH'
        });
        return result;
      }

      // Length validation
      if (url.length > this.config.maxStringLength) {
        result.violations.push({
          type: 'EXCESSIVE_LENGTH',
          message: `URL exceeds maximum length of ${this.config.maxStringLength}`,
          severity: 'HIGH'
        });
        return result;
      }

      // URL format validation
      const urlObj = new URL(url);
      result.metadata.protocol = urlObj.protocol;
      result.metadata.hostname = urlObj.hostname;
      result.metadata.port = urlObj.port;

      // Protocol validation
      const allowedProtocols = options.allowedProtocols || ['http:', 'https:'];
      if (!allowedProtocols.includes(urlObj.protocol)) {
        result.violations.push({
          type: 'INVALID_PROTOCOL',
          message: `Protocol '${urlObj.protocol}' is not allowed`,
          severity: 'HIGH'
        });
        return result;
      }

      // Security pattern checks
      this.checkSecurityPatterns(url, result);

      // Path traversal check
      if (this.containsPathTraversal(urlObj.pathname)) {
        result.violations.push({
          type: 'PATH_TRAVERSAL',
          message: 'URL contains path traversal patterns',
          severity: 'HIGH'
        });
      }

      // Sanitize URL
      result.sanitizedValue = this.sanitizeURL(urlObj);
      result.isValid = result.violations.filter(v => v.severity === 'HIGH').length === 0;

    } catch (error) {
      result.violations.push({
        type: 'MALFORMED_URL',
        message: `Invalid URL format: ${error.message}`,
        severity: 'HIGH'
      });
    }

    this.logViolations(url, result.violations);
    return result;
  }

  /**
   * Validate CSS selector for injection attacks
   * @param {string} selector - CSS selector to validate
   * @returns {Object} - Validation result
   */
  validateCSSSelector(selector) {
    const result = {
      isValid: false,
      sanitizedValue: null,
      violations: []
    };

    if (typeof selector !== 'string') {
      result.violations.push({
        type: 'INVALID_TYPE',
        message: 'CSS selector must be a string',
        severity: 'HIGH'
      });
      return result;
    }

    // Length check
    if (selector.length > this.config.maxStringLength) {
      result.violations.push({
        type: 'EXCESSIVE_LENGTH',
        message: 'CSS selector too long',
        severity: 'HIGH'
      });
      return result;
    }

    // Check for CSS injection patterns
    for (const pattern of SECURITY_PATTERNS.cssSelectorInjection) {
      if (pattern.test(selector)) {
        result.violations.push({
          type: 'CSS_INJECTION',
          message: 'CSS selector contains potential injection patterns',
          severity: 'HIGH'
        });
        break;
      }
    }

    // Check for suspicious functions
    const suspiciousFunctions = ['expression', 'url', 'import', 'javascript'];
    for (const func of suspiciousFunctions) {
      if (selector.toLowerCase().includes(func)) {
        result.violations.push({
          type: 'SUSPICIOUS_FUNCTION',
          message: `CSS selector contains suspicious function: ${func}`,
          severity: 'MEDIUM'
        });
      }
    }

    // Validate selector syntax
    try {
      // Basic CSS selector validation
      if (typeof document !== 'undefined') {
        document.querySelector(selector);
      }
    } catch (error) {
      result.violations.push({
        type: 'INVALID_SYNTAX',
        message: `Invalid CSS selector syntax: ${error.message}`,
        severity: 'MEDIUM'
      });
    }

    result.sanitizedValue = this.sanitizeCSSSelector(selector);
    result.isValid = result.violations.filter(v => v.severity === 'HIGH').length === 0;

    this.logViolations(selector, result.violations);
    return result;
  }

  /**
   * Validate search query for injection attacks
   * @param {string} query - Search query to validate
   * @returns {Object} - Validation result
   */
  validateSearchQuery(query) {
    const result = {
      isValid: false,
      sanitizedValue: null,
      violations: []
    };

    if (typeof query !== 'string') {
      result.violations.push({
        type: 'INVALID_TYPE',
        message: 'Search query must be a string',
        severity: 'HIGH'
      });
      return result;
    }

    // Length check
    if (query.length > 1000) { // Search queries should be shorter
      result.violations.push({
        type: 'EXCESSIVE_LENGTH',
        message: 'Search query too long',
        severity: 'MEDIUM'
      });
    }

    // Check for SQL injection patterns
    this.checkSQLInjection(query, result);

    // Check for XSS patterns
    this.checkXSSPatterns(query, result);

    // Check for command injection
    this.checkCommandInjection(query, result);

    // Validate search operators
    const dangerousOperators = ['site:', 'filetype:', 'inurl:', 'intitle:'];
    const operatorCount = dangerousOperators.reduce((count, op) => {
      return count + (query.toLowerCase().split(op).length - 1);
    }, 0);

    if (operatorCount > 5) {
      result.violations.push({
        type: 'TOO_MANY_OPERATORS',
        message: 'Too many search operators',
        severity: 'MEDIUM'
      });
    }

    result.sanitizedValue = this.sanitizeSearchQuery(query);
    result.isValid = result.violations.filter(v => v.severity === 'HIGH').length === 0;

    this.logViolations(query, result.violations);
    return result;
  }

  /**
   * Validate regular expression for ReDoS attacks
   * @param {string} regex - Regular expression pattern
   * @returns {Object} - Validation result
   */
  validateRegex(regex) {
    const result = {
      isValid: false,
      sanitizedValue: null,
      violations: []
    };

    if (typeof regex !== 'string') {
      result.violations.push({
        type: 'INVALID_TYPE',
        message: 'Regex must be a string',
        severity: 'HIGH'
      });
      return result;
    }

    // Length check
    if (regex.length > this.config.maxRegexLength) {
      result.violations.push({
        type: 'EXCESSIVE_LENGTH',
        message: 'Regular expression too long',
        severity: 'HIGH'
      });
      return result;
    }

    // Check for ReDoS patterns
    for (const pattern of SECURITY_PATTERNS.redosPatterns) {
      if (pattern.test(regex)) {
        result.violations.push({
          type: 'REDOS_RISK',
          message: 'Regular expression may be vulnerable to ReDoS attacks',
          severity: 'HIGH'
        });
        break;
      }
    }

    // Check for complex quantifiers
    const complexQuantifiers = /(\*\+)|(\+\*)|(\*\*)|(\+\+)|(\?\?)/g;
    if (complexQuantifiers.test(regex)) {
      result.violations.push({
        type: 'COMPLEX_QUANTIFIERS',
        message: 'Regular expression contains complex quantifiers',
        severity: 'MEDIUM'
      });
    }

    // Validate regex syntax
    try {
      new RegExp(regex);
    } catch (error) {
      result.violations.push({
        type: 'INVALID_SYNTAX',
        message: `Invalid regular expression syntax: ${error.message}`,
        severity: 'HIGH'
      });
    }

    result.sanitizedValue = regex; // Don't modify regex patterns
    result.isValid = result.violations.filter(v => v.severity === 'HIGH').length === 0;

    this.logViolations(regex, result.violations);
    return result;
  }

  /**
   * Validate HTML content
   * @param {string} html - HTML content to validate
   * @returns {Object} - Validation result
   */
  validateHTML(html) {
    const result = {
      isValid: false,
      sanitizedValue: null,
      violations: []
    };

    if (typeof html !== 'string') {
      result.violations.push({
        type: 'INVALID_TYPE',
        message: 'HTML must be a string',
        severity: 'HIGH'
      });
      return result;
    }

    // Length check
    if (html.length > this.config.maxStringLength) {
      result.violations.push({
        type: 'EXCESSIVE_LENGTH',
        message: 'HTML content too long',
        severity: 'MEDIUM'
      });
    }

    // Check for XSS patterns
    this.checkXSSPatterns(html, result);

    // Sanitize HTML using DOMPurify
    result.sanitizedValue = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: this.config.allowedHTMLTags,
      ALLOWED_ATTR: ['class', 'id'],
      FORBID_SCRIPT: true,
      FORBID_IFRAME: true
    });

    result.isValid = result.violations.filter(v => v.severity === 'HIGH').length === 0;

    this.logViolations(html.substring(0, 100), result.violations);
    return result;
  }

  /**
   * Validate object structure and depth
   * @param {Object} obj - Object to validate
   * @param {Object} options - Validation options
   * @returns {Object} - Validation result
   */
  validateObject(obj, options = {}) {
    const result = {
      isValid: false,
      sanitizedValue: null,
      violations: []
    };

    if (typeof obj !== 'object' || obj === null) {
      result.violations.push({
        type: 'INVALID_TYPE',
        message: 'Input must be an object',
        severity: 'HIGH'
      });
      return result;
    }

    // Check object depth
    const depth = this.getObjectDepth(obj);
    if (depth > this.config.maxObjectDepth) {
      result.violations.push({
        type: 'EXCESSIVE_DEPTH',
        message: `Object depth exceeds maximum of ${this.config.maxObjectDepth}`,
        severity: 'HIGH'
      });
      return result;
    }

    // Check array lengths
    this.checkArrayLengths(obj, result);

    // Check string lengths
    this.checkStringLengths(obj, result);

    // Sanitize object
    result.sanitizedValue = this.sanitizeObject(obj);
    result.isValid = result.violations.filter(v => v.severity === 'HIGH').length === 0;

    return result;
  }

  /**
   * Check for security patterns in input
   * @param {string} input - Input to check
   * @param {Object} result - Result object to update
   */
  checkSecurityPatterns(input, result) {
    this.checkSQLInjection(input, result);
    this.checkXSSPatterns(input, result);
    this.checkCommandInjection(input, result);
  }

  /**
   * Check for SQL injection patterns
   * @param {string} input - Input to check
   * @param {Object} result - Result object to update
   */
  checkSQLInjection(input, result) {
    for (const pattern of SECURITY_PATTERNS.sqlInjection) {
      if (pattern.test(input)) {
        result.violations.push({
          type: 'SQL_INJECTION',
          message: 'Input contains potential SQL injection patterns',
          severity: 'HIGH'
        });
        break;
      }
    }
  }

  /**
   * Check for XSS patterns
   * @param {string} input - Input to check
   * @param {Object} result - Result object to update
   */
  checkXSSPatterns(input, result) {
    for (const pattern of SECURITY_PATTERNS.xssPatterns) {
      if (pattern.test(input)) {
        result.violations.push({
          type: 'XSS_ATTEMPT',
          message: 'Input contains potential XSS patterns',
          severity: 'HIGH'
        });
        break;
      }
    }
  }

  /**
   * Check for command injection patterns
   * @param {string} input - Input to check
   * @param {Object} result - Result object to update
   */
  checkCommandInjection(input, result) {
    for (const pattern of SECURITY_PATTERNS.commandInjection) {
      if (pattern.test(input)) {
        result.violations.push({
          type: 'COMMAND_INJECTION',
          message: 'Input contains potential command injection patterns',
          severity: 'HIGH'
        });
        break;
      }
    }
  }

  /**
   * Check for path traversal patterns
   * @param {string} path - Path to check
   * @returns {boolean}
   */
  containsPathTraversal(path) {
    return SECURITY_PATTERNS.pathTraversal.some(pattern => pattern.test(path));
  }

  /**
   * Sanitize URL object
   * @param {URL} urlObj - URL object to sanitize
   * @returns {string}
   */
  sanitizeURL(urlObj) {
    const sanitized = new URL(urlObj.toString());
    
    // Remove authentication info
    sanitized.username = '';
    sanitized.password = '';
    
    // Remove fragment for security
    sanitized.hash = '';
    
    return sanitized.toString();
  }

  /**
   * Sanitize CSS selector
   * @param {string} selector - CSS selector to sanitize
   * @returns {string}
   */
  sanitizeCSSSelector(selector) {
    return selector
      .replace(/['"]/g, '') // Remove quotes
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove comments
      .replace(/javascript:/gi, '') // Remove javascript:
      .replace(/expression\s*\(/gi, '') // Remove expression()
      .trim();
  }

  /**
   * Sanitize search query
   * @param {string} query - Search query to sanitize
   * @returns {string}
   */
  sanitizeSearchQuery(query) {
    return query
      .replace(/[<>&"']/g, '') // Remove HTML characters
      .replace(/[\r\n\t]/g, ' ') // Replace control characters with spaces
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()
      .substring(0, 1000); // Limit length
  }

  /**
   * Sanitize object recursively
   * @param {Object} obj - Object to sanitize
   * @returns {Object}
   */
  sanitizeObject(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.slice(0, this.config.maxArrayLength).map(item => this.sanitizeObject(item));
    }

    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        sanitized[key] = this.sanitizeString(value);
      } else if (typeof value === 'object') {
        sanitized[key] = this.sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Sanitize string value
   * @param {string} str - String to sanitize
   * @returns {string}
   */
  sanitizeString(str) {
    if (typeof str !== 'string') {
      return str;
    }

    return str
      .replace(/[\r\n\t]/g, ' ') // Replace control characters
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()
      .substring(0, this.config.maxStringLength);
  }

  /**
   * Get object depth
   * @param {Object} obj - Object to measure
   * @param {number} depth - Current depth
   * @returns {number}
   */
  getObjectDepth(obj, depth = 0) {
    if (typeof obj !== 'object' || obj === null || depth > this.config.maxObjectDepth) {
      return depth;
    }

    let maxDepth = depth;
    for (const value of Object.values(obj)) {
      if (typeof value === 'object' && value !== null) {
        maxDepth = Math.max(maxDepth, this.getObjectDepth(value, depth + 1));
      }
    }

    return maxDepth;
  }

  /**
   * Check array lengths in object
   * @param {Object} obj - Object to check
   * @param {Object} result - Result object to update
   */
  checkArrayLengths(obj, result) {
    for (const value of Object.values(obj)) {
      if (Array.isArray(value) && value.length > this.config.maxArrayLength) {
        result.violations.push({
          type: 'EXCESSIVE_ARRAY_LENGTH',
          message: `Array length exceeds maximum of ${this.config.maxArrayLength}`,
          severity: 'MEDIUM'
        });
      } else if (typeof value === 'object' && value !== null) {
        this.checkArrayLengths(value, result);
      }
    }
  }

  /**
   * Check string lengths in object
   * @param {Object} obj - Object to check
   * @param {Object} result - Result object to update
   */
  checkStringLengths(obj, result) {
    for (const value of Object.values(obj)) {
      if (typeof value === 'string' && value.length > this.config.maxStringLength) {
        result.violations.push({
          type: 'EXCESSIVE_STRING_LENGTH',
          message: `String length exceeds maximum of ${this.config.maxStringLength}`,
          severity: 'MEDIUM'
        });
      } else if (typeof value === 'object' && value !== null) {
        this.checkStringLengths(value, result);
      }
    }
  }

  /**
   * Log security violations
   * @param {string} input - Input that caused violations
   * @param {Array} violations - Array of violations
   */
  logViolations(input, violations) {
    if (violations.length > 0) {
      const logEntry = {
        timestamp: new Date().toISOString(),
        input: input.substring(0, 100), // Limit logged input
        violations: violations,
        severity: violations.reduce((max, v) => {
          const severities = { LOW: 1, MEDIUM: 2, HIGH: 3 };
          return Math.max(max, severities[v.severity] || 0);
        }, 0)
      };

      this.violationLog.push(logEntry);

      // Maintain log size
      if (this.violationLog.length > this.maxViolationLogSize) {
        this.violationLog.shift();
      }
    }
  }

  /**
   * Get validation statistics
   * @returns {Object}
   */
  getStats() {
    const totalViolations = this.violationLog.length;
    const violationsByType = {};
    const violationsBySeverity = { LOW: 0, MEDIUM: 0, HIGH: 0 };

    for (const entry of this.violationLog) {
      for (const violation of entry.violations) {
        violationsByType[violation.type] = (violationsByType[violation.type] || 0) + 1;
        violationsBySeverity[violation.severity]++;
      }
    }

    return {
      totalViolations,
      violationsByType,
      violationsBySeverity,
      logSize: this.violationLog.length,
      maxLogSize: this.maxViolationLogSize,
      config: this.config
    };
  }

  /**
   * Clear violation log
   */
  clearViolationLog() {
    this.violationLog = [];
  }

  /**
   * Get recent violations
   * @param {number} limit - Number of recent violations to return
   * @returns {Array}
   */
  getRecentViolations(limit = 10) {
    return this.violationLog.slice(-limit);
  }
}

export default InputValidator;