# Changelog

All notable changes to CrawlForge MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.19] - 2026-05-17

### Security
- **HIGH:** HTTP transport (`--http`) now requires `Authorization: Bearer <api-key>` (or `X-API-Key`) on every `/mcp` request — closes audit phase 4. Unauthenticated requests return 401 and emit a structured warning log. Creator mode bypasses the check. `/health` and `/.well-known/mcp/server-card.json` remain unauthenticated for discovery.
- **MEDIUM:** Stored API key is re-validated against the backend at startup — closes audit phase 5. If the backend explicitly rejects the key (invalid / revoked / expired / unauthorized), the server throws and refuses to boot. Network failures are tolerated. `CRAWLFORGE_SKIP_STARTUP_VALIDATION=true` bypasses.
- Phase 6 (config HMAC) is formally deferred until the backend gains support; tracked in `docs/PRODUCTION_READINESS.md`.

### Added
- `src/server/withAuth.js` — tool-handler wrapper extracted from `server.js` for unit-testability.
- Structured `tool invocation` log line on every MCP tool call: `{ toolName, paramHash, durationMs, outcome, creditCost, creatorMode }`. `paramHash` is a 12-hex SHA-256 prefix — no payload leakage. `outcome ∈ { success | error | insufficient_credits }`.
- Per-report `requestId` + `idempotencyKey` (UUID v4) on every usage report; the latter is sent as the HTTP `Idempotency-Key` header and persisted into `~/.crawlforge/pending-usage.json` for safe retry replay.
- `tests/unit/withAuth.test.js` (6 tests) and `tests/unit/authManagerPhaseA.test.js` (6 tests). Unit-test count rises from 14 → 26.

### Changed
- `AuthManager._flushPendingUsage()` and `_appendPendingUsage()` no longer swallow errors silently — structured Winston logs at info/warn/error with retained requestIds. Pending-file ENOENT remains silent (normal), other read errors are now logged at warn.
- `withAuth()` resolves `getToolCost()` and `isCreatorMode()` once per call (was twice and three times respectively); wrapped in `try/finally` so the log line fires on every code path.
- `docs/PRODUCTION_READINESS.md` header bumped: v3.0.12 → v3.0.19, "19 Tools" → "20 Tools", date 2026-03-30 → 2026-05-17. Security Audit Phase Tracker updated: phases 4 and 5 ✅ COMPLETE, phase 6 DEFERRED with rationale.

### Removed
- `src/core/LocalizationManager.js`: deleted the `PROXY_PROVIDERS` constant (11 fake `proxy-*.example.com` endpoints), the `TRANSLATION_SERVICES` constant (Google / Azure / LibreTranslate stubs that were never wired up), the `initializeProxySystem()` and `initializeTranslationServices()` methods, and their re-exports. These never did anything.
- `src/core/ActionExecutor.js`: deleted the `if (url === 'http://example.com')` mock branch — no test depended on it and it short-circuited real action-chain validation.

### Notes
- `isomorphic-dompurify` was **not** removed (plan claim was incorrect — it's actively used by `src/security/wave3-security.js` and `src/utils/inputValidation.js` for HTML sanitization).
- `SnapshotManager.js` was **not** changed — gzip compression is already real, working code (lines 240–260), not a stale comment.

## [3.0.18] - 2026-04-18

### Security
- **CRITICAL:** Endpoint allow-list prevents `CRAWLFORGE_API_URL` from pointing to unauthorized/mock backends. Localhost only permitted in creator mode.
- **CRITICAL:** Credit check fails closed — cached results only trusted within 30 s of last successful backend response. `CREDIT_CHECK_INTERVAL` reduced from 60 s to 15 s.
- **HIGH:** Usage reporting now has a 5 s timeout and decrements local cache regardless of network success. Failed usage reports queued to `~/.crawlforge/pending-usage.json` and replayed automatically.

### Known Issues (deferred to future release)
- HTTP transport (`--http`) still uses the server's stored key for every request. Do not expose publicly until Phase 4 lands.
- API key is not re-validated at startup (Phase 5).
- Local `config.json` has no integrity check (Phase 6).

## [3.0.3] - 2025-10-01

### Security
- **CRITICAL:** Removed authentication bypass vulnerability that allowed users to use `BYPASS_API_KEY=true` for free unlimited access
- Implemented secure creator mode with SHA256 hash-based authentication
- Only package maintainer with secret UUID can enable creator mode (unlimited access for development)
- Protected business model - all users must now authenticate with valid API keys from crawlforge.dev

### Changed
- AuthManager now checks creator mode dynamically to fix initialization order issues
- `.env` file loading moved to top of server.js before all imports
- Updated documentation to reflect security changes

### Added
- `.env.example` file with configuration templates
- Comprehensive creator mode documentation in CLAUDE.md
- Security update notes in README.md

## [3.0.2] - 2025-10-01

### Fixed
- Removed backup files from npm package (ActionExecutor.js.backup, ssrfProtection.js.bak)
- Fixed author email from placeholder to support@crawlforge.dev
- Standardized repository URLs to github.com/mysleekdesigns/crawlforge-mcp
- Fixed homepage URL to https://crawlforge.dev

### Changed
- Updated .npmignore to exclude `*.backup` files
- Updated package-lock.json to sync version
- Reduced package size by 11.1 KB (3.5% reduction)

### Added
- CONTRIBUTING.md with comprehensive contribution guidelines

## [3.0.1] - 2025-10-01

### Security
- Disabled JavaScript execution by default in ActionExecutor
- Requires explicit `ALLOW_JAVASCRIPT_EXECUTION=true` environment variable
- Enforced HTTPS-only webhooks (HTTP webhooks now rejected)

### Fixed
- MCP protocol compliance test JSON parsing issues
- Version synchronization between server.js and package.json

### Changed
- Updated security documentation
- Improved error handling for webhook validation

## [3.0.0] - 2024-08-28

### Added
- Initial release with 19 comprehensive tools
- Basic tools: fetch_url, extract_text, extract_links, extract_metadata, scrape_structured
- Advanced tools: search_web, crawl_deep, map_site
- Content processing: extract_content, process_document, summarize_content, analyze_content
- Wave 2 tools: batch_scrape, scrape_with_actions
- Wave 3 tools: deep_research, track_changes, generate_llms_txt, stealth_mode, localization
- MCP protocol compliance
- Authentication system with API key validation
- Credit tracking and usage reporting
- Docker support
- Comprehensive test suite

### Security
- SSRF protection with allowlist/blocklist
- Input validation and sanitization
- Rate limiting
- Secure webhook dispatching
- API key encryption

---

## Version History Summary

| Version | Date | Type | Description |
|---------|------|------|-------------|
| 3.0.18 | 2026-04-18 | Security | Endpoint allow-list, fail-closed credit check, usage-report hardening |
| 3.0.3 | 2025-10-01 | Security | Critical auth bypass fix |
| 3.0.2 | 2025-10-01 | Maintenance | Package cleanup & metadata fixes |
| 3.0.1 | 2025-10-01 | Security | JS execution & webhook security |
| 3.0.0 | 2024-08-28 | Major | Initial public release |

---

**Note:** For detailed security information, see `PRODUCTION_READINESS.md` and `.github/SECURITY.md`.
