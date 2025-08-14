/**
 * Wave 3 Security Validation Utilities
 * Provides security validation, sanitization, and protection functions
 * for Wave 3 features in the MCP WebScraper project.
 */

import { z } from 'zod';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import path from 'path';
import { URL } from 'url';
import DOMPurify from 'isomorphic-dompurify';

// Security configuration
const SECURITY_CONFIG = {
  // SSRF Protection
  allowedDomains: [
    'google.com',
    'bing.com',
    'duckduckgo.com',
    'wikipedia.org',
    'archive.org',
    '*.edu',
    '*.gov'
  ],
  
  blockedDomains: [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '10.*',
    '172.16.*',
    '192.168.*',
    '169.254.*', // AWS metadata
    'metadata.google.internal'
  ],
  
  // Resource limits
  maxContentSize: 50 * 1024 * 1024, // 50MB
  maxSnapshotSize: 100 * 1024 * 1024, // 100MB  
  maxResearchUrls: 50,
  maxResearchTime: 120000, // 2 minutes
  
  // Path validation
  allowedDirectories: [
    './snapshots',
    './cache',
    './temp'
  ],
  
  // Content validation
  maxStringLength: 10000,
  maxArrayLength: 100,
  
  // Rate limiting
  defaultRateLimit: {
    windowMs: 60 * 1000, // 1 minute
    max: 100 // requests per window
  }
};

/**
 * SSRF Protection Functions
 */
export class SSRFProtection {
  static validateUrl(url) {
    try {
      const parsedUrl = new URL(url);
      
      // Check protocol
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Invalid protocol. Only HTTP and HTTPS are allowed.');
      }
      
      // Check for blocked domains
      const hostname = parsedUrl.hostname.toLowerCase();
      for (const blocked of SECURITY_CONFIG.blockedDomains) {
        if (blocked.includes('*')) {
          const pattern = blocked.replace('*', '.*');
          if (new RegExp(pattern).test(hostname)) {
            throw new Error(`Blocked domain: ${hostname}`);
          }
        } else if (hostname === blocked || hostname.endsWith(`.${blocked}`)) {
          throw new Error(`Blocked domain: ${hostname}`);
        }
      }
      
      // Check for allowed domains (if whitelist is used)
      if (SECURITY_CONFIG.allowedDomains.length > 0) {
        let isAllowed = false;
        for (const allowed of SECURITY_CONFIG.allowedDomains) {
          if (allowed.includes('*')) {
            const pattern = allowed.replace('*', '.*');
            if (new RegExp(pattern).test(hostname)) {
              isAllowed = true;
              break;
            }
          } else if (hostname === allowed || hostname.endsWith(`.${allowed}`)) {
            isAllowed = true;
            break;
          }
        }
        if (!isAllowed) {
          throw new Error(`Domain not in whitelist: ${hostname}`);
        }
      }
      
      // Check for IP addresses (basic check)
      const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
      if (ipPattern.test(hostname)) {
        throw new Error('Direct IP access not allowed');
      }
      
      return parsedUrl;
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error('Invalid URL format');
      }
      throw error;
    }
  }
  
  static async validateAndFetch(url, options = {}) {
    const validatedUrl = this.validateUrl(url);
    
    const fetchOptions = {
      timeout: options.timeout || 30000,
      headers: {
        'User-Agent': 'MCP-WebScraper/3.0 (Security-Hardened)',
        ...options.headers
      },
      ...options
    };
    
    // Remove sensitive headers
    delete fetchOptions.headers['Authorization'];
    delete fetchOptions.headers['Cookie'];
    
    return fetch(validatedUrl.toString(), fetchOptions);
  }
}

/**
 * Path Traversal Protection
 */
export class PathSecurity {
  static sanitizePath(userPath, baseDirectory) {
    // Normalize the path to resolve any .. or . components
    const normalizedPath = path.normalize(userPath);
    
    // Resolve the absolute path
    const absolutePath = path.resolve(baseDirectory, normalizedPath);
    const absoluteBase = path.resolve(baseDirectory);
    
    // Ensure the resolved path is within the base directory
    if (!absolutePath.startsWith(absoluteBase + path.sep) && absolutePath !== absoluteBase) {
      throw new Error('Path traversal detected');
    }
    
    return absolutePath;
  }
  
  static validateSnapshotId(snapshotId) {
    // Only allow alphanumeric characters and hyphens
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(snapshotId)) {
      throw new Error('Invalid snapshot ID format');
    }
    
