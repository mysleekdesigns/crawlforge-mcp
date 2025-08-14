# Security Policy

## Overview

This document outlines the security measures, policies, and procedures for the MCP WebScraper project. We take security seriously and have implemented comprehensive measures to protect against common vulnerabilities.

## Automated Security Testing

### CI/CD Pipeline Security

Our continuous integration pipeline includes multiple layers of security testing:

#### 1. **Security Test Suite** (Every PR/Push)
- **SSRF Protection Tests**: Validates protection against Server-Side Request Forgery
- **Input Validation Tests**: Tests XSS, SQL injection, and command injection prevention
- **Rate Limiting Tests**: Ensures proper rate limiting implementation
- **DoS Protection Tests**: Validates protection against denial-of-service attacks
- **Regex DoS Tests**: Prevents ReDoS vulnerabilities in user-provided patterns

#### 2. **Dependency Security Scanning**
- **npm audit**: Automated vulnerability scanning of all dependencies
- **License compliance**: Checks for problematic licenses in dependencies
- **Outdated package detection**: Identifies packages that need security updates
- **Critical vulnerability blocking**: Automatically fails builds with critical vulnerabilities

#### 3. **Static Code Analysis**
- **CodeQL Analysis**: GitHub's semantic code analysis for security vulnerabilities
- **ESLint Security Rules**: Automated detection of insecure coding patterns
- **Secret Detection**: Scans for hardcoded secrets, API keys, and credentials
- **Security-focused linting**: Custom rules for common security anti-patterns

#### 4. **Container Security**
- **Trivy Scanning**: Comprehensive container vulnerability scanning
- **Base image security**: Regular updates to base Docker images
- **SARIF reporting**: Security findings uploaded to GitHub Security tab

### Automated Security Workflows

#### Daily Security Scans (`security.yml`)
- **Scheduled Execution**: Runs daily at 2 AM UTC
- **Comprehensive Scanning**: Full dependency, code, and container analysis
- **Manual Triggers**: On-demand security scans with configurable parameters
- **Automated Reporting**: Generates detailed security reports with actionable insights
- **Issue Creation**: Automatically creates GitHub issues for critical vulnerabilities

#### Security Thresholds
- **Critical vulnerabilities**: Build fails immediately
- **High severity (>3)**: Build fails if more than 3 high-severity issues found
- **Moderate/Low**: Warnings only, build continues

## Security Features

### SSRF Protection
- Blocks access to private IP ranges (RFC 1918)
- Prevents localhost/loopback access
- Blocks dangerous ports (SSH, databases, etc.)
- Validates URL schemes (only HTTP/HTTPS allowed)
- Prevents access to cloud metadata services
- Path traversal detection and prevention

### Input Validation
- SQL injection prevention
- XSS attack prevention
- Command injection protection
- CSS injection detection in selectors
- Regex DoS vulnerability detection
- Input length limits
- Object depth validation
- HTML sanitization using DOMPurify

### Rate Limiting
- Per-domain rate limiting
- Requests per second limits
- Requests per minute limits
- Configurable thresholds
- Statistics tracking

### Container Security
- Non-root user execution
- Minimal base images (Alpine Linux)
- Health checks implemented
- Resource limits enforced
- Security scanning integrated

## Reporting Security Vulnerabilities

### Responsible Disclosure

We encourage responsible disclosure of security vulnerabilities. If you discover a security issue:

1. **Do NOT** create a public GitHub issue
2. **Do NOT** disclose the vulnerability publicly until we've had a chance to address it
3. **Send details to**: [Insert security contact email]
4. **Include**: 
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Any proof-of-concept code (if applicable)

### Response Timeline

- **Initial Response**: Within 24 hours
- **Assessment**: Within 72 hours
- **Fix Development**: Based on severity (1-30 days)
- **Public Disclosure**: After fix is deployed and users can update

### Severity Classification

