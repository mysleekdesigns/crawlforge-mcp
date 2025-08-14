# Security Documentation

## Overview

MCP WebScraper implements comprehensive security measures to protect against common web scraping vulnerabilities and ensure safe operation in production environments. This document provides detailed guidance on security features, configuration, and best practices.

## Table of Contents

1. [Security Overview](#security-overview)
2. [SSRF Protection](#ssrf-protection)
3. [Rate Limiting](#rate-limiting)
4. [Input Validation](#input-validation)
5. [Authentication & API Keys](#authentication--api-keys)
6. [robots.txt Compliance](#robotstxt-compliance)
7. [Data Privacy](#data-privacy)
8. [Network Security](#network-security)
9. [Resource Limits](#resource-limits)
10. [Security Best Practices](#security-best-practices)
11. [Reporting Security Issues](#reporting-security-issues)
12. [Security Checklist](#security-checklist)

## Security Overview

The MCP WebScraper employs defense-in-depth security principles with multiple layers of protection:

- **Input Sanitization**: All user inputs are validated and sanitized using Zod schemas and custom validators
- **SSRF Protection**: Comprehensive protection against Server-Side Request Forgery attacks
- **Rate Limiting**: Per-domain and global rate limiting to prevent abuse
- **Resource Limits**: Memory, CPU, and network resource constraints
- **Access Controls**: Robots.txt compliance and domain filtering
- **Secure Defaults**: Security-first configuration with safe defaults

### Why Security Matters in Web Scraping

Web scrapers are particularly vulnerable to security attacks because they:
- Fetch content from untrusted external sources
- Process user-provided URLs and selectors
- Can be exploited to attack internal systems (SSRF)
- May consume excessive resources if not properly limited

## SSRF Protection

Server-Side Request Forgery (SSRF) protection is critical for preventing attackers from using the scraper to access internal systems or sensitive endpoints.

### Built-in SSRF Protection

The `SSRFProtection` class provides comprehensive protection:

```javascript
import { SSRFProtection } from './src/utils/ssrfProtection.js';

const ssrfProtection = new SSRFProtection({
  // Blocked IP ranges (private networks, localhost, etc.)
  blockedIPRanges: [
    '127.0.0.0/8',     // Localhost
    '10.0.0.0/8',      // Private network
    '172.16.0.0/12',   // Private network
    '192.168.0.0/16',  // Private network
    '169.254.0.0/16',  // Link-local
    // ... and more
  ],
  
  // Blocked hostnames/domains
  blockedHostnames: [
    'localhost',
    'metadata.google.internal',
    '169.254.169.254',  // AWS/Azure metadata
    // ... and more
  ],
  
  // Blocked ports (SSH, databases, etc.)
  blockedPorts: [22, 23, 25, 53, 135, 139, 445, 1433, 3306, 5432, 6379, 27017],
  
  // Security limits
  maxRequestSize: 100 * 1024 * 1024, // 100MB
  maxTimeout: 60000, // 60 seconds
  maxRedirects: 5
});
```

### URL Validation Process

Every URL goes through a multi-stage validation process:

1. **Protocol Validation**: Only HTTP/HTTPS allowed by default
2. **Hostname Check**: Against blocklist of dangerous hostnames
3. **DNS Resolution**: Resolve hostname to IP and check against blocked ranges
4. **Port Validation**: Block dangerous ports (SSH, databases, etc.)
5. **Path Analysis**: Check for directory traversal patterns
6. **Length Limits**: Prevent excessively long URLs

### Example: Validating URLs

```javascript
// Validate a URL before scraping
const validation = await ssrfProtection.validateURL('https://example.com/page');

if (!validation.allowed) {
  console.error('URL blocked:', validation.violations);
  throw new Error(`Security violation: ${validation.violations[0].message}`);
}

// Use the sanitized URL for scraping
const safeUrl = validation.sanitizedURL;
```

### Advanced SSRF Protection

For production environments, consider additional protections:

```javascript
// Create a secure fetch wrapper
const secureFetch = ssrfProtection.createSecureFetch({
  allowedDomains: ['example.com', 'api.trusted-site.com'],
  maxRequestSize: 50 * 1024 * 1024 // 50MB limit
});

// Use secure fetch instead of regular fetch
const response = await secureFetch(url);
```

## Rate Limiting

Rate limiting prevents abuse and ensures fair resource usage across different domains and users.

### Per-Domain Rate Limiting

The `RateLimiter` class implements per-domain limits:

```javascript
import { RateLimiter } from './src/utils/rateLimiter.js';

const rateLimiter = new RateLimiter({
  requestsPerSecond: 10,    // Max 10 requests per second per domain
  requestsPerMinute: 100,   // Max 100 requests per minute per domain
  perDomain: true           // Enable per-domain limiting
});

// Check rate limit before making request
await rateLimiter.checkLimit('https://example.com/page');
```

### Environment Configuration

Configure rate limits via environment variables:

```bash
# .env file
RATE_LIMIT_REQUESTS_PER_SECOND=10
RATE_LIMIT_REQUESTS_PER_MINUTE=100
MAX_CONCURRENT_REQUESTS=50
```

### Circuit Breaker Pattern

The system includes circuit breaker functionality to handle failing services:

```javascript
import { CircuitBreaker } from './src/utils/rateLimiter.js';

const circuitBreaker = new CircuitBreaker({
  threshold: 5,        // Open after 5 failures
  timeout: 60000,      // 60 second timeout
  resetTimeout: 120000 // 2 minute reset timeout
});

// Execute with circuit breaker protection
const result = await circuitBreaker.execute('example.com', async () => {
  return await fetch(url);
});
```

## Input Validation

All user inputs are rigorously validated and sanitized to prevent injection attacks.

### Validation Categories

The `InputValidator` class handles multiple input types:

```javascript
import { InputValidator } from './src/utils/inputValidation.js';

const validator = new InputValidator({
  maxStringLength: 10000,
  maxArrayLength: 1000,
  maxObjectDepth: 10
});
```

### URL Validation

```javascript
const urlValidation = validator.validateURL('https://example.com/search?q=test');

if (!urlValidation.isValid) {
  console.error('Invalid URL:', urlValidation.violations);
  throw new Error('Invalid URL provided');
}

const safeUrl = urlValidation.sanitizedValue;
```

### CSS Selector Validation

Prevents CSS injection attacks in selector parameters:

```javascript
const selectorValidation = validator.validateCSSSelector('.content > p');

if (!selectorValidation.isValid) {
  console.error('Dangerous selector:', selectorValidation.violations);
  throw new Error('Invalid CSS selector');
}
```

### Search Query Validation

Protects against injection in search queries:

```javascript
const queryValidation = validator.validateSearchQuery('web scraping security');

if (!queryValidation.isValid) {
  console.error('Suspicious query:', queryValidation.violations);
  throw new Error('Invalid search query');
}
```

### Security Pattern Detection

The validator automatically detects common attack patterns:

- **SQL Injection**: `SELECT`, `UNION`, `DROP`, etc.
- **XSS Attempts**: `<script>`, `javascript:`, event handlers
- **Command Injection**: Shell metacharacters, `eval`, `exec`
- **Path Traversal**: `../`, `..\\`, encoded variations
- **ReDoS**: Regular expression denial of service patterns

## Authentication & API Keys

Secure handling of API credentials is crucial for production deployments.

### Environment Variable Security

Store sensitive credentials in environment variables:

```bash
# .env file
GOOGLE_API_KEY=your_actual_api_key_here
GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id
NODE_ENV=production
```

**Never commit `.env` files to version control!**

### API Key Validation

The system validates API keys before use:

```javascript
// In Google search adapter
if (!process.env.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY === 'test-key-123') {
  throw new Error('Invalid or missing Google API key');
}
```

### Production Security

For production deployments:

1. Use a secrets management service (AWS Secrets Manager, Azure Key Vault, etc.)
2. Rotate API keys regularly
3. Monitor API usage for anomalies
4. Set up API key restrictions in Google Cloud Console

```bash
# Example: Using AWS Secrets Manager
AWS_SECRET_NAME=mcp-webscraper/google-api
GOOGLE_API_KEY=$(aws secretsmanager get-secret-value --secret-id $AWS_SECRET_NAME --query SecretString --output text)
```

## robots.txt Compliance

Respecting website policies is both ethical and legally important.

### Built-in robots.txt Support

The `RobotsChecker` class automatically validates URLs against robots.txt:

```javascript
import { RobotsChecker } from './src/utils/robotsChecker.js';

const robotsChecker = new RobotsChecker('MCP-WebScraper/3.0');

// Check if scraping is allowed
const canScrape = await robotsChecker.canFetch('https://example.com/page');
if (!canScrape) {
  throw new Error('Scraping not allowed by robots.txt');
}

// Get crawl delay
const delay = robotsChecker.getCrawlDelay('https://example.com');
await new Promise(resolve => setTimeout(resolve, delay * 1000));
```

### Configuration

Enable/disable robots.txt checking:

```bash
# .env file
RESPECT_ROBOTS_TXT=true  # Set to false to disable (not recommended)
```

### Sitemap Discovery

The robots checker can also discover sitemaps:

```javascript
const sitemaps = robotsChecker.getSitemaps('https://example.com');
console.log('Available sitemaps:', sitemaps);
```

## Data Privacy

Protecting scraped data and user privacy is essential.

### Data Minimization

Only collect necessary data:

```javascript
// Good: Specific data extraction
const titleValidation = validator.validateCSSSelector('h1.title');
const title = extract(html, titleValidation.sanitizedValue);

// Avoid: Extracting entire pages unnecessarily
```

### Caching Security

The caching system includes privacy protections:

```javascript
const cacheManager = new CacheManager({
  // Don't cache sensitive content
  sensitivePatterns: [
    /login/i,
    /password/i,
    /email/i,
    /personal/i
  ],
  
  // Automatic cache expiration
  defaultTTL: 3600000, // 1 hour
  maxItems: 10000      // Limit cache size
});
```

### Content Sanitization

All scraped content is sanitized:

```javascript
import DOMPurify from 'isomorphic-dompurify';

// HTML content is automatically sanitized
const cleanHTML = DOMPurify.sanitize(htmlContent, {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'h1', 'h2', 'h3'],
  FORBID_SCRIPT: true,
  FORBID_IFRAME: true
});
```

## Network Security

Network-level security protections ensure safe communication.

### HTTPS Enforcement

The system prefers HTTPS connections:

```javascript
// URLs are upgraded to HTTPS when possible
if (url.startsWith('http://') && !options.allowInsecure) {
  const httpsUrl = url.replace('http://', 'https://');
  try {
    // Try HTTPS first
    const response = await fetch(httpsUrl);
    return response;
  } catch (error) {
    // Fall back to HTTP only if explicitly allowed
    if (options.fallbackToHttp) {
      return await fetch(url);
    }
    throw error;
  }
}
```

### Timeout Controls

All network requests have strict timeouts:

```javascript
const fetchOptions = {
  timeout: 30000,  // 30 second timeout
  signal: AbortSignal.timeout(30000),
  headers: {
    'User-Agent': 'MCP-WebScraper/3.0 (Security Enhanced)'
  }
};
```

### Connection Pooling

The `ConnectionPool` manages connections securely:

```javascript
const connectionPool = new ConnectionPool({
  maxConnections: 100,
  maxConnectionsPerHost: 10,
  timeout: 30000,
  keepAlive: true,
  keepAliveMsecs: 1000
});
```

## Resource Limits

Resource limits prevent denial of service and ensure system stability.

### Memory Limits

```javascript
// Memory monitoring and limits
const MEMORY_LIMIT = 512 * 1024 * 1024; // 512MB

function checkMemoryUsage() {
  const usage = process.memoryUsage();
  if (usage.heapUsed > MEMORY_LIMIT) {
    throw new Error('Memory limit exceeded');
  }
}
```

### Request Size Limits

```javascript
// Maximum response size
const MAX_RESPONSE_SIZE = 100 * 1024 * 1024; // 100MB

const response = await fetch(url);
const contentLength = response.headers.get('content-length');
if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
  throw new Error('Response too large');
}
```

### Concurrent Request Limits

```javascript
import PQueue from 'p-queue';

const queue = new PQueue({
  concurrency: 10,     // Max 10 concurrent requests
  interval: 1000,      // Rate limiting interval
  intervalCap: 50      // Max requests per interval
});
```

### Environment Configuration

```bash
# .env file
MAX_WORKERS=10
QUEUE_CONCURRENCY=10
MAX_PAGES_PER_CRAWL=100
MAX_CRAWL_DEPTH=5
MEMORY_LIMIT_MB=512
REQUEST_TIMEOUT_MS=30000
```

## Security Best Practices

### For Developers

1. **Input Validation**: Always validate and sanitize user inputs
2. **Error Handling**: Don't expose internal errors to users
3. **Logging**: Log security events but not sensitive data
4. **Updates**: Keep dependencies updated regularly
5. **Testing**: Include security tests in your test suite

```javascript
// Good: Secure error handling
try {
  const result = await scrapePage(url);
  return result;
} catch (error) {
  // Log internal error
  console.error('Scraping error:', error);
  
  // Return generic error to user
  throw new Error('Failed to scrape page');
}
```

### For Production Deployment

1. **Environment Variables**: Use secure credential storage
2. **Network Security**: Deploy behind a firewall/VPC
3. **Monitoring**: Set up security monitoring and alerting
4. **Access Control**: Implement authentication for API access
5. **Regular Audits**: Conduct regular security assessments

### Security Headers

When exposing the MCP server via HTTP, use security headers:

```javascript
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});
```

### Content Security Policy

```javascript
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; script-src 'none'; object-src 'none';"
  );
  next();
});
```

## Reporting Security Issues

We take security seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

1. **Email**: Send details to [security@example.com] (replace with actual email)
2. **Encrypted**: Use PGP key [key-id] for sensitive reports
3. **Details**: Include steps to reproduce and potential impact
4. **Responsible Disclosure**: Allow time for fixes before public disclosure

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Suggested fixes (if any)
- Your contact information

### Response Timeline

- **Initial Response**: Within 24 hours
- **Triage**: Within 72 hours
- **Fix Development**: Within 2 weeks
- **Public Disclosure**: After fix is deployed

### Hall of Fame

Security researchers who report valid vulnerabilities will be acknowledged (with permission) in our security hall of fame.

## Security Checklist

Use this checklist to ensure secure deployment and operation.

### Pre-Deployment Security Checklist

- [ ] **Environment Variables**
  - [ ] All sensitive data stored in environment variables
  - [ ] No hardcoded API keys in code
  - [ ] Production API keys are different from development
  - [ ] Environment variables are properly secured

- [ ] **Input Validation**
  - [ ] All user inputs validated with Zod schemas
  - [ ] Custom validation for URLs, selectors, queries
  - [ ] Input sanitization enabled
  - [ ] Length limits configured appropriately

- [ ] **SSRF Protection**
  - [ ] SSRF protection enabled
  - [ ] Blocked IP ranges configured
  - [ ] Blocked hostnames configured
  - [ ] Port blocking configured
  - [ ] Redirect limits set

- [ ] **Rate Limiting**
  - [ ] Per-domain rate limiting enabled
  - [ ] Global rate limits configured
  - [ ] Circuit breaker enabled
  - [ ] Rate limit values appropriate for use case

- [ ] **Resource Limits**
  - [ ] Memory limits configured
  - [ ] Request timeout limits set
  - [ ] Response size limits configured
  - [ ] Concurrency limits set
  - [ ] Queue size limits configured

- [ ] **Network Security**
  - [ ] HTTPS preferred/enforced
  - [ ] Secure user agent configured
  - [ ] Connection pooling configured
  - [ ] Timeout values appropriate

### Runtime Security Checklist

- [ ] **Monitoring**
  - [ ] Security violation logging enabled
  - [ ] Error monitoring configured
  - [ ] Performance monitoring active
  - [ ] Alert thresholds configured

- [ ] **Access Control**
  - [ ] robots.txt compliance enabled
  - [ ] Domain filtering configured (if needed)
  - [ ] API authentication implemented (if exposed)
  - [ ] Regular access review process

- [ ] **Data Protection**
  - [ ] Data retention policies defined
  - [ ] Sensitive data identification process
  - [ ] Cache expiration configured
  - [ ] Data encryption in transit/at rest

- [ ] **Maintenance**
  - [ ] Dependency update process
  - [ ] Security patch management
  - [ ] Regular security testing
  - [ ] Incident response plan

### Security Testing Checklist

- [ ] **Automated Tests**
  - [ ] SSRF protection tests
  - [ ] Input validation tests
  - [ ] Rate limiting tests
  - [ ] Error handling tests

- [ ] **Manual Testing**
  - [ ] Penetration testing conducted
  - [ ] Security code review completed
  - [ ] Configuration review performed
  - [ ] Incident response tested

- [ ] **Compliance**
  - [ ] Legal compliance verified
  - [ ] Privacy policy updated
  - [ ] Terms of service reviewed
  - [ ] Data protection requirements met

### Emergency Response Checklist

If a security incident occurs:

- [ ] **Immediate Response**
  - [ ] Assess scope and impact
  - [ ] Contain the incident
  - [ ] Preserve evidence
  - [ ] Notify stakeholders

- [ ] **Investigation**
  - [ ] Root cause analysis
  - [ ] Timeline reconstruction
  - [ ] Impact assessment
  - [ ] Documentation of findings

- [ ] **Recovery**
  - [ ] Apply security patches
  - [ ] Update configurations
  - [ ] Verify system integrity
  - [ ] Resume normal operations

- [ ] **Post-Incident**
  - [ ] Lessons learned documentation
  - [ ] Process improvements
  - [ ] Security control updates
  - [ ] Team training updates

---

## Configuration Examples

### Secure Production Configuration

```bash
# Production .env file
NODE_ENV=production
LOG_LEVEL=warn

# API Configuration
GOOGLE_API_KEY=${GOOGLE_API_KEY}  # From secrets manager
GOOGLE_SEARCH_ENGINE_ID=${GOOGLE_SEARCH_ENGINE_ID}

# Security Settings
RESPECT_ROBOTS_TXT=true
SSRF_PROTECTION_ENABLED=true
RATE_LIMITING_ENABLED=true
INPUT_VALIDATION_STRICT=true

# Resource Limits
MAX_WORKERS=5
QUEUE_CONCURRENCY=5
MEMORY_LIMIT_MB=256
REQUEST_TIMEOUT_MS=30000
MAX_PAGES_PER_CRAWL=50
MAX_CRAWL_DEPTH=3

# Rate Limiting
RATE_LIMIT_REQUESTS_PER_SECOND=5
RATE_LIMIT_REQUESTS_PER_MINUTE=50

# Cache Settings
CACHE_TTL=1800000  # 30 minutes
CACHE_MAX_SIZE=1000
```

### Development Configuration

```bash
# Development .env file
NODE_ENV=development
LOG_LEVEL=debug

# API Configuration (test keys)
GOOGLE_API_KEY=test-key-123
GOOGLE_SEARCH_ENGINE_ID=test-id-456

# More permissive settings for development
MAX_WORKERS=10
QUEUE_CONCURRENCY=10
RATE_LIMIT_REQUESTS_PER_SECOND=10
RATE_LIMIT_REQUESTS_PER_MINUTE=100
```

Remember: Security is not a one-time setup but an ongoing process. Regularly review and update your security measures as threats evolve and your system grows.