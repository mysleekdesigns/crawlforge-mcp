# CrawlForge Tool Testing Patterns

## Basic Tools Testing

**Tools:** fetch_url, extract_text, extract_links, extract_metadata

```bash
# Test basic functionality
node test-tools.js

# Validate against various content types
# - Standard HTML pages
# - Single-page applications
# - Pages with redirects
# - Error pages (404, 500)
# - Rate-limited responses
```

## Advanced Tools Testing

**Tools:** search_web, extract_content, scrape_structured

```bash
# Test search functionality
node test-real-world.js

# Validate structured extraction
# - CSS selector accuracy
# - Nested element handling
# - Dynamic content extraction
# - Error handling for missing selectors
```

## Premium Tools Testing

**Tools:** crawl_deep, map_site, batch_scrape

```bash
# Test crawling operations
npm run test:wave2

# Validate batch processing
# - Concurrent request handling
# - Error isolation (one failure doesn't stop batch)
# - Progress tracking
# - Credit consumption accuracy
```

## Response Time Validation

```bash
# Basic tools: < 1 second
time node -e "console.log(await fetch_url('https://example.com'))"

# Search: < 2 seconds for 10 results
time node test-search-performance.js

# Batch: < 5 seconds for 10 URLs
time node test-batch-performance.js
```

## Integration Testing

### MCP Protocol Compliance

```bash
# Test tool discovery
npm test

# Validate tool responses
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node server.js
```

## Test Scenarios by Category

### URL Handling
1. Valid HTTPS URLs
2. HTTP URLs (should upgrade or reject)
3. Malformed URLs
4. Private IP addresses (SSRF protection)
5. Localhost attempts (should block)

### Content Extraction
1. Standard HTML pages
2. JavaScript-rendered content
3. Large files (>10MB)
4. Binary content detection
5. Character encoding variations

### Error Handling
1. Network timeouts
2. DNS failures
3. SSL certificate errors
4. Rate limiting (429)
5. Server errors (500)
