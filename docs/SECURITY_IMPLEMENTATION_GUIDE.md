# Security Implementation Guide

This guide provides detailed instructions for implementing and maintaining security measures in the MCP WebScraper project.

## Overview

The MCP WebScraper now includes comprehensive security measures to protect against:
- Server-Side Request Forgery (SSRF) attacks
- Cross-Site Scripting (XSS) attacks
- SQL Injection attacks
- Command Injection attacks
- Regular Expression Denial of Service (ReDoS) attacks
- Denial of Service (DoS) attacks
- Input validation vulnerabilities

## Security Components

### 1. SSRF Protection (`src/utils/ssrfProtection.js`)

**Purpose:** Prevents malicious requests to internal services and sensitive endpoints.

**Features:**
- Validates URLs against private IP ranges
- Blocks dangerous protocols (file://, ftp://, etc.)
- Prevents access to cloud metadata services
- Validates DNS resolution
- Handles redirects securely
- Enforces request size and timeout limits

**Configuration:**
```javascript
const ssrfProtection = new SSRFProtection({
  allowedProtocols: ['http:', 'https:'],
  maxRequestSize: 100 * 1024 * 1024, // 100MB
  maxTimeout: 60000, // 60 seconds
  maxRedirects: 5
});
```

### 2. Input Validation (`src/utils/inputValidation.js`)

**Purpose:** Validates and sanitizes all user inputs to prevent injection attacks.

**Features:**
- SQL injection detection
- XSS pattern detection
- Command injection detection
- CSS selector validation
- Regular expression validation (ReDoS protection)
- HTML sanitization
- Object structure validation

**Usage:**
```javascript
const validator = new InputValidator();
const result = validator.validateSearchQuery(userInput);
if (!result.isValid) {
  throw new Error('Invalid input detected');
}
```

### 3. Security Middleware (`src/utils/securityMiddleware.js`)

**Purpose:** Integrates all security measures into a unified middleware system.

**Features:**
- Centralized security validation
- Security event logging
- Violation statistics
- Tool parameter validation
- API key authentication

## Implementation Steps

### Step 1: Update Dependencies

First, address the dependency vulnerabilities:

```bash
# Fix non-breaking vulnerabilities
npm audit fix

# For breaking changes (use with caution)
npm audit fix --force

# Update to latest secure versions
npm update
```

### Step 2: Configure Security Settings

Copy the security configuration template:

```bash
cp .env.security.example .env
```

Edit `.env` to configure security settings:

```bash
# Enable SSRF protection
SSRF_PROTECTION_ENABLED=true

# Enable input validation
INPUT_VALIDATION_ENABLED=true

# Enable API authentication (optional)
REQUIRE_AUTHENTICATION=true
API_KEY=your-secure-api-key-here

# Configure rate limiting
RATE_LIMIT_REQUESTS_PER_SECOND=5
RATE_LIMIT_REQUESTS_PER_MINUTE=50
```

### Step 3: Update Server Configuration

The security measures are now integrated into the configuration system. Update your server startup to include security validation:

```javascript
import { securityMiddleware } from './src/utils/securityMiddleware.js';

// Validate tool parameters before execution
server.tool("fetch_url", "Fetch content from a URL", schema, async (request) => {
  // Validate parameters for security
  const validation = await securityMiddleware.validateToolParameters(
    request.params, 
    'fetch_url'
  );
  
  if (!validation.isValid) {
    throw new Error(`Security validation failed: ${validation.violations.map(v => v.message).join(', ')}`);
  }
  
  // Use sanitized parameters
  const params = validation.sanitizedParams;
  // ... rest of tool implementation
});
```

### Step 4: Run Security Tests

Execute the security test suite to verify implementation:

```bash
# Run security tests
node tests/security/security-test-suite.js

# Run full test suite including security
npm test
```

### Step 5: Monitor Security Events

Set up security monitoring:

```javascript
import { securityMiddleware } from './src/utils/securityMiddleware.js';

// Get security statistics
const stats = securityMiddleware.getSecurityStats();
console.log('Security Stats:', stats);

// Monitor violations
setInterval(() => {
  const recentViolations = securityMiddleware.inputValidator.getRecentViolations(10);
  if (recentViolations.length > 0) {
    console.log('Recent security violations:', recentViolations);
  }
}, 60000); // Check every minute
```

## Security Best Practices

### 1. Principle of Least Privilege

- Only enable necessary protocols (http/https)
- Restrict crawling depth and page counts
- Limit request sizes and timeouts
- Use domain whitelists when possible

### 2. Defense in Depth

- Enable all security layers (SSRF + Input Validation + Rate Limiting)
- Use multiple validation techniques
- Log all security events
- Monitor for anomalies

### 3. Regular Security Maintenance

**Weekly:**
- Review security logs for unusual patterns
- Check dependency vulnerabilities: `npm audit`
- Monitor error rates and blocked requests

**Monthly:**
- Update dependencies: `npm update`
- Review and update security configurations
- Test security measures with penetration testing

**Quarterly:**
- Conduct comprehensive security audit
- Review and update security policies
- Update blocked IP ranges and domains

### 4. Secure Configuration

**Production Environment:**
```bash
NODE_ENV=production
SSRF_PROTECTION_ENABLED=true
INPUT_VALIDATION_ENABLED=true
STRICT_VALIDATION_MODE=true
REQUIRE_AUTHENTICATION=true
SECURITY_LOGGING=true
RATE_LIMIT_REQUESTS_PER_SECOND=2
RATE_LIMIT_REQUESTS_PER_MINUTE=20
MAX_CRAWL_DEPTH=2
MAX_PAGES_PER_CRAWL=25
```

**Development Environment:**
```bash
NODE_ENV=development
SSRF_PROTECTION_ENABLED=true
INPUT_VALIDATION_ENABLED=true
STRICT_VALIDATION_MODE=false
REQUIRE_AUTHENTICATION=false
SECURITY_LOGGING=true
RATE_LIMIT_REQUESTS_PER_SECOND=10
RATE_LIMIT_REQUESTS_PER_MINUTE=100
```

## Security Incident Response

### 1. Detection

Monitor for these indicators:
- High number of blocked requests
- SSRF attempt patterns
- Injection attack patterns
- Unusual traffic patterns
- Error rate spikes

### 2. Response Procedure

**Immediate Actions:**
1. Identify the attack source (IP, user agent, etc.)
2. Block the source if necessary
3. Assess the scope of the attack
4. Check logs for successful exploitation

**Investigation:**
1. Analyze security logs
2. Review violation patterns
3. Check system integrity
4. Identify potential data exposure

**Recovery:**
1. Patch any identified vulnerabilities
2. Update security configurations
3. Reset API keys if compromised
4. Notify stakeholders if required

### 3. Post-Incident

1. Document the incident
2. Update security measures
3. Conduct lessons learned review
4. Update response procedures

## Common Attack Patterns and Defenses

### 1. SSRF Attacks

**Attack Pattern:**
```
http://internal-service:8080/admin
http://169.254.169.254/latest/meta-data/
http://localhost:3000/../../etc/passwd
```

**Defense:**
- URL validation against private IPs
- Protocol restrictions
- Domain filtering
- DNS resolution validation

### 2. Injection Attacks

**SQL Injection:**
```
'; DROP TABLE users; --
' OR '1'='1
```

**XSS:**
```
<script>alert('XSS')</script>
<img onerror="alert(1)" src="x">
```

**Command Injection:**
```
; rm -rf /
| cat /etc/passwd
```

**Defense:**
- Input pattern detection
- Parameter sanitization
- Content Security Policy
- HTML sanitization

### 3. DoS Attacks

**Attack Pattern:**
- Large payloads
- Complex regex patterns
- Rapid request rates
- Deep object structures

**Defense:**
- Rate limiting
- Input size limits
- Regex complexity validation
- Request timeouts

## Troubleshooting

### Common Issues

**1. Legitimate URLs Blocked**
```bash
# Check SSRF configuration
echo $ALLOWED_DOMAINS
echo $BLOCKED_DOMAINS

# Review recent violations
node -e "
const { securityMiddleware } = require('./src/utils/securityMiddleware.js');
console.log(securityMiddleware.getSecurityStats());
"
```

**2. Performance Issues**
```bash
# Adjust rate limits
RATE_LIMIT_REQUESTS_PER_SECOND=10

# Optimize validation
STRICT_VALIDATION_MODE=false

# Check cache performance
node -e "
const { securityMiddleware } = require('./src/utils/securityMiddleware.js');
console.log(securityMiddleware.ssrfProtection.getStats());
"
```

**3. False Positives**
- Review validation patterns
- Adjust severity thresholds
- Whitelist known-good patterns
- Update security rules

### Debugging

Enable debug logging:
```bash
LOG_LEVEL=debug
SECURITY_LOGGING=true
VIOLATION_LOGGING=true
```

Check security logs:
```bash
tail -f logs/security.log
grep "Security violation" logs/app.log
```

## Integration with External Systems

### 1. Web Application Firewall (WAF)

Configure WAF rules to complement application-level security:
- Block known attack patterns
- Rate limit by IP
- Geo-blocking if needed
- Log all security events

### 2. SIEM Integration

Export security logs to SIEM:
```javascript
import { securityMiddleware } from './src/utils/securityMiddleware.js';

// Export security events
setInterval(() => {
  const stats = securityMiddleware.getSecurityStats();
  // Send to SIEM
  sendToSIEM(stats);
}, 300000); // Every 5 minutes
```

### 3. Monitoring and Alerting

Set up alerts for:
- High violation rates
- SSRF attempts
- Injection attacks
- System resource usage
- Error rates

## Future Security Enhancements

### Planned Improvements

1. **Advanced Threat Detection**
   - Machine learning-based anomaly detection
   - Behavioral analysis
   - Threat intelligence integration

2. **Enhanced Authentication**
   - JWT token support
   - OAuth 2.0 integration
   - Multi-factor authentication

3. **Additional Security Measures**
   - Content Security Policy headers
   - HTTP Strict Transport Security
   - Request signing/verification
   - API versioning and deprecation

### Security Roadmap

**Q1:** Basic security implementation (completed)
**Q2:** Advanced threat detection
**Q3:** Authentication enhancements
**Q4:** Compliance and audit features

## Compliance Considerations

### OWASP Top 10 Coverage

1. ✅ **Injection** - Input validation and sanitization
2. ✅ **Broken Authentication** - API key validation
3. ✅ **Sensitive Data Exposure** - Secure configuration
4. ✅ **XML External Entities (XXE)** - Input validation
5. ✅ **Broken Access Control** - Authorization checks
6. ✅ **Security Misconfiguration** - Secure defaults
7. ✅ **Cross-Site Scripting (XSS)** - HTML sanitization
8. ✅ **Insecure Deserialization** - Object validation
9. ✅ **Using Components with Known Vulnerabilities** - Dependency scanning
10. ✅ **Insufficient Logging & Monitoring** - Security event logging

### Regulatory Compliance

For organizations requiring compliance with regulations like GDPR, HIPAA, or SOX:
- Enable audit logging
- Implement data retention policies
- Add encryption for sensitive data
- Document security procedures
- Regular security assessments

---

**For questions or security concerns, please contact the security team or file an issue in the project repository.**