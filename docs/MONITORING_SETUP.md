# MCP WebScraper Monitoring Setup Guide

This guide covers the comprehensive monitoring and observability setup for the MCP WebScraper project in production environments.

## Overview

The MCP WebScraper includes a robust monitoring system with:
- **Health Checks**: Service health monitoring with dependency checks
- **Metrics Collection**: Comprehensive performance and usage analytics
- **Dashboard Integration**: Compatible with Grafana, DataDog, and other tools
- **Alerting**: Configurable alerts for performance degradation and failures

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Application   │───▶│  Health Checks   │───▶│   Alerting      │
│                 │    │  Metrics Collect │    │   Dashboard     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         │              ┌─────────────────┐               │
         └─────────────▶│  File Exports   │◀──────────────┘
                        │  (JSON/CSV)     │
                        └─────────────────┘
```

## Quick Start

### 1. Import and Configure

```javascript
import { HealthCheckManager } from './src/monitoring/healthCheck.js';
import { MetricsCollector } from './src/monitoring/metrics.js';

// Initialize monitoring
const healthCheck = new HealthCheckManager({
  checkInterval: 30000,        // 30 seconds
  timeout: 5000,              // 5 seconds
  memoryThreshold: 512 * 1024 * 1024,  // 512MB
  cpuThreshold: 90,            // 90%
  responseTimeThreshold: 2000  // 2 seconds
});

const metrics = new MetricsCollector({
  collectInterval: 10000,      // 10 seconds
  exportInterval: 60000,       // 1 minute
  exportPath: './cache/metrics',
  enableFileExport: true,
  enableRealtimeMetrics: true
});

// Start monitoring
await healthCheck.start();
await metrics.start();
```

### 2. Instrument Your Application

```javascript
// Record tool executions
metrics.recordToolExecution('search_web', responseTime, isError, {
  errorType: error?.name,
  queryLength: query.length,
  resultCount: results.length
});

// Record cache operations
metrics.recordCacheOperation('hit', {
  responseTime: cacheResponseTime,
  cacheSize: cache.size
});

// Monitor requests for health checks
healthCheck.recordRequest(responseTime, isError);
```

## Health Check Configuration

### Core Health Checks

The system includes these built-in health checks:

#### System Resource Checks
- **Memory Usage**: Monitors heap and system memory consumption
- **CPU Usage**: Tracks CPU utilization and load average
- **Disk Space**: Monitors available disk space (when configured)

#### Application Health Checks
- **Cache Health**: Monitors cache hit rates and performance
- **Queue Health**: Tracks queue depth and processing status
- **Worker Health**: Monitors worker pool status and task distribution
- **Connection Health**: Tracks HTTP connection pool status

#### External Dependency Checks
- **Search API Health**: Validates search provider connectivity
- **Network Connectivity**: Tests internet connectivity to key services

### Custom Health Checks

Add custom health checks for your specific dependencies:

```javascript
// Register a custom database health check
healthCheck.registerCheck('database', async () => {
  try {
    await db.ping();
    return {
      status: 'operational',
      connections: db.pool.totalCount,
      activeQueries: db.pool.idleCount
    };
  } catch (error) {
    throw new Error(`Database health check failed: ${error.message}`);
  }
});

// Register an external API health check
healthCheck.registerCheck('external_api', async () => {
  const start = performance.now();
  const response = await fetch('https://api.example.com/health');
  const duration = performance.now() - start;
  
  if (!response.ok) {
    throw new Error(`API returned ${response.status}`);
  }
  
  return {
    status: 'operational',
    responseTime: duration,
    version: response.headers.get('api-version')
  };
});
```

### Health Check Endpoints

Expose health check endpoints for external monitoring:

```javascript
import express from 'express';

const app = express();

// Simple health endpoint
app.get('/health', (req, res) => {
  const status = healthCheck.getHealthStatus();
  const httpStatus = status.overall === 'healthy' ? 200 : 503;
  res.status(httpStatus).json(status);
});

// Detailed health endpoint
app.get('/health/detailed', (req, res) => {
  const status = healthCheck.getHealthStatus();
  res.json(status);
});

// Health check in different formats
app.get('/health/text', (req, res) => {
  const report = healthCheck.generateReport('text');
  res.set('Content-Type', 'text/plain').send(report);
});

