# Enhanced Change Tracking System (Phase 2.4)

The Enhanced Change Tracking system provides comprehensive content monitoring capabilities with advanced features for scheduled monitoring, semantic analysis, alert management, and historical trend analysis.

## Features Overview

### 1. Scheduled Monitoring System
- **Cron-based scheduling** with flexible time expressions
- **Multiple frequency support** (hourly, daily, weekly, custom)
- **Monitoring dashboard** for real-time status tracking
- **Reusable monitoring templates** for common use cases

### 2. Advanced Comparison Engine
- **Semantic diff algorithms** for meaningful content analysis
- **Visual regression detection** for layout and styling changes
- **Structured data change analysis** (JSON-LD, OpenGraph, etc.)
- **Enhanced significance scoring** (0-1 scale with multiple factors)

### 3. Alert System
- **Multi-channel notifications** (email, webhook, Slack)
- **Intelligent throttling** to prevent notification spam
- **Custom alert rules** with flexible conditions
- **Alert aggregation** for related changes
- **Webhook security** with signature verification

### 4. Historical Analysis
- **Complete change history** with detailed tracking
- **Trend analysis reports** with pattern recognition
- **Export capabilities** (JSON, CSV formats)
- **Pattern detection** for recurring changes

## API Operations

### Basic Operations

#### Create Baseline
```javascript
{
  "url": "https://example.com",
  "operation": "create_baseline",
  "content": "<html>...</html>",
  "trackingOptions": {
    "granularity": "section",
    "trackText": true,
    "trackStructure": true
  }
}
```

#### Compare with Baseline
```javascript
{
  "url": "https://example.com",
  "operation": "compare",
  "content": "<html>...</html>",
  "trackingOptions": {
    "granularity": "section",
    "significanceThresholds": {
      "minor": 0.1,
      "moderate": 0.3,
      "major": 0.7
    }
  }
}
```

### Enhanced Operations

#### Create Scheduled Monitor
```javascript
{
  "url": "https://example.com",
  "operation": "create_scheduled_monitor",
  "scheduledMonitorOptions": {
    "schedule": "0 */2 * * *", // Every 2 hours
    "templateId": "e-commerce",
    "enabled": true
  },
  "trackingOptions": {
    "granularity": "element",
    "customSelectors": [".price", ".stock-status"]
  },
  "notificationOptions": {
    "webhook": {
      "enabled": true,
      "url": "https://your-webhook.com/alerts",
      "signingSecret": "your-secret"
    }
  }
}
```

#### Get Monitoring Dashboard
```javascript
{
  "operation": "get_dashboard",
  "dashboardOptions": {
    "includeRecentAlerts": true,
    "includeTrends": true,
    "includeMonitorStatus": true
  }
}
```

#### Export Historical Data
```javascript
{
  "operation": "export_history",
  "url": "https://example.com", // Optional: specific URL
  "exportOptions": {
    "format": "json",
    "startTime": 1640995200000,
    "endTime": 1641081600000,
    "includeContent": false,
    "includeSnapshots": true
  }
}
```

#### Create Custom Alert Rule
```javascript
{
  "operation": "create_alert_rule",
  "alertRuleOptions": {
    "ruleId": "high-frequency-changes",
    "condition": "frequent",
    "actions": ["webhook", "slack"],
    "throttle": 1800000, // 30 minutes
    "priority": "high"
  }
}
```

#### Generate Trend Report
```javascript
{
  "operation": "generate_trend_report",
  "url": "https://example.com" // Optional: specific URL analysis
}
```

#### Get Monitoring Templates
```javascript
{
  "operation": "get_monitoring_templates"
}
```

## Monitoring Templates

### Pre-built Templates

#### News Site Template
- **Frequency**: Every 15 minutes
- **Granularity**: Section-level tracking
- **Focus**: Text content changes
- **Alerts**: Minor significance threshold

#### E-commerce Template
- **Frequency**: Every 2 hours
- **Granularity**: Element-level tracking
- **Focus**: Price, stock status, product information
- **Alerts**: Moderate significance threshold

#### Documentation Template
- **Frequency**: Daily at 9 AM
- **Granularity**: Section-level tracking
- **Focus**: Content structure and text
- **Alerts**: Major significance threshold only

### Template Usage
```javascript
{
  "url": "https://shop.example.com/product/123",
  "operation": "create_scheduled_monitor",
  "scheduledMonitorOptions": {
    "schedule": "0 */1 * * *", // Override default frequency
    "templateId": "e-commerce"
  }
}
```

## Alert Configuration

### Webhook Alerts
```javascript
{
  "notificationOptions": {
    "webhook": {
      "enabled": true,
      "url": "https://your-webhook.com/alerts",
      "method": "POST",
      "headers": {
        "Authorization": "Bearer your-token"
      },
      "signingSecret": "webhook-secret",
      "includeContent": false
    }
  }
}
```

### Slack Integration
```javascript
{
  "notificationOptions": {
    "slack": {
      "enabled": true,
      "webhookUrl": "https://hooks.slack.com/services/...",
      "channel": "#alerts",
      "username": "ChangeTracker"
    }
  }
}
```

