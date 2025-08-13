# MCP WebScraper Usage Examples

## Overview

This document provides practical, real-world examples for all 12 tools in the MCP WebScraper server. Each example includes the request format, expected response, and common use cases.

## Table of Contents

- [Basic Web Operations](#basic-web-operations)
- [Search & Discovery](#search--discovery)
- [Advanced Content Processing](#advanced-content-processing)
- [Real-World Scenarios](#real-world-scenarios)
- [Error Handling Examples](#error-handling-examples)
- [Integration Patterns](#integration-patterns)

---

## Basic Web Operations

### `fetch_url` - Basic URL Fetching

#### Example 1: Simple Website Fetch

```json
{
  "tool": "fetch_url",
  "parameters": {
    "url": "https://httpbin.org/get"
  }
}
```

**Response:**
```json
{
  "status": 200,
  "statusText": "OK",
  "headers": {
    "content-type": "application/json",
    "content-length": "315"
  },
  "body": "{\n  \"args\": {},\n  \"headers\": {\n    \"Host\": \"httpbin.org\",\n    \"User-Agent\": \"MCP-WebScraper/3.0\"\n  },\n  \"origin\": \"203.0.113.1\",\n  \"url\": \"https://httpbin.org/get\"\n}",
  "contentType": "application/json",
  "size": 315,
  "url": "https://httpbin.org/get"
}
```

#### Example 2: API Call with Headers

```json
{
  "tool": "fetch_url",
  "parameters": {
    "url": "https://api.github.com/repos/microsoft/vscode",
    "headers": {
      "Authorization": "Bearer github_pat_123",
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "MyApp/1.0"
    },
    "timeout": 15000
  }
}
```

**Use Cases:**
- API testing and debugging
- Fetching raw content for analysis
- Downloading documents or data files
- Testing website accessibility

### `extract_text` - Clean Text Extraction

#### Example 1: News Article Text

```json
{
  "tool": "extract_text",
  "parameters": {
    "url": "https://www.bbc.com/news/technology-67890123",
    "remove_scripts": true,
    "remove_styles": true
  }
}
```

**Response:**
```json
{
  "text": "Artificial Intelligence Breakthrough Scientists at MIT have developed a new machine learning algorithm that can predict climate patterns with 95% accuracy. The breakthrough represents a significant advancement in our ability to forecast extreme weather events. Dr. Sarah Johnson, lead researcher on the project, explains that the algorithm combines satellite data with historical weather patterns to create more accurate predictions...",
  "word_count": 425,
  "char_count": 2847,
  "url": "https://www.bbc.com/news/technology-67890123"
}
```

#### Example 2: Blog Post with Minimal Processing

```json
{
  "tool": "extract_text",
  "parameters": {
    "url": "https://blog.example.com/web-scraping-guide",
    "remove_scripts": false,
    "remove_styles": false
  }
}
```

**Use Cases:**
- Content analysis and research
- Creating text summaries
- Academic research and citation
- Content migration and archival

### `extract_links` - Link Discovery

#### Example 1: Internal Link Analysis

```json
{
  "tool": "extract_links",
  "parameters": {
    "url": "https://docs.python.org/3/",
    "filter_external": true,
    "base_url": "https://docs.python.org"
  }
}
```

**Response:**
```json
{
  "links": [
    {
      "href": "https://docs.python.org/3/tutorial/",
      "text": "Tutorial",
      "is_external": false,
      "original_href": "/3/tutorial/"
    },
    {
      "href": "https://docs.python.org/3/library/",
      "text": "Library Reference", 
      "is_external": false,
      "original_href": "/3/library/"
    }
  ],
  "total_count": 45,
  "internal_count": 45,
  "external_count": 0,
  "base_url": "https://docs.python.org"
}
```

#### Example 2: All Links Discovery

```json
{
  "tool": "extract_links",
  "parameters": {
    "url": "https://news.ycombinator.com",
    "filter_external": false
  }
}
```

**Use Cases:**
- Site architecture analysis
- Link building and SEO
- Content discovery
- Broken link detection

### `extract_metadata` - Comprehensive Metadata

#### Example 1: Social Media Metadata

```json
{
  "tool": "extract_metadata",
  "parameters": {
    "url": "https://medium.com/@author/article-title"
  }
}
```

**Response:**
```json
{
  "title": "How to Build Better APIs",
  "description": "A comprehensive guide to API design principles and best practices for modern web development.",
  "keywords": ["api", "design", "development", "rest", "graphql"],
  "canonical_url": "https://medium.com/@author/how-to-build-better-apis",
  "author": "John Developer",
  "robots": "index,follow",
  "viewport": "width=device-width,initial-scale=1",
  "charset": "utf-8",
  "og_tags": {
    "title": "How to Build Better APIs",
    "description": "A comprehensive guide to API design principles...",
    "image": "https://cdn-images-1.medium.com/max/1200/1*abc123.png",
    "type": "article",
    "url": "https://medium.com/@author/how-to-build-better-apis"
  },
  "twitter_tags": {
    "card": "summary_large_image",
    "title": "How to Build Better APIs",
    "description": "A comprehensive guide to API design...",
    "image": "https://cdn-images-1.medium.com/max/1200/1*abc123.png"
  },
  "url": "https://medium.com/@author/article-title"
}
```

**Use Cases:**
- SEO analysis and optimization
- Social media preview generation
- Content management systems
- Website quality assessment

### `scrape_structured` - Targeted Data Extraction

#### Example 1: E-commerce Product Data

```json
{
  "tool": "scrape_structured",
  "parameters": {
    "url": "https://www.amazon.com/dp/B08N5WRWNW",
    "selectors": {
      "title": "#productTitle",
      "price": ".a-price-whole",
      "rating": ".a-icon-alt",
      "description": "#feature-bullets ul",
      "images": "#landingImage",
      "availability": "#availability span"
    }
  }
}
```

**Response:**
```json
{
  "data": {
    "title": "Echo Dot (4th Gen) | Smart speaker with Alexa",
    "price": "$49",
    "rating": "4.7 out of 5 stars",
    "description": ["Compact design with rich sound", "Voice control your smart home", "Alexa is always getting smarter"],
    "images": "https://m.media-amazon.com/images/I/614YRTr9N7L._AC_SL1000_.jpg",
    "availability": "In Stock"
  },
  "selectors_used": {
    "title": "#productTitle",
    "price": ".a-price-whole",
    "rating": ".a-icon-alt",
    "description": "#feature-bullets ul",
    "images": "#landingImage", 
    "availability": "#availability span"
  },
  "elements_found": 6,
  "url": "https://www.amazon.com/dp/B08N5WRWNW"
}
```

#### Example 2: Job Listings

```json
{
  "tool": "scrape_structured",
  "parameters": {
    "url": "https://stackoverflow.com/jobs/companies/google",
    "selectors": {
      "job_titles": ".job-title a",
      "locations": ".job-location",
      "descriptions": ".job-summary",
      "posted_dates": ".job-posted-date",
      "company": ".company-name"
    }
  }
}
```

**Use Cases:**
- E-commerce price monitoring
- Job market analysis
- Real estate data collection
- News and content aggregation
- Research data gathering

---

## Search & Discovery

### `search_web` - Web Search

#### Example 1: Technical Research

```json
{
  "tool": "search_web",
  "parameters": {
    "query": "machine learning python tutorials 2024",
    "limit": 10,
    "lang": "en",
    "time_range": "year",
    "enable_ranking": true,
    "expand_query": true
  }
}
```

**Response:**
```json
{
  "query": "machine learning python tutorials 2024",
  "effective_query": "machine learning python tutorials 2024 OR \"ML python guide\"",
  "results": [
    {
      "title": "Complete Machine Learning Tutorial with Python",
      "link": "https://realpython.com/python-machine-learning/",
      "snippet": "Learn machine learning with Python through practical examples and hands-on projects. This comprehensive tutorial covers scikit-learn, pandas, and more.",
      "displayLink": "realpython.com",
      "pagemap": {
        "metatags": {
          "title": "Python Machine Learning Tutorial",
          "description": "Complete guide to machine learning in Python"
        }
      }
    }
  ],
  "total_results": 2450000,
  "search_time": 0.45,
  "provider": {
    "name": "duckduckgo",
    "capabilities": ["web_search", "time_filtering"]
  },
  "processing": {
    "ranking": {
      "algorithmsUsed": ["bm25", "semantic", "authority"],
      "totalResults": 10
    }
  }
}
```

#### Example 2: Academic Research

```json
{
  "tool": "search_web",
  "parameters": {
    "query": "climate change renewable energy",
    "site": "scholar.google.com",
    "file_type": "pdf",
    "limit": 5,
    "safe_search": true
  }
}
```

#### Example 3: Local Search

```json
{
  "tool": "search_web",
  "parameters": {
    "query": "restaurants near me San Francisco",
    "limit": 15,
    "include_ranking_details": true
  }
}
```

**Use Cases:**
- Research and fact-checking
- Competitive analysis
- Content discovery
- Academic research
- Market research

### `crawl_deep` - Website Crawling

#### Example 1: Documentation Crawl

```json
{
  "tool": "crawl_deep",
  "parameters": {
    "url": "https://docs.djangoproject.com/",
    "max_depth": 3,
    "max_pages": 100,
    "include_patterns": [".*\\/docs\\/.*"],
    "exclude_patterns": [".*\\/(download|admin)\\/.*"],
    "extract_content": true,
    "concurrency": 5,
    "enable_link_analysis": true
  }
}
```

**Response:**
```json
{
  "url": "https://docs.djangoproject.com/",
  "crawl_depth": 3,
  "pages_crawled": 85,
  "pages_found": 85,
  "errors": 3,
  "duration_ms": 45230,
  "pages_per_second": 1.88,
  "results": [
    {
      "url": "https://docs.djangoproject.com/en/4.2/",
      "depth": 1,
      "title": "Django Documentation",
      "links_count": 42,
      "content_length": 3456,
      "timestamp": "2024-01-15T10:30:00.000Z",
      "content": "Django is a high-level Python web framework...",
      "metadata": {
        "title": "Django Documentation",
        "description": "Official Django documentation"
      }
    }
  ],
  "site_structure": {
    "total_pages": 85,
    "depth_distribution": {
      "1": 15,
      "2": 35,
      "3": 35
    },
    "path_patterns": {
      "tutorial": 12,
      "topics": 25,
      "ref": 18
    },
    "file_types": {
      "html": 85
    }
  },
  "link_analysis": {
    "statistics": {
      "nodes": 85,
      "links": 456,
      "density": 0.063
    }
  }
}
```

#### Example 2: E-commerce Site Analysis

```json
{
  "tool": "crawl_deep",
  "parameters": {
    "url": "https://shop.example.com",
    "max_depth": 2,
    "max_pages": 50,
    "include_patterns": [".*\\/products\\/.*", ".*\\/categories\\/.*"],
    "exclude_patterns": [".*\\/admin\\/.*", ".*\\/checkout\\/.*"],
    "domain_filter": {
      "whitelist": ["shop.example.com"],
      "blacklist": ["ads.example.com"]
    }
  }
}
```

**Use Cases:**
- Site auditing and analysis
- Content inventory
- SEO analysis
- Competitive intelligence
- Data migration planning

### `map_site` - Site Structure Discovery

#### Example 1: Complete Site Mapping

```json
{
  "tool": "map_site",
  "parameters": {
    "url": "https://blog.example.com",
    "include_sitemap": true,
    "max_urls": 500,
    "group_by_path": true,
    "include_metadata": true
  }
}
```

**Response:**
```json
{
  "url": "https://blog.example.com",
  "discovered_urls": [
    {
      "url": "https://blog.example.com/2024/machine-learning-guide",
      "source": "sitemap",
      "priority": 0.8,
      "lastmod": "2024-01-15",
      "changefreq": "weekly"
    },
    {
      "url": "https://blog.example.com/about",
      "source": "crawl",
      "priority": null,
      "lastmod": null,
      "changefreq": null
    }
  ],
  "url_count": 156,
  "sources": {
    "sitemap": 120,
    "crawl": 36
  },
  "path_structure": {
    "2024": {
      "count": 45,
      "paths": ["/2024/01/", "/2024/02/"]
    },
    "categories": {
      "count": 32,
      "paths": ["/categories/tech/", "/categories/programming/"]
    }
  },
  "sitemaps_found": [
    "https://blog.example.com/sitemap.xml",
    "https://blog.example.com/post-sitemap.xml"
  ]
}
```

#### Example 2: Quick Site Overview

```json
{
  "tool": "map_site",
  "parameters": {
    "url": "https://startup.example.com",
    "max_urls": 100,
    "include_metadata": false,
    "group_by_path": false
  }
}
```

**Use Cases:**
- SEO auditing
- Site migration planning
- Content strategy development
- Information architecture analysis
- Competitive analysis

---

## Advanced Content Processing

### `extract_content` - Enhanced Content Extraction

#### Example 1: Article Processing

```json
{
  "tool": "extract_content",
  "parameters": {
    "url": "https://www.nature.com/articles/s41586-023-06123-4",
    "options": {
      "useReadability": true,
      "extractStructuredData": true,
      "calculateReadabilityScore": true,
      "outputFormat": "markdown",
      "assessContentQuality": true
    }
  }
}
```

**Response:**
```json
{
  "url": "https://www.nature.com/articles/s41586-023-06123-4",
  "title": "Quantum Computing Breakthrough in Error Correction",
  "content": {
    "text": "Researchers at MIT have achieved a significant breakthrough in quantum error correction...",
    "markdown": "# Quantum Computing Breakthrough in Error Correction\n\nResearchers at MIT have achieved a significant breakthrough..."
  },
  "readability": {
    "title": "Quantum Computing Breakthrough in Error Correction",
    "content": "<article>...</article>",
    "textContent": "Researchers at MIT have achieved...",
    "length": 2456,
    "byline": "Dr. Alice Smith"
  },
  "readabilityScore": {
    "score": 72.5,
    "level": "Standard",
    "sentences": 45,
    "words": 523,
    "avgWordsPerSentence": 11.6
  },
  "structuredData": {
    "jsonLd": [
      {
        "@type": "ScholarlyArticle",
        "headline": "Quantum Computing Breakthrough",
        "author": "Dr. Alice Smith"
      }
    ]
  },
  "qualityAssessment": {
    "isValid": true,
    "score": 8.7,
    "reasons": ["Sufficient length", "Good structure", "Clear headings"]
  },
  "success": true
}
```

#### Example 2: JavaScript-Rendered Content

```json
{
  "tool": "extract_content",
  "parameters": {
    "url": "https://app.example.com/dashboard",
    "options": {
      "requiresJavaScript": true,
      "waitForSelector": ".content-loaded",
      "waitForTimeout": 10000,
      "outputFormat": "structured"
    }
  }
}
```

**Use Cases:**
- Content curation and archival
- Academic research
- Content quality assessment
- SEO content analysis
- News aggregation

### `process_document` - Multi-format Processing

#### Example 1: PDF Document Analysis

```json
{
  "tool": "process_document",
  "parameters": {
    "source": "https://arxiv.org/pdf/2301.07041.pdf",
    "sourceType": "pdf_url",
    "options": {
      "extractText": true,
      "extractImages": false,
      "extractMetadata": true,
      "pageRange": [1, 10],
      "outputFormat": "structured"
    }
  }
}
```

**Response:**
```json
{
  "source": "https://arxiv.org/pdf/2301.07041.pdf",
  "sourceType": "pdf_url",
  "content": {
    "text": "Abstract: This paper presents a novel approach to machine learning...",
    "pages": [
      {
        "pageNumber": 1,
        "text": "Abstract: This paper presents...",
        "images": 0,
        "tables": 1
      }
    ]
  },
  "metadata": {
    "title": "Novel Approaches to Machine Learning",
    "author": "Dr. John Smith, Dr. Jane Doe",
    "creator": "LaTeX",
    "pages": 15,
    "creationDate": "2024-01-10T08:00:00Z"
  },
  "statistics": {
    "totalPages": 10,
    "totalCharacters": 25420,
    "totalWords": 4156,
    "averageWordsPerPage": 415.6
  },
  "success": true
}
```

#### Example 2: Web Page with JavaScript

```json
{
  "tool": "process_document",
  "parameters": {
    "source": "https://dashboard.example.com/reports/2024",
    "sourceType": "url",
    "options": {
      "useJavaScript": true,
      "waitForContent": true,
      "timeout": 30000,
      "chunkContent": true,
      "chunkSize": 1000
    }
  }
}
```

**Use Cases:**
- Academic paper analysis
- Legal document processing
- Report generation
- Content conversion
- Research data extraction

### `summarize_content` - Text Summarization

#### Example 1: News Article Summary

```json
{
  "tool": "summarize_content",
  "parameters": {
    "text": "The global climate summit concluded today with representatives from 195 countries agreeing to new emissions targets. The agreement, which builds upon the Paris Climate Accord, sets more aggressive goals for reducing greenhouse gas emissions by 2030. Key provisions include a 50% reduction in carbon emissions from 2019 levels, increased funding for renewable energy projects in developing nations, and new penalties for countries that fail to meet their targets...",
    "options": {
      "summaryType": "abstractive",
      "length": "short",
      "focusOn": "key_facts",
      "outputFormat": "bullets",
      "includeKeyPoints": true
    }
  }
}
```

**Response:**
```json
{
  "text": "The global climate summit concluded today with representatives...",
  "summary": {
    "content": "• 195 countries agreed to new emissions targets at global climate summit\n• Agreement builds on Paris Climate Accord with more aggressive 2030 goals\n• Key provisions include 50% carbon emission reduction and increased renewable energy funding\n• New penalties introduced for countries missing targets",
    "type": "abstractive",
    "length": "short",
    "sentences": 4,
    "compressionRatio": 0.15
  },
  "keyPoints": [
    "195 countries participated in climate summit agreement",
    "50% carbon emission reduction target by 2030",
    "Increased funding for renewable energy in developing nations",
    "New penalty system for non-compliance"
  ],
  "keywords": [
    {
      "term": "climate summit",
      "frequency": 3,
      "importance": 0.9
    },
    {
      "term": "emissions targets",
      "frequency": 2,
      "importance": 0.8
    }
  ],
  "success": true
}
```

#### Example 2: Technical Document Summary

```json
{
  "tool": "summarize_content",
  "parameters": {
    "text": "Machine learning algorithms have revolutionized data analysis across industries. Deep learning, a subset of machine learning, uses neural networks with multiple layers to identify patterns in large datasets. Convolutional Neural Networks (CNNs) excel at image recognition tasks, while Recurrent Neural Networks (RNNs) are better suited for sequential data like text and time series...",
    "options": {
      "summaryType": "hybrid",
      "compressionRatio": 0.3,
      "audience": "technical",
      "includeMetrics": true
    }
  }
}
```

**Use Cases:**
- News article condensation
- Research paper abstracts
- Meeting notes summarization
- Content curation
- Executive briefings

### `analyze_content` - Comprehensive Analysis

#### Example 1: Product Review Analysis

```json
{
  "tool": "analyze_content",
  "parameters": {
    "text": "I absolutely love this new smartphone! The camera quality is incredible, especially in low light conditions. The battery life easily lasts all day, even with heavy usage. The design is sleek and modern, though I wish it came in more color options. The price point is reasonable for the features you get. Overall, I'm very satisfied with this purchase and would definitely recommend it to others.",
    "options": {
      "detectLanguage": true,
      "extractTopics": true,
      "analyzeSentiment": true,
      "extractKeywords": true,
      "includeAdvancedMetrics": true
    }
  }
}
```

**Response:**
```json
{
  "text": "I absolutely love this new smartphone! The camera quality...",
  "language": {
    "code": "en",
    "name": "English",
    "confidence": 0.98
  },
  "topics": [
    {
      "topic": "camera quality",
      "confidence": 0.85,
      "keywords": ["camera", "quality", "low light"],
      "category": "technology"
    },
    {
      "topic": "battery life",
      "confidence": 0.78,
      "keywords": ["battery", "life", "usage"],
      "category": "technology"
    }
  ],
  "sentiment": {
    "polarity": 0.72,
    "subjectivity": 0.65,
    "label": "positive",
    "confidence": 0.89,
    "emotions": [
      {
        "emotion": "joy",
        "intensity": 0.8
      }
    ]
  },
  "keywords": [
    {
      "keyword": "smartphone",
      "frequency": 2,
      "relevance": 0.95,
      "type": "noun",
      "category": "technical"
    },
    {
      "keyword": "camera quality",
      "frequency": 1,
      "relevance": 0.88,
      "type": "noun_phrase",
      "category": "technical"
    }
  ],
  "statistics": {
    "characters": 467,
    "words": 89,
    "sentences": 7,
    "readingTime": 21
  },
  "success": true
}
```

#### Example 2: Academic Text Analysis

```json
{
  "tool": "analyze_content",
  "parameters": {
    "text": "Quantum computing represents a paradigm shift in computational methodology, leveraging quantum mechanical phenomena such as superposition and entanglement to process information. Unlike classical computers that utilize binary bits, quantum computers employ quantum bits or qubits, which can exist in multiple states simultaneously...",
    "options": {
      "maxTopics": 15,
      "maxKeywords": 25,
      "minConfidence": 0.2,
      "calculateReadability": true
    }
  }
}
```

**Use Cases:**
- Customer feedback analysis
- Content quality assessment
- Social media monitoring
- Academic research
- Market research analysis

---

## Real-World Scenarios

### Scenario 1: Competitive Analysis Workflow

**Step 1: Map Competitor Website**
```json
{
  "tool": "map_site",
  "parameters": {
    "url": "https://competitor.com",
    "include_sitemap": true,
    "max_urls": 1000
  }
}
```

**Step 2: Crawl Key Sections**
```json
{
  "tool": "crawl_deep",
  "parameters": {
    "url": "https://competitor.com/products",
    "max_depth": 2,
    "include_patterns": [".*\\/products\\/.*"],
    "extract_content": true
  }
}
```

**Step 3: Extract Product Information**
```json
{
  "tool": "scrape_structured",
  "parameters": {
    "url": "https://competitor.com/products/example",
    "selectors": {
      "name": "h1.product-title",
      "price": ".price",
      "features": ".features li",
      "description": ".product-description"
    }
  }
}
```

**Step 4: Analyze Content**
```json
{
  "tool": "analyze_content",
  "parameters": {
    "text": "extracted product descriptions...",
    "options": {
      "extractTopics": true,
      "extractKeywords": true,
      "analyzeSentiment": true
    }
  }
}
```

### Scenario 2: Content Research Pipeline

**Step 1: Search for Topics**
```json
{
  "tool": "search_web",
  "parameters": {
    "query": "sustainable technology trends 2024",
    "limit": 20,
    "time_range": "month"
  }
}
```

**Step 2: Extract Content from Top Results**
```json
{
  "tool": "extract_content",
  "parameters": {
    "url": "https://techcrunch.com/2024/01/sustainable-tech-trends",
    "options": {
      "useReadability": true,
      "outputFormat": "markdown"
    }
  }
}
```

**Step 3: Summarize Key Articles**
```json
{
  "tool": "summarize_content",
  "parameters": {
    "text": "extracted article content...",
    "options": {
      "length": "medium",
      "focusOn": "key_facts",
      "includeKeyPoints": true
    }
  }
}
```

### Scenario 3: Academic Research Workflow

**Step 1: Search Academic Sources**
```json
{
  "tool": "search_web",
  "parameters": {
    "query": "machine learning healthcare applications",
    "site": "scholar.google.com",
    "file_type": "pdf",
    "limit": 10
  }
}
```

**Step 2: Process PDF Documents**
```json
{
  "tool": "process_document",
  "parameters": {
    "source": "https://arxiv.org/pdf/2301.12345.pdf",
    "sourceType": "pdf_url",
    "options": {
      "extractText": true,
      "extractMetadata": true
    }
  }
}
```

**Step 3: Analyze Content**
```json
{
  "tool": "analyze_content",
  "parameters": {
    "text": "extracted paper content...",
    "options": {
      "extractTopics": true,
      "detectLanguage": true,
      "calculateReadability": true
    }
  }
}
```

---

## Error Handling Examples

### Handling Network Errors

```json
{
  "tool": "fetch_url",
  "parameters": {
    "url": "https://unreachable-site.com",
    "timeout": 5000
  }
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Request timeout after 5000ms",
  "error_code": "TIMEOUT_ERROR",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "details": {
    "url": "https://unreachable-site.com",
    "retry_after": 30
  }
}
```

### Handling Rate Limiting

```json
{
  "tool": "search_web",
  "parameters": {
    "query": "test query"
  }
}
```

**Rate Limited Response:**
```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "error_code": "RATE_LIMITED",
  "retry_after": 60,
  "limit": 10,
  "remaining": 0,
  "reset": "2024-01-15T10:31:00.000Z"
}
```

### Handling Invalid Parameters

```json
{
  "tool": "crawl_deep",
  "parameters": {
    "url": "not-a-valid-url",
    "max_depth": 10
  }
}
```

**Validation Error Response:**
```json
{
  "success": false,
  "error": "Validation failed: max_depth must be between 1 and 5",
  "error_code": "VALIDATION_ERROR",
  "details": {
    "field": "max_depth",
    "value": 10,
    "constraint": "max: 5"
  }
}
```

---

## Integration Patterns

### Chaining Tool Calls

```javascript
// Example: Research pipeline in Claude Code
async function researchTopic(topic) {
  // 1. Search for sources
  const searchResults = await mcp.searchWeb({
    query: topic,
    limit: 5,
    time_range: "month"
  });
  
  // 2. Extract content from top results
  const contentPromises = searchResults.results.slice(0, 3).map(result => 
    mcp.extractContent({
      url: result.link,
      options: { useReadability: true }
    })
  );
  
  const contents = await Promise.all(contentPromises);
  
  // 3. Summarize each piece of content
  const summaries = await Promise.all(
    contents.map(content => 
      mcp.summarizeContent({
        text: content.content.text,
        options: { length: "short" }
      })
    )
  );
  
  return summaries;
}
```

### Error Recovery Pattern

```javascript
async function robustContentExtraction(url) {
  try {
    // Try advanced extraction first
    return await mcp.extractContent({
      url,
      options: { useReadability: true }
    });
  } catch (error) {
    if (error.code === 'CONTENT_EXTRACTION_FAILED') {
      // Fallback to basic text extraction
      return await mcp.extractText({ url });
    }
    throw error;
  }
}
```

### Batch Processing Pattern

```javascript
async function processUrls(urls) {
  const results = [];
  const batchSize = 5;
  
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const batchPromises = batch.map(url => 
      mcp.fetchUrl({ url }).catch(error => ({ url, error }))
    );
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    // Rate limiting delay
    if (i + batchSize < urls.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return results;
}
```

### Configuration-Based Usage

```javascript
const configs = {
  development: {
    search: { limit: 5, cache: false },
    crawl: { max_pages: 10, concurrency: 2 }
  },
  production: {
    search: { limit: 20, cache: true },
    crawl: { max_pages: 100, concurrency: 10 }
  }
};

const config = configs[process.env.NODE_ENV] || configs.development;

// Use configuration
const results = await mcp.searchWeb({
  query: "example query",
  ...config.search
});
```

These examples demonstrate the full capabilities of the MCP WebScraper server and provide practical patterns for real-world usage. Each tool can be used independently or combined with others to create powerful data extraction and analysis workflows.