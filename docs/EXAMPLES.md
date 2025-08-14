# Real-World Examples

Practical examples showing how to solve common problems with MCP WebScraper. Each example includes the problem, solution approach, and complete implementation.

## 📚 Quick Navigation

- [Getting Started](#getting-started)
- [Business Intelligence](#business-intelligence) 
- [Research & Analysis](#research--analysis)
- [Monitoring & Alerts](#monitoring--alerts)
- [E-commerce & Shopping](#e-commerce--shopping)
- [Complete Workflows](#complete-workflows)

---

## 🚀 Getting Started

### Simple Page Analysis

**Problem**: Need to quickly analyze a webpage's content and structure.

**Solution**: Use basic tools to extract key information.

```javascript
// Get page content
{
  "tool": "fetch_url",
  "parameters": {
    "url": "https://example.com/blog-post"
  }
}

// Extract main content
{
  "tool": "extract_content",
  "parameters": {
    "url": "https://example.com/blog-post",
    "options": {
      "includeReadabilityScore": true,
      "includeStructuredData": true
    }
  }
}

// Analyze the content
{
  "tool": "analyze_content", 
  "parameters": {
    "text": "[Content from previous step]",
    "options": {
      "analyzeSentiment": true,
      "extractTopics": true,
      "detectLanguage": true
    }
  }
}
```

### Quick Data Collection

**Problem**: Extract specific data points from a website.

**Solution**: Use structured scraping with CSS selectors.

```javascript
{
  "tool": "scrape_structured",
  "parameters": {
    "url": "https://news-site.com",
    "selectors": {
      "headlines": "h1, h2.headline",
      "summaries": ".article-excerpt",
      "authors": ".byline",
      "dates": ".publish-date",
      "categories": ".category-tag"
    }
  }
}
```

---

## 💼 Business Intelligence

### Market Research Dashboard

**Problem**: Need to research the AI chatbot market and track key players.

**Solution**: Combine deep research with change monitoring for ongoing intelligence.

```javascript
// Step 1: Comprehensive market research
{
  "tool": "deep_research",
  "parameters": {
    "topic": "AI chatbot market 2024 key players pricing strategies",
    "researchApproach": "current_events",
    "maxUrls": 100,
    "sourceTypes": ["industry", "news", "company"],
    "outputFormat": "comprehensive"
  }
}

// Step 2: Monitor competitor pricing pages
{
  "tool": "track_changes",
  "parameters": {
    "url": "https://openai.com/pricing",
    "operation": "create_baseline"
  }
}

// Step 3: Set up alerts for changes
{
  "tool": "track_changes", 
  "parameters": {
    "url": "https://openai.com/pricing",
    "operation": "monitor",
    "monitoringOptions": {
      "interval": 86400000,  // Daily checks
      "webhookUrl": "https://your-company.com/alerts"
    }
  }
}
```

### Competitor Analysis

**Problem**: Track what competitors are doing with their features and messaging.

**Solution**: Stealth scraping with automated monitoring.

```javascript
// Analyze competitor features without detection
{
  "tool": "scrape_with_actions",
  "parameters": {
    "url": "https://competitor.com/features",
    "actions": [
      { "type": "wait", "timeout": 3000 },
      { "type": "screenshot", "description": "Feature overview" },
      { "type": "scroll", "selector": "body" },
      { "type": "screenshot", "description": "Full feature list" }
    ],
    "browserOptions": {
      "stealthMode": {
        "enabled": true,
        "level": "medium",
        "randomizeUserAgent": true
      }
    }
  }
}
```

### Industry News Monitoring

**Problem**: Stay updated on industry developments that could affect your business.

**Solution**: Automated news monitoring with intelligent filtering.

```javascript
// Monitor multiple tech news sources
{
  "tool": "batch_scrape",
  "parameters": {
    "urls": [
      {
        "url": "https://techcrunch.com/category/artificial-intelligence/",
        "selectors": {
          "headlines": ".post-title",
          "summaries": ".excerpt",
          "dates": ".date"
        }
      },
      {
        "url": "https://venturebeat.com/ai/",
        "selectors": {
          "headlines": "h2.entry-title",
          "summaries": ".excerpt"
        }
      }
    ],
    "mode": "async",
    "webhook": {
      "url": "https://your-news-processor.com/webhook",
      "events": ["batch_completed"]
    }
  }
}
```

---

## 🔍 Research & Analysis

### Academic Literature Review

**Problem**: Need to research a scientific topic with source verification.

**Solution**: Deep research with conflict detection and credibility analysis.

```javascript
{
  "tool": "deep_research",
  "parameters": {
    "topic": "machine learning bias in healthcare systems",
    "researchApproach": "academic",
    "maxUrls": 150,
    "sourceTypes": ["academic", "government", "medical"],
    "credibilityThreshold": 0.7,
    "enableConflictDetection": true,
    "enableSourceVerification": true,
    "outputFormat": "comprehensive"
  }
}
```

### Content Quality Analysis

**Problem**: Analyze the quality and sentiment of competitor content.

**Solution**: Extract and analyze content across multiple pages.

```javascript
// Extract main content from competitor blog
{
  "tool": "extract_content",
  "parameters": {
    "url": "https://competitor.com/blog/latest-post",
    "options": {
      "includeStructuredData": true,
      "includeReadabilityScore": true
    }
  }
}

// Analyze the content
{
  "tool": "analyze_content",
  "parameters": {
    "text": "[Content from previous step]",
    "options": {
      "analyzeSentiment": true,
      "extractTopics": true,
      "detectLanguage": true,
      "includeAdvancedMetrics": true
    }
  }
}
```

### Market Trend Analysis

**Problem**: Understand market trends by analyzing multiple sources.

**Solution**: Comprehensive research with temporal analysis.

```javascript
{
  "tool": "deep_research",
  "parameters": {
    "topic": "remote work software adoption trends 2024",
    "researchApproach": "comparative",
    "maxUrls": 120,
    "sourceTypes": ["industry", "survey", "research"],
    "timeLimit": 300000,
    "queryExpansion": {
      "enableSynonyms": true,
      "enableContextual": true
    }
  }
}
```

---

## 🔔 Monitoring & Alerts

### Website Change Detection

**Problem**: Monitor competitor pricing and get notified of changes.

**Solution**: Automated monitoring with smart notifications.

```javascript
// Create monitoring baseline
{
  "tool": "track_changes",
  "parameters": {
    "url": "https://competitor.com/pricing",
    "operation": "create_baseline",
    "trackingOptions": {
      "granularity": "element",
      "customSelectors": [".price", ".plan-name", ".feature-list"],
      "excludeSelectors": [".timestamp", ".last-updated"]
    }
  }
}

// Set up monitoring with alerts
{
  "tool": "track_changes",
  "parameters": {
    "url": "https://competitor.com/pricing",
    "operation": "monitor",
    "monitoringOptions": {
      "enabled": true,
      "interval": 14400000,  // Check every 4 hours
      "notificationThreshold": "minor",
      "enableWebhook": true,
      "webhookUrl": "https://your-alerts.com/webhook"
    }
  }
}
```

### News Alert System

**Problem**: Get immediate alerts when specific topics appear in news.

**Solution**: Continuous monitoring with keyword filtering.

```javascript
// Monitor multiple news sources
[
  {
    "tool": "track_changes",
    "parameters": {
      "url": "https://techcrunch.com/",
      "operation": "monitor",
      "trackingOptions": {
        "customSelectors": [".post-title", ".excerpt"],
        "keywordFilters": ["AI regulation", "ChatGPT", "OpenAI"]
      },
      "monitoringOptions": {
        "interval": 1800000,  // Every 30 minutes
        "webhookUrl": "https://news-alerts.com/webhook"
      }
    }
  },
  {
    "tool": "track_changes",
    "parameters": {
      "url": "https://www.theverge.com/tech",
      "operation": "monitor",
      "trackingOptions": {
        "customSelectors": [".entry-title", ".excerpt"],
        "keywordFilters": ["artificial intelligence", "machine learning"]
      }
    }
  }
]
```

### Compliance Monitoring

**Problem**: Monitor privacy policy changes for compliance.

**Solution**: Detailed change tracking with legal focus.

```javascript
{
  "tool": "track_changes",
  "parameters": {
    "url": "https://yourcompany.com/privacy-policy",
    "operation": "monitor",
    "trackingOptions": {
      "granularity": "section",
      "trackText": true,
      "trackStructure": true,
      "customSelectors": [".policy-section", ".effective-date"],
      "significanceThresholds": {
        "minor": 0.02,
        "moderate": 0.1,
        "major": 0.3
      }
    },
    "monitoringOptions": {
      "scheduleType": "cron",
      "cronExpression": "0 9 * * 1",  // Weekly Monday at 9 AM
      "notificationOptions": {
        "includeScreenshots": true,
        "includeDiff": true,
        "alertSeverity": "high"
      }
    }
  }
}
```

---

## 🛒 E-commerce & Shopping

### Price Comparison System

**Problem**: Compare prices across multiple e-commerce sites.

**Solution**: Batch scraping with stealth mode to avoid detection.

```javascript
{
  "tool": "batch_scrape",
  "parameters": {
    "urls": [
      {
        "url": "https://amazon.com/dp/B08N5WRWNW",
        "selectors": {
          "title": "#productTitle",
          "price": ".a-price-whole",
          "rating": "[data-hook='average-star-rating']",
          "availability": "#availability span"
        }
      },
      {
        "url": "https://bestbuy.com/site/product/6418599.p",
        "selectors": {
          "title": ".sku-title",
          "price": ".sr-only",
          "rating": ".stars"
        }
      }
    ],
    "mode": "async",
    "maxConcurrency": 3,
    "delayBetweenRequests": 2000,
    "globalOptions": {
      "stealthMode": {
        "enabled": true,
        "level": "medium"
      }
    },
    "formats": ["json"]
  }
}
```

### Product Catalog Analysis

**Problem**: Analyze competitor product catalogs for gaps and opportunities.

**Solution**: Deep crawling with structured data extraction.

```javascript
// First, map the site structure
{
  "tool": "map_site",
  "parameters": {
    "url": "https://competitor-store.com",
    "maxUrls": 500,
    "includePatterns": ["/products/*", "/category/*"],
    "includeMetadata": true
  }
}

// Then crawl product pages
{
  "tool": "crawl_deep",
  "parameters": {
    "url": "https://competitor-store.com/products",
    "maxDepth": 3,
    "maxPages": 200,
    "includePatterns": ["/products/*"],
    "extractContent": true,
    "extractStructuredData": true
  }
}
```

### Inventory Monitoring

**Problem**: Track stock levels and availability changes.

**Solution**: Regular monitoring with instant alerts.

```javascript
// Monitor specific products for availability
{
  "tool": "track_changes",
  "parameters": {
    "url": "https://store.com/limited-edition-product",
    "operation": "monitor",
    "trackingOptions": {
      "customSelectors": [".stock-status", ".availability", ".add-to-cart"],
      "textFilters": ["in stock", "out of stock", "available"]
    },
    "monitoringOptions": {
      "interval": 600000,  // Check every 10 minutes
      "enableWebhook": true,
      "webhookUrl": "https://inventory-alerts.com/webhook"
    }
  }
}
```

---

## 🔄 Complete Workflows

### Comprehensive Competitive Intelligence

**Problem**: Set up complete competitive monitoring system.

**Solution**: Multi-stage workflow combining research, monitoring, and analysis.

```javascript
// Stage 1: Initial competitor research
{
  "tool": "deep_research",
  "parameters": {
    "topic": "Competitor Inc product strategy pricing features",
    "researchApproach": "current_events",
    "maxUrls": 80,
    "sourceTypes": ["news", "industry", "company"],
    "outputFormat": "comprehensive"
  }
}

// Stage 2: Analyze competitor website
{
  "tool": "scrape_with_actions",
  "parameters": {
    "url": "https://competitor.com",
    "actions": [
      { "type": "screenshot", "description": "Homepage" },
      { "type": "click", "selector": ".pricing-nav" },
      { "type": "screenshot", "description": "Pricing page" },
      { "type": "click", "selector": ".features-nav" },
      { "type": "screenshot", "description": "Features page" }
    ],
    "browserOptions": {
      "stealthMode": {
        "enabled": true,
        "level": "advanced"
      }
    }
  }
}

// Stage 3: Set up ongoing monitoring
{
  "tool": "track_changes",
  "parameters": {
    "url": "https://competitor.com/pricing",
    "operation": "monitor",
    "trackingOptions": {
      "customSelectors": [".price", ".feature-list", ".plan-name"]
    },
    "monitoringOptions": {
      "interval": 21600000,  // Every 6 hours
      "webhookUrl": "https://your-crm.com/competitor-updates"
    }
  }
}
```

### Content Strategy Research

**Problem**: Research content trends and track key industry sources.

**Solution**: Research-driven content planning with ongoing monitoring.

```javascript
// Stage 1: Research trending topics
{
  "tool": "deep_research",
  "parameters": {
    "topic": "B2B SaaS content marketing trends 2024",
    "researchApproach": "current_events",
    "maxUrls": 100,
    "sourceTypes": ["industry", "marketing", "research"],
    "outputFormat": "summary"
  }
}

// Stage 2: Analyze competitor content
{
  "tool": "crawl_deep",
  "parameters": {
    "url": "https://competitor.com/blog",
    "maxDepth": 3,
    "maxPages": 50,
    "includePatterns": ["/blog/*"],
    "extractContent": true
  }
}

// Stage 3: Monitor industry sources for new content
{
  "tool": "batch_scrape",
  "parameters": {
    "urls": [
      {
        "url": "https://contentmarketinginstitute.com/blog/",
        "selectors": {
          "titles": ".entry-title",
          "dates": ".entry-date",
          "categories": ".entry-category"
        }
      },
      {
        "url": "https://blog.hubspot.com/marketing",
        "selectors": {
          "titles": ".blog-post-title",
          "summaries": ".blog-post-summary"
        }
      }
    ],
    "mode": "async",
    "webhook": {
      "url": "https://content-pipeline.com/webhook"
    }
  }
}
```

### Investment Research Pipeline

**Problem**: Create systematic investment research with risk monitoring.

**Solution**: Multi-source research with sentiment and regulatory tracking.

```javascript
// Stage 1: Company fundamental research
{
  "tool": "deep_research",
  "parameters": {
    "topic": "Tesla Inc financial performance 2024 electric vehicle market share",
    "researchApproach": "broad",
    "maxUrls": 120,
    "sourceTypes": ["financial", "industry", "company"],
    "credibilityThreshold": 0.8,
    "enableConflictDetection": true
  }
}

// Stage 2: Monitor regulatory changes
{
  "tool": "track_changes",
  "parameters": {
    "url": "https://www.sec.gov/news/pressreleases",
    "operation": "monitor",
    "trackingOptions": {
      "customSelectors": [".news-headline", ".press-release-title"],
      "keywordFilters": ["Tesla", "electric vehicle", "automotive"]
    },
    "monitoringOptions": {
      "interval": 7200000,  // Every 2 hours
      "webhookUrl": "https://investment-alerts.com/regulatory"
    }
  }
}

// Stage 3: Sentiment analysis on recent news
{
  "tool": "search_web",
  "parameters": {
    "query": "Tesla stock news analysis",
    "limit": 50,
    "time_range": "week"
  }
}

// Then analyze sentiment of results
{
  "tool": "analyze_content",
  "parameters": {
    "text": "[Combined text from search results]",
    "options": {
      "analyzeSentiment": true,
      "extractTopics": true,
      "includeAdvancedMetrics": true
    }
  }
}
```

---

## 💡 Best Practices for Examples

### Error Handling
Always implement proper error handling in your workflows:

```javascript
// Include retry logic and fallbacks
{
  "tool": "batch_scrape",
  "parameters": {
    "urls": ["https://site1.com", "https://site2.com"],
    "retryOptions": {
      "maxRetries": 3,
      "retryDelay": 2000
    },
    "errorHandling": "continue"  // Continue on individual failures
  }
}
```

### Rate Limiting
Respect website policies and avoid overwhelming servers:

```javascript
{
  "tool": "crawl_deep",
  "parameters": {
    "url": "https://example.com",
    "maxPages": 100,
    "respectRobotsTxt": true,
    "delayBetweenRequests": 1000,  // 1 second delay
    "maxConcurrentRequests": 3
  }
}
```

### Data Quality
Always validate and clean your extracted data:

```javascript
// Use structured selectors with fallbacks
{
  "tool": "scrape_structured", 
  "parameters": {
    "url": "https://example.com",
    "selectors": {
      "price": [".price-new", ".price", ".cost"],  // Multiple fallback selectors
      "title": "h1, .product-title, .name"
    },
    "validateResults": true
  }
}
```

---

## 🚀 Next Steps

- **Start Simple**: Begin with basic examples and gradually add complexity
- **Test Thoroughly**: Validate your workflows with small datasets first
- **Monitor Performance**: Track success rates and response times
- **Scale Gradually**: Increase limits and concurrency as needed
- **Stay Compliant**: Always respect robots.txt and rate limits

For more detailed tool documentation, see [API_REFERENCE.md](./API_REFERENCE.md).
For troubleshooting help, see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).