    // Prevent path traversal attempts
    if (snapshotId.includes('..') || snapshotId.includes('/') || snapshotId.includes('\\')) {
      throw new Error('Invalid characters in snapshot ID');
    }
    
    return snapshotId;
  }
  
  static validateDirectory(directory) {
    const normalizedDir = path.normalize(directory);
    
    // Check against allowed directories
    for (const allowed of SECURITY_CONFIG.allowedDirectories) {
      const absoluteAllowed = path.resolve(allowed);
      const absoluteDir = path.resolve(normalizedDir);
      
      if (absoluteDir.startsWith(absoluteAllowed)) {
        return absoluteDir;
      }
    }
    
    throw new Error('Directory not allowed');
  }
}

/**
 * Input Validation and Sanitization
 */
export class InputSecurity {
  static sanitizeHtml(html) {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
      ALLOWED_ATTR: []
    });
  }
  
  static sanitizeString(str, maxLength = SECURITY_CONFIG.maxStringLength) {
    if (typeof str !== 'string') {
      throw new Error('Input must be a string');
    }
    
    if (str.length > maxLength) {
      throw new Error(`String too long. Maximum length is ${maxLength}`);
    }
    
    // Remove null bytes and control characters
    return str.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
  }
  
  static sanitizeArray(arr, maxLength = SECURITY_CONFIG.maxArrayLength) {
    if (!Array.isArray(arr)) {
      throw new Error('Input must be an array');
    }
    
    if (arr.length > maxLength) {
      throw new Error(`Array too long. Maximum length is ${maxLength}`);
    }
    
    return arr;
  }
  
  static validateContentSize(content) {
    const size = Buffer.byteLength(content, 'utf8');
    if (size > SECURITY_CONFIG.maxContentSize) {
      throw new Error(`Content too large: ${size} bytes (max: ${SECURITY_CONFIG.maxContentSize})`);
    }
    return size;
  }
  
  static sanitizeJavaScript(jsCode) {
    // Remove potentially dangerous patterns
    const dangerousPatterns = [
      /eval\s*\(/gi,
      /Function\s*\(/gi,
      /setTimeout\s*\(/gi,
      /setInterval\s*\(/gi,
      /document\.write/gi,
      /innerHTML/gi,
      /outerHTML/gi,
      /execScript/gi,
      /script:/gi,
      /javascript:/gi,
      /data:/gi,
      /vbscript:/gi
    ];
    
    let sanitized = jsCode;
    for (const pattern of dangerousPatterns) {
      if (pattern.test(sanitized)) {
        throw new Error('Dangerous JavaScript pattern detected');
      }
    }
    
    return sanitized;
  }
}

/**
 * Cryptographic Security
 */
export class CryptoSecurity {
  static generateSecureId(length = 32) {
    return randomBytes(length).toString('hex');
  }
  
  static generateSessionId() {
    return this.generateSecureId(16);
  }
  
  static hashContent(content, algorithm = 'sha256') {
    return createHash(algorithm).update(content).digest('hex');
  }
  
  static timingSafeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
      throw new Error('Both values must be strings');
    }
    
    if (a.length !== b.length) {
      return false;
    }
    
    const bufferA = Buffer.from(a);
    const bufferB = Buffer.from(b);
    
    return timingSafeEqual(bufferA, bufferB);
  }
  
  static generateWebhookSignature(payload, secret) {
    return createHash('sha256')
      .update(payload + secret)
      .digest('hex');
  }
  
  static validateWebhookSignature(payload, signature, secret) {
    const expectedSignature = this.generateWebhookSignature(payload, secret);
    return this.timingSafeCompare(signature, expectedSignature);
  }
}

/**
 * Resource Management Security
 */
export class ResourceSecurity {
  static validateResearchLimits(options) {
    const maxUrls = Math.min(options.maxUrls || 10, SECURITY_CONFIG.maxResearchUrls);
    const timeLimit = Math.min(options.timeLimit || 60000, SECURITY_CONFIG.maxResearchTime);
    const maxDepth = Math.min(Math.max(options.maxDepth || 3, 1), 5);
    
    return {
      maxUrls,
      timeLimit,
      maxDepth,
      concurrency: Math.min(options.concurrency || 3, 5)
    };
  }
  
  static validateSnapshotLimits(options) {
    return {
      maxSnapshots: Math.min(options.maxSnapshots || 100, 1000),
      maxAge: Math.max(options.maxAge || 86400000, 3600000), // Min 1 hour
      maxStorageSize: Math.min(options.maxStorageSize || 1073741824, 10737418240), // Max 10GB
      compressionThreshold: Math.max(options.compressionThreshold || 1024, 1024)
    };
  }
}

/**
 * Browser Security
 */
export class BrowserSecurity {
  static getSecureBrowserArgs() {
    return [
      // Security-focused args (remove dangerous ones from original)
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-plugins',
      '--disable-images', // Reduce attack surface
      '--disable-javascript-harmony-shipping',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-field-trial-config',
      '--disable-back-forward-cache',
      '--disable-hang-monitor',
      '--disable-prompt-on-repost',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--no-first-run',
      '--safebrowsing-disable-auto-update',
      '--password-store=basic',
      '--use-mock-keychain',
      
      // Security enhancements
      '--disable-file-system',
      '--disable-databases',
      '--disable-local-storage',
      '--disable-session-storage',
      '--disable-application-cache',
      '--disable-notifications',
      '--disable-geolocation',
      '--disable-microphone',
      '--disable-camera',
      
      // DO NOT include these dangerous args from original:
      // --no-sandbox (removes critical security boundary)
      // --disable-web-security (removes Same Origin Policy)
      // --disable-features=VizDisplayCompositor (removes security features)
    ];
  }
  
  static validateStealthConfig(config) {
    // Ensure stealth mode doesn't compromise security
    const secureConfig = {
      ...config,
      hideWebDriver: true, // This is fine
      blockWebRTC: true,   // This is fine for privacy
      spoofTimezone: true, // This is fine for privacy
      randomizeHeaders: true, // This is fine for privacy
      
      // Remove dangerous options
      disableSecurity: false,
      allowUnsafeInlineScripts: false,
      bypassCSP: false
    };
    
    return secureConfig;
  }
  
  static sanitizeInjectedScript(script) {
    // Validate that injected scripts don't contain dangerous patterns
    const dangerousPatterns = [
      /eval\(/gi,
      /Function\(/gi,
      /setTimeout\(/gi,
      /setInterval\(/gi,
      /XMLHttpRequest/gi,
      /fetch\(/gi,
      /import\(/gi,
      /require\(/gi
    ];
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(script)) {
        throw new Error('Dangerous script pattern detected');
      }
    }
    
    return script;
  }
}

/**
 * Validation Schemas for Wave 3 Components
 */
export const Wave3SecuritySchemas = {
  // Research Tool Security Schema
  researchRequest: z.object({
    topic: z.string().min(3).max(500).refine(val => !/<script/i.test(val), 'No script tags allowed'),
    maxDepth: z.number().min(1).max(5),
    maxUrls: z.number().min(1).max(50),
    timeLimit: z.number().min(30000).max(120000),
    concurrency: z.number().min(1).max(5)
  }),
  
  // Stealth Browser Security Schema  
  stealthConfig: z.object({
    level: z.enum(['basic', 'medium']), // Remove 'advanced' - too dangerous
    randomizeFingerprint: z.boolean(),
    hideWebDriver: z.boolean(),
    blockWebRTC: z.boolean(),
    spoofTimezone: z.boolean(),
    customUserAgent: z.string().max(500).optional(),
    customViewport: z.object({
      width: z.number().min(800).max(1920),
      height: z.number().min(600).max(1080)
    }).optional()
  }),
  
  // Localization Security Schema
  localizationConfig: z.object({
    countryCode: z.string().length(2).regex(/^[A-Z]{2}$/),
    language: z.string().max(10).regex(/^[a-z]{2}-[A-Z]{2}$/),
    timezone: z.string().max(50).regex(/^[A-Za-z_/]+$/),
    currency: z.string().length(3).regex(/^[A-Z]{3}$/)
  }),
  
  // Snapshot Security Schema
  snapshotRequest: z.object({
    url: z.string().url().refine(url => {
      try {
        SSRFProtection.validateUrl(url);
        return true;
      } catch {
        return false;
      }
    }, 'Invalid or blocked URL'),
    content: z.string().max(SECURITY_CONFIG.maxContentSize),
    snapshotId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional()
  }),
  
  // Change Tracking Security Schema
  changeTrackingRequest: z.object({
    url: z.string().url(),
    granularity: z.enum(['page', 'section', 'element', 'text']),
    customSelectors: z.array(z.string().max(100)).max(10).optional(),
    excludeSelectors: z.array(z.string().max(100)).max(20).optional()
  })
};

/**
 * Security Middleware Factory
 */
export class SecurityMiddleware {
  static rateLimiter(options = SECURITY_CONFIG.defaultRateLimit) {
    const requests = new Map();
    
    return (identifier) => {
      const now = Date.now();
      const windowStart = now - options.windowMs;
      
      // Clean old requests
      for (const [key, timestamps] of requests.entries()) {
        requests.set(key, timestamps.filter(time => time > windowStart));
      }
      
      // Check current requests
      const userRequests = requests.get(identifier) || [];
      if (userRequests.length >= options.max) {
        throw new Error('Rate limit exceeded');
      }
      
      // Add current request
      userRequests.push(now);
      requests.set(identifier, userRequests);
    };
  }
  
  static validateRequest(schema) {
    return (data) => {
      try {
        return schema.parse(data);
      } catch (error) {
        throw new Error(`Validation failed: ${error.message}`);
      }
    };
  }
  
  static auditLogger() {
    return (operation, details) => {
      const logEntry = {
        timestamp: new Date().toISOString(),
        operation,
        details: typeof details === 'object' ? JSON.stringify(details) : details,
        level: 'SECURITY'
      };
      
      console.log('[SECURITY AUDIT]', JSON.stringify(logEntry));
    };
  }
}

/**
 * Security Testing Utilities
 */
export class SecurityTesting {
  static generateMaliciousPayloads() {
    return {
      ssrf: [
        'http://localhost:3000/admin',
        'http://127.0.0.1:22',
        'http://169.254.169.254/latest/meta-data/',
        'file:///etc/passwd',
        'ftp://internal.server.com'
      ],
      
      pathTraversal: [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32\\config\\sam',
        '/etc/shadow',
        'C:\\Windows\\System32\\drivers\\etc\\hosts'
      ],
      
      xss: [
        '<script>alert("XSS")</script>',
        'javascript:alert("XSS")',
        '<img src="x" onerror="alert(\'XSS\')">',
        '<svg onload="alert(\'XSS\')"></svg>'
      ],
      
      injection: [
        "'; DROP TABLE users; --",
        '${7*7}',
        '#{7*7}',
        '{{7*7}}',
        '<%= 7*7 %>'
      ]
    };
  }
  
  static testSecurityFunction(securityFunction, maliciousPayloads) {
    const results = [];
    
    for (const payload of maliciousPayloads) {
      try {
        securityFunction(payload);
        results.push({ payload, blocked: false, error: null });
      } catch (error) {
        results.push({ payload, blocked: true, error: error.message });
      }
    }
    
    return results;
  }
}

/**
 * Emergency Security Patches
 */
export class EmergencyPatches {
  // Patch for ResearchOrchestrator SSRF vulnerability
  static patchResearchTool(researchTool) {
    const originalExecute = researchTool.execute;
    
    researchTool.execute = async function(params) {
      // Validate research limits
      const secureParams = ResourceSecurity.validateResearchLimits(params);
      
      // Validate topic for script injection
      secureParams.topic = InputSecurity.sanitizeString(params.topic, 500);
      
      return originalExecute.call(this, secureParams);
    };
  }
  
  // Patch for StealthBrowserManager script injection
  static patchBrowserManager(browserManager) {
    const originalCreateStealthContext = browserManager.createStealthContext;
    
    browserManager.createStealthContext = async function(config) {
      // Validate and secure the config
      const secureConfig = BrowserSecurity.validateStealthConfig(config);
      
      // Use secure browser args
      secureConfig.browserArgs = BrowserSecurity.getSecureBrowserArgs();
      
      return originalCreateStealthContext.call(this, secureConfig);
    };
  }
  
  // Patch for SnapshotManager path traversal
  static patchSnapshotManager(snapshotManager) {
    const originalStoreSnapshot = snapshotManager.storeSnapshot;
    
    snapshotManager.storeSnapshot = async function(url, content, metadata, options) {
      // Validate URL
      SSRFProtection.validateUrl(url);
      
      // Validate content size
      InputSecurity.validateContentSize(content);
      
      // Generate secure snapshot ID
      const snapshotId = CryptoSecurity.generateSecureId();
      
      return originalStoreSnapshot.call(this, url, content, metadata, { ...options, snapshotId });
    };
  }
}

// Export default security instance
export default {
  SSRFProtection,
  PathSecurity,
  InputSecurity,
  CryptoSecurity,
  ResourceSecurity,
  BrowserSecurity,
  Wave3SecuritySchemas,
  SecurityMiddleware,
  SecurityTesting,
  EmergencyPatches,
  SECURITY_CONFIG
};
