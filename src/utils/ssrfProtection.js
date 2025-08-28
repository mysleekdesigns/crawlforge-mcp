/**
 * SSRF Protection Module
 * Implements comprehensive Server-Side Request Forgery prevention measures
 */

import { promisify } from 'util';
import dns from 'dns';
import net from 'net';

const dnsLookup = promisify(dns.lookup);

/**
 * SSRF Protection Configuration
 */
const SSRF_CONFIG = {
  // Allowed protocols
  allowedProtocols: ['http:', 'https:'],
  
  // Blocked IP ranges (private networks, localhost, etc.)
  blockedIPRanges: [
    '127.0.0.0/8',     // Localhost
    '10.0.0.0/8',      // Private network
    '172.16.0.0/12',   // Private network
    '192.168.0.0/16',  // Private network
    '169.254.0.0/16',  // Link-local
    '224.0.0.0/4',     // Multicast
    '240.0.0.0/4',     // Reserved
    '0.0.0.0/8',       // This network
    '100.64.0.0/10',   // Carrier-grade NAT
    '198.18.0.0/15',   // Benchmark testing
    '::1/128',         // IPv6 localhost
    'fc00::/7',        // IPv6 private network
    'fe80::/10',       // IPv6 link-local
    'ff00::/8',        // IPv6 multicast
  ],
  
  // Blocked hostnames/domains
  blockedHostnames: [
    'localhost',
    'metadata.google.internal',  // GCP metadata
    'metadata.azure.com',       // Azure metadata
    'metadata',
    'consul',
    'vault',
  ],
  
  // Default ports to block
  blockedPorts: [
    22,    // SSH
    23,    // Telnet
    25,    // SMTP
    53,    // DNS
    135,   // RPC
    139,   // NetBIOS
    445,   // SMB
    1433,  // MSSQL
    1521,  // Oracle
    3306,  // MySQL
    3389,  // RDP
    5432,  // PostgreSQL
    5984,  // CouchDB
    6379,  // Redis
    8086,  // InfluxDB
    9200,  // Elasticsearch
    9300,  // Elasticsearch
    27017, // MongoDB
  ],
  
  // Maximum request size (bytes)
  maxRequestSize: 100 * 1024 * 1024, // 100MB
  
  // Maximum timeout (milliseconds)
  maxTimeout: 60000, // 60 seconds
  
  // Maximum redirects
  maxRedirects: 5,
};

/**
 * SSRF Protection Class
 */
export class SSRFProtection {
  constructor(options = {}) {
    this.config = { ...SSRF_CONFIG, ...options };
    this.cache = new Map(); // DNS resolution cache
    this.cacheMaxSize = 10000;
    this.cacheMaxAge = 300000; // 5 minutes
  }

