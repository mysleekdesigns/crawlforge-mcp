# Security Checklists

## Input Validation Checklist

- [ ] URL validation and sanitization
- [ ] Query parameter filtering
- [ ] Header injection prevention
- [ ] Path normalization
- [ ] Content-type validation
- [ ] Size limit enforcement
- [ ] Character encoding validation

## Authentication & Authorization

- [ ] API key protection
- [ ] Token validation
- [ ] Rate limiting per user/IP
- [ ] Access control verification
- [ ] Session management
- [ ] Credential storage security

## Data Protection

- [ ] Sensitive data encryption
- [ ] Secure data transmission (HTTPS)
- [ ] Data retention policies
- [ ] PII handling procedures
- [ ] Log sanitization
- [ ] Cache security

## Network Security

- [ ] SSRF prevention
- [ ] DNS rebinding protection
- [ ] IP allowlist/blocklist
- [ ] Timeout configurations
- [ ] Connection limits
- [ ] Protocol validation

## Dependency Security

- [ ] npm audit results clean
- [ ] Outdated package checks
- [ ] License compliance
- [ ] Known vulnerability scan
- [ ] Supply chain verification
- [ ] Dependency pinning

## Robots.txt Compliance

- [ ] Parse and respect robots.txt
- [ ] Honor Crawl-delay directive
- [ ] Respect Disallow rules
- [ ] Check Sitemap directives
- [ ] Validate User-agent matching
- [ ] Cache robots.txt appropriately

## Secret Management

- [ ] Never hardcode credentials
- [ ] Use environment variables
- [ ] Implement key rotation
- [ ] Audit key usage
- [ ] Monitor for exposed keys
- [ ] Use secure key storage
