# CrawlForge MCP Server - Production Readiness

**Version:** 3.0.10 | **Status:** ✅ PRODUCTION READY | **Updated:** 2026-01-16

---

## Quick Status

| Category | Status |
|----------|--------|
| CrawlForge.dev Integration | ✅ Complete |
| Security | ✅ 9.5/10 |
| All 19 Tools | ✅ Working |
| MCP Compliance | ✅ 100% |
| npm Published | ✅ Yes |

**Production Readiness Score:** 97.75/100

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 3.0.10 | 2026-01-16 | Auto-configure Claude Code & Cursor MCP clients |
| 3.0.9 | 2026-01-16 | Fix API endpoint (api → www.crawlforge.dev) |
| 3.0.8 | 2026-01-12 | Search API proxy via CrawlForge.dev |
| 3.0.7 | 2026-01-09 | Fix HIGH severity dependency vulnerabilities |
| 3.0.6 | 2026-01-09 | Fix PNG screenshot quality option |
| 3.0.3 | 2025-10-01 | Secure creator mode, auth bypass fix |

---

## API Endpoints

All requests go to `https://www.crawlforge.dev`:

| Endpoint | Purpose |
|----------|---------|
| `POST /api/v1/auth/validate` | Validate API key |
| `GET /api/v1/credits` | Check credit balance |
| `POST /api/v1/usage` | Report tool usage |
| `POST /api/v1/search` | Google Search proxy |

---

## Credit Costs

| Tool Type | Credits | Tools |
|-----------|---------|-------|
| Basic | 1 | fetch_url, extract_text, extract_links, extract_metadata |
| Standard | 2-3 | scrape_structured, search_web, summarize_content, analyze_content, process_document, extract_content, generate_llms_txt, track_changes |
| Premium | 5-10 | crawl_deep, map_site, batch_scrape, scrape_with_actions, localization, deep_research, stealth_mode |

---

## Security Summary

All HIGH priority items resolved:
- ✅ JavaScript execution disabled by default
- ✅ HTTPS-only webhooks enforced
- ✅ SHA-256 creator mode authentication
- ✅ SSRF protection (industry-leading)
- ✅ Zod input validation on all tools

---

## User Setup Flow

```bash
npm install -g crawlforge-mcp-server
npx crawlforge-setup  # Auto-configures Claude Code & Cursor
# Restart IDE
```

---

## Related Documentation

| Document | Location |
|----------|----------|
| Security Audit | `/docs/security-audit-report.md` |
| Testing Report | `/docs/testing-validation-report.md` |
| MCP Protocol | `/docs/mcp-protocol-review.md` |
| User Journey | `/docs/user-journey-validation-report.md` |

---

## Contact

**Project Owner:** Simon Lacey

---

*Last reviewed: 2026-01-16*