  /**
   * Validate and sanitize URL for SSRF protection
   * @param {string} url - URL to validate
   * @param {Object} options - Validation options
   * @returns {Promise<Object>} - Validation result
   */
  async validateURL(url, options = {}) {
    try {
      // Check for path traversal in raw URL before URL parsing
      const rawPathTraversal = this.checkRawPathTraversal(url);
      
      const urlObj = new URL(url);
      const validationResult = {
        allowed: false,
        url: url,
        sanitizedURL: null,
        violations: [],
        metadata: {
          protocol: urlObj.protocol,
          hostname: urlObj.hostname,
          port: urlObj.port || this.getDefaultPort(urlObj.protocol),
          path: urlObj.pathname,
          validatedAt: new Date().toISOString()
        }
      };
      
      // Add raw path traversal violations
      if (rawPathTraversal.violations.length > 0) {
        validationResult.violations.push(...rawPathTraversal.violations);
      }
      // 1. Protocol validation
      if (!this.config.allowedProtocols.includes(urlObj.protocol)) {
        validationResult.violations.push({
          type: 'INVALID_PROTOCOL',
          message: `Protocol '${urlObj.protocol}' is not allowed`,
          severity: 'HIGH'
        });
        return validationResult;
      }

      // 2. Hostname validation
      const hostnameCheck = this.validateHostname(urlObj.hostname);
      if (!hostnameCheck.allowed) {
        validationResult.violations.push({
          type: 'BLOCKED_HOSTNAME',
          message: hostnameCheck.reason,
          severity: 'HIGH'
        });
        return validationResult;
      }

      // 3. Port validation
      const port = parseInt(urlObj.port) || this.getDefaultPort(urlObj.protocol);
      if (this.config.blockedPorts.includes(port)) {
        validationResult.violations.push({
          type: 'BLOCKED_PORT',
          message: `Port ${port} is blocked`,
          severity: 'HIGH'
        });
        return validationResult;
      }

      // 4. DNS resolution and IP validation
      const ipValidation = await this.validateIP(urlObj.hostname);
      if (!ipValidation.allowed) {
        validationResult.violations.push({
          type: 'BLOCKED_IP',
          message: ipValidation.reason,
          severity: 'HIGH'
        });
        validationResult.metadata.resolvedIPs = ipValidation.ips;
        return validationResult;
      }

      // 5. Path validation
      const pathValidation = this.validatePath(urlObj.pathname);
      if (!pathValidation.allowed) {
        validationResult.violations.push({
          type: 'SUSPICIOUS_PATH',
          message: pathValidation.reason,
          severity: 'MEDIUM'
        });
      }

      // 6. URL length validation
      if (url.length > 2048) {
        validationResult.violations.push({
          type: 'URL_TOO_LONG',
          message: 'URL exceeds maximum length',
          severity: 'MEDIUM'
        });
      }

      // If no high-severity violations, allow the request
      const highSeverityViolations = validationResult.violations.filter(v => v.severity === 'HIGH');
      validationResult.allowed = highSeverityViolations.length === 0;
      validationResult.sanitizedURL = this.sanitizeURL(urlObj);
      validationResult.metadata.resolvedIPs = ipValidation.ips;

      return validationResult;
    } catch (error) {
      return {
        allowed: false,
        url: url,
        violations: [{
          type: 'INVALID_URL',
          message: `Invalid URL format: ${error.message}`,
          severity: 'HIGH'
        }],
        metadata: {
          error: error.message,
          validatedAt: new Date().toISOString()
        }
      };
    }
  }

