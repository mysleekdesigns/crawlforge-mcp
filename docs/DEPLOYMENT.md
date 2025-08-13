# Deployment Guide

Deploy the MCP WebScraper server in production environments using Docker, npm, or PM2.

## Quick Deployment Options

### Option 1: NPM Global Install (Simplest)

```bash
# Install globally
npm install -g mcp-webscraper

# Run the server
mcp-webscraper

# Or with environment variables
NODE_ENV=production mcp-webscraper
```

### Option 2: Docker (Recommended for Production)

```bash
# Using Docker Compose
docker-compose up -d mcp-webscraper-prod

# Or using Docker directly
docker run -d \
  --name mcp-webscraper \
  --restart unless-stopped \
  -e NODE_ENV=production \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/logs:/app/logs \
  mcp-webscraper:latest
```

### Option 3: PM2 Process Manager

```bash
# Install PM2 globally
npm install -g pm2

# Start with PM2
pm2 start server.js --name mcp-webscraper \
  --env production \
  --max-memory-restart 512M

# Save PM2 configuration
pm2 save
pm2 startup
```

## Production Configuration

### Environment Variables

Create a `.env` file for production:

```env
# Environment
NODE_ENV=production
LOG_LEVEL=info

# Performance
MAX_WORKERS=10
QUEUE_CONCURRENCY=10
CACHE_TTL=3600000
RATE_LIMIT_REQUESTS_PER_SECOND=10

# Search Configuration
SEARCH_PROVIDER=google
GOOGLE_API_KEY=your_production_key
GOOGLE_SEARCH_ENGINE_ID=your_engine_id

# Security
ENABLE_SSRF_PROTECTION=true
MAX_REQUEST_SIZE=104857600
REQUEST_TIMEOUT=60000

# Crawling Limits
MAX_CRAWL_DEPTH=5
MAX_PAGES_PER_CRAWL=100
RESPECT_ROBOTS_TXT=true
```

### Resource Requirements

| Component | Minimum | Recommended | Notes |
|-----------|---------|-------------|-------|
| CPU | 1 core | 2+ cores | More cores improve concurrent processing |
| Memory | 512MB | 1-2GB | Depends on crawl size and concurrency |
| Storage | 1GB | 5GB+ | For cache and logs |
| Network | 10 Mbps | 100+ Mbps | For efficient web scraping |

## Docker Deployment

### Build and Run

```bash
# Build production image
docker build --target production -t mcp-webscraper:prod .

# Run with resource limits
docker run -d \
  --name mcp-webscraper-prod \
  --restart unless-stopped \
  --memory=1g \
  --cpus=2.0 \
  -e NODE_ENV=production \
  -e LOG_LEVEL=info \
  -v mcp-cache:/app/cache \
  -v mcp-logs:/app/logs \
  mcp-webscraper:prod
```

### Docker Compose Production

```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  mcp-webscraper:
    image: mcp-webscraper:prod
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=info
      - MAX_WORKERS=10
      - QUEUE_CONCURRENCY=10
    volumes:
      - cache:/app/cache
      - logs:/app/logs
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 1G
        reservations:
          cpus: '1.0'
          memory: 512M
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health')"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  cache:
  logs:
```

Run with:
```bash
docker-compose -f docker-compose.prod.yml up -d
```

## Cloud Deployment

### AWS EC2 / DigitalOcean / Azure VM

1. **Create VM Instance**
   - Ubuntu 20.04 LTS or newer
   - t3.medium (AWS) or similar
   - 20GB storage minimum

2. **Setup Script**
```bash
#!/bin/bash
# setup-mcp-webscraper.sh

# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Git
sudo apt-get install -y git

# Clone repository
git clone https://github.com/your-username/mcp-webscraper.git
cd mcp-webscraper

# Install dependencies
npm install --production

# Setup PM2
sudo npm install -g pm2

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Start with PM2
pm2 start server.js --name mcp-webscraper
pm2 save
pm2 startup systemd -u $USER --hp /home/$USER
```

### Heroku Deployment

```bash
# Create Heroku app
heroku create your-mcp-webscraper

# Set buildpack
heroku buildpacks:set heroku/nodejs

# Set environment variables
heroku config:set NODE_ENV=production
heroku config:set GOOGLE_API_KEY=your_key
heroku config:set MAX_WORKERS=4

# Deploy
git push heroku main

# Scale dynos
heroku ps:scale web=1
```

## Monitoring

### Health Check Endpoint

The server exposes a health check endpoint:

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "healthy",
  "uptime": 3600,
  "memory": {
    "used": 52428800,
    "total": 536870912
  },
  "cpu": {
    "usage": 15.2
  }
}
```

### Logging

Production logs are written to:
- `./logs/app.log` - Application logs
- `./logs/error.log` - Error logs
- `./logs/performance.log` - Performance metrics

Configure log rotation:

```bash
# /etc/logrotate.d/mcp-webscraper
/path/to/mcp-webscraper/logs/*.log {
  daily
  rotate 7
  compress
  missingok
  notifempty
  create 0640 node node
  sharedscripts
  postrotate
    pm2 reload mcp-webscraper
  endscript
}
```

### Monitoring with PM2

```bash
# Real-time monitoring
pm2 monit

# View logs
pm2 logs mcp-webscraper

# Process info
pm2 show mcp-webscraper

# Web dashboard
pm2 install pm2-web
pm2 web
```

## Security Best Practices

1. **Use Environment Variables**
   - Never commit `.env` files
   - Use secrets management in production

2. **Enable SSRF Protection**
   ```env
   ENABLE_SSRF_PROTECTION=true
   ```

3. **Set Resource Limits**
   ```env
   MAX_REQUEST_SIZE=104857600  # 100MB
   REQUEST_TIMEOUT=60000        # 60 seconds
   MAX_CRAWL_DEPTH=5
   MAX_PAGES_PER_CRAWL=100
   ```

4. **Use HTTPS**
   - Deploy behind a reverse proxy (nginx/Apache)
   - Enable SSL/TLS certificates

5. **Regular Updates**
   ```bash
   # Update dependencies
   npm audit fix
   npm update
   ```

## Scaling Considerations

### Horizontal Scaling

Run multiple instances behind a load balancer:

```nginx
# nginx.conf
upstream mcp_webscraper {
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
    server 127.0.0.1:3003;
}

server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://mcp_webscraper;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Performance Tuning

```env
# Optimize for high load
MAX_WORKERS=16               # Match CPU cores
QUEUE_CONCURRENCY=20         # Increase concurrency
CACHE_SIZE=10000            # Larger cache
CONNECTION_POOL_SIZE=100    # More connections
```

## Troubleshooting Production Issues

### High Memory Usage
```bash
# Check memory usage
pm2 monit

# Restart if needed
pm2 restart mcp-webscraper

# Adjust memory limit
pm2 delete mcp-webscraper
pm2 start server.js --max-memory-restart 1G
```

### Slow Performance
1. Check CPU usage: `top` or `htop`
2. Review logs: `pm2 logs`
3. Increase workers: `MAX_WORKERS=16`
4. Enable caching: `CACHE_TTL=7200000`

### Connection Errors
1. Check network: `netstat -tuln`
2. Verify firewall: `sudo ufw status`
3. Test connectivity: `curl -I https://example.com`

## Next Steps

- 📊 [Monitoring Setup](./ADVANCED.md#monitoring) - Advanced monitoring
- 🔒 [Security Guide](./ADVANCED.md#security) - Security hardening
- 🚀 [Performance Tuning](./ADVANCED.md#performance) - Optimization tips
- 🔧 [Troubleshooting](./TROUBLESHOOTING.md) - Common issues