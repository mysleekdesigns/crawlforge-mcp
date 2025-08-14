# MCP WebScraper Tools Guide

A comprehensive guide to all 16 MCP WebScraper tools, organized by difficulty level to help you learn progressively.

## 📚 Table of Contents

- [Quick Tool Selection Guide](#quick-tool-selection-guide)
- [Beginner Tools (Start Here!)](#beginner-tools-start-here)
- [Intermediate Tools](#intermediate-tools)
- [Advanced Tools](#advanced-tools)
- [Expert Tools](#expert-tools)

---

## Quick Tool Selection Guide

**What do you want to do?**

| Task | Tool to Use | Difficulty |
|------|------------|------------|
| Get a webpage | `fetch_url` | Beginner |
| Extract clean text | `extract_text` | Beginner |
| Find all links | `extract_links` | Beginner |
| Get page metadata | `extract_metadata` | Beginner |
| Extract specific data | `scrape_structured` | Beginner |
| Search the web | `search_web` | Intermediate |
| Crawl entire websites | `crawl_deep` | Intermediate |
| Map website structure | `map_site` | Intermediate |
| Extract main content | `extract_content` | Intermediate |
| Process PDFs | `process_document` | Intermediate |
| Summarize text | `summarize_content` | Intermediate |
| Analyze content | `analyze_content` | Intermediate |
| Scrape multiple URLs | `batch_scrape` | Advanced |
| Automate browser actions | `scrape_with_actions` | Advanced |
| Conduct deep research | `deep_research` | Expert |
| Track website changes | `track_changes` | Expert |

---

## 🟢 Beginner Tools (Start Here!)

These tools are simple, require minimal configuration, and are perfect for learning web scraping basics.

### 1. `fetch_url` - Get Any Webpage

**What it does:** Downloads the HTML content of any webpage.

**Simple Example:**
```javascript
{
  "url": "https://example.com"
}
```

**With Options:**
```javascript
{
  "url": "https://example.com",
  "headers": {
    "User-Agent": "My Bot 1.0"
  },
  "timeout": 15000  // 15 seconds
}
```

**When to use:** 
- Getting raw HTML for analysis
- Checking if a website is accessible
- Downloading webpage source code

---

### 2. `extract_text` - Get Clean Text

**What it does:** Extracts readable text from a webpage, removing HTML tags and scripts.

**Simple Example:**
```javascript
{
  "url": "https://example.com/article"
}
```

**Response includes:**
- Clean text content
- Word count
- Character count

**When to use:**
- Reading articles without formatting
- Getting content for analysis
- Creating text summaries

---

### 3. `extract_links` - Find All Links

**What it does:** Discovers all links on a webpage.

**Simple Example:**
```javascript
{
  "url": "https://example.com"
}
```

**Filter External Links:**
```javascript
{
  "url": "https://example.com",
  "filter_external": true  // Only internal links
}
```

**When to use:**
- Building site maps
- Finding related pages
- Discovering resources

---

### 4. `extract_metadata` - Get Page Information

**What it does:** Extracts title, description, keywords, and social media tags.

**Simple Example:**
```javascript
{
  "url": "https://example.com"
}
```

**Response includes:**
- Page title and description
- Open Graph tags (Facebook)
- Twitter Card data
- Keywords and author

**When to use:**
- SEO analysis
- Social media preview data
- Page categorization

---

### 5. `scrape_structured` - Extract Specific Data

**What it does:** Uses CSS selectors to extract specific elements.

**Simple Example:**
```javascript
{
  "url": "https://example.com/products",
  "selectors": {
    "title": "h1",
    "price": ".price",
    "description": ".product-desc"
  }
}
```

**When to use:**
- Extracting product information
- Getting specific page elements
- Building datasets

---

## 🟡 Intermediate Tools

These tools handle more complex scenarios and require some understanding of web scraping concepts.

### 6. `search_web` - Search Google/DuckDuckGo

**What it does:** Performs web searches and returns results.

**Simple Search:**
```javascript
{
  "query": "machine learning tutorials",
  "limit": 10
}
```

**Advanced Search:**
```javascript
{
  "query": "climate change",
  "limit": 20,
  "time_range": "month",  // Last month only
  "site": "nature.com",   // Search specific site
  "file_type": "pdf"      // Find PDFs only
}
```

**When to use:**
- Finding information on topics
- Discovering relevant websites
- Research tasks

---

### 7. `crawl_deep` - Explore Entire Websites

**What it does:** Systematically visits all pages on a website up to a specified depth.

**Simple Crawl:**
```javascript
{
  "url": "https://example.com",
  "max_depth": 2,
  "max_pages": 50
}
```

**Advanced Crawl:**
```javascript
{
  "url": "https://example.com",
  "max_depth": 3,
  "max_pages": 100,
  "include_patterns": ["/blog/*", "/docs/*"],
  "exclude_patterns": ["/admin/*"],
  "extract_content": true
}
```

**When to use:**
- Indexing entire websites
- Finding all content
- Building comprehensive datasets

---

### 8. `map_site` - Discover Website Structure

**What it does:** Creates a map of all URLs on a website.

**Simple Mapping:**
```javascript
{
  "url": "https://example.com",
  "max_urls": 100
}
```

**With Sitemap:**
```javascript
{
  "url": "https://example.com",
  "include_sitemap": true,
  "include_metadata": true
}
```

**When to use:**
- Understanding site architecture
- Planning crawl strategies
- SEO audits

---

### 9. `extract_content` - Smart Content Extraction

**What it does:** Intelligently extracts the main content using readability algorithms.

**Simple Example:**
```javascript
{
  "url": "https://example.com/article"
}
```

**Response includes:**
- Main article content
- Readability score
- Structured data (JSON-LD)
- Article metadata

**When to use:**
- Extracting articles
- Getting main content only
- Removing ads and navigation

---

### 10. `process_document` - Handle Multiple Formats

**What it does:** Processes various document types including PDFs and dynamic pages.

**PDF Processing:**
```javascript
{
  "source": "https://example.com/report.pdf",
  "sourceType": "pdf_url"
}
```

**Dynamic Page:**
```javascript
{
  "source": "https://example.com/spa",
  "sourceType": "url",
  "options": {
    "waitForSelector": "#content"
  }
}
```

**When to use:**
- Processing PDFs
- Handling JavaScript-heavy sites
- Multi-format documents

---

### 11. `summarize_content` - Create Summaries

**What it does:** Generates intelligent summaries of text content.

**Simple Summary:**
```javascript
{
  "text": "Long article text here..."
}
```

**Response includes:**
- Key sentences summary
- Main topics identified
- Summary statistics

**When to use:**
- Creating brief overviews
- Extracting key points
- Content analysis

---

### 12. `analyze_content` - Deep Content Analysis

**What it does:** Performs comprehensive content analysis including language detection and sentiment.

**Simple Analysis:**
```javascript
{
  "text": "Content to analyze..."
}
```

**Response includes:**
- Language detection
- Topic extraction
- Entity recognition
- Sentiment analysis

**When to use:**
- Understanding content themes
- Language classification
- Content categorization

---

## 🔴 Advanced Tools

These tools handle complex scenarios and browser automation.

### 13. `batch_scrape` - Process Multiple URLs

**What it does:** Efficiently scrapes multiple URLs with job management.

**Simple Batch:**
```javascript
{
  "urls": [
    "https://example.com/page1",
    "https://example.com/page2",
    "https://example.com/page3"
  ],
  "formats": ["json", "markdown"]
}
```

**Advanced Batch with Webhooks:**
```javascript
{
  "urls": [
    {"url": "https://example.com/product1", "selectors": {"price": ".price"}},
    {"url": "https://example.com/product2", "selectors": {"price": ".price"}}
  ],
  "mode": "async",
  "webhook": {
    "url": "https://myapp.com/webhook",
    "events": ["batch_completed"]
  },
  "maxConcurrency": 5
}
```

**When to use:**
- Processing product catalogs
- Bulk data extraction
- Large-scale scraping

---

### 14. `scrape_with_actions` - Browser Automation

**What it does:** Automates browser interactions before scraping (clicking, typing, scrolling).

**Simple Form Fill:**
```javascript
{
  "url": "https://example.com/search",
  "actions": [
    {"type": "type", "selector": "#search", "text": "laptops"},
    {"type": "click", "selector": "#submit"},
    {"type": "wait", "timeout": 2000}
  ]
}
```

**Complex Automation:**
```javascript
{
  "url": "https://example.com/login",
  "formAutoFill": {
    "fields": [
      {"selector": "#email", "value": "user@example.com"},
      {"selector": "#password", "value": "password123"}
    ],
    "submitSelector": "#login-button"
  },
  "actions": [
    {"type": "wait", "timeout": 3000},
    {"type": "click", "selector": "#dashboard"},
    {"type": "screenshot", "description": "Dashboard view"}
  ]
}
```

**When to use:**
- Filling forms
- Navigating complex sites
- Automating interactions

---

## 🚀 Expert Tools

These are the most powerful tools for specialized use cases.

### 15. `deep_research` - AI-Powered Research

**What it does:** Conducts comprehensive multi-stage research with source verification and conflict detection.

**Simple Research:**
```javascript
{
  "topic": "renewable energy storage solutions",
  "researchApproach": "broad",
  "outputFormat": "summary"
}
```

**Academic Research:**
```javascript
{
  "topic": "quantum computing applications in cryptography",
  "maxDepth": 8,
  "maxUrls": 200,
  "researchApproach": "academic",
  "sourceTypes": ["academic", "government"],
  "credibilityThreshold": 0.7,
  "enableConflictDetection": true,
  "outputFormat": "comprehensive"
}
```

**Research Approaches:**
- `broad` - General exploration
- `focused` - Specific investigation
- `academic` - Scholarly sources
- `current_events` - Recent news
- `comparative` - Multiple viewpoints

**When to use:**
- Academic research
- Market analysis
- Competitive intelligence
- Fact-checking

---

### 16. `track_changes` - Monitor Websites

**What it does:** Tracks changes to websites over time with notifications.

**Create Baseline:**
```javascript
{
  "url": "https://example.com/pricing",
  "operation": "create_baseline"
}
```

**Compare Changes:**
```javascript
{
  "url": "https://example.com/pricing",
  "operation": "compare",
  "trackingOptions": {
    "granularity": "text",
    "trackText": true,
    "trackLinks": true
  }
}
```

**Monitor with Notifications:**
```javascript
{
  "url": "https://example.com/news",
  "operation": "monitor",
  "monitoringOptions": {
    "enabled": true,
    "interval": 3600000,  // Check every hour
    "notificationThreshold": "moderate",
    "webhookUrl": "https://myapp.com/webhook"
  }
}
```

**When to use:**
- Price monitoring
- Content updates tracking
- Competitor monitoring
- News alerts

---

## 🎯 Common Workflows

Learn the most effective combinations of tools for common tasks:

### Research Workflow
1. **Find Sources**: `search_web` to discover relevant websites
2. **Deep Dive**: `deep_research` for comprehensive analysis
3. **Summarize**: `summarize_content` to extract key findings
4. **Monitor**: `track_changes` to stay updated

### E-commerce Monitoring
1. **Map Structure**: `map_site` to find all product pages
2. **Extract Data**: `batch_scrape` to get prices and details
3. **Track Changes**: `track_changes` to monitor updates
4. **Alert**: Set up webhooks for price changes

### Content Aggregation
1. **Discover Pages**: `crawl_deep` to find all content
2. **Extract Content**: `extract_content` for main articles
3. **Categorize**: `analyze_content` for topic classification
4. **Process**: `summarize_content` for brief overviews

### Competitive Intelligence
1. **Research Market**: `deep_research` for industry analysis
2. **Monitor Competitors**: `track_changes` on key pages
3. **Stealth Analysis**: `scrape_with_actions` for detailed investigation
4. **Batch Processing**: `batch_scrape` for systematic data collection

---

## 💡 Best Practices

### For Beginners
- **Start Simple**: Begin with `fetch_url` and `extract_text`
- **Test Small**: Use limits of 10-20 pages initially
- **Check Robots**: Always respect robots.txt
- **Handle Errors**: Expect some websites to fail

### For Performance
- **Use Batch Tools**: `batch_scrape` is faster than sequential calls
- **Enable Caching**: Avoid re-fetching the same content
- **Set Timeouts**: Prevent hanging requests
- **Monitor Resources**: Watch memory and CPU usage

### For Reliability
- **Add Delays**: Don't overwhelm target servers
- **Use Rate Limits**: Respect website policies
- **Handle Failures**: Implement retry logic
- **Monitor Health**: Use health check endpoints

### For Security
- **Validate URLs**: Check for malicious or private addresses
- **Sanitize Content**: Clean extracted data
- **Use HTTPS**: Secure connections only
- **Limit Scope**: Don't crawl entire internet

### Tool-Specific Tips

**Search Tools:**
- Use specific keywords for better results
- Try different search providers if one fails
- Filter by date for recent information

**Crawling Tools:**
- Start with shallow depth (2-3 levels)
- Use include/exclude patterns wisely
- Monitor progress with smaller batches first

**Content Tools:**
- Check content quality scores
- Use structured data when available
- Handle different languages appropriately

**Advanced Tools:**
- Test stealth mode on non-critical sites first
- Set up proper webhook endpoints
- Monitor change detection carefully

---

## 🆘 Getting Help

- **Troubleshooting:** See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- **API Details:** See [API_REFERENCE.md](./API_REFERENCE.md)
- **Examples:** See [EXAMPLES.md](./EXAMPLES.md)
- **Setup:** See [GETTING_STARTED.md](./GETTING_STARTED.md)

---

*Last updated: January 2025 | Version 3.0 | 16 Tools Available*