  /**
   * Validate hostname against blocked patterns
   * @param {string} hostname 
   * @returns {Object}
   */
  validateHostname(hostname) {
    const lowercaseHostname = hostname.toLowerCase();

    // Check exact matches
    if (this.config.blockedHostnames.includes(lowercaseHostname)) {
      return {
        allowed: false,
        reason: `Hostname '${hostname}' is explicitly blocked`
      };
    }

    // Check for suspicious patterns
    const suspiciousPatterns = [
      /^metadata/i,
      /^consul/i,
      /^vault/i,
      /^admin/i,
      /^internal/i,
      /\.local$/i,
      /\.internal$/i,
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(hostname)) {
        return {
          allowed: false,
          reason: `Hostname '${hostname}' matches blocked pattern`
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Resolve hostname to IP and validate against blocked ranges
   * @param {string} hostname 
   * @returns {Promise<Object>}
   */
  async validateIP(hostname) {
    try {
      // Check cache first
      const cacheKey = hostname.toLowerCase();
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheMaxAge) {
        return cached.result;
      }

      // Resolve hostname to IP
      const { address, family } = await dnsLookup(hostname, { family: 0 });
      const ips = Array.isArray(address) ? address : [address];

      // Validate each resolved IP
      for (const ip of ips) {
        if (!this.isIPAllowed(ip)) {
          const result = {
            allowed: false,
            reason: `Resolved IP '${ip}' is in blocked range`,
            ips: ips
          };
          this.cacheResult(cacheKey, result);
          return result;
        }
      }

      const result = {
        allowed: true,
        ips: ips
      };
      this.cacheResult(cacheKey, result);
      return result;

    } catch (error) {
      // DNS resolution failed - could be suspicious
      return {
        allowed: false,
        reason: `DNS resolution failed: ${error.message}`,
        ips: []
      };
    }
  }

  /**
   * Check if IP address is in blocked ranges
   * @param {string} ip 
   * @returns {boolean}
   */
  isIPAllowed(ip) {
    // Direct IP checks for common blocked addresses
    if (ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0') {
      return false;
    }

    // Check against CIDR ranges
    for (const range of this.config.blockedIPRanges) {
      if (this.isIPInRange(ip, range)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if IP is in CIDR range
   * @param {string} ip 
   * @param {string} cidr 
   * @returns {boolean}
   */
  isIPInRange(ip, cidr) {
    try {
      const [network, prefixLength] = cidr.split('/');
      const prefix = parseInt(prefixLength);

      if (net.isIPv4(ip) && net.isIPv4(network)) {
        return this.isIPv4InRange(ip, network, prefix);
      } else if (net.isIPv6(ip) && net.isIPv6(network)) {
        return this.isIPv6InRange(ip, network, prefix);
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if IPv4 address is in range
   * @param {string} ip 
   * @param {string} network 
   * @param {number} prefix 
   * @returns {boolean}
   */
  isIPv4InRange(ip, network, prefix) {
    const ipInt = this.ipv4ToInt(ip);
    const networkInt = this.ipv4ToInt(network);
    const mask = (0xffffffff << (32 - prefix)) >>> 0;

    return (ipInt & mask) === (networkInt & mask);
  }

  /**
   * Convert IPv4 to integer
   * @param {string} ip 
   * @returns {number}
   */
  ipv4ToInt(ip) {
    const parts = ip.split('.');
    return (parseInt(parts[0]) << 24) + 
           (parseInt(parts[1]) << 16) + 
           (parseInt(parts[2]) << 8) + 
           parseInt(parts[3]);
  }

  /**
   * Check if IPv6 address is in range (simplified)
   * @param {string} ip 
   * @param {string} network 
   * @param {number} prefix 
   * @returns {boolean}
   */
  isIPv6InRange(ip, network, prefix) {
    try {
      // Normalize IPv6 addresses by expanding compressed notation
      const normalizeIPv6 = (ipv6) => {
        // Handle :: compression
        if (ipv6.includes("::")) {
          const parts = ipv6.split("::");
          const leftParts = parts[0] ? parts[0].split(":") : [];
          const rightParts = parts[1] ? parts[1].split(":") : [];
          const missingParts = 8 - leftParts.length - rightParts.length;
          const middleParts = Array(missingParts).fill("0000");
          const allParts = [...leftParts, ...middleParts, ...rightParts];
          return allParts.map(part => part.padStart(4, "0")).join(":");
        } else {
          return ipv6.split(":").map(part => part.padStart(4, "0")).join(":");
        }
      };

      const normalizedIP = normalizeIPv6(ip);
      const normalizedNetwork = normalizeIPv6(network);
      
      // Convert to binary for precise comparison
      const ipBinary = normalizedIP.split(":").map(hex => 
        parseInt(hex, 16).toString(2).padStart(16, "0")
      ).join("");
      
      const networkBinary = normalizedNetwork.split(":").map(hex => 
        parseInt(hex, 16).toString(2).padStart(16, "0")
      ).join("");
      
      // Compare only the prefix bits
      for (let i = 0; i < prefix; i++) {
        if (ipBinary[i] !== networkBinary[i]) {
          return false;
        }
      }

      return true;
    } catch (error) {
      // If IPv6 parsing fails, be conservative and return false
      console.warn("IPv6 range check failed for", ip, "vs", network, error.message);
      return false;
    }
  }
  /**

  /**
   * Check for path traversal patterns in raw URL before parsing
   * @param {string} url - Raw URL to check
   * @returns {Object} - Result with violations array
   */
   * Validate URL path for suspicious patterns
  /**
   * Check for path traversal patterns in raw URL before parsing
   * @param {string} url - Raw URL to check
   * @returns {Object} - Result with violations array
   */
  checkRawPathTraversal(url) {
    const violations = [];
    
    // Path traversal patterns to check before URL normalization
    const pathTraversalPatterns = [
      /\.\.\//g, // Basic path traversal ../
      /\.\.\\/g, // Windows path traversal ..\
      /%2e%2e%2f/gi, // URL encoded ../
      /%2e%2e%5c/gi, // URL encoded ..\
      /%2e%2e/gi, // URL encoded ..
      /\.\.%2f/gi, // Mixed encoding
      /\.\.%5c/gi, // Mixed encoding
    ];
    
    for (const pattern of pathTraversalPatterns) {
      if (pattern.test(url)) {
        violations.push({
          type: "SUSPICIOUS_PATH",
          message: `URL contains path traversal pattern: ${pattern}`,
          severity: "HIGH"
        });
        break; // Only report one path traversal violation
      }
    }
    
    return { violations };
  }
   * @param {string} path 
   * @returns {Object}
   */  validatePath(path) {
    const suspiciousPatterns = [
      /\.\.\//, // Directory traversal
      /\/etc\//, // System files
      /\/proc\//, // System files
      /\/sys\//, // System files
      /\/dev\//, // Device files
      /\/tmp\//, // Temporary files
      /\/var\/log/, // Log files
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(path)) {
        return {
          allowed: false,
          reason: `Path contains suspicious pattern: ${pattern}`
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Sanitize URL by removing potentially dangerous parts
   * @param {URL} urlObj 
   * @returns {string}
   */
  sanitizeURL(urlObj) {
    const sanitized = new URL(urlObj.toString());
    
    // Remove authentication info
    sanitized.username = '';
    sanitized.password = '';
    
    // Remove fragment
    sanitized.hash = '';
    
    return sanitized.toString();
  }

  /**
   * Get default port for protocol
   * @param {string} protocol 
   * @returns {number}
   */
  getDefaultPort(protocol) {
    switch (protocol) {
      case 'http:': return 80;
      case 'https:': return 443;
      case 'ftp:': return 21;
      default: return 80;
    }
  }

  /**
   * Cache DNS resolution result
   * @param {string} key 
   * @param {Object} result 
   */
  cacheResult(key, result) {
    if (this.cache.size >= this.cacheMaxSize) {
      // Remove oldest entry
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now()
    });
  }

  /**
   * Create secure fetch wrapper with SSRF protection
   * @param {Object} options 
   * @returns {Function}
   */
  createSecureFetch(options = {}) {
    const { allowedDomains = [], maxRequestSize = this.config.maxRequestSize } = options;

    return async (url, fetchOptions = {}) => {
      // Validate URL
      const validation = await this.validateURL(url);
      if (!validation.allowed) {
        const violations = validation.violations.map(v => v.message).join(', ');
        throw new Error(`SSRF Protection: ${violations}`);
      }

      // Check domain whitelist if provided
      if (allowedDomains.length > 0) {
        const urlObj = new URL(validation.sanitizedURL);
        const isAllowed = allowedDomains.some(domain => 
          urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain)
        );
        
        if (!isAllowed) {
          throw new Error(`SSRF Protection: Domain not in whitelist`);
        }
      }

      // Set secure defaults
      const secureOptions = {
        ...fetchOptions,
        timeout: Math.min(fetchOptions.timeout || 30000, this.config.maxTimeout),
        redirect: 'manual', // Handle redirects manually
        headers: {
          'User-Agent': 'CrawlForge/3.0 (Security Enhanced)',
          ...fetchOptions.headers
        }
      };

      // Perform the request
      let response;
      let redirectCount = 0;
      let currentUrl = validation.sanitizedURL;

      while (redirectCount <= this.config.maxRedirects) {
        response = await fetch(currentUrl, secureOptions);

        // Check response size
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > maxRequestSize) {
          throw new Error('SSRF Protection: Response size exceeds limit');
        }

        // Handle redirects manually
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) {
            break;
          }

          // Validate redirect URL
          const redirectValidation = await this.validateURL(location);
          if (!redirectValidation.allowed) {
            throw new Error('SSRF Protection: Redirect to blocked URL');
          }

          currentUrl = redirectValidation.sanitizedURL;
          redirectCount++;
          continue;
        }

        break;
      }

      if (redirectCount > this.config.maxRedirects) {
        throw new Error('SSRF Protection: Too many redirects');
      }

      return response;
    };
  }

  /**
   * Get SSRF protection statistics
   * @returns {Object}
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      cacheMaxSize: this.cacheMaxSize,
      cacheMaxAge: this.cacheMaxAge,
      blockedRanges: this.config.blockedIPRanges.length,
      blockedHostnames: this.config.blockedHostnames.length,
      blockedPorts: this.config.blockedPorts.length,
      maxRequestSize: this.config.maxRequestSize,
      maxTimeout: this.config.maxTimeout,
      maxRedirects: this.config.maxRedirects
    };
  }

  /**
   * Clear DNS cache
   */
  clearCache() {
    this.cache.clear();
  }
}

export default SSRFProtection;
