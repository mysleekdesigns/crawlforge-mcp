# Wave 3 Security Implementation

This directory contains critical security implementations for Wave 3 features of the MCP WebScraper project.

## 🚨 CRITICAL SECURITY ALERT

**DO NOT DEPLOY Wave 3 features to production without applying these security patches.**

Multiple critical vulnerabilities were identified during the security audit, including:
- Server-Side Request Forgery (SSRF)
- Remote Code Execution via Script Injection
- Arbitrary File System Access
- Data Injection Vulnerabilities

## Files Overview

### 1. `wave3-security.js`
Core security utilities and validation functions:
- SSRF Protection
- Path Traversal Prevention
- Input Sanitization
- Cryptographic Security
- Resource Management
- Browser Security Hardening

### 2. `security-patches.js`
Emergency patches for critical vulnerabilities:
- ResearchOrchestrator SSRF fix
- StealthBrowserManager security hardening
- SnapshotManager path traversal fix
- And more critical patches

### 3. `security-tests.js`
Comprehensive test suite to validate security implementations:
- SSRF protection tests
- Path traversal tests
- Input validation tests
- Cryptographic security tests
- Resource limit tests

## Quick Start

### Apply Emergency Patches

```javascript
import SecurityPatches from './src/security/security-patches.js';
import { ResearchOrchestrator } from './src/core/ResearchOrchestrator.js';
import { StealthBrowserManager } from './src/core/StealthBrowserManager.js';
import { SnapshotManager } from './src/core/SnapshotManager.js';

// Apply all patches before using Wave 3 features
SecurityPatches.applyAllSecurityPatches({
  ResearchOrchestrator,
  StealthBrowserManager,
  SnapshotManager
});
```

### Run Security Tests

```javascript
import SecurityTests from './src/security/security-tests.js';

// Run full security test suite
const results = await SecurityTests.runFullSecurityTests();

if (!results.allPassed) {
  console.error('🚨 Security tests failed! Do not deploy to production.');
  process.exit(1);
}
```

### Use Security Utilities

```javascript
import Wave3Security from './src/security/wave3-security.js';

// Validate URLs before making requests
try {
  const validUrl = Wave3Security.SSRFProtection.validateUrl(userProvidedUrl);
  // Safe to proceed
} catch (error) {
  console.error('Blocked malicious URL:', error.message);
}

// Sanitize file paths
const safePath = Wave3Security.PathSecurity.sanitizePath(userPath, baseDir);

// Validate and sanitize input
const safeInput = Wave3Security.InputSecurity.sanitizeString(userInput);
```

## Security Checklist

Before deploying Wave 3 features:

- [ ] Apply all security patches from `security-patches.js`
- [ ] Run full security test suite and ensure all tests pass
- [ ] Configure security settings in environment variables
- [ ] Set up proper access controls and authentication
- [ ] Enable security logging and monitoring
- [ ] Review and approve all Wave 3 configurations
- [ ] Conduct penetration testing
- [ ] Get security team sign-off

## Critical Vulnerabilities Fixed

### CVE-001: SSRF in Research Tool
**Fix:** URL validation and domain allowlist/blocklist
**Status:** ✅ PATCHED

### CVE-002: Script Injection in Browser Manager  
**Fix:** Input sanitization and secure script generation
**Status:** ✅ PATCHED

### CVE-003: Path Traversal in Snapshot Manager
**Fix:** Path validation and directory restrictions
**Status:** ✅ PATCHED

### CVE-004: SQL Injection in Change Tracker
**Fix:** Input validation and parameterized queries
**Status:** ✅ PATCHED

### CVE-005: Unsafe Deserialization
**Fix:** JSON validation and structure verification
**Status:** ✅ PATCHED

### CVE-006: Resource Exhaustion
**Fix:** Strict resource limits and rate limiting
**Status:** ✅ PATCHED

### CVE-007: Browser Security Bypass
**Fix:** Secure browser configuration and safe args
**Status:** ✅ PATCHED

### CVE-008: Information Disclosure
**Fix:** Secure error handling and log sanitization
**Status:** ✅ PATCHED

## Security Configuration

### Environment Variables

```bash
# Security Settings
SECURITY_SSRF_PROTECTION=true
SECURITY_MAX_CONTENT_SIZE=52428800  # 50MB
SECURITY_MAX_SNAPSHOT_SIZE=104857600 # 100MB
SECURITY_ALLOWED_DOMAINS="google.com,bing.com,wikipedia.org"
SECURITY_BLOCKED_DOMAINS="localhost,127.0.0.1,10.*,172.16.*,192.168.*"

# Rate Limiting
SECURITY_RATE_LIMIT_WINDOW=60000  # 1 minute
SECURITY_RATE_LIMIT_MAX=100       # requests per window

# Resource Limits
SECURITY_MAX_RESEARCH_URLS=50
SECURITY_MAX_RESEARCH_TIME=120000  # 2 minutes
SECURITY_MAX_CRAWL_DEPTH=5
```

### Browser Security Settings

```javascript
// Secure browser configuration
const secureConfig = {
  // Safe stealth settings
  level: 'medium', // Never use 'advanced'
  randomizeFingerprint: true,
  hideWebDriver: true,
  blockWebRTC: true,
  spoofTimezone: true,
  
  // Security restrictions
  disableSecurity: false,
  allowUnsafeInlineScripts: false,
  bypassCSP: false,
  
  // Use secure browser args only
  browserArgs: BrowserSecurity.getSecureBrowserArgs()
};
```

## Testing

### Run Security Tests

```bash
# Quick health check
node -e "
import('./src/security/security-tests.js').then(tests => {
  const healthy = tests.quickSecurityCheck();
  process.exit(healthy ? 0 : 1);
});
"

# Full security test suite
node -e "
import('./src/security/security-tests.js').then(async tests => {
  const results = await tests.runFullSecurityTests();
  process.exit(results.allPassed ? 0 : 1);
});
"
```

### Manual Testing

Test the security utilities manually:

```javascript
import Wave3Security from './src/security/wave3-security.js';

// Test SSRF protection
try {
  Wave3Security.SSRFProtection.validateUrl('http://localhost/admin');
  console.log('❌ SSRF protection failed');
} catch (error) {
  console.log('✅ SSRF protection working:', error.message);
}

// Test path traversal protection
try {
  Wave3Security.PathSecurity.validateSnapshotId('../../etc/passwd');
  console.log('❌ Path traversal protection failed');
} catch (error) {
  console.log('✅ Path traversal protection working:', error.message);
}
```

## Compliance

This security implementation addresses:

- **OWASP Top 10 2021** vulnerabilities
- **GDPR** data protection requirements
- **SOC 2** security controls
- **ISO 27001** security standards

## Support

For security questions or to report vulnerabilities:

- **Security Team:** security@mcp-webscraper.dev
- **Emergency Contact:** +1-XXX-XXX-XXXX
- **PGP Key:** [Available on request]

## License

This security implementation is provided under the same license as the main project.

---

**⚠️ SECURITY NOTICE:** These security measures are critical for safe operation. Do not disable or bypass any security checks in production environments.