app.get('/health/summary', (req, res) => {
  const summary = healthCheck.generateReport('summary');
  res.json(summary);
});
```

## Metrics Collection

### Available Metrics

#### System Metrics
- **Total Requests**: Cumulative request count
- **Total Errors**: Cumulative error count
- **Response Time**: Average, percentiles (P50, P75, P90, P95, P99)
- **Error Rate**: Percentage of failed requests
- **Memory Usage**: Heap usage, RSS, external memory
- **CPU Usage**: User and system CPU time

#### Tool-Specific Metrics
For each MCP tool:
- **Call Count**: Total invocations
- **Success Rate**: Percentage of successful calls
- **Average Response Time**: Mean execution time
- **Error Breakdown**: Errors by type
- **Usage Patterns**: Call frequency and timing

#### Cache Performance
- **Hit Rate**: Cache hit percentage
- **Miss Rate**: Cache miss percentage
- **Response Time**: Cache vs non-cache response times
- **Cache Size**: Current cache memory usage
- **Eviction Rate**: Cache eviction frequency

#### Performance Components
- **Worker Pool**: Active workers, queue depth, task completion rates
- **Connection Pool**: Active connections, connection errors, pool utilization
- **Queue Manager**: Pending tasks, processing time, throughput

### Real-time Metrics

Access real-time metrics for immediate monitoring:

```javascript
// Get current metrics
const currentMetrics = metrics.getMetrics({
  includeTimeSeries: true,
  includePercentiles: true,
  timeRange: {
    start: Date.now() - 3600000, // Last hour
    end: Date.now()
  }
});

// Listen for real-time updates
metrics.on('toolExecution', (data) => {
  console.log(`Tool ${data.toolName} executed in ${data.responseTime}ms`);
});

metrics.on('cacheOperation', (data) => {
  console.log(`Cache ${data.operation}, hit rate: ${data.currentHitRate}`);
});
```

### Metrics Export

Metrics are automatically exported in multiple formats:

#### JSON Export
- **File**: `metrics-{timestamp}.json`
- **Contains**: Complete metrics with time series data
- **Use**: Import into analysis tools, debugging

#### CSV Export
- **File**: `metrics-summary-{timestamp}.csv`
- **Contains**: Tabular summary data
- **Use**: Excel analysis, reporting dashboards

## Dashboard Integration

### Grafana Dashboard Configuration

#### Data Source Setup

1. **File-based (JSON)**:
```json
{
  "type": "simplejson",
  "url": "file:///path/to/cache/metrics/",
  "access": "direct"
}
```

2. **HTTP Endpoint**:
```javascript
// Expose metrics endpoint
app.get('/metrics/prometheus', (req, res) => {
  const metrics = metricsCollector.getMetrics();
  const prometheus = convertToPrometheus(metrics);
  res.set('Content-Type', 'text/plain').send(prometheus);
});
```

#### Dashboard Panels

**System Overview Panel**:
```json
{
  "title": "MCP WebScraper Overview",
  "panels": [
    {
      "title": "Requests per Second",
      "type": "graph",
      "targets": [
        {
          "expr": "rate(mcp_requests_total[5m])",
          "legendFormat": "Requests/sec"
        }
      ]
    },
    {
      "title": "Error Rate",
      "type": "singlestat",
      "targets": [
        {
          "expr": "rate(mcp_errors_total[5m]) / rate(mcp_requests_total[5m]) * 100",
          "legendFormat": "Error %"
        }
      ]
    },
    {
      "title": "Response Time Percentiles",
      "type": "graph",
      "targets": [
        {
          "expr": "histogram_quantile(0.50, mcp_response_time_bucket)",
          "legendFormat": "P50"
        },
        {
          "expr": "histogram_quantile(0.95, mcp_response_time_bucket)",
          "legendFormat": "P95"
        },
        {
          "expr": "histogram_quantile(0.99, mcp_response_time_bucket)",
          "legendFormat": "P99"
        }
      ]
    }
  ]
}
```

**Tool Performance Panel**:
```json
{
  "title": "Tool Performance",
  "panels": [
    {
      "title": "Tool Usage Distribution",
      "type": "piechart",
      "targets": [
        {
          "expr": "mcp_tool_calls_total",
          "legendFormat": "{{tool}}"
        }
      ]
    },
    {
      "title": "Tool Response Times",
      "type": "heatmap",
      "targets": [
        {
          "expr": "mcp_tool_response_time_bucket",
          "legendFormat": "{{tool}}"
        }
      ]
    }
  ]
}
```

### DataDog Integration

#### Custom Metrics

```javascript
// DataDog StatsD integration
import StatsD from 'node-statsd';

