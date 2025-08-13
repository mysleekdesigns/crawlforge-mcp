# MCP WebScraper API Reference

## Overview

The MCP WebScraper server provides 12 comprehensive tools for web scraping, searching, crawling, and content processing. This document provides detailed API specifications for all available tools.

**Server Version:** 3.0.0  
**MCP Protocol:** 2024-11-05  
**Node.js Required:** 18.0.0+

## Tool Categories

### Basic Web Operations
- [`fetch_url`](#fetch_url) - Fetch content from URLs with headers and timeout support
- [`extract_text`](#extract_text) - Extract clean text content from HTML
- [`extract_links`](#extract_links) - Extract and filter links from webpages
- [`extract_metadata`](#extract_metadata) - Extract comprehensive page metadata
- [`scrape_structured`](#scrape_structured) - Extract structured data using CSS selectors

### Search & Discovery
- [`search_web`](#search_web) - Web search with multiple provider support
- [`crawl_deep`](#crawl_deep) - Deep website crawling with BFS algorithm
- [`map_site`](#map_site) - Discover and map website structure

### Advanced Content Processing
- [`extract_content`](#extract_content) - Enhanced content extraction with readability detection
- [`process_document`](#process_document) - Multi-format document processing
- [`summarize_content`](#summarize_content) - Intelligent text summarization
- [`analyze_content`](#analyze_content) - Comprehensive content analysis

---

## Tool Specifications

### `fetch_url`

Fetch content from a URL with optional headers and timeout support.

**Description:** Basic URL fetching with comprehensive response information, custom headers support, and configurable timeouts.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | ✅ | - | The URL to fetch (must be valid HTTP/HTTPS URL) |
| `headers` | object | ❌ | `{}` | Optional HTTP headers to include in the request |
| `timeout` | number | ❌ | `10000` | Request timeout in milliseconds (1000-30000) |

#### Response Schema

```json
{
  "status": 200,
  "statusText": "OK",
  "headers": {
    "content-type": "text/html; charset=utf-8",
    "content-length": "1234"
  },
  "body": "<!DOCTYPE html>...",
  "contentType": "text/html; charset=utf-8",
  "size": 1234,
  "url": "https://example.com"
}
```

#### Error Codes

- `TIMEOUT_ERROR` - Request timeout exceeded
- `NETWORK_ERROR` - Network connectivity issues
- `HTTP_ERROR` - HTTP error status codes (4xx, 5xx)
- `INVALID_URL` - Malformed URL provided

#### Example Usage

##### Basic Website Fetch
```javascript
{
  "tool": "fetch_url",
  "parameters": {
    "url": "https://httpbin.org/get"
  }
}

// Response:
{
  "status": 200,
  "statusText": "OK",
  "headers": {
    "content-type": "application/json"
  },
  "body": "{\"args\": {}, \"headers\": {...}}",
  "size": 315
}
```

##### API Call with Authentication
```javascript
{
  "tool": "fetch_url",
  "parameters": {
    "url": "https://api.github.com/repos/microsoft/vscode",
    "headers": {
      "Authorization": "Bearer github_pat_123",
      "Accept": "application/vnd.github.v3+json"
    },
    "timeout": 15000
  }
}
```

**Common Use Cases:**
- API testing and debugging
- Fetching raw content for analysis
- Downloading documents or data files
- Testing website accessibility

---

### `extract_text`

Extract clean text content from HTML, removing scripts, styles, and non-content elements.

**Description:** Intelligent text extraction that removes boilerplate content and focuses on main textual content.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | ✅ | - | The URL to extract text from |
| `remove_scripts` | boolean | ❌ | `true` | Remove script tags before extraction |
| `remove_styles` | boolean | ❌ | `true` | Remove style tags before extraction |

#### Response Schema

```json
{
  "text": "Extracted clean text content...",
  "word_count": 245,
  "char_count": 1456,
  "url": "https://example.com"
}
```

#### Error Codes

- `FETCH_FAILED` - Unable to fetch the URL
- `PARSE_ERROR` - HTML parsing failed
- `EMPTY_CONTENT` - No text content found

#### Example Usage

##### Extract News Article Text
```javascript
{
  "tool": "extract_text",
  "parameters": {
    "url": "https://www.bbc.com/news/technology",
    "remove_scripts": true,
    "remove_styles": true
  }
}

// Response:
{
  "text": "Artificial Intelligence Breakthrough Scientists at MIT...",
  "word_count": 425,
  "char_count": 2847,
  "url": "https://www.bbc.com/news/technology"
}
```

##### Extract with Minimal Processing
```javascript
{
  "tool": "extract_text",
  "parameters": {
    "url": "https://blog.example.com/article",
    "remove_scripts": false,
    "remove_styles": false
  }
}
```

**Common Use Cases:**
- Content analysis and research
- Creating text summaries
- Academic research and citation
- Content migration and archival

---

### `extract_links`

Extract all links from a webpage with optional filtering options.

**Description:** Comprehensive link extraction with support for internal/external filtering and relative URL resolution.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | ✅ | - | The URL to extract links from |
| `filter_external` | boolean | ❌ | `false` | Filter out external links (keep only internal) |
| `base_url` | string | ❌ | auto-detected | Base URL for resolving relative links |

#### Response Schema

```json
{
  "links": [
    {
      "href": "https://example.com/page1",
      "text": "Link Text",
      "is_external": false,
      "original_href": "/page1"
    }
  ],
  "total_count": 25,
  "internal_count": 20,
  "external_count": 5,
  "base_url": "https://example.com"
}
```

#### Error Codes

- `FETCH_FAILED` - Unable to fetch the URL
- `PARSE_ERROR` - HTML parsing failed
- `NO_LINKS_FOUND` - No links detected on the page

#### Example Usage

```javascript
// Extract all links
{
  "url": "https://example.com"
}

// Only internal links
{
  "url": "https://example.com/blog",
  "filter_external": true
}

// Custom base URL
{
  "url": "https://example.com/subdir/page",
  "base_url": "https://example.com"
}
```

---

### `extract_metadata`

Extract comprehensive metadata from a webpage including Open Graph, Twitter Cards, and standard meta tags.

**Description:** Complete metadata extraction supporting all major metadata standards used by social media platforms and search engines.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | ✅ | - | The URL to extract metadata from |

#### Response Schema

```json
{
  "title": "Page Title",
  "description": "Page description...",
  "keywords": ["keyword1", "keyword2"],
  "canonical_url": "https://example.com/canonical",
  "author": "Author Name",
  "robots": "index,follow",
  "viewport": "width=device-width, initial-scale=1",
  "charset": "utf-8",
  "og_tags": {
    "title": "Open Graph Title",
    "description": "OG Description",
    "image": "https://example.com/image.jpg",
    "type": "article"
  },
  "twitter_tags": {
    "card": "summary_large_image",
    "title": "Twitter Title",
    "description": "Twitter Description"
  },
  "url": "https://example.com"
}
```

#### Error Codes

- `FETCH_FAILED` - Unable to fetch the URL
- `PARSE_ERROR` - HTML parsing failed
- `NO_METADATA` - No metadata found

#### Example Usage

```javascript
{
  "url": "https://blog.example.com/article-title"
}
```

---

### `scrape_structured`

Extract structured data from a webpage using CSS selectors.

**Description:** Flexible data extraction using CSS selectors to target specific elements and extract their content.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | ✅ | - | The URL to scrape |
| `selectors` | object | ✅ | - | Object mapping field names to CSS selectors |

#### Response Schema

```json
{
  "data": {
    "title": "Extracted Title",
    "prices": ["$19.99", "$29.99"],
    "description": "Product description"
  },
  "selectors_used": {
    "title": "h1.product-title",
    "prices": ".price",
    "description": ".description"
  },
  "elements_found": 3,
  "url": "https://example.com"
}
```

#### Error Codes

- `FETCH_FAILED` - Unable to fetch the URL
- `INVALID_SELECTOR` - Malformed CSS selector
- `NO_ELEMENTS_FOUND` - No elements matched the selectors

#### Example Usage

```javascript
// E-commerce product scraping
{
  "url": "https://shop.example.com/product/123",
  "selectors": {
    "title": "h1.product-title",
    "price": ".price-current",
    "description": ".product-description",
    "images": "img.product-image",
    "reviews": ".review-text"
  }
}

// News article scraping
{
  "url": "https://news.example.com/article",
  "selectors": {
    "headline": "h1",
    "author": ".author-name",
    "published_date": ".publish-date",
    "content": ".article-body p"
  }
}
```

---

### `search_web`

Search the web using configurable providers (DuckDuckGo or Google Custom Search API).

**Description:** Comprehensive web search with support for multiple providers, advanced query expansion, result ranking, and deduplication.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | ✅ | - | Search query |
| `limit` | number | ❌ | `10` | Maximum number of results (1-100) |
| `offset` | number | ❌ | `0` | Result offset for pagination |
| `lang` | string | ❌ | `"en"` | Language code (e.g., 'en', 'fr', 'de') |
| `safe_search` | boolean | ❌ | `true` | Enable safe search filtering |
| `time_range` | string | ❌ | `"all"` | 'day', 'week', 'month', 'year', 'all' |
| `site` | string | ❌ | - | Restrict search to specific site |
| `file_type` | string | ❌ | - | Filter by file type (e.g., 'pdf', 'doc') |
| `expand_query` | boolean | ❌ | `true` | Enable automatic query expansion |
| `enable_ranking` | boolean | ❌ | `true` | Enable result ranking |
| `enable_deduplication` | boolean | ❌ | `true` | Enable result deduplication |

#### Advanced Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `expansion_options` | object | ❌ | `{}` | Query expansion configuration |
| `ranking_weights` | object | ❌ | auto | Custom ranking weights |
| `deduplication_thresholds` | object | ❌ | auto | Deduplication sensitivity |
| `include_ranking_details` | boolean | ❌ | `false` | Include ranking scores in results |
| `include_deduplication_details` | boolean | ❌ | `false` | Include deduplication info |

#### Response Schema

```json
{
  "query": "machine learning",
  "effective_query": "machine learning OR \"artificial intelligence\"",
  "expanded_queries": ["machine learning", "machine learning OR AI"],
  "results": [
    {
      "title": "Introduction to Machine Learning",
      "link": "https://example.com/ml-intro",
      "snippet": "Learn the basics of machine learning...",
      "displayLink": "example.com",
      "formattedUrl": "https://example.com/ml-intro",
      "pagemap": {
        "metatags": {
          "title": "ML Tutorial",
          "description": "Complete guide...",
          "image": "https://example.com/image.jpg"
        }
      }
    }
  ],
  "total_results": 1420000,
  "search_time": 0.45,
  "offset": 0,
  "limit": 10,
  "cached": false,
  "provider": {
    "name": "duckduckgo",
    "capabilities": ["web_search", "safe_search", "time_filtering"]
  },
  "processing": {
    "ranking": {
      "algorithmsUsed": ["bm25", "semantic", "authority", "freshness"],
      "totalResults": 10
    },
    "deduplication": {
      "originalCount": 12,
      "finalCount": 10,
      "duplicatesRemoved": 2
    }
  }
}
```

#### Error Codes

- `SEARCH_FAILED` - Search provider error
- `INVALID_QUERY` - Query format error
- `RATE_LIMITED` - Too many requests
- `PROVIDER_UNAVAILABLE` - Search provider not available

#### Example Usage

```javascript
// Basic search
{
  "query": "web scraping techniques"
}

// Advanced search with filters
{
  "query": "machine learning python",
  "limit": 20,
  "lang": "en",
  "time_range": "month",
  "site": "github.com",
  "expand_query": true,
  "enable_ranking": true
}

// PDF search
{
  "query": "data science handbook",
  "file_type": "pdf",
  "limit": 5
}
```

---

### `crawl_deep`

Deep crawl websites using breadth-first search algorithm with comprehensive options.

**Description:** Advanced website crawling with depth control, pattern filtering, link analysis, and domain management.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | ✅ | - | Starting URL to crawl |
| `max_depth` | number | ❌ | `3` | Maximum crawl depth (1-5) |
| `max_pages` | number | ❌ | `100` | Maximum pages to crawl (1-1000) |
| `include_patterns` | array | ❌ | `[]` | Regex patterns for URLs to include |
| `exclude_patterns` | array | ❌ | `[]` | Regex patterns for URLs to exclude |
| `follow_external` | boolean | ❌ | `false` | Follow external links |
| `respect_robots` | boolean | ❌ | `true` | Respect robots.txt rules |
| `extract_content` | boolean | ❌ | `true` | Extract page content |
| `concurrency` | number | ❌ | `10` | Number of concurrent requests (1-20) |
| `enable_link_analysis` | boolean | ❌ | `true` | Enable link analysis |

#### Advanced Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `domain_filter` | object | ❌ | - | Domain filtering configuration |
| `link_analysis_options` | object | ❌ | `{}` | Link analysis configuration |
| `import_filter_config` | string | ❌ | - | JSON string of exported filter config |

#### Response Schema

```json
{
  "url": "https://example.com",
  "crawl_depth": 3,
  "pages_crawled": 45,
  "pages_found": 45,
  "errors": 2,
  "duration_ms": 15420,
  "pages_per_second": 2.92,
  "results": [
    {
      "url": "https://example.com/page1",
      "depth": 1,
      "title": "Page Title",
      "links_count": 15,
      "content_length": 2456,
      "timestamp": "2024-01-15T10:30:00.000Z",
      "content": "Page content preview...",
      "metadata": {
        "title": "Page Title",
        "description": "Page description"
      }
    }
  ],
  "errors": [
    {
      "url": "https://example.com/broken",
      "error": "HTTP 404: Not Found",
      "timestamp": "2024-01-15T10:30:15.000Z"
    }
  ],
  "stats": {
    "total_requests": 47,
    "successful_requests": 45,
    "failed_requests": 2,
    "average_response_time": 342,
    "total_data_downloaded": 1245600
  },
  "site_structure": {
    "total_pages": 45,
    "depth_distribution": {
      "1": 12,
      "2": 18,
      "3": 15
    },
    "path_patterns": {
      "blog": 15,
      "products": 8,
      "about": 3
    },
    "file_types": {
      "html": 42,
      "pdf": 2,
      "doc": 1
    },
    "subdomains": ["www.example.com", "blog.example.com"]
  },
  "link_analysis": {
    "statistics": {
      "nodes": 45,
      "links": 234,
      "density": 0.12,
      "avgOutboundLinks": 5.2,
      "avgInboundLinks": 5.2
    },
    "importance": {
      "topPages": [
        {
          "url": "https://example.com",
          "score": 0.85,
          "rank": 1
        }
      ]
    }
  }
}
```

#### Error Codes

- `CRAWL_FAILED` - General crawl failure
- `ROBOTS_BLOCKED` - Blocked by robots.txt
- `TIMEOUT_ERROR` - Crawl timeout exceeded
- `DEPTH_EXCEEDED` - Maximum depth reached

#### Example Usage

```javascript
// Basic crawl
{
  "url": "https://blog.example.com"
}

// Advanced crawl with filtering
{
  "url": "https://docs.example.com",
  "max_depth": 2,
  "max_pages": 50,
  "include_patterns": [".*\\/docs\\/.*"],
  "exclude_patterns": [".*\\.pdf$", ".*\\/archive\\/.*"],
  "extract_content": true,
  "enable_link_analysis": true
}

// Domain filtering
{
  "url": "https://example.com",
  "domain_filter": {
    "whitelist": ["example.com", "docs.example.com"],
    "blacklist": ["ads.example.com"],
    "domain_rules": {
      "docs.example.com": {
        "maxDepth": 3,
        "rateLimit": 5
      }
    }
  }
}
```

---

### `map_site`

Discover and map website structure with sitemap support.

**Description:** Comprehensive website structure discovery using multiple methods including sitemap parsing and link crawling.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | ✅ | - | Website URL to map |
| `include_sitemap` | boolean | ❌ | `true` | Include sitemap.xml URLs |
| `max_urls` | number | ❌ | `1000` | Maximum URLs to discover (1-10000) |
| `group_by_path` | boolean | ❌ | `true` | Group URLs by path segments |
| `include_metadata` | boolean | ❌ | `false` | Fetch metadata for discovered URLs |

#### Response Schema

```json
{
  "url": "https://example.com",
  "discovered_urls": [
    {
      "url": "https://example.com/page1",
      "source": "sitemap",
      "priority": 0.8,
      "lastmod": "2024-01-15",
      "changefreq": "weekly"
    }
  ],
  "url_count": 156,
  "sources": {
    "sitemap": 120,
    "crawl": 36
  },
  "path_structure": {
    "blog": {
      "count": 45,
      "paths": ["/blog/2024/", "/blog/categories/"]
    },
    "products": {
      "count": 32,
      "paths": ["/products/category1/", "/products/category2/"]
    }
  },
  "file_types": {
    "html": 145,
    "pdf": 8,
    "xml": 3
  },
  "sitemaps_found": [
    "https://example.com/sitemap.xml",
    "https://example.com/blog-sitemap.xml"
  ],
  "robots_txt": {
    "found": true,
    "sitemaps": ["https://example.com/sitemap.xml"],
    "restrictions": ["*/admin/*", "*/private/*"]
  },
  "metadata": {
    "site_title": "Example Website",
    "generator": "WordPress 6.3",
    "last_analyzed": "2024-01-15T10:30:00.000Z"
  }
}
```

#### Error Codes

- `SITE_UNREACHABLE` - Cannot access the website
- `NO_SITEMAP` - No sitemap found and crawling failed
- `ROBOTS_BLOCKED` - Blocked by robots.txt
- `INVALID_SITEMAP` - Sitemap format error

#### Example Usage

```javascript
// Basic site mapping
{
  "url": "https://example.com"
}

// Detailed mapping with metadata
{
  "url": "https://blog.example.com",
  "max_urls": 500,
  "include_metadata": true,
  "group_by_path": true
}

// Skip sitemap, crawl only
{
  "url": "https://docs.example.com",
  "include_sitemap": false,
  "max_urls": 200
}
```

---

### `extract_content`

Enhanced content extraction with readability detection and structured data extraction.

**Description:** Advanced content extraction using Mozilla Readability for main content detection, with support for JavaScript rendering and comprehensive content analysis.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | ✅ | - | URL to extract content from |
| `options` | object | ❌ | `{}` | Content extraction options |

#### Options Schema

```javascript
{
  // Content extraction options
  "useReadability": true,          // Use Mozilla Readability for main content
  "extractStructuredData": true,   // Extract JSON-LD, microdata
  "calculateReadabilityScore": true, // Calculate readability metrics
  "preserveImageInfo": true,       // Extract image information
  "extractMetadata": true,         // Extract page metadata
  
  // Browser rendering options
  "requiresJavaScript": false,     // Force JavaScript rendering
  "waitForSelector": "#content",   // Wait for specific selector
  "waitForTimeout": 5000,          // Wait timeout in ms
  
  // Quality assessment options
  "assessContentQuality": true,    // Assess content quality
  "minContentLength": 100,         // Minimum content length
  
  // Output options
  "includeRawHTML": false,         // Include original HTML
  "includeCleanedHTML": false,     // Include cleaned HTML
  "outputFormat": "structured"     // "text", "markdown", "structured"
}
```

#### Response Schema

```json
{
  "url": "https://example.com/article",
  "title": "Article Title",
  "content": {
    "text": "Main article content...",
    "markdown": "# Article Title\n\nMain article content..."
  },
  "metadata": {
    "title": "Article Title",
    "description": "Article description",
    "author": "Author Name",
    "published": "2024-01-15T10:00:00Z",
    "language": "en",
    "canonical": "https://example.com/article",
    "openGraph": {
      "title": "OG Title",
      "description": "OG Description"
    }
  },
  "readability": {
    "title": "Article Title",
    "content": "<article>...</article>",
    "textContent": "Clean text content...",
    "length": 2456,
    "excerpt": "Article excerpt...",
    "byline": "By Author Name",
    "siteName": "Example Site"
  },
  "readabilityScore": {
    "score": 65.2,
    "level": "Standard",
    "sentences": 45,
    "words": 523,
    "characters": 2456,
    "avgWordsPerSentence": 11.6,
    "avgCharsPerWord": 4.7
  },
  "structuredData": {
    "jsonLd": [
      {
        "@type": "Article",
        "headline": "Article Title",
        "author": "Author Name"
      }
    ],
    "microdata": [],
    "schemaOrg": []
  },
  "images": [
    {
      "src": "https://example.com/image.jpg",
      "alt": "Image description",
      "title": "Image title",
      "width": "800",
      "height": "600"
    }
  ],
  "qualityAssessment": {
    "isValid": true,
    "score": 8.5,
    "reasons": ["Sufficient length", "Good structure"],
    "metrics": {
      "contentLength": 2456,
      "paragraphCount": 12,
      "headingCount": 5
    }
  },
  "extractedAt": "2024-01-15T10:30:00.000Z",
  "processingTime": 1245,
  "success": true
}
```

#### Error Codes

- `CONTENT_EXTRACTION_FAILED` - Unable to extract content
- `JAVASCRIPT_RENDERING_FAILED` - Browser rendering failed
- `READABILITY_FAILED` - Readability analysis failed
- `STRUCTURED_DATA_ERROR` - Structured data parsing failed

#### Example Usage

```javascript
// Basic content extraction
{
  "url": "https://blog.example.com/article"
}

// Advanced extraction with JavaScript rendering
{
  "url": "https://app.example.com/dynamic-content",
  "options": {
    "requiresJavaScript": true,
    "waitForSelector": ".content-loaded",
    "outputFormat": "markdown",
    "includeCleanedHTML": true
  }
}

// Quality-focused extraction
{
  "url": "https://news.example.com/article",
  "options": {
    "assessContentQuality": true,
    "minContentLength": 500,
    "calculateReadabilityScore": true,
    "extractStructuredData": true
  }
}
```

---

### `process_document`

Multi-format document processing including PDFs, web pages, and JavaScript content.

**Description:** Comprehensive document processing supporting multiple input formats with specialized processors for different content types.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `source` | string | ✅ | - | Document source (URL, file path, etc.) |
| `sourceType` | string | ❌ | auto-detect | Source type: 'url', 'pdf_url', 'file', 'pdf_file' |
| `options` | object | ❌ | `{}` | Processing options |

#### Options Schema

```javascript
{
  // General processing options
  "extractText": true,             // Extract text content
  "extractImages": false,          // Extract image information
  "extractMetadata": true,         // Extract document metadata
  "preserveFormatting": false,     // Preserve original formatting
  
  // PDF-specific options
  "pageRange": [1, 10],           // Process specific page range
  "ocrMode": false,               // Enable OCR for scanned PDFs
  "extractTables": false,         // Extract table data
  
  // Web processing options
  "useJavaScript": false,         // Enable JavaScript rendering
  "waitForContent": true,         // Wait for content to load
  "timeout": 30000,               // Processing timeout
  
  // Output options
  "outputFormat": "structured",   // "text", "json", "structured"
  "includeRawData": false,        // Include raw extracted data
  "chunkContent": false,          // Split content into chunks
  "chunkSize": 1000              // Chunk size in characters
}
```

#### Response Schema

```json
{
  "source": "https://example.com/document.pdf",
  "sourceType": "pdf_url",
  "content": {
    "text": "Document text content...",
    "pages": [
      {
        "pageNumber": 1,
        "text": "Page 1 content...",
        "images": 2,
        "tables": 1
      }
    ]
  },
  "metadata": {
    "title": "Document Title",
    "author": "Author Name",
    "creator": "Application Name",
    "producer": "PDF Producer",
    "creationDate": "2024-01-15T10:00:00Z",
    "modificationDate": "2024-01-15T12:00:00Z",
    "pages": 15,
    "fileSize": 245760,
    "format": "PDF 1.7"
  },
  "images": [
    {
      "page": 1,
      "index": 0,
      "width": 800,
      "height": 600,
      "format": "JPEG"
    }
  ],
  "tables": [
    {
      "page": 1,
      "rows": 5,
      "columns": 3,
      "data": [
        ["Header 1", "Header 2", "Header 3"],
        ["Row 1 Col 1", "Row 1 Col 2", "Row 1 Col 3"]
      ]
    }
  ],
  "statistics": {
    "totalPages": 15,
    "totalCharacters": 15420,
    "totalWords": 2156,
    "averageWordsPerPage": 143.7,
    "processingTime": 3245
  },
  "processedAt": "2024-01-15T10:30:00.000Z",
  "success": true
}
```

#### Error Codes

- `DOCUMENT_PROCESSING_FAILED` - General processing failure
- `UNSUPPORTED_FORMAT` - Document format not supported
- `PDF_PARSING_ERROR` - PDF-specific parsing error
- `OCR_FAILED` - OCR processing failed
- `FILE_NOT_FOUND` - Source file not accessible

#### Example Usage

```javascript
// Process PDF from URL
{
  "source": "https://example.com/document.pdf",
  "sourceType": "pdf_url",
  "options": {
    "extractTables": true,
    "pageRange": [1, 5],
    "outputFormat": "structured"
  }
}

// Process web page with JavaScript
{
  "source": "https://app.example.com/report",
  "sourceType": "url",
  "options": {
    "useJavaScript": true,
    "waitForContent": true,
    "extractImages": true
  }
}

// Process local PDF file
{
  "source": "/path/to/document.pdf",
  "sourceType": "pdf_file",
  "options": {
    "ocrMode": true,
    "extractText": true,
    "chunkContent": true,
    "chunkSize": 500
  }
}
```

---

### `summarize_content`

Intelligent text summarization with configurable options.

**Description:** Advanced text summarization using multiple algorithms with support for different summary types and customizable output formats.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `text` | string | ✅ | - | Text content to summarize |
| `options` | object | ❌ | `{}` | Summarization options |

#### Options Schema

```javascript
{
  // Summary configuration
  "summaryType": "abstractive",    // "extractive", "abstractive", "hybrid"
  "length": "medium",              // "short", "medium", "long", "custom"
  "maxSentences": 5,              // Maximum sentences (for custom length)
  "compressionRatio": 0.3,        // Compression ratio (0.1-0.9)
  
  // Content focus
  "focusOn": "main_points",       // "main_points", "key_facts", "conclusions"
  "includeKeywords": true,        // Include key terms in summary
  "preserveStructure": false,     // Maintain original structure
  
  // Output options
  "outputFormat": "paragraph",    // "paragraph", "bullets", "structured"
  "includeMetrics": false,        // Include summarization metrics
  "includeKeyPoints": true,       // Extract key points separately
  
  // Advanced options
  "language": "auto",             // Target language
  "tone": "neutral",              // "neutral", "formal", "casual"
  "audience": "general"           // "general", "technical", "academic"
}
```

#### Response Schema

```json
{
  "text": "Original text (first 200 chars)...",
  "summary": {
    "content": "Summarized content goes here...",
    "type": "abstractive",
    "length": "medium",
    "sentences": 4,
    "compressionRatio": 0.28
  },
  "keyPoints": [
    "Key point 1 extracted from the text",
    "Key point 2 with important information",
    "Key point 3 highlighting main conclusions"
  ],
  "keywords": [
    {
      "term": "machine learning",
      "frequency": 8,
      "importance": 0.9
    },
    {
      "term": "data analysis",
      "frequency": 5,
      "importance": 0.7
    }
  ],
  "metrics": {
    "originalLength": 2456,
    "summaryLength": 687,
    "compressionAchieved": 0.28,
    "readabilityScore": 72.5,
    "coherenceScore": 0.85
  },
  "metadata": {
    "algorithm": "hybrid_extraction",
    "language": "en",
    "processingTime": 1245,
    "confidence": 0.87
  },
  "summarizedAt": "2024-01-15T10:30:00.000Z",
  "success": true
}
```

#### Error Codes

- `SUMMARIZATION_FAILED` - General summarization failure
- `TEXT_TOO_SHORT` - Input text below minimum length
- `LANGUAGE_NOT_SUPPORTED` - Language not supported
- `INVALID_OPTIONS` - Invalid summarization options

#### Example Usage

```javascript
// Basic summarization
{
  "text": "Long article text content..."
}

// Custom summarization with specific requirements
{
  "text": "Technical document content...",
  "options": {
    "summaryType": "abstractive",
    "length": "short",
    "focusOn": "key_facts",
    "outputFormat": "bullets",
    "audience": "technical",
    "includeMetrics": true
  }
}

// Structured summarization
{
  "text": "Research paper content...",
  "options": {
    "summaryType": "hybrid",
    "compressionRatio": 0.2,
    "preserveStructure": true,
    "includeKeyPoints": true,
    "tone": "academic"
  }
}
```

---

### `analyze_content`

Comprehensive content analysis including language detection, topic extraction, sentiment analysis, and more.

**Description:** Advanced NLP-powered content analysis providing insights into language, topics, entities, sentiment, and readability.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `text` | string | ✅ | - | Text content to analyze (min 10 characters) |
| `options` | object | ❌ | `{}` | Analysis options |

#### Options Schema

```javascript
{
  // Analysis components
  "detectLanguage": true,          // Detect content language
  "extractTopics": true,           // Extract main topics
  "extractEntities": true,         // Extract named entities
  "extractKeywords": true,         // Extract keywords
  "analyzeSentiment": true,        // Analyze sentiment
  "calculateReadability": true,    // Calculate readability metrics
  "includeStatistics": true,       // Include text statistics
  
  // Analysis depth
  "maxTopics": 10,                // Maximum topics to extract
  "maxKeywords": 15,              // Maximum keywords to extract
  "minConfidence": 0.1,           // Minimum confidence threshold
  
  // Output options
  "includeAdvancedMetrics": false, // Include advanced metrics
  "groupEntitiesByType": true,    // Group entities by type
  "rankByRelevance": true         // Sort results by relevance
}
```

#### Response Schema

```json
{
  "text": "Original text (first 500 chars)...",
  "language": {
    "code": "en",
    "name": "English",
    "confidence": 0.98,
    "alternatives": [
      {
        "code": "en-US",
        "name": "English (US)",
        "confidence": 0.95
      }
    ]
  },
  "topics": [
    {
      "topic": "machine learning",
      "confidence": 0.89,
      "keywords": ["algorithm", "training", "model"],
      "category": "technology"
    }
  ],
  "entities": {
    "people": ["John Smith", "Dr. Johnson"],
    "places": ["New York", "Silicon Valley"],
    "organizations": ["Google", "MIT"],
    "dates": ["2024", "January 15"],
    "money": ["$1 million", "$50"],
    "other": ["Python", "API"],
    "summary": {
      "totalEntities": 25,
      "uniqueEntities": 20,
      "entityDensity": 0.12
    }
  },
  "keywords": [
    {
      "keyword": "artificial intelligence",
      "frequency": 12,
      "relevance": 0.95,
      "type": "noun_phrase",
      "category": "technical"
    }
  ],
  "sentiment": {
    "polarity": 0.15,
    "subjectivity": 0.67,
    "label": "positive",
    "confidence": 0.82,
    "emotions": [
      {
        "emotion": "trust",
        "intensity": 0.7
      }
    ]
  },
  "readability": {
    "score": 68.5,
    "level": "Standard",
    "metrics": {
      "sentences": 45,
      "words": 523,
      "characters": 2456,
      "avgWordsPerSentence": 11.6,
      "avgCharsPerWord": 4.7,
      "complexWords": 78,
      "syllables": 892
    }
  },
  "statistics": {
    "characters": 2456,
    "charactersNoSpaces": 2103,
    "words": 523,
    "sentences": 45,
    "paragraphs": 12,
    "readingTime": 125,
    "vocabulary": {
      "uniqueWords": 287,
      "vocabularyRichness": 0.55,
      "lexicalDiversity": 0.78
    }
  },
  "themes": [
    {
      "theme": "technology",
      "confidence": 0.87,
      "supportingTopics": ["machine learning", "artificial intelligence"]
    }
  ],
  "analyzedAt": "2024-01-15T10:30:00.000Z",
  "processingTime": 1876,
  "success": true
}
```

#### Error Codes

- `ANALYSIS_FAILED` - General analysis failure
- `TEXT_TOO_SHORT` - Text below minimum length
- `LANGUAGE_DETECTION_FAILED` - Unable to detect language
- `TOPIC_EXTRACTION_FAILED` - Topic extraction failed
- `SENTIMENT_ANALYSIS_FAILED` - Sentiment analysis failed

#### Example Usage

```javascript
// Basic content analysis
{
  "text": "Artificial intelligence is transforming industries..."
}

// Advanced analysis with custom options
{
  "text": "Research paper content...",
  "options": {
    "maxTopics": 20,
    "maxKeywords": 30,
    "includeAdvancedMetrics": true,
    "minConfidence": 0.2
  }
}

// Focused sentiment analysis
{
  "text": "Product review content...",
  "options": {
    "analyzeSentiment": true,
    "extractEntities": true,
    "extractKeywords": true,
    "detectLanguage": false,
    "extractTopics": false
  }
}
```

---

## Error Handling

### Common Error Response Format

All tools return errors in a consistent format:

```json
{
  "success": false,
  "error": "Error description",
  "error_code": "ERROR_CODE",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "details": {
    "url": "https://example.com",
    "retry_after": 30
  }
}
```

### Global Error Codes

| Code | Description | Retry | Solution |
|------|-------------|-------|----------|
| `NETWORK_ERROR` | Network connectivity issues | ✅ | Check internet connection |
| `TIMEOUT_ERROR` | Request timeout exceeded | ✅ | Increase timeout or retry |
| `RATE_LIMITED` | Too many requests | ✅ | Wait and retry (see retry_after) |
| `INVALID_URL` | Malformed URL provided | ❌ | Correct URL format |
| `PERMISSION_DENIED` | Access forbidden | ❌ | Check robots.txt and permissions |
| `SERVER_ERROR` | Internal server error | ✅ | Retry after delay |
| `VALIDATION_ERROR` | Parameter validation failed | ❌ | Check parameter format |

### Rate Limiting

The server implements rate limiting to prevent abuse:

- **Default limit:** 10 requests per second per domain
- **Burst limit:** 20 requests per 10 seconds
- **Global limit:** 100 requests per minute

When rate limited, the response includes:
```json
{
  "error_code": "RATE_LIMITED",
  "retry_after": 30,
  "limit": 10,
  "remaining": 0,
  "reset": "2024-01-15T10:31:00.000Z"
}
```

---

## Performance Considerations

### Caching

The server implements intelligent caching:

- **Search results:** Cached for 1 hour
- **Page content:** Cached for 24 hours
- **Site maps:** Cached for 7 days
- **Robots.txt:** Cached for 24 hours

### Concurrency

Default concurrency limits:
- **Crawling:** 10 concurrent requests
- **Batch processing:** 5 concurrent operations
- **Search queries:** 3 concurrent searches

### Resource Usage

Typical resource consumption:
- **Memory:** 100-500MB for normal operations
- **CPU:** Low usage except during content analysis
- **Network:** Respects rate limits and robots.txt

---

## Integration Examples

### Claude Code Integration

```json
{
  "mcpServers": {
    "webscraper": {
      "command": "node",
      "args": ["/path/to/webScraper-1.0/server.js"],
      "env": {
        "GOOGLE_API_KEY": "your_key",
        "SEARCH_PROVIDER": "auto"
      }
    }
  }
}
```

### Cursor Integration

```json
{
  "mcpServers": {
    "webscraper": {
      "command": "node",
      "args": ["/path/to/webScraper-1.0/server.js"]
    }
  }
}
```

---

## Changelog

### Version 3.0.0
- Added 4 new advanced content processing tools
- Enhanced search with query expansion and ranking
- Improved crawling with link analysis
- Added comprehensive content analysis capabilities

### Version 2.0.0
- Added deep crawling and site mapping tools
- Enhanced search with multiple provider support
- Improved error handling and rate limiting

### Version 1.0.0
- Initial release with basic scraping tools
- Support for fetch, extract_text, extract_links, extract_metadata, scrape_structured