| Severity | Description | Response Time |
|----------|-------------|---------------|
| **Critical** | Remote code execution, data breach | 24 hours |
| **High** | Privilege escalation, data exposure | 72 hours |
| **Medium** | DoS, information disclosure | 1 week |
| **Low** | Minor security improvements | 2 weeks |

## Security Best Practices

### For Contributors

1. **Follow Secure Coding Guidelines**
   - Never hardcode secrets or credentials
   - Always validate and sanitize user inputs
   - Use parameterized queries for database operations
   - Implement proper error handling without information leakage

2. **Testing Requirements**
   - Add security tests for new features
   - Run `npm run test:security` before submitting PRs
   - Ensure all CI security checks pass

3. **Dependency Management**
   - Keep dependencies updated
   - Review security advisories for used packages
   - Use `npm audit fix` to address vulnerabilities
   - Avoid unnecessary dependencies

### For Users

1. **Environment Security**
   - Use environment variables for sensitive configuration
   - Never commit `.env` files with real credentials
   - Regularly rotate API keys and tokens
   - Use HTTPS for all web scraping targets when possible

2. **Deployment Security**
   - Run containers as non-root user
   - Use read-only filesystems where possible
   - Implement network policies and firewalls
   - Monitor logs for suspicious activity

3. **Configuration Security**
   - Enable rate limiting in production
   - Set appropriate resource limits
   - Configure proper logging levels
   - Use secure defaults

## Security Configuration

### Environment Variables

```bash
# Security Settings
RATE_LIMIT_ENABLED=true
RATE_LIMIT_REQUESTS_PER_SECOND=10
RATE_LIMIT_REQUESTS_PER_MINUTE=100

# SSRF Protection
SSRF_PROTECTION_ENABLED=true
BLOCKED_IP_RANGES="10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
BLOCKED_PORTS="22,3306,5432,6379,27017"

# Input Validation
INPUT_VALIDATION_ENABLED=true
MAX_INPUT_LENGTH=10000
MAX_OBJECT_DEPTH=10

# Logging
LOG_SECURITY_EVENTS=true
LOG_LEVEL=info
```

### Docker Security

```dockerfile
# Use specific versions for reproducibility
FROM node:18-alpine@sha256:...

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Set secure file permissions
COPY --chown=nodejs:nodejs . .

# Run as non-root
USER nodejs

# Health check for monitoring
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js || exit 1
```

## Incident Response

### Detection
- Automated security scanning alerts
- Log analysis and monitoring
- User reports and bug bounty submissions
- Dependency vulnerability notifications

### Response Process
1. **Assessment**: Evaluate severity and impact
2. **Containment**: Implement immediate mitigations
3. **Investigation**: Analyze root cause and scope
4. **Resolution**: Develop and deploy fixes
5. **Communication**: Notify affected users
6. **Post-mortem**: Document lessons learned

### Emergency Contacts
- **Security Team**: [Insert contact]
- **Development Lead**: [Insert contact]
- **DevOps/Infrastructure**: [Insert contact]

## Compliance and Standards

### Standards Followed
- **OWASP Top 10**: Protection against common web vulnerabilities
- **CWE Top 25**: Common weakness enumeration guidelines
- **NIST Cybersecurity Framework**: Risk management practices
- **SANS Secure Coding**: Secure development practices

### Regular Security Activities
- **Quarterly**: Security architecture review
- **Monthly**: Dependency vulnerability assessment
- **Weekly**: Security patch deployment
- **Daily**: Automated security scanning

## Security Training

### Required Reading
- [OWASP Secure Coding Practices](https://owasp.org/www-project-secure-coding-practices-quick-reference-guide/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Docker Security](https://docs.docker.com/engine/security/)

### Security Tools
- **npm audit**: Dependency vulnerability scanning
- **ESLint Security**: Static analysis security rules
- **CodeQL**: Semantic code analysis
- **Trivy**: Container vulnerability scanning
- **GitHub Security**: Integrated security features

---

**Last Updated**: [Current Date]
**Version**: 1.0
**Next Review**: [Date + 6 months]