const statsd = new StatsD({
  host: 'localhost',
  port: 8125,
  prefix: 'mcp.webscraper.'
});

// Send metrics to DataDog
metrics.on('toolExecution', (data) => {
  statsd.increment('tool.calls', 1, [`tool:${data.toolName}`]);
  statsd.timing('tool.response_time', data.responseTime, [`tool:${data.toolName}`]);
  
  if (data.isError) {
    statsd.increment('tool.errors', 1, [`tool:${data.toolName}`]);
  }
});

metrics.on('cacheOperation', (data) => {
  statsd.increment(`cache.${data.operation}`, 1);
  statsd.gauge('cache.hit_rate', data.currentHitRate * 100);
});
```

#### Dashboard Configuration

```json
{
  "title": "MCP WebScraper Performance",
  "widgets": [
    {
      "definition": {
        "type": "timeseries",
        "requests": [
          {
            "q": "sum:mcp.webscraper.tool.calls{*} by {tool}.as_rate()",
            "display_type": "line"
          }
        ],
        "title": "Tool Usage Rate"
      }
    },
    {
      "definition": {
        "type": "query_value",
        "requests": [
          {
            "q": "avg:mcp.webscraper.cache.hit_rate{*}",
            "aggregator": "avg"
          }
        ],
        "title": "Cache Hit Rate"
      }
    }
  ]
}
```

## Alerting Configuration

### Grafana Alerts

#### High Error Rate Alert
```json
{
  "alert": {
    "conditions": [
      {
        "query": {
          "params": ["A", "5m", "now"]
        },
        "reducer": {
          "params": [],
          "type": "avg"
        },
        "type": "query"
      }
    ],
    "executionErrorState": "alerting",
    "for": "5m",
    "frequency": "10s",
    "handler": 1,
    "name": "High Error Rate",
    "noDataState": "no_data",
    "notifications": []
  },
  "targets": [
    {
      "expr": "rate(mcp_errors_total[5m]) / rate(mcp_requests_total[5m]) * 100 > 5",
      "refId": "A"
    }
  ]
}
```

#### High Memory Usage Alert
```json
{
  "alert": {
    "conditions": [
      {
        "query": {
          "params": ["A", "1m", "now"]
        },
        "reducer": {
          "params": [],
          "type": "last"
        },
        "type": "query"
      }
    ],
    "executionErrorState": "alerting",
    "for": "2m",
    "frequency": "30s",
    "handler": 1,
    "name": "High Memory Usage",
    "noDataState": "no_data",
    "notifications": []
  },
  "targets": [
    {
      "expr": "mcp_memory_usage_bytes > 512000000",
      "refId": "A"
    }
  ]
}
```

### PagerDuty Integration

```javascript
import axios from 'axios';

// PagerDuty integration
healthCheck.on('healthCheck', (status) => {
  if (status.overall === 'unhealthy') {
    sendPagerDutyAlert({
      summary: 'MCP WebScraper Health Check Failed',
      severity: 'error',
      source: 'mcp-webscraper',
      custom_details: status
    });
  }
});

async function sendPagerDutyAlert(alertData) {
  try {
    await axios.post('https://events.pagerduty.com/v2/enqueue', {
      routing_key: process.env.PAGERDUTY_ROUTING_KEY,
      event_action: 'trigger',
      payload: alertData
    });
  } catch (error) {
    logger.error('Failed to send PagerDuty alert', { error: error.message });
  }
}
```

### Slack Notifications

```javascript
import { WebClient } from '@slack/web-api';

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

// Slack notifications for performance issues
metrics.on('toolExecution', async (data) => {
  if (data.responseTime > 5000) { // 5 second threshold
    await slack.chat.postMessage({
      channel: '#alerts',
      text: `⚠️ Slow tool execution detected: ${data.toolName} took ${data.responseTime}ms`,
      attachments: [
        {
          color: 'warning',
          fields: [
            { title: 'Tool', value: data.toolName, short: true },
            { title: 'Response Time', value: `${data.responseTime}ms`, short: true },
            { title: 'Error', value: data.isError ? 'Yes' : 'No', short: true }
          ]
        }
      ]
    });
  }
});
```

## Production Deployment

### Environment Variables

```bash
# Monitoring Configuration
MONITORING_ENABLED=true
HEALTH_CHECK_INTERVAL=30000
METRICS_EXPORT_INTERVAL=60000
METRICS_RETENTION_PERIOD=604800000  # 7 days
EXPORT_PATH=./cache/metrics

