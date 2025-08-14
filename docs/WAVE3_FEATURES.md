# Wave 3 Features Guide - Research & Intelligence Tools

**Version 3.0 | January 2025**

The Wave 3 release introduces powerful research and intelligence capabilities to MCP WebScraper, featuring AI-powered research orchestration, intelligent change tracking, advanced stealth mode, and comprehensive localization support.

## Table of Contents

- [Overview](#overview)
- [Feature 1: Deep Research Intelligence](#feature-1-deep-research-intelligence)
- [Feature 2: Intelligent Change Tracking](#feature-2-intelligent-change-tracking)
- [Feature 3: Advanced Stealth Mode](#feature-3-advanced-stealth-mode)
- [Feature 4: Comprehensive Localization](#feature-4-comprehensive-localization)
- [Feature 5: Research Orchestration](#feature-5-research-orchestration)
- [Configuration Guide](#configuration-guide)
- [Common Use Cases](#common-use-cases)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

---

## Overview

Wave 3 transforms MCP WebScraper from a basic scraping tool into a comprehensive research and intelligence platform. These features enable sophisticated workflows including academic research, competitive intelligence, content monitoring, and cross-cultural content analysis.

### What's New in Wave 3

#### Core Intelligence Features
- **Deep Research Tool** - Multi-stage research with AI-powered source verification
- **Intelligent Change Tracking** - Website monitoring with significance scoring
- **Advanced Stealth Mode** - Human behavior simulation and anti-detection
- **Comprehensive Localization** - 26 countries, RTL support, cultural adaptation
- **Research Orchestration** - Configurable research approaches and synthesis

#### Enhanced Capabilities
- **AI Integration** - LLM-powered analysis and synthesis
- **Source Verification** - Credibility assessment and conflict detection
- **Browser Automation** - Stealth mode with fingerprint randomization
- **Global Access** - Geo-blocking bypass and regional content access
- **Real-time Monitoring** - Webhook notifications and scheduled tracking

---

## Feature 1: Deep Research Intelligence

The `deep_research` tool conducts comprehensive multi-stage research with AI-powered analysis, source verification, and intelligent synthesis.

### Key Capabilities

#### 🧠 Intelligent Research Orchestration
- **Multi-stage investigation** from broad exploration to focused analysis
- **AI-powered query expansion** with semantic understanding
- **Source credibility assessment** using multiple factors
- **Conflict detection** between different information sources
- **Research synthesis** with confidence scoring

#### 📊 Advanced Analysis
- **LLM integration** for semantic analysis and synthesis
- **Relevance scoring** using AI-powered content evaluation
- **Topic alignment** assessment for research focus
- **Confidence metrics** for reliability assessment
- **Pattern recognition** in research findings

### Configuration Requirements

```bash
# LLM Integration (Optional but recommended)
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key

# Research Settings
MAX_RESEARCH_DEPTH=10
MAX_RESEARCH_URLS=1000
RESEARCH_TIME_LIMIT=300000
ENABLE_SOURCE_VERIFICATION=true
ENABLE_CONFLICT_DETECTION=true
```

### Usage Examples

#### Basic Research Investigation
```javascript
{
  "tool": "deep_research",
  "parameters": {
    "topic": "renewable energy storage solutions",
    "researchApproach": "broad",
    "maxDepth": 5,
    "maxUrls": 50,
    "outputFormat": "summary"
  }
}
```

#### Academic Research with Source Verification
```javascript
{
  "tool": "deep_research",
  "parameters": {
    "topic": "machine learning bias in healthcare AI systems",
    "researchApproach": "academic",
    "sourceTypes": ["academic", "government", "medical"],
    "credibilityThreshold": 0.7,
    "enableConflictDetection": true,
    "enableSourceVerification": true,
    "maxDepth": 8,
    "maxUrls": 200,
    "outputFormat": "comprehensive"
  }
}
```

#### Conflict Analysis Research
```javascript
{
  "tool": "deep_research",
  "parameters": {
    "topic": "COVID-19 vaccine effectiveness studies",
    "researchApproach": "comparative",
    "enableConflictDetection": true,
    "outputFormat": "conflicts_focus",
    "timeLimit": 300000
  }
}
```

### Research Approaches

| Approach | Description | Best For |
|----------|-------------|----------|
| `broad` | Comprehensive coverage with multiple query variations | General exploration |
| `focused` | Targeted investigation with limited scope | Specific questions |
| `academic` | Prioritizes scholarly and peer-reviewed sources | Research papers |
| `current_events` | Focuses on recent information and news | Breaking news |
| `comparative` | Enables conflict detection and multiple perspectives | Controversial topics |

### Output Formats

- **comprehensive** - Complete research results with all findings
- **summary** - Condensed results with top findings
- **citations_only** - Source-focused output with metadata
- **conflicts_focus** - Emphasis on conflict analysis

### Response Structure

```json
{
  "success": true,
  "sessionId": "deep_research_12345_abc123",
  "researchSummary": {
    "totalSources": 45,
    "verifiedSources": 32,
    "keyFindings": 12,
    "conflictsFound": 3,
    "consensusAreas": 8
  },
  "findings": [
    {
      "finding": "Key research insight",
      "confidence": 0.87,
      "sources": ["url1", "url2"],
      "category": "primary_insight",
      "significance": "high"
    }
  ],
  "consensus": [
    {
      "topic": "Agreed upon finding",
      "agreement_level": 0.95,
      "supporting_sources": 15,
      "evidence_strength": "strong"
    }
  ],
  "conflicts": [
    {
      "topic": "Disputed claim",
      "positions": [
        {
          "stance": "Position A",
          "sources": ["url1"],
          "credibility": 0.8
        }
      ],
      "severity": "moderate"
    }
  ]
}
```

---

## Feature 2: Intelligent Change Tracking

The `track_changes` tool provides comprehensive website monitoring with advanced change detection, significance scoring, and automated notifications.

### Key Capabilities

#### 📊 Advanced Change Detection
- **Multi-granularity tracking** (page, section, element, text)
- **Semantic change analysis** using content understanding
- **Significance scoring** with customizable thresholds
- **Change categorization** by type and importance
- **Historical trend analysis** with pattern recognition

#### 🔔 Intelligent Monitoring
- **Scheduled monitoring** with cron-based scheduling
- **Real-time notifications** via webhooks, email, and Slack
- **Alert throttling** to prevent notification spam
- **Monitoring templates** for common use cases
- **Dashboard interface** for status tracking

### Configuration Requirements

```bash
# Change Tracking Settings
ENABLE_CHANGE_TRACKING=true
CHANGE_TRACKING_STORAGE_PATH=./data/change_tracking
CHANGE_TRACKING_RETENTION_DAYS=90

# Notification Settings
WEBHOOK_NOTIFICATIONS_ENABLED=true
EMAIL_NOTIFICATIONS_ENABLED=true
SLACK_NOTIFICATIONS_ENABLED=true

# Monitoring Settings
DEFAULT_MONITORING_INTERVAL=3600000  # 1 hour
MAX_MONITORING_JOBS=100
```

### Usage Examples

#### Create Baseline for Tracking
```javascript
{
  "tool": "track_changes",
  "parameters": {
    "url": "https://example.com/product-page",
    "operation": "create_baseline",
    "trackingOptions": {
      "granularity": "section",
      "trackText": true,
      "trackLinks": true,
      "trackImages": false,
      "customSelectors": [".price", ".stock-status", ".description"]
    }
  }
}
```

#### Compare Current State with Baseline
```javascript
{
  "tool": "track_changes",
  "parameters": {
    "url": "https://example.com/product-page",
    "operation": "compare",
    "trackingOptions": {
      "significanceThresholds": {
        "minor": 0.1,
        "moderate": 0.3,
        "major": 0.7
      }
    }
  }
}
```

#### Enable Automated Monitoring
```javascript
{
  "tool": "track_changes",
  "parameters": {
    "url": "https://competitor.com/pricing",
    "operation": "monitor",
    "monitoringOptions": {
      "enabled": true,
      "interval": 3600000,
      "scheduleType": "interval",
      "notificationThreshold": "moderate",
      "enableWebhook": true,
      "webhookUrl": "https://your-app.com/webhook"
    },
    "trackingOptions": {
      "granularity": "element",
      "customSelectors": [".price", ".features", ".availability"]
    }
  }
}
```

#### Set Up Advanced Monitoring with Cron Schedule
```javascript
{
  "tool": "track_changes",
  "parameters": {
    "url": "https://news.example.com",
    "operation": "monitor",
    "monitoringOptions": {
      "enabled": true,
      "scheduleType": "cron",
      "cronExpression": "0 */2 * * *",  // Every 2 hours
      "timezone": "America/New_York",
      "notificationThreshold": "minor",
      "enableWebhook": true,
      "webhookUrl": "https://your-app.com/alerts",
      "webhookHeaders": {
        "Authorization": "Bearer your-token"
      }
    }
  }
}
```

### Tracking Granularity Options

| Granularity | Description | Use Case |
|-------------|-------------|----------|
| `page` | Entire page comparison | General monitoring |
| `section` | Semantic sections (header, main, footer) | Content area monitoring |
| `element` | Individual HTML elements | Specific element tracking |
| `text` | Text-only comparison | Content-focused monitoring |

### Significance Levels

- **None** (0-0.1): Minimal or no changes
- **Minor** (0.1-0.4): Small content updates, typos
- **Moderate** (0.4-0.7): Notable changes requiring attention
- **Major** (0.7-0.9): Significant modifications
- **Critical** (0.9-1.0): Major structural or content overhauls

### Monitoring Templates

#### E-commerce Template
```javascript
{
  "templateId": "e-commerce",
  "schedule": "0 */2 * * *",  // Every 2 hours
  "trackingOptions": {
    "granularity": "element",
    "customSelectors": [".price", ".stock", ".rating", ".reviews"]
  },
  "notificationThreshold": "moderate"
}
```

#### News Site Template
```javascript
{
  "templateId": "news",
  "schedule": "*/15 * * * *",  // Every 15 minutes
  "trackingOptions": {
    "granularity": "section",
    "trackText": true,
    "trackLinks": true
  },
  "notificationThreshold": "minor"
}
```

### Notification Configuration

#### Webhook Notifications
```javascript
{
  "webhook": {
    "enabled": true,
    "url": "https://your-app.com/webhook",
    "method": "POST",
    "headers": {
      "Authorization": "Bearer token",
      "Content-Type": "application/json"
    },
    "signingSecret": "webhook-secret",
    "includeContent": false
  }
}
```

#### Slack Integration
```javascript
{
  "slack": {
    "enabled": true,
    "webhookUrl": "https://hooks.slack.com/services/...",
    "channel": "#alerts",
    "username": "ChangeTracker",
    "iconEmoji": ":warning:"
  }
}
```

---

## Feature 3: Advanced Stealth Mode

Wave 3 introduces sophisticated anti-detection capabilities with human behavior simulation, browser fingerprint randomization, and intelligent evasion techniques.

### Key Capabilities

#### 🥷 Stealth Technologies
- **Browser fingerprint randomization** with realistic profiles
- **Human behavior simulation** including typing patterns and mouse movements
- **Anti-detection evasion** for sophisticated bot detection systems
- **Session management** with persistent browser contexts
- **Traffic pattern mimicking** to appear as human users

#### 🤖 Behavior Simulation
- **Realistic typing speeds** with natural variations
- **Mouse movement patterns** following human trajectories
- **Scroll behavior** with pause patterns and reading speeds
- **Click timing** with human-like delays
- **Page interaction** simulating real user engagement

### Configuration Requirements

```bash
# Stealth Mode Settings
STEALTH_MODE_ENABLED=true
STEALTH_BROWSER_POOL_SIZE=5
STEALTH_SESSION_TIMEOUT=1800000  # 30 minutes
STEALTH_HUMAN_DELAY_MIN=1000
STEALTH_HUMAN_DELAY_MAX=3000

# Browser Fingerprinting
RANDOMIZE_USER_AGENTS=true
RANDOMIZE_VIEWPORT_SIZE=true
RANDOMIZE_TIMEZONE=true
RANDOMIZE_LANGUAGE=true
```

### Usage Examples

#### Basic Stealth Scraping
```javascript
{
  "tool": "scrape_with_actions",
  "parameters": {
    "url": "https://protected-site.com",
    "stealthMode": {
      "enabled": true,
      "humanBehavior": true,
      "randomizeFingerprint": true
    },
    "actions": [
      {"type": "wait", "timeout": 2000},
      {"type": "screenshot", "description": "Page loaded"}
    ]
  }
}
```

#### Advanced Form Automation with Stealth
```javascript
{
  "tool": "scrape_with_actions",
  "parameters": {
    "url": "https://login-protected-site.com",
    "stealthMode": {
      "enabled": true,
      "humanBehavior": true,
      "randomizeFingerprint": true,
      "sessionPersistence": true
    },
    "formAutoFill": {
      "fields": [
        {"selector": "#username", "value": "user@example.com"},
        {"selector": "#password", "value": "password123"}
      ],
      "submitSelector": "#login-button",
      "humanTyping": true
    },
    "actions": [
      {"type": "wait", "timeout": 3000},
      {"type": "click", "selector": "#dashboard-link"},
      {"type": "scroll", "direction": "down", "amount": 500},
      {"type": "extract", "selector": ".protected-content"}
    ]
  }
}
```

### Stealth Mode Options

| Option | Description | Default |
|--------|-------------|---------|
| `enabled` | Enable stealth mode | `false` |
| `humanBehavior` | Simulate human behavior patterns | `true` |
| `randomizeFingerprint` | Randomize browser fingerprint | `true` |
| `sessionPersistence` | Maintain session across requests | `false` |
| `trafficMimicking` | Mimic human traffic patterns | `true` |

---

## Feature 4: Comprehensive Localization

Advanced localization support for 26 countries with RTL language support, cultural adaptation, and geo-blocking bypass capabilities.

### Key Capabilities

#### 🌍 Global Coverage
- **26 countries** across 4 continents
- **RTL language support** for Arabic, Hebrew, and Persian
- **Cultural adaptation** with region-specific browsing patterns
- **Timezone and currency** localization
- **Regional proxy support** with intelligent routing

#### 🔓 Geo-blocking Bypass
- **Multi-strategy bypass** with automatic failover
- **Regional proxy rotation** across 11 global regions
- **Intelligent detection** of geo-blocking patterns
- **Cultural behavior simulation** for different regions
- **Success estimation** for bypass effectiveness

### Configuration Requirements

```bash
# Localization Settings
LOCALIZATION_ENABLED=true
DEFAULT_COUNTRY_CODE=US
DEFAULT_LANGUAGE=en-US
SUPPORTED_COUNTRIES=US,GB,DE,FR,JP,CN,KR,SA,AE,IL,BR,IN,AU,CA,MX,IT,ES,NL,SE,NO,PL,RU,TR,TH,SG,ZA

# Proxy Configuration
PROXY_ROTATION_ENABLED=true
PROXY_HEALTH_CHECK_INTERVAL=300000  # 5 minutes
PROXY_US_EAST_ENABLED=true
PROXY_EU_WEST_ENABLED=true
PROXY_ASIA_PACIFIC_ENABLED=true

# RTL Language Support
RTL_LANGUAGES_ENABLED=true
RTL_BEHAVIOR_SIMULATION=true
```

### Usage Examples

#### Basic Country Localization
```javascript
{
  "tool": "search_web",
  "parameters": {
    "query": "local news",
    "localization": {
      "country": "DE",
      "language": "de-DE",
      "timezone": "Europe/Berlin"
    }
  }
}
```

#### RTL Language Content Processing
```javascript
{
  "tool": "extract_content",
  "parameters": {
    "url": "https://arabic-news-site.com/article",
    "localization": {
      "country": "SA",
      "language": "ar-SA",
      "textDirection": "rtl",
      "culturalAdaptation": true
    }
  }
}
```

#### Geo-blocking Bypass
```javascript
{
  "tool": "fetch_url",
  "parameters": {
    "url": "https://geo-blocked-content.com",
    "localization": {
      "country": "US",
      "autoBypassGeoBlocking": true,
      "proxyRegion": "us-east"
    }
  }
}
```

### Supported Countries and Regions

#### Americas
- **United States** (US) - English, Central/Eastern/Mountain/Pacific Time
- **Canada** (CA) - English/French, Multiple timezones
- **Brazil** (BR) - Portuguese, Brasília Time
- **Mexico** (MX) - Spanish, Central Time

#### Europe
- **United Kingdom** (GB) - English, GMT/BST
- **Germany** (DE) - German, CET/CEST
- **France** (FR) - French, CET/CEST
- **Italy** (IT) - Italian, CET/CEST
- **Spain** (ES) - Spanish, CET/CEST
- **Netherlands** (NL) - Dutch, CET/CEST
- **Sweden** (SE) - Swedish, CET/CEST
- **Norway** (NO) - Norwegian, CET/CEST
- **Poland** (PL) - Polish, CET/CEST
- **Russia** (RU) - Russian, Multiple timezones
- **Turkey** (TR) - Turkish, TRT

#### Asia-Pacific
- **Japan** (JP) - Japanese, JST
- **China** (CN) - Chinese, CST
- **South Korea** (KR) - Korean, KST
- **India** (IN) - Hindi/English, IST
- **Thailand** (TH) - Thai, ICT
- **Singapore** (SG) - English/Chinese/Malay/Tamil, SGT
- **Australia** (AU) - English, Multiple timezones

#### Middle East
- **Saudi Arabia** (SA) - Arabic (RTL), AST
- **United Arab Emirates** (AE) - Arabic (RTL), GST
- **Israel** (IL) - Hebrew (RTL)/Arabic, IST

#### Africa
- **South Africa** (ZA) - English/Afrikaans, SAST

### RTL Language Support

Wave 3 includes comprehensive support for Right-to-Left languages:

#### Supported RTL Languages
- **Arabic** (ar) - Saudi Arabia, UAE
- **Hebrew** (he) - Israel
- **Persian** (fa) - Iran (future support)

#### RTL-Specific Features
- **Text direction detection** and automatic RTL handling
- **Cultural browsing patterns** adapted for RTL users
- **UI element positioning** appropriate for RTL layouts
- **Reading pattern simulation** following RTL conventions

---

## Feature 5: Research Orchestration

Sophisticated research workflow management with configurable approaches, multi-stage processing, and intelligent synthesis.

### Key Capabilities

#### 🎯 Research Strategies
- **Configurable approaches** for different research types
- **Multi-stage processing** from exploration to synthesis
- **Intelligent query expansion** with semantic understanding
- **Source prioritization** based on credibility and relevance
- **Cross-reference validation** between multiple sources

#### 📈 Advanced Analytics
- **Research metrics** and performance tracking
- **Confidence scoring** for findings and sources
- **Pattern recognition** in research data
- **Trend analysis** across multiple research sessions
- **Quality assessment** of research outcomes

### Configuration Requirements

```bash
# Research Orchestration
RESEARCH_ORCHESTRATION_ENABLED=true
MAX_RESEARCH_STAGES=10
RESEARCH_QUALITY_THRESHOLD=0.7
ENABLE_CROSS_REFERENCE_VALIDATION=true

# AI Integration for Research
AI_RESEARCH_SYNTHESIS_ENABLED=true
AI_CONFLICT_DETECTION_ENABLED=true
AI_SOURCE_CREDIBILITY_ENABLED=true
```

### Research Workflow Examples

#### Academic Research Workflow
```javascript
{
  "tool": "deep_research",
  "parameters": {
    "topic": "quantum computing applications in cryptography",
    "researchApproach": "academic",
    "workflow": {
      "stages": [
        {
          "name": "broad_exploration",
          "maxUrls": 50,
          "sourceTypes": ["academic", "government"],
          "credibilityThreshold": 0.6
        },
        {
          "name": "focused_analysis",
          "maxUrls": 25,
          "sourceTypes": ["academic"],
          "credibilityThreshold": 0.8
        },
        {
          "name": "synthesis",
          "enableConflictDetection": true,
          "enableCrossReference": true
        }
      ]
    }
  }
}
```

#### Market Research Workflow
```javascript
{
  "tool": "deep_research",
  "parameters": {
    "topic": "electric vehicle market trends 2024",
    "researchApproach": "current_events",
    "workflow": {
      "stages": [
        {
          "name": "news_gathering",
          "maxUrls": 30,
          "timeRange": "month",
          "sourceTypes": ["news", "industry"]
        },
        {
          "name": "data_analysis",
          "maxUrls": 20,
          "sourceTypes": ["data", "reports"],
          "enableTrendAnalysis": true
        },
        {
          "name": "competitive_intelligence",
          "maxUrls": 15,
          "sourceTypes": ["corporate", "financial"],
          "enableCompetitorTracking": true
        }
      ]
    }
  }
}
```

---

## Configuration Guide

### Environment Variables

#### Core Wave 3 Settings
```bash
# Enable Wave 3 Features
WAVE3_FEATURES_ENABLED=true

# Deep Research Configuration
DEEP_RESEARCH_ENABLED=true
MAX_RESEARCH_DEPTH=10
MAX_RESEARCH_URLS=1000
RESEARCH_TIME_LIMIT=300000
ENABLE_SOURCE_VERIFICATION=true
ENABLE_CONFLICT_DETECTION=true

# Change Tracking Configuration
CHANGE_TRACKING_ENABLED=true
CHANGE_TRACKING_STORAGE_PATH=./data/change_tracking
CHANGE_TRACKING_RETENTION_DAYS=90
DEFAULT_MONITORING_INTERVAL=3600000

# Stealth Mode Configuration
STEALTH_MODE_ENABLED=true
STEALTH_BROWSER_POOL_SIZE=5
STEALTH_SESSION_TIMEOUT=1800000
RANDOMIZE_USER_AGENTS=true
RANDOMIZE_VIEWPORT_SIZE=true

# Localization Configuration
LOCALIZATION_ENABLED=true
DEFAULT_COUNTRY_CODE=US
DEFAULT_LANGUAGE=en-US
RTL_LANGUAGES_ENABLED=true
PROXY_ROTATION_ENABLED=true

# AI Integration (Optional)
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
AI_RESEARCH_SYNTHESIS_ENABLED=true
AI_CONFLICT_DETECTION_ENABLED=true
```

#### Notification Settings
```bash
# Webhook Notifications
WEBHOOK_NOTIFICATIONS_ENABLED=true
WEBHOOK_DEFAULT_TIMEOUT=10000

# Email Notifications
EMAIL_NOTIFICATIONS_ENABLED=true
EMAIL_SMTP_HOST=smtp.gmail.com
EMAIL_SMTP_PORT=587
EMAIL_USERNAME=your_email@gmail.com
EMAIL_PASSWORD=your_app_password

# Slack Notifications
SLACK_NOTIFICATIONS_ENABLED=true
SLACK_DEFAULT_CHANNEL=#alerts
```

#### Performance Settings
```bash
# Research Performance
RESEARCH_CONCURRENCY=5
RESEARCH_CACHE_TTL=3600000

# Change Tracking Performance
CHANGE_TRACKING_CONCURRENCY=3
CHANGE_TRACKING_CACHE_TTL=1800000

# Stealth Mode Performance
STEALTH_BROWSER_TIMEOUT=30000
STEALTH_ACTION_TIMEOUT=10000

# Localization Performance
LOCALIZATION_CACHE_TTL=86400000  # 24 hours
PROXY_HEALTH_CHECK_INTERVAL=300000  # 5 minutes
```

### Claude Code Integration

Add Wave 3 configurations to your MCP settings:

```json
{
  "mcpServers": {
    "webscraper": {
      "command": "node",
      "args": ["/path/to/webScraper-1.0/server.js"],
      "env": {
        "WAVE3_FEATURES_ENABLED": "true",
        "DEEP_RESEARCH_ENABLED": "true",
        "CHANGE_TRACKING_ENABLED": "true",
        "STEALTH_MODE_ENABLED": "true",
        "LOCALIZATION_ENABLED": "true",
        "DEFAULT_COUNTRY_CODE": "US",
        "OPENAI_API_KEY": "your_openai_key"
      }
    }
  }
}
```

---

## Common Use Cases

### Academic Research
```javascript
// Multi-stage academic investigation
{
  "tool": "deep_research",
  "parameters": {
    "topic": "climate change mitigation strategies",
    "researchApproach": "academic",
    "sourceTypes": ["academic", "government"],
    "credibilityThreshold": 0.8,
    "enableConflictDetection": true,
    "maxDepth": 8,
    "outputFormat": "comprehensive"
  }
}
```

### Competitive Intelligence
```javascript
// Monitor competitor website changes
{
  "tool": "track_changes",
  "parameters": {
    "url": "https://competitor.com/pricing",
    "operation": "monitor",
    "monitoringOptions": {
      "enabled": true,
      "interval": 7200000,  // Check every 2 hours
      "notificationThreshold": "minor"
    }
  }
}
```

### Global Content Analysis
```javascript
// Analyze content across different regions
{
  "tool": "extract_content",
  "parameters": {
    "url": "https://global-news-site.com/article",
    "localization": {
      "country": "JP",
      "language": "ja-JP",
      "culturalAdaptation": true
    }
  }
}
```

### Stealth Data Collection
```javascript
// Collect data from protected sources
{
  "tool": "scrape_with_actions",
  "parameters": {
    "url": "https://protected-data-site.com",
    "stealthMode": {
      "enabled": true,
      "humanBehavior": true,
      "sessionPersistence": true
    },
    "actions": [
      {"type": "wait", "timeout": 3000},
      {"type": "scroll", "direction": "down"},
      {"type": "extract", "selector": ".data-table"}
    ]
  }
}
```

---

## Best Practices

### Research Best Practices

#### Query Formulation
- **Be specific** - Use precise terminology for better results
- **Use multiple approaches** - Try different research strategies
- **Set appropriate thresholds** - Balance quality vs quantity
- **Enable conflict detection** - For controversial topics

#### Source Management
- **Verify credibility** - Enable source verification for important research
- **Cross-reference findings** - Use multiple sources for validation
- **Monitor research quality** - Check confidence scores and metrics
- **Document methodology** - Keep track of research approaches used

### Change Tracking Best Practices

#### Monitoring Setup
- **Start with baselines** - Always create a baseline before monitoring
- **Choose appropriate granularity** - Match tracking level to your needs
- **Set realistic thresholds** - Avoid notification spam
- **Use monitoring templates** - Leverage pre-configured settings

#### Notification Management
- **Configure throttling** - Prevent alert fatigue
- **Set priority levels** - Focus on important changes
- **Test webhook endpoints** - Ensure notifications are delivered
- **Monitor alert history** - Review and adjust settings

### Stealth Mode Best Practices

#### Responsible Usage
- **Respect robots.txt** - Follow website policies when possible
- **Avoid aggressive scraping** - Use reasonable delays and limits
- **Monitor detection rates** - Adjust strategies if detected
- **Use session persistence** - Maintain consistent browser state

#### Performance Optimization
- **Pool browser instances** - Reuse contexts when possible
- **Manage memory usage** - Clean up unused browser sessions
- **Monitor success rates** - Track stealth effectiveness
- **Adjust timing patterns** - Fine-tune human behavior simulation

### Localization Best Practices

#### Cultural Sensitivity
- **Understand regional differences** - Respect cultural norms
- **Use appropriate languages** - Match content language expectations
- **Consider time zones** - Account for regional business hours
- **Respect geo-blocking** - Use bypass responsibly

#### Performance Considerations
- **Cache localization data** - Avoid repeated API calls
- **Monitor proxy health** - Ensure reliable regional access
- **Track success rates** - Monitor localization effectiveness
- **Use appropriate regions** - Match proxies to target content

---

## Troubleshooting

### Common Issues

#### Deep Research Problems

**Issue: Low-quality research results**
- **Cause**: Credibility threshold too low or poor source selection
- **Solution**: Increase credibility threshold, refine source types
- **Example**: Set `credibilityThreshold: 0.7` for academic research

**Issue: Research timeouts**
- **Cause**: Time limit too low or complex research topic
- **Solution**: Increase time limit, reduce scope
- **Example**: Set `timeLimit: 300000` for complex topics

**Issue: No conflicts detected**
- **Cause**: Conflict detection disabled or topic not controversial
- **Solution**: Enable conflict detection, try comparative approach
- **Example**: Use `researchApproach: "comparative"`

#### Change Tracking Problems

**Issue: Too many false positives**
- **Cause**: Significance thresholds too low, tracking dynamic content
- **Solution**: Increase thresholds, exclude dynamic selectors
- **Example**: Add `.timestamp, .ads` to exclude selectors

**Issue: Missing important changes**
- **Cause**: Significance thresholds too high, wrong granularity
- **Solution**: Lower thresholds, adjust granularity
- **Example**: Use `granularity: "element"` for specific tracking

**Issue: Webhook notifications not received**
- **Cause**: Invalid webhook URL, network issues
- **Solution**: Test webhook endpoint, check network connectivity
- **Example**: Verify webhook URL returns 200 status

#### Stealth Mode Problems

**Issue: Still being detected**
- **Cause**: Insufficient fingerprint randomization, obvious bot behavior
- **Solution**: Enable full stealth mode, adjust timing patterns
- **Example**: Set longer delays, enable human behavior simulation

**Issue: Poor performance**
- **Cause**: Too many browser instances, memory leaks
- **Solution**: Optimize browser pool size, implement cleanup
- **Example**: Reduce `STEALTH_BROWSER_POOL_SIZE` to 3

**Issue: Session persistence not working**
- **Cause**: Cookies not preserved, session timeout
- **Solution**: Enable session persistence, increase timeout
- **Example**: Set `sessionPersistence: true` in stealth options

#### Localization Problems

**Issue: Geo-blocking not bypassed**
- **Cause**: Proxy region mismatch, proxy health issues
- **Solution**: Use correct proxy region, check proxy health
- **Example**: Use `proxyRegion: "us-east"` for US content

**Issue: RTL content not handled correctly**
- **Cause**: RTL support disabled, incorrect language detection
- **Solution**: Enable RTL support, verify language settings
- **Example**: Set `RTL_LANGUAGES_ENABLED=true`

**Issue: Cultural adaptation not working**
- **Cause**: Cultural patterns not loaded, incorrect country code
- **Solution**: Verify country code, check cultural patterns
- **Example**: Use correct ISO country codes (US, DE, JP)

### Debugging Tools

#### Research Debugging
```javascript
// Get detailed research metrics
{
  "tool": "deep_research",
  "parameters": {
    "topic": "test topic",
    "outputFormat": "comprehensive",
    "includeMetrics": true,
    "includeProvenance": true
  }
}
```

#### Change Tracking Debugging
```javascript
// Check monitoring status
{
  "tool": "track_changes",
  "parameters": {
    "operation": "get_stats",
    "url": "https://example.com"
  }
}
```

#### Stealth Mode Debugging
```javascript
// Test stealth effectiveness
{
  "tool": "scrape_with_actions",
  "parameters": {
    "url": "https://bot-detection-test.com",
    "stealthMode": {
      "enabled": true,
      "debugMode": true
    },
    "actions": [
      {"type": "screenshot", "description": "Detection test"}
    ]
  }
}
```

#### Localization Debugging
```javascript
// Test localization configuration
{
  "tool": "fetch_url",
  "parameters": {
    "url": "https://httpbin.org/headers",
    "localization": {
      "country": "DE",
      "debugMode": true
    }
  }
}
```

### Performance Monitoring

#### Research Performance
- Monitor research completion times
- Track source verification accuracy
- Measure conflict detection effectiveness
- Analyze synthesis quality scores

#### Change Tracking Performance
- Monitor detection accuracy rates
- Track notification delivery success
- Measure monitoring overhead
- Analyze false positive/negative rates

#### Stealth Mode Performance
- Track detection rates by target sites
- Monitor browser pool utilization
- Measure action execution times
- Analyze success rates by stealth strategy

#### Localization Performance
- Monitor proxy health and response times
- Track geo-blocking bypass success rates
- Measure cultural adaptation effectiveness
- Analyze regional content access success

---

## Conclusion

Wave 3 features transform MCP WebScraper into a comprehensive research and intelligence platform. These advanced capabilities enable sophisticated workflows including academic research, competitive intelligence, global content analysis, and automated monitoring.

The combination of AI-powered research, intelligent change tracking, advanced stealth capabilities, and comprehensive localization provides enterprise-grade functionality for complex web intelligence tasks.

For additional support and advanced configurations, refer to the [API Reference](./API_REFERENCE.md) and [Troubleshooting Guide](./TROUBLESHOOTING.md).

---

*Last updated: January 2025 | Wave 3 Features | Version 3.0*