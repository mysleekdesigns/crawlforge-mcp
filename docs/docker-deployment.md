# Docker Deployment Guide

---

## Quick Start

```bash
# Build the image
npm run docker:build

# Run in development mode
npm run docker:dev

# Run in production mode
npm run docker:prod
```

---

## Manual Build and Run

```bash
# Build
docker build -t crawlforge:latest .

# Run with stdio transport (for MCP clients)
docker run -i --rm \
  -e CRAWLFORGE_API_KEY=your_api_key \
  crawlforge:latest

# Run HTTP transport (for REST/SSE access)
docker run -p 3000:3000 --rm \
  -e CRAWLFORGE_API_KEY=your_api_key \
  crawlforge:latest node server.js --http
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CRAWLFORGE_API_KEY` | Yes (user mode) | Your CrawlForge.dev API key |
| `PORT` | No | HTTP server port (default: 10000) |
| `NODE_ENV` | No | `production` or `development` |
| `OLLAMA_BASE_URL` | No | Ollama endpoint for local LLM |
| `OPENAI_API_KEY` | No | OpenAI key (optional LLM fallback) |
| `ANTHROPIC_API_KEY` | No | Anthropic key (optional LLM fallback) |
| `CRAWLFORGE_BROWSER_BACKEND` | No | `local` (default) or `browserbase` |
| `BROWSERBASE_API_KEY` | No | BrowserBase cloud browser API key |
| `MAX_WORKERS` | No | Concurrency workers (default: 10) |
| `CACHE_TTL` | No | Cache TTL in ms (default: 3600000) |

---

## Docker Compose

```yaml
version: '3.8'

services:
  crawlforge:
    build: .
    image: crawlforge:latest
    ports:
      - "3000:3000"
    environment:
      - CRAWLFORGE_API_KEY=${CRAWLFORGE_API_KEY}
      - NODE_ENV=production
      - PORT=3000
      - OLLAMA_BASE_URL=http://ollama:11434
    depends_on:
      - ollama
    restart: unless-stopped

  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    restart: unless-stopped

volumes:
  ollama_data:
```

Run:
```bash
docker-compose up -d
```

---

## Render Deploy

CrawlForge is pre-configured for [Render](https://render.com).

### render.yaml

```yaml
services:
  - type: web
    name: crawlforge-mcp
    env: node
    plan: starter
    buildCommand: npm ci
    startCommand: node server.js --http
    envVars:
      - key: PORT
        value: 10000
      - key: NODE_ENV
        value: production
      - key: CRAWLFORGE_API_KEY
        sync: false
```

Key notes:
- Default port is **10000** (Render requirement)
- The `/health` endpoint responds with `{"status":"ok"}` for health checks
- Set `CRAWLFORGE_API_KEY` as a secret in Render dashboard

---

## Health Check

The server exposes a health check endpoint on HTTP transport:

```bash
curl http://localhost:3000/health
# {"status":"ok","version":"4.2.0","tools":23}
```

Docker HEALTHCHECK:
```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:${PORT:-10000}/health || exit 1
```

---

## Persistent Volumes

For production, mount volumes for:

```bash
docker run -v crawlforge-cache:/app/cache \
           -v crawlforge-logs:/app/logs \
           -v crawlforge-snapshots:/app/snapshots \
           crawlforge:latest
```

---

## Playwright Browsers in Docker

The Dockerfile installs Chromium for Playwright. If browser launch fails:

```bash
# Install system dependencies manually
RUN npx playwright install-deps chromium
```

Or use the official Playwright Docker image as base:

```dockerfile
FROM mcr.microsoft.com/playwright:v1.54.0-noble
```
