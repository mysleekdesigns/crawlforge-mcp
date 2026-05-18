# Observability Setup

CrawlForge ships with built-in Prometheus metrics, OpenTelemetry tracing, and Winston structured logging.

---

## Prometheus Metrics

### Enable

```bash
# HTTP transport mode exposes /metrics automatically
node server.js --http

# Or set via environment
PROMETHEUS_ENABLED=true node server.js
```

### Endpoint

```
GET http://localhost:3000/metrics
```

### Available Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `crawlforge_tool_calls_total` | Counter | Tool invocations by name and status |
| `crawlforge_tool_duration_seconds` | Histogram | Tool execution time |
| `crawlforge_credits_used_total` | Counter | Credits consumed per tool |
| `crawlforge_credits_remaining` | Gauge | Remaining API credits |
| `crawlforge_cache_hits_total` | Counter | Cache hit count |
| `crawlforge_cache_misses_total` | Counter | Cache miss count |
| `crawlforge_browser_contexts_active` | Gauge | Active Playwright contexts |
| `crawlforge_jobs_pending` | Gauge | Queued async jobs |
| `crawlforge_jobs_completed_total` | Counter | Completed batch jobs |
| `crawlforge_http_requests_total` | Counter | Outbound HTTP requests |
| `crawlforge_memory_heap_bytes` | Gauge | Node.js heap usage |

### Prometheus Scrape Config

```yaml
scrape_configs:
  - job_name: crawlforge
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: /metrics
    scrape_interval: 15s
```

---

## OpenTelemetry (OTel) Tracing

### Enable

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 \
OTEL_SERVICE_NAME=crawlforge-mcp \
node server.js
```

### Supported Exporters

| Exporter | Env Var | Example |
|----------|---------|---------|
| OTLP gRPC | `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4317` |
| OTLP HTTP | `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` |
| Jaeger | `OTEL_EXPORTER_JAEGER_ENDPOINT` | `http://localhost:14268/api/traces` |
| Zipkin | `OTEL_EXPORTER_ZIPKIN_ENDPOINT` | `http://localhost:9411/api/v2/spans` |

### Span Attributes

Each tool call creates a span with:
- `crawlforge.tool.name` — tool identifier
- `crawlforge.tool.credits_used` — credits consumed
- `crawlforge.tool.success` — boolean outcome
- `http.url` — target URL (when applicable)
- `http.status_code` — response status

---

## Winston Logging

### Log Levels

Set via `LOG_LEVEL` environment variable:

```bash
LOG_LEVEL=debug node server.js  # verbose output
LOG_LEVEL=info node server.js   # default
LOG_LEVEL=warn node server.js   # warnings and errors only
LOG_LEVEL=error node server.js  # errors only
```

### Log Format

```bash
# JSON structured logs (production)
NODE_ENV=production node server.js

# Pretty-printed logs (development)
NODE_ENV=development node server.js
```

### Log Output

- **MCP protocol messages** → stdout (required for MCP transport)
- **Application logs** → stderr
- **File logs** → `logs/` directory (when `LOG_TO_FILE=true`)

### Secret Masking

API keys, passwords, and tokens are automatically masked:
```
{"apiKey": "[REDACTED]...4j8k", "url": "https://example.com"}
```

---

## Grafana Dashboard

A pre-built Grafana dashboard is available at `docs/observability/grafana-dashboard.json`.

### Import

1. Open Grafana → Dashboards → Import
2. Upload `docs/observability/grafana-dashboard.json`
3. Select your Prometheus data source
4. Click Import

The dashboard includes panels for:
- Tool call rates and error rates
- P50/P95/P99 response times
- Credit consumption over time
- Memory and cache utilization
- Active browser contexts

---

## Docker Compose with Monitoring Stack

```yaml
version: '3.8'

services:
  crawlforge:
    image: crawlforge:latest
    ports:
      - "3000:3000"
    environment:
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
      - OTEL_SERVICE_NAME=crawlforge-mcp

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    volumes:
      - grafana_data:/var/lib/grafana

  otel-collector:
    image: otel/opentelemetry-collector:latest
    ports:
      - "4317:4317"
      - "4318:4318"

  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"

volumes:
  grafana_data:
```

---

## Alerts

Sample Prometheus alerting rules:

```yaml
groups:
  - name: crawlforge
    rules:
      - alert: HighErrorRate
        expr: rate(crawlforge_tool_calls_total{status="error"}[5m]) > 0.1
        for: 2m
        annotations:
          summary: "CrawlForge error rate above 10%"

      - alert: LowCredits
        expr: crawlforge_credits_remaining < 100
        annotations:
          summary: "API credits running low"

      - alert: HighMemoryUsage
        expr: crawlforge_memory_heap_bytes > 500e6
        annotations:
          summary: "Heap memory above 500 MB"
```
