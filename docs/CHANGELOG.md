# Changelog

All notable changes to MCP WebScraper will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Comprehensive documentation restructuring
- SECURITY.md with security best practices
- PERFORMANCE.md with optimization guidance
- DEVELOPMENT.md for contributors
- Improved GETTING_STARTED.md consolidating all installation methods

### Changed
- Consolidated installation documentation into single file
- Updated README.md to be a concise entry point
- Enhanced troubleshooting guide structure

### Removed
- Redundant installation files (INSTALL.md, QUICK_START.md, SETUP.md)

## [3.0.0] - 2025-01-15 (Wave 3 Release)

### Added
- 🚀 **deep_research** tool - Comprehensive multi-stage research orchestrator
  - Intelligent query expansion and source verification
  - Conflict detection and consensus analysis
  - Credibility assessment and ranking
  - Support for academic, broad, focused, and comparative research approaches
- 📊 **track_changes** tool - Advanced website change tracking
  - Baseline creation and comparison
  - Scheduled monitoring with notifications
  - Granular change detection (text, structure, links, images)
  - Webhook notifications for changes
- 🥷 **Stealth Mode Enhancements**
  - Advanced browser fingerprinting evasion
  - Human behavior simulation (mouse movements, scrolling)
  - Rotating user agents and headers
  - Anti-detection measures for protected sites
- 🌍 **Localization Support**
  - Multi-language content handling
  - Locale-specific scraping
  - International search support
  - Currency and date format detection
- 📸 **Snapshot Management**
  - Website state capture and versioning
  - Historical comparison capabilities
  - Efficient storage with compression

### Enhanced
- **Performance Improvements**
  - 40% faster content extraction with optimized parsers
  - Reduced memory usage through stream processing
  - Improved cache hit rates to 75%
- **Security Hardening**
  - Enhanced SSRF protection with DNS validation
  - Stricter input validation across all tools
  - Improved credential management
- **Search System**
  - Better query expansion algorithms
  - Improved result ranking with BM25 scoring
  - Enhanced deduplication with SimHash

### Fixed
- Memory leak in long-running crawl operations
- Rate limiting edge cases with concurrent requests
- Cache invalidation issues with dynamic content
- Worker pool timeout handling

## [2.1.0] - 2024-12-01 (Wave 2 Release)

### Added
- 🔄 **batch_scrape** tool - Asynchronous batch processing
  - Process up to 50 URLs concurrently
  - Job management with unique IDs
  - Webhook notifications for completion
  - Retry logic with exponential backoff
- 🤖 **scrape_with_actions** tool - Browser automation
  - Click, type, scroll, and screenshot actions
  - Form auto-fill capabilities
  - Intermediate state capture
  - Stealth mode for anti-bot evasion
- **Job Management System**
  - Async job tracking and status updates
  - Priority queue support
  - Job persistence across restarts
- **Webhook Dispatcher**
  - Real-time notifications for long-running operations
  - Configurable event types
  - Secure webhook signatures

### Enhanced
- **Worker Pool Architecture**
  - Multi-threading with Node.js worker_threads
  - 8x faster HTML parsing
  - Automatic worker recycling
- **Connection Pooling**
  - 50% reduction in connection overhead
  - Keep-alive support
  - Per-host connection limits

### Fixed
- Timeout issues with large batch operations
- Memory spikes during concurrent crawls
- Browser automation stability improvements

## [2.0.0] - 2024-10-15

### Added
- 🔍 **Advanced Content Processing Tools** (4 new tools)
  - **extract_content** - Enhanced extraction with Mozilla Readability
  - **process_document** - Multi-format document processing (PDFs, web pages)
  - **summarize_content** - Intelligent text summarization
  - **analyze_content** - NLP-powered content analysis
- **Search Provider System**
  - Support for Google Custom Search API
  - DuckDuckGo as free alternative
  - Automatic provider fallback
- **Two-Tier Cache System**
  - LRU memory cache (Level 1)
  - Disk persistence cache (Level 2)
  - Configurable TTL and size limits

### Enhanced
- **crawl_deep** improvements
  - Link analysis with PageRank-style scoring
  - Domain filtering capabilities
  - Better memory management for large crawls
- **map_site** enhancements
  - Sitemap.xml parsing support
  - robots.txt compliance checking
  - Path-based URL grouping

### Changed
- Migrated to ES modules (`"type": "module"`)
- Improved error handling with custom error classes
- Better TypeScript type definitions

### Fixed
- robots.txt caching issues
- URL normalization edge cases
- Memory leaks in content processor

## [1.5.0] - 2024-08-20

### Added
- **Performance Manager** for intelligent task routing
- **Circuit Breaker** pattern for external service calls
- **Retry Manager** with exponential backoff
- Comprehensive performance benchmarks
- Docker support with multi-stage builds

### Enhanced
- Queue management with p-queue
- Improved SSRF protection
- Better rate limiting per domain
- Enhanced input validation

### Fixed
- Connection timeout issues
- Cache key collision problems
- Worker pool deadlocks

## [1.0.0] - 2024-06-01

### Added
- Initial release with 5 basic tools
  - **fetch_url** - Fetch content from URLs
  - **extract_text** - Extract clean text from HTML
  - **extract_links** - Extract and filter links
  - **extract_metadata** - Extract page metadata
  - **scrape_structured** - Extract data using CSS selectors
- MCP protocol implementation
- Basic rate limiting
- Simple caching mechanism
- robots.txt compliance

### Security
- Basic SSRF protection
- Input validation with Zod
- URL sanitization

---

## Migration Guides

### Migrating from 2.x to 3.0

#### Breaking Changes
- Tool response format standardization
- Cache key structure changes
- Worker pool API updates

#### Migration Steps
1. Update tool response handlers to use new format
2. Clear existing cache before upgrade
3. Update worker pool initialization code
4. Review and update any custom tools

### Migrating from 1.x to 2.0

#### Breaking Changes
- Switch to ES modules
- New tool registration API
- Cache system overhaul

#### Migration Steps
1. Update require() to import statements
2. Modify tool registration code
3. Clear old cache data
4. Update configuration files

---

## Version Support

| Version | Status | Support Until | Node.js Required |
|---------|--------|---------------|------------------|
| 3.0.x | **Current** | Active | 18+ |
| 2.1.x | Maintenance | 2025-06-01 | 18+ |
| 2.0.x | Maintenance | 2025-03-01 | 16+ |
| 1.x.x | End of Life | 2024-12-01 | 14+ |

---

## Deprecation Notices

### Deprecated in 3.0.0
- `crawl_deep` option `followExternal` - use `domain_filter` instead
- `search_web` option `provider` - use `SEARCH_PROVIDER` env var

### Removed in 3.0.0
- Legacy cache system from v1.x
- Synchronous tool execution API

---

*For detailed upgrade instructions, see the [Migration Guide](./docs/MIGRATION.md)*

[Unreleased]: https://github.com/your-username/mcp-webscraper/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/your-username/mcp-webscraper/compare/v2.1.0...v3.0.0
[2.1.0]: https://github.com/your-username/mcp-webscraper/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/your-username/mcp-webscraper/compare/v1.5.0...v2.0.0
[1.5.0]: https://github.com/your-username/mcp-webscraper/compare/v1.0.0...v1.5.0
[1.0.0]: https://github.com/your-username/mcp-webscraper/releases/tag/v1.0.0