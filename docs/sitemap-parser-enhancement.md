# Sitemap Parser Enhancement

## Overview

The MCP WebScraper project has been enhanced with a comprehensive SitemapParser class that provides advanced sitemap processing capabilities. This enhancement significantly improves the mapSite tool's ability to discover and parse sitemaps across various formats and structures.

## Key Features

### 1. Enhanced SitemapParser Class (`src/utils/sitemapParser.js`)

#### Core Capabilities
- **Multiple Format Support**: XML sitemaps, sitemap indexes, RSS feeds, Atom feeds
- **Compression Support**: Handles .xml.gz compressed sitemaps automatically
- **Recursive Processing**: Follows sitemap index files up to configurable depth
- **Rich Metadata Extraction**: Extracts lastmod, changefreq, priority, and specialized content
- **Intelligent Caching**: Multi-level caching with disk persistence
- **Streaming Support**: Efficient handling of large sitemaps
- **Validation & Recovery**: Robust error handling for malformed sitemaps

#### Advanced Features
- **Sitemap Discovery**: Automatic discovery from robots.txt and common paths
- **Content Type Detection**: Parses images, videos, and news sitemaps
- **URL Filtering**: Advanced filtering by domain, path, date, priority, and change frequency
- **Performance Optimization**: Compression detection, rate limiting, and cache management
- **Statistics Tracking**: Detailed parsing statistics and performance metrics

### 2. Enhanced MapSite Tool (`src/tools/crawl/mapSite.js`)

#### New Parameters
- `sitemap_only`: Process only sitemaps, skip page crawling
- `include_sitemap_metadata`: Include rich sitemap metadata in results
- `follow_sitemap_indexes`: Recursively follow sitemap index files
- `discover_sitemaps`: Auto-discover sitemaps from various sources

#### New Capabilities
- **Intelligent Sitemap Discovery**: Checks robots.txt, common paths, and sitemap indexes
- **Rich Metadata Response**: Returns sitemap statistics, discovered sitemaps, and parsing details
- **Enhanced Statistics**: Extended URL analysis including content types, domains, and file extensions
- **Performance Caching**: Separate caches for page data and sitemap data
- **Backward Compatibility**: Maintains all existing functionality

## Implementation Details

### SitemapParser Architecture

```javascript
// Core parsing method
const result = await parser.parseSitemap(url, {
  includeMetadata: true,    // Extract rich metadata
  followIndexes: true,      // Follow sitemap indexes
  maxDepth: 3              // Maximum recursion depth
});

// Sitemap discovery
const sitemaps = await parser.discoverSitemaps(baseUrl, {
  checkRobotsTxt: true,     // Check robots.txt
  checkCommonPaths: true,   // Check standard paths
  checkSitemapIndex: true   // Check for index files
});

// Advanced URL filtering
const filteredUrls = parser.extractUrls(sitemapData, {
  domainFilter: 'example.com',
  pathFilter: '^/blog/',
  priorityFilter: { min: 0.7, max: 1.0 },
  changeFreqFilter: 'daily',
  lastModAfter: '2024-01-01'
});
```

### Enhanced MapSite Usage

```javascript
// Basic enhanced usage
const result = await mapTool.execute({
  url: 'https://example.com',
  include_sitemap: true,
  include_sitemap_metadata: true,
  follow_sitemap_indexes: true,
  discover_sitemaps: true,
  max_urls: 1000
});

// Sitemap-only mode
const sitemapOnly = await mapTool.execute({
  url: 'https://example.com',
  sitemap_only: true,
  include_sitemap_metadata: true,
  max_urls: 5000
});

// Sitemap analysis
const analysis = await mapTool.analyzeSitemaps('https://example.com');
```

## Performance Optimizations

### 1. Multi-Level Caching
- **Memory Cache**: LRU cache for frequently accessed sitemaps
- **Disk Cache**: Persistent cache with TTL support
- **Cache Key Generation**: Smart cache keys based on URL and options

### 2. Compression Handling
- **Automatic Detection**: Detects .gz files and Content-Encoding headers
- **Streaming Decompression**: Efficient handling of compressed content
- **Bandwidth Tracking**: Monitors compression savings

### 3. Rate Limiting & Timeouts
- **Configurable Timeouts**: Per-request timeout controls
- **Error Recovery**: Graceful handling of network failures
- **Resource Management**: Prevents excessive resource consumption

## Edge Cases Handled

### 1. Malformed Sitemaps
- **XML Parsing Errors**: Robust error handling for invalid XML
- **Missing Elements**: Graceful handling of incomplete sitemap entries
- **Format Detection**: Fallback to different parsers for ambiguous formats

### 2. Large Sitemaps
- **Size Limits**: Configurable maximum URLs per sitemap (default: 50,000)
- **Memory Management**: Streaming processing for large files
- **Recursion Control**: Maximum depth limits to prevent infinite loops

### 3. Network Issues
- **Timeout Handling**: Configurable request timeouts
- **Retry Logic**: Built-in retry mechanisms for transient failures
- **Graceful Degradation**: Continues processing despite individual failures

## Configuration Options

### SitemapParser Options
```javascript
const parser = new SitemapParser({
  userAgent: 'MCP-WebScraper/1.0',
  timeout: 10000,                    // Request timeout in ms
  maxRecursionDepth: 3,              // Maximum sitemap index depth
  maxUrlsPerSitemap: 50000,          // Maximum URLs per sitemap
  enableCaching: true,               // Enable caching
  cacheTTL: 3600000,                 // Cache TTL in ms (1 hour)
  validateUrls: true                 // Validate extracted URLs
});
```

### MapSite Tool Options
```javascript
const mapTool = new MapSiteTool({
  userAgent: 'MCP-WebScraper/1.0',
  timeout: 10000,                    // Request timeout in ms
  enableCaching: true                // Enable caching
});
```

## Error Handling

### 1. Network Errors
- Connection timeouts
- DNS resolution failures
- HTTP error responses

### 2. Parsing Errors
- Invalid XML structure
- Malformed URLs
- Missing required elements

### 3. Resource Limits
- Memory consumption
- Excessive recursion
- Rate limiting violations

## Statistics & Monitoring

### Parser Statistics
- Sitemaps processed count
- URLs found count
- Cache hit rate
- Compression savings
- Error count

### Enhanced URL Statistics
- Content type breakdown (pages, images, documents, media)
- Domain and subdomain analysis
- URL length distribution
- Security analysis (HTTPS usage)
- File extension analysis

## Backward Compatibility

The enhancement maintains full backward compatibility:
- All existing MapSite parameters work unchanged
- Legacy sitemap parsing methods remain available
- Default behavior unchanged when using basic parameters
- Existing integrations require no modifications

## Future Enhancements

Potential areas for future development:
1. **Parallel Processing**: Concurrent sitemap processing
2. **Advanced Validation**: Schema validation for specialized sitemaps
3. **Machine Learning**: Intelligent sitemap prediction
4. **Real-time Updates**: Live sitemap monitoring
5. **Analytics Integration**: Enhanced reporting capabilities

## Files Modified/Created

### Created Files
- `/src/utils/sitemapParser.js` - Complete enhanced sitemap parser implementation

### Modified Files
- `/src/tools/crawl/mapSite.js` - Enhanced with new SitemapParser integration

The implementation is production-ready and provides significant improvements in sitemap processing capabilities while maintaining the simplicity and reliability of the original implementation.