# Thresholds
MEMORY_THRESHOLD=536870912          # 512MB
CPU_THRESHOLD=90                    # 90%
RESPONSE_TIME_THRESHOLD=2000        # 2 seconds
ERROR_RATE_THRESHOLD=0.05           # 5%

# External Integrations
DATADOG_API_KEY=your_datadog_key
PAGERDUTY_ROUTING_KEY=your_pd_key
SLACK_BOT_TOKEN=your_slack_token
```

### Docker Configuration

```dockerfile
# Add monitoring dependencies
RUN npm install @datadog/node statsd

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Expose metrics port
EXPOSE 3000 8125
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-webscraper
spec:
  template:
    spec:
      containers:
      - name: mcp-webscraper
        image: mcp-webscraper:latest
        ports:
        - containerPort: 3000
          name: http
        - containerPort: 8125
          name: statsd
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health/summary
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
        resources:
          requests:
            memory: "256Mi"
            cpu: "200m"
          limits:
            memory: "512Mi"
            cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: mcp-webscraper
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "3000"
    prometheus.io/path: "/metrics"
spec:
  ports:
  - port: 3000
    name: http
  selector:
    app: mcp-webscraper
```

## Monitoring Best Practices

### 1. Alert Fatigue Prevention
- Set appropriate thresholds to avoid false positives
- Use alert grouping and routing
- Implement alert suppression during maintenance
- Regular review and tuning of alert rules

### 2. Performance Monitoring
- Monitor key business metrics, not just technical metrics
- Track user experience indicators
- Monitor dependencies and external services
- Use distributed tracing for complex requests

### 3. Capacity Planning
- Monitor resource utilization trends
- Set up predictive alerts for capacity issues
- Track growth patterns in usage
- Plan for peak load scenarios

### 4. Security Monitoring
- Monitor for unusual access patterns
- Track rate limiting violations
- Monitor certificate expiration
- Log security-relevant events

### 5. Data Retention
- Balance storage costs with debugging needs
- Implement tiered storage (hot/warm/cold)
- Regular cleanup of old metrics and logs
- Backup critical monitoring data

## Troubleshooting

### Common Issues

#### High Memory Usage
```javascript
// Check memory leaks
const memUsage = process.memoryUsage();
console.log('Memory usage:', {
  heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
  heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
  external: Math.round(memUsage.external / 1024 / 1024) + 'MB'
});

// Force garbage collection for debugging
if (global.gc) {
  global.gc();
}
```

#### Missing Metrics
```javascript
// Verify metrics collector is running
if (!metrics.isCollecting) {
  console.error('Metrics collection is not running');
  await metrics.start();
}

// Check event listeners
console.log('Event listeners:', metrics.listenerCount('toolExecution'));
```

#### Health Check Failures
```javascript
// Debug individual health checks
for (const [name, checkFn] of healthCheck.dependencyChecks.entries()) {
  try {
    const result = await checkFn();
    console.log(`${name}: OK`, result);
  } catch (error) {
    console.error(`${name}: FAILED`, error.message);
  }
}
```

### Performance Tuning

#### Reduce Monitoring Overhead
```javascript
// Adjust collection intervals
const metrics = new MetricsCollector({
  collectInterval: 30000,    // Increase from 10s to 30s
  exportInterval: 300000,    // Increase from 1m to 5m
  enableRealtimeMetrics: false  // Disable if not needed
});
```

#### Optimize Health Checks
```javascript
// Reduce check frequency for stable systems
const healthCheck = new HealthCheckManager({
  checkInterval: 60000,      // Increase from 30s to 60s
  timeout: 3000             // Reduce from 5s to 3s
});
```

## Support and Maintenance

### Regular Tasks
- Review and update alert thresholds monthly
- Clean up old metric exports weekly
- Update dashboard configurations as needed
- Test monitoring systems during maintenance windows

### Documentation Updates
- Keep alert runbooks current
- Document new metrics and their meaning
- Update dashboard screenshots and configurations
- Maintain troubleshooting guides

### Team Training
- Ensure team members understand monitoring tools
- Practice incident response procedures
- Regular review of monitoring best practices
- Cross-training on dashboard and alerting systems

This monitoring setup provides comprehensive visibility into the MCP WebScraper's performance, health, and usage patterns, enabling proactive issue detection and resolution in production environments.