### Email Notifications
```javascript
{
  "notificationOptions": {
    "email": {
      "enabled": true,
      "recipients": ["admin@example.com", "team@example.com"],
      "subject": "Content Change Alert",
      "includeDetails": true
    }
  }
}
```

## Significance Levels

### Enhanced Scoring
The system uses multiple factors to calculate change significance:

- **Content Similarity** (40% weight): Text and structure comparison
- **Semantic Analysis** (20% weight): Meaning and topic changes
- **Visual Changes** (20% weight): Layout and styling modifications
- **Structured Data** (20% weight): Schema and metadata changes

### Significance Levels
- **None** (0-0.1): Minimal or no changes
- **Minor** (0.1-0.4): Small content updates
- **Moderate** (0.4-0.7): Notable changes requiring attention
- **Major** (0.7-0.9): Significant modifications
- **Critical** (0.9-1.0): Major structural or content overhauls

## Advanced Features

### Semantic Analysis
- **Keyword tracking**: Monitors important term frequency
- **Topic shift detection**: Identifies content theme changes
- **Sentiment analysis**: Tracks tone and sentiment changes
- **Confidence scoring**: Provides reliability metrics

### Visual Regression Detection
- **Layout changes**: Element count and positioning
- **CSS modifications**: Style and appearance changes
- **Image updates**: New or modified images
- **Font and color changes**: Typography modifications

### Pattern Recognition
- **Recurring patterns**: Identifies regular change cycles
- **Time-based trends**: Detects daily/weekly patterns
- **Change velocity**: Tracks modification frequency
- **Anomaly detection**: Highlights unusual change patterns

## Configuration Options

### Tracking Granularity
- **Page**: Entire page comparison
- **Section**: Semantic sections (header, main, footer)
- **Element**: Individual HTML elements
- **Text**: Text-only comparison

### Performance Tuning
```javascript
{
  "trackingOptions": {
    "excludeSelectors": [".timestamp", ".ads", ".comments"],
    "ignoreWhitespace": true,
    "ignoreCase": false,
    "significanceThresholds": {
      "minor": 0.05,    // More sensitive
      "moderate": 0.2,
      "major": 0.5
    }
  }
}
```

### Cron Schedule Examples
```javascript
// Every 5 minutes
"schedule": "*/5 * * * *"

// Every hour at minute 0
"schedule": "0 * * * *"

// Every day at 9:00 AM
"schedule": "0 9 * * *"

// Every Monday at 8:00 AM
"schedule": "0 8 * * 1"

// Every 15 minutes during business hours (9-17)
"schedule": "*/15 9-17 * * 1-5"
```

## Security Considerations

### Webhook Security
- **Signature verification** using HMAC-SHA256
- **Request headers** for authentication
- **HTTPS enforcement** for secure transmission

### Data Privacy
- **Content sanitization** for external notifications
- **Selective data inclusion** in exports
- **Access control** for dashboard and API endpoints

## Performance Optimization

### Caching Strategy
- **Content hashing** for efficient comparison
- **Semantic analysis caching** to avoid recomputation
- **Alert throttling** to prevent notification overload

### Resource Management
- **Memory-efficient storage** with compression
- **Cleanup policies** for old data
- **Rate limiting** for monitoring requests

## Troubleshooting

### Common Issues

#### High False Positive Rate
- Adjust significance thresholds
- Use exclude selectors for dynamic content
- Enable whitespace ignoring

#### Missing Change Detection
- Lower significance thresholds
- Check exclude selectors
- Verify tracking granularity

#### Alert Spam
- Increase throttle intervals
- Enable alert aggregation
- Adjust alert rule conditions

### Debugging
```javascript
// Get detailed statistics
{
  "operation": "get_stats",
  "url": "https://example.com"
}

// Check dashboard status
{
  "operation": "get_dashboard",
  "dashboardOptions": {
    "includeMonitorStatus": true
  }
}
```

## Migration from Basic Tracking

### Upgrading Existing Monitors
1. **Stop existing monitors** using `stop_scheduled_monitor`
2. **Create enhanced monitors** with templates and improved options
3. **Configure alerts** with appropriate thresholds
4. **Export historical data** for analysis

### Backward Compatibility
- All existing API operations remain functional
- Enhanced features are additive
- Graceful degradation for unsupported features

## Best Practices

### Monitoring Strategy
1. **Start with templates** for common use cases
2. **Tune thresholds** based on content characteristics
3. **Use appropriate granularity** for your needs
4. **Monitor performance** and adjust intervals

### Alert Management
1. **Set reasonable throttle intervals** to prevent spam
2. **Use priority levels** for different change types
3. **Aggregate related alerts** for better signal-to-noise ratio
4. **Test webhook endpoints** before deployment

### Data Management
1. **Regular exports** for long-term storage
2. **Cleanup policies** for old monitoring data
3. **Archive historical data** periodically
4. **Monitor storage usage** and performance

This enhanced system provides enterprise-grade content monitoring with the flexibility to handle various use cases while maintaining high performance and reliability.