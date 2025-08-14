# MCP WebScraper Examples

Practical, copy-paste examples organized by use case. Start with simple examples and work your way up!

## 📚 Quick Links

- [Simple Web Scraping](#simple-web-scraping)
- [Search and Discovery](#search-and-discovery)
- [Data Extraction](#data-extraction)
- [Content Processing](#content-processing)
- [Automation](#automation)
- [Research and Monitoring](#research-and-monitoring)
- [Complete Workflows](#complete-workflows)

---

## 🟢 Simple Web Scraping

Start with these basic examples to understand how web scraping works.

### Get a Web Page

**Ask your AI:**
```
Get the HTML content from https://example.com
```

**Tool used:** `fetch_url`
```javascript
{
  "url": "https://example.com"
}
```

### Extract Text from Article

**Ask your AI:**
```
Extract just the text from this article: https://en.wikipedia.org/wiki/Artificial_intelligence
```

**Tool used:** `extract_text`
```javascript
{
  "url": "https://en.wikipedia.org/wiki/Artificial_intelligence"
}
```

### Find All Links

**Ask your AI:**
```
Find all the links on the Hacker News homepage
```

**Tool used:** `extract_links`
```javascript
{
  "url": "https://news.ycombinator.com",
  "filter_external": false
}
```

---

## 🔍 Search and Discovery

### Basic Web Search

**Ask your AI:**
```
Search for "best programming languages 2024" and show me the top 10 results
```

**Tool used:** `search_web`
```javascript
{
  "query": "best programming languages 2024",
  "limit": 10
}
```

### Search Specific Website

**Ask your AI:**
```
Search for machine learning articles only on MIT's website
```

**Tool used:** `search_web`
```javascript
{
  "query": "machine learning",
  "site": "mit.edu",
  "limit": 20
}
```

### Map Website Structure

**Ask your AI:**
```
Show me all the pages on example.com
```

**Tool used:** `map_site`
```javascript
{
  "url": "https://example.com",
  "max_urls": 100
}
```

---

## 📊 Data Extraction

### Extract Product Information

**Ask your AI:**
```
Extract the product title and price from this Amazon page: [URL]
```

**Tool used:** `scrape_structured`
```javascript
{
  "url": "https://example-shop.com/product",
  "selectors": {
    "title": "h1.product-title",
    "price": ".price-now",
    "description": ".product-description",
    "rating": ".star-rating"
  }
}
```

### Extract News Headlines

**Ask your AI:**
```
Get all the headlines from CNN's homepage
```

**Tool used:** `scrape_structured`
```javascript
{
  "url": "https://cnn.com",
  "selectors": {
    "headlines": "h2, h3",
    "links": "h2 a, h3 a"
  }
}
```

---

## 🧠 Deep Research Examples

### Academic Literature Review

Conduct comprehensive research on a scientific topic with source verification and conflict analysis.

```javascript
// Request to Claude or Cursor
"Conduct a comprehensive academic research on 'machine learning bias in healthcare' 
with source verification and conflict detection."

// MCP Tool Call
{
  "tool": "deep_research",
  "parameters": {
    "topic": "machine learning bias in healthcare systems",
    "maxDepth": 8,
    "maxUrls": 150,
    "timeLimit": 300000,
    "researchApproach": "academic",
    "sourceTypes": ["academic", "government", "medical"],
    "credibilityThreshold": 0.7,
    "enableConflictDetection": true,
    "enableSourceVerification": true,
    "outputFormat": "comprehensive",
    "queryExpansion": {
      "enableSynonyms": true,
      "enableContextual": true,
      "maxVariations": 20
    }
  }
}
```

**Expected Response:**
```json
{
  "success": true,
  "sessionId": "research_ml_bias_healthcare_001",
  "researchSummary": {
    "totalSources": 87,
    "verifiedSources": 71,
    "keyFindings": 12,
    "conflictsFound": 4,
    "consensusAreas": 8
  },
  "findings": [
    {
      "finding": "Algorithmic bias in healthcare ML systems disproportionately affects minority populations with error rates 15-20% higher than baseline populations",
      "confidence": 0.92,
      "sources": [
        "https://www.nature.com/articles/s41591-019-0548-6",
        "https://jamanetwork.com/journals/jama/fullarticle/2735726"
      ],
      "category": "primary_insight",
      "significance": "high"
    }
  ],
  "conflicts": [
    {
      "topic": "Effectiveness of bias mitigation techniques",
      "positions": [
        {
          "stance": "Pre-processing methods most effective",
          "sources": ["https://academic-source-1.com"],
          "credibility": 0.85
        },
        {
          "stance": "Post-processing methods show better results",
          "sources": ["https://academic-source-2.com"],
          "credibility": 0.82
        }
      ],
      "severity": "moderate"
    }
  ]
}
```

### Market Research with Competitive Analysis

Research a market space with focus on recent developments and competitor analysis.

```javascript
// Request to AI
"Research the current state of AI chatbot market with competitive analysis"

{
  "tool": "deep_research",
  "parameters": {
    "topic": "AI chatbot market 2024 competitive landscape",
    "maxDepth": 6,
    "maxUrls": 100,
    "researchApproach": "current_events",
    "sourceTypes": ["news", "industry", "company"],
    "includeRecentOnly": true,
    "timeLimit": 240000,
    "outputFormat": "summary",
    "enableConflictDetection": true
  }
}
```

### Fact-Checking Investigation

Investigate claims and verify information across multiple sources.

```javascript
// Request to AI
"Investigate claims about renewable energy job creation with conflict detection"

{
  "tool": "deep_research", 
  "parameters": {
    "topic": "renewable energy job creation statistics 2024",
    "maxDepth": 7,
    "maxUrls": 80,
    "researchApproach": "comparative",
    "sourceTypes": ["government", "academic", "industry"],
    "credibilityThreshold": 0.6,
    "enableConflictDetection": true,
    "outputFormat": "conflicts_focus",
    "timeLimit": 180000
  }
}
```

---

## 🥷 Stealth Mode Examples

### Stealth Competitive Analysis

Analyze competitor websites without detection using advanced stealth features.

```javascript
// Request to AI
"Scrape competitor pricing pages using stealth mode to avoid detection"

{
  "tool": "scrape_with_actions",
  "parameters": {
    "url": "https://competitor.com/pricing",
    "actions": [
      { 
        "type": "wait", 
        "timeout": 3000,
        "description": "Wait for page load" 
      },
      { 
        "type": "scroll", 
        "selector": "body",
        "description": "Scroll to load dynamic content"
      },
      { 
        "type": "screenshot", 
        "description": "Capture pricing table" 
      }
    ],
    "browserOptions": {
      "stealthMode": {
        "enabled": true,
        "level": "advanced",
        "randomizeFingerprint": true,
        "hideWebDriver": true,
        "blockWebRTC": true,
        "preventCanvas": true
      },
      "humanBehavior": {
        "enabled": true,
        "mouseMovements": true,
        "scrollBehavior": true,
        "readingTime": true,
        "idlePeriods": true
      }
    },
    "formats": ["json", "screenshots"]
  }
}
```

### Stealth Form Interaction

Fill out forms and interact with websites while simulating human behavior.

```javascript
// Request to AI
"Fill out a contact form on a website using stealth mode with human-like behavior"

{
  "tool": "scrape_with_actions",
  "parameters": {
    "url": "https://example.com/contact",
    "actions": [
      {
        "type": "type",
        "selector": "#name",
        "text": "John Smith",
        "description": "Enter name with natural typing"
      },
      {
        "type": "type", 
        "selector": "#email",
        "text": "john.smith@email.com",
        "description": "Enter email address"
      },
      {
        "type": "type",
        "selector": "#message", 
        "text": "I'm interested in learning more about your services.",
        "description": "Enter message with realistic typing speed"
      },
      {
        "type": "click",
        "selector": "#submit-btn",
        "description": "Submit the form"
      }
    ],
    "browserOptions": {
      "stealthMode": {
        "enabled": true,
        "level": "medium",
        "randomizeUserAgent": true,
        "spoofTimezone": true
      },
      "humanBehavior": {
        "enabled": true,
        "typingVariation": true,
        "mouseMovements": true,
        "mistakeSimulation": {
          "enabled": true,
          "frequency": 0.02
        }
      }
    }
  }
}
```

### Stealth Batch Processing

Process multiple URLs with stealth features to avoid triggering rate limits.

```javascript
// Request to AI
"Scrape product information from multiple e-commerce pages using stealth mode"

{
  "tool": "batch_scrape",
  "parameters": {
    "urls": [
      {
        "url": "https://shop.example.com/product/1",
        "selectors": {
          "title": "h1.product-title",
          "price": ".price",
          "availability": ".stock-status"
        }
      },
      {
        "url": "https://shop.example.com/product/2", 
        "selectors": {
          "title": "h1.product-title",
          "price": ".price",
          "availability": ".stock-status"
        }
      }
    ],
    "mode": "async",
    "maxConcurrency": 3,
    "delayBetweenRequests": 5000,
    "globalOptions": {
      "stealthMode": {
        "enabled": true,
        "level": "medium",
        "randomizeUserAgent": true,
        "humanBehavior": true
      }
    }
  }
}
```

---

## 📊 Change Tracking Examples

### Competitor Price Monitoring

Monitor competitor pricing pages for changes with automated notifications.

```javascript
// Request to AI
"Set up monitoring for competitor pricing changes with notifications"

// Step 1: Create baseline
{
  "tool": "track_changes",
  "parameters": {
    "url": "https://competitor.com/pricing",
    "operation": "create_baseline",
    "trackingOptions": {
      "granularity": "element",
      "trackText": true,
      "trackLinks": true,
      "customSelectors": [
        ".price-card",
        ".plan-features",
        ".pricing-tier"
      ],
      "excludeSelectors": [
        ".timestamp",
        ".last-updated",
        "#chat-widget"
      ]
    }
  }
}

// Step 2: Enable monitoring
{
  "tool": "track_changes",
  "parameters": {
    "url": "https://competitor.com/pricing",
    "operation": "monitor",
    "monitoringOptions": {
      "enabled": true,
      "interval": 14400000,
      "notificationThreshold": "minor",
      "enableWebhook": true,
      "webhookUrl": "https://your-company.com/webhook/pricing-alerts",
      "webhookHeaders": {
        "Authorization": "Bearer webhook-token-123",
        "Content-Type": "application/json"
      }
    },
    "trackingOptions": {
      "significanceThresholds": {
        "minor": 0.05,
        "moderate": 0.2,
        "major": 0.5
      }
    }
  }
}
```

### Content Compliance Monitoring

Monitor website content for compliance and regulatory changes.

```javascript
// Request to AI
"Monitor our privacy policy page for changes to ensure compliance"

{
  "tool": "track_changes",
  "parameters": {
    "url": "https://yourcompany.com/privacy-policy",
    "operation": "monitor",
    "trackingOptions": {
      "granularity": "section",
      "trackText": true,
      "trackStructure": true,
      "customSelectors": [
        ".policy-section",
        ".effective-date",
        ".contact-info"
      ],
      "significanceThresholds": {
        "minor": 0.02,
        "moderate": 0.1,
        "major": 0.3
      }
    },
    "monitoringOptions": {
      "enabled": true,
      "scheduleType": "cron",
      "cronExpression": "0 9 * * 1",
      "timezone": "America/New_York",
      "enableWebhook": true,
      "webhookUrl": "https://compliance-system.com/webhook"
    },
    "notificationOptions": {
      "includeScreenshots": true,
      "includeDiff": true,
      "alertSeverity": "high"
    }
  }
}
```

### News Source Monitoring

Track news sources for breaking developments on specific topics.

```javascript
// Request to AI
"Monitor tech news sites for AI regulation updates"

{
  "tool": "track_changes",
  "parameters": {
    "url": "https://techcrunch.com/tag/artificial-intelligence/",
    "operation": "monitor", 
    "trackingOptions": {
      "granularity": "element",
      "trackText": true,
      "trackLinks": true,
      "customSelectors": [
        ".post-title",
        ".post-excerpt",
        ".featured-article"
      ],
      "excludeSelectors": [
        ".advertisement",
        ".sponsored-content",
        ".social-share"
      ]
    },
    "monitoringOptions": {
      "enabled": true,
      "interval": 1800000,
      "notificationThreshold": "minor",
      "enableWebhook": true,
      "webhookUrl": "https://news-aggregator.com/webhook"
    }
  }
}
```

---

## 🌍 Localization Examples

### Multi-Country Market Research

Research the same topic across different countries with localized results.

```javascript
// Request to AI
"Research electric vehicle adoption rates in Germany, Japan, and Brazil"

// Germany Research
{
  "tool": "deep_research",
  "parameters": {
    "topic": "electric vehicle adoption rates 2024",
    "researchApproach": "current_events",
    "maxUrls": 50,
    "localization": {
      "countryCode": "DE",
      "language": "de-DE",
      "timezone": "Europe/Berlin",
      "searchDomain": "google.de"
    },
    "sourceTypes": ["news", "government", "industry"]
  }
}

// Japan Research  
{
  "tool": "deep_research",
  "parameters": {
    "topic": "electric vehicle adoption rates 2024",
    "researchApproach": "current_events", 
    "maxUrls": 50,
    "localization": {
      "countryCode": "JP",
      "language": "ja-JP",
      "timezone": "Asia/Tokyo",
      "searchDomain": "google.co.jp"
    },
    "sourceTypes": ["news", "government", "industry"]
  }
}
```

### Geo-Restricted Content Access

Access region-specific content using localization emulation.

```javascript
// Request to AI
"Access UK-specific financial news that's geo-blocked from other regions"

{
  "tool": "extract_content",
  "parameters": {
    "url": "https://financial-news-uk.com/exclusive-report",
    "options": {
      "localization": {
        "countryCode": "GB",
        "language": "en-GB",
        "timezone": "Europe/London",
        "geoEmulation": {
          "enabled": true,
          "latitude": 51.5074,
          "longitude": -0.1278
        }
      },
      "stealthMode": {
        "enabled": true,
        "level": "medium"
      }
    }
  }
}
```

### Localized Search Comparison

Compare search results across different countries for the same query.

```javascript
// Request to AI  
"Compare search results for 'climate change policy' across US, EU, and China"

// US Search
{
  "tool": "search_web",
  "parameters": {
    "query": "climate change policy 2024",
    "limit": 20,
    "localization": {
      "countryCode": "US",
      "language": "en-US",
      "searchDomain": "google.com"
    }
  }
}

// Germany Search (EU representative)
{
  "tool": "search_web",
  "parameters": {
    "query": "climate change policy 2024",
    "limit": 20, 
    "localization": {
      "countryCode": "DE",
      "language": "de-DE",
      "searchDomain": "google.de"
    }
  }
}

// China Search
{
  "tool": "search_web",
  "parameters": {
    "query": "climate change policy 2024",
    "limit": 20,
    "localization": {
      "countryCode": "CN",
      "language": "zh-CN",
      "searchDomain": "baidu.com"
    }
  }
}
```

---

## 🔄 Combined Workflow Examples

### Comprehensive Competitive Intelligence

A complete workflow combining deep research, change tracking, and stealth monitoring.

```javascript
// Request to AI
"Set up comprehensive competitive intelligence for our main competitor including research, 
monitoring, and stealth analysis"

// Step 1: Deep research on competitor
const competitorResearch = {
  "tool": "deep_research",
  "parameters": {
    "topic": "Competitor Inc product strategy pricing model",
    "maxDepth": 6,
    "maxUrls": 80,
    "researchApproach": "current_events",
    "sourceTypes": ["news", "industry", "company"],
    "timeLimit": 240000,
    "outputFormat": "comprehensive"
  }
};

// Step 2: Analyze competitor website with stealth
const stealthAnalysis = {
  "tool": "scrape_with_actions",
  "parameters": {
    "url": "https://competitor.com",
    "actions": [
      { "type": "screenshot", "description": "Homepage snapshot" },
      { "type": "scroll", "selector": "body" },
      { "type": "click", "selector": ".products-nav" },
      { "type": "screenshot", "description": "Products page" }
    ],
    "browserOptions": {
      "stealthMode": {
        "enabled": true,
        "level": "advanced",
        "randomizeFingerprint": true
      },
      "humanBehavior": {
        "enabled": true,
        "readingTime": true
      }
    }
  }
};

// Step 3: Set up change monitoring
const changeMonitoring = {
  "tool": "track_changes",
  "parameters": {
    "url": "https://competitor.com/pricing",
    "operation": "monitor",
    "trackingOptions": {
      "granularity": "section",
      "customSelectors": [".price", ".feature-list", ".plan-name"]
    },
    "monitoringOptions": {
      "enabled": true,
      "interval": 21600000,
      "enableWebhook": true,
      "webhookUrl": "https://your-crm.com/competitor-updates"
    }
  }
};
```

### Research-Driven Content Strategy

Combine research, change tracking, and localization for content strategy.

```javascript
// Request to AI
"Research trending topics in AI for content strategy, monitor key sources, 
and track changes across multiple regions"

// Step 1: Research trending AI topics
const trendResearch = {
  "tool": "deep_research",
  "parameters": {
    "topic": "trending artificial intelligence topics 2024",
    "researchApproach": "current_events",
    "maxUrls": 100,
    "sourceTypes": ["news", "industry", "academic"],
    "timeLimit": 300000
  }
};

// Step 2: Monitor key industry sources
const sourceMonitoring = [
  {
    "tool": "track_changes",
    "parameters": {
      "url": "https://ai-news.com",
      "operation": "monitor",
      "monitoringOptions": {
        "interval": 3600000,
        "enableWebhook": true
      }
    }
  },
  {
    "tool": "track_changes", 
    "parameters": {
      "url": "https://techcrunch.com/category/artificial-intelligence/",
      "operation": "monitor",
      "monitoringOptions": {
        "interval": 7200000,
        "enableWebhook": true
      }
    }
  }
];

// Step 3: Regional content analysis
const regionalAnalysis = {
  "tool": "search_web",
  "parameters": {
    "query": "artificial intelligence trends",
    "limit": 30,
    "localization": {
      "countryCode": "JP",
      "language": "ja-JP"
    }
  }
};
```

### Automated Research Pipeline

A complete automated research and monitoring pipeline.

```javascript
// Request to AI
"Create an automated research pipeline for tracking AI safety developments 
with multi-stage verification and continuous monitoring"

// Stage 1: Initial broad research
const initialResearch = {
  "tool": "deep_research",
  "parameters": {
    "topic": "AI safety research developments 2024",
    "researchApproach": "academic",
    "maxDepth": 8,
    "maxUrls": 150,
    "sourceTypes": ["academic", "government"],
    "credibilityThreshold": 0.8,
    "outputFormat": "comprehensive",
    "enableConflictDetection": true
  }
};

// Stage 2: Monitor identified key sources
const keySourceMonitoring = {
  "tool": "batch_scrape",
  "parameters": {
    "urls": [
      "https://www.safe.ai/research",
      "https://openai.com/research", 
      "https://www.anthropic.com/research"
    ],
    "mode": "async",
    "formats": ["json"],
    "webhook": {
      "url": "https://research-pipeline.com/updates",
      "events": ["batch_completed"]
    }
  }
};

// Stage 3: Set up change tracking for critical sources
const criticalMonitoring = {
  "tool": "track_changes",
  "parameters": {
    "url": "https://ai-safety-institute.gov/reports",
    "operation": "monitor",
    "trackingOptions": {
      "granularity": "element",
      "customSelectors": [".report-title", ".publication-date"]
    },
    "monitoringOptions": {
      "enabled": true,
      "scheduleType": "cron", 
      "cronExpression": "0 */6 * * *",
      "enableWebhook": true,
      "webhookUrl": "https://research-alerts.com/webhook"
    }
  }
};

// Stage 4: Weekly comprehensive update
const weeklyUpdate = {
  "tool": "deep_research",
  "parameters": {
    "topic": "AI safety research latest developments",
    "researchApproach": "current_events",
    "maxUrls": 50,
    "includeRecentOnly": true,
    "timeLimit": 180000,
    "webhook": {
      "url": "https://weekly-digest.com/ai-safety",
      "events": ["research_completed"]
    }
  }
};
```

---

## 🏢 Enterprise Use Cases

### Legal Compliance Monitoring

Monitor regulatory changes and legal developments across multiple jurisdictions.

```javascript
// Request to AI
"Set up comprehensive legal compliance monitoring for GDPR updates across EU countries"

// Monitor EU privacy regulators
const euRegulatorMonitoring = [
  {
    "tool": "track_changes",
    "parameters": {
      "url": "https://edpb.europa.eu/news/news_en",
      "operation": "monitor",
      "trackingOptions": {
        "granularity": "element",
        "customSelectors": [".news-item", ".announcement"]
      },
      "monitoringOptions": {
        "interval": 14400000,
        "enableWebhook": true,
        "webhookUrl": "https://legal-team.com/gdpr-updates"
      }
    }
  }
];

// Research latest GDPR interpretations
const gdprResearch = {
  "tool": "deep_research",
  "parameters": {
    "topic": "GDPR enforcement decisions 2024",
    "researchApproach": "academic",
    "sourceTypes": ["government", "legal"],
    "maxUrls": 100,
    "localization": {
      "countryCode": "DE",
      "language": "en-GB"
    }
  }
};
```

### Product Intelligence Platform

Complete product intelligence combining research, monitoring, and analysis.

```javascript
// Request to AI
"Create comprehensive product intelligence for our SaaS platform including 
competitor analysis, feature tracking, and market research"

// Stage 1: Market landscape research
const marketResearch = {
  "tool": "deep_research",
  "parameters": {
    "topic": "SaaS project management tools market 2024",
    "researchApproach": "current_events",
    "maxUrls": 200,
    "sourceTypes": ["industry", "news", "company"],
    "timeLimit": 360000,
    "outputFormat": "comprehensive"
  }
};

// Stage 2: Competitor feature tracking
const featureTracking = [
  {
    "tool": "track_changes",
    "parameters": {
      "url": "https://competitor1.com/features",
      "operation": "monitor",
      "trackingOptions": {
        "customSelectors": [".feature-card", ".pricing-tier"]
      }
    }
  },
  {
    "tool": "track_changes",
    "parameters": {
      "url": "https://competitor2.com/product-updates", 
      "operation": "monitor",
      "trackingOptions": {
        "customSelectors": [".update-item", ".release-notes"]
      }
    }
  }
];

// Stage 3: Stealth competitor analysis
const competitorAnalysis = {
  "tool": "batch_scrape",
  "parameters": {
    "urls": [
      {
        "url": "https://competitor1.com/pricing",
        "selectors": {
          "plans": ".pricing-card",
          "features": ".feature-list",
          "prices": ".price"
        }
      }
    ],
    "mode": "async",
    "globalOptions": {
      "stealthMode": {
        "enabled": true,
        "level": "advanced"
      }
    }
  }
};
```

### Investment Research Platform

Comprehensive investment research combining multiple data sources and monitoring.

```javascript
// Request to AI
"Set up investment research for renewable energy stocks with sentiment tracking 
and regulatory monitoring"

// Stage 1: Industry research
const industryResearch = {
  "tool": "deep_research",
  "parameters": {
    "topic": "renewable energy investment outlook 2024",
    "researchApproach": "broad",
    "maxUrls": 150,
    "sourceTypes": ["financial", "industry", "government"],
    "credibilityThreshold": 0.7,
    "enableConflictDetection": true
  }
};

// Stage 2: Monitor regulatory changes
const regulatoryMonitoring = {
  "tool": "track_changes",
  "parameters": {
    "url": "https://www.iea.org/news", 
    "operation": "monitor",
    "trackingOptions": {
      "customSelectors": [".news-headline", ".policy-update"]
    },
    "monitoringOptions": {
      "interval": 21600000,
      "enableWebhook": true
    }
  }
};

// Stage 3: Sentiment analysis on news
const sentimentTracking = {
  "tool": "analyze_content",
  "parameters": {
    "text": "Recent renewable energy news content...",
    "options": {
      "analyzeSentiment": true,
      "extractTopics": true,
      "includeAdvancedMetrics": true
    }
  }
};
```

These examples demonstrate the power and flexibility of Wave 3 features, showing how they can be combined to create sophisticated workflows for research, monitoring, and competitive intelligence. Each example can be adapted and customized based on specific use cases and requirements.