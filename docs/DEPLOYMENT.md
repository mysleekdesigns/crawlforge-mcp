# Deployment Guide

🎯 **Purpose**: Deploy MCP WebScraper to production environments  
⏱️ **Time Needed**: 15-30 minutes  
📚 **Difficulty**: 🟡 Intermediate

## 🚀 Quick Deployment Options

### Option 1: Docker (Recommended) 🐳

The easiest and most reliable way to deploy. Docker provides consistent environments and easy scaling.

#### Quick Docker Setup

**Prerequisites:**
- Install [Docker Desktop](https://www.docker.com/products/docker-desktop) (Windows/Mac)
- Or on Linux: `curl -fsSL https://get.docker.com | sh`

**Development Mode:**
```bash
# Start development container with hot reload
docker-compose up mcp-webscraper-dev
```

**Production Mode:**
```bash
# Start production container with optimizations
docker-compose up -d mcp-webscraper-prod
```

**With Monitoring Stack:**
```bash
# Start with Prometheus & Grafana
docker-compose --profile monitoring up -d
```

#### Docker Benefits
- ✅ **No installation hassles** - Everything pre-configured
- ✅ **Consistent environment** - Works the same everywhere
- ✅ **Easy cleanup** - Remove with one command
- ✅ **Resource isolation** - Won't affect other programs
- ✅ **Built-in health checks** - Auto-restart on failures

#### Essential Docker Commands
```bash
# View running containers
docker ps

# View logs
docker logs mcp-webscraper

# Stop containers
docker-compose down

# Remove everything (including data)
docker-compose down -v

# Update to latest version
docker-compose pull
docker-compose up -d
```

### Option 2: PM2 Process Manager

For Node.js deployments without Docker:

```bash
# Install PM2 globally
npm install -g pm2

# Start with PM2
pm2 start server.js --name mcp-webscraper \
  --env production \
  --max-memory-restart 512M

# Save configuration
pm2 save
pm2 startup
```

### Option 3: Direct Node.js

Simplest but least robust:

```bash
# Run directly
NODE_ENV=production node server.js

# Or with nohup (Linux/Mac)
nohup node server.js > app.log 2>&1 &
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

## 📋 Production Deployment Checklist

Before deploying to production, ensure:

- [ ] Node.js version 18+ installed
- [ ] Environment variables configured
- [ ] SSL/TLS certificates ready (for HTTPS)
- [ ] Firewall rules configured
- [ ] Monitoring setup planned
- [ ] Backup strategy defined
- [ ] Resource limits set
- [ ] Log rotation configured

## ☁️ Cloud Deployment

### Quick Setup Scripts

#### AWS EC2 / DigitalOcean / Azure

**One-Command Setup** (Ubuntu/Debian):
```bash
curl -fsSL https://raw.githubusercontent.com/your-username/mcp-webscraper/main/scripts/cloud-setup.sh | bash
```

Or manually:
```bash
#!/bin/bash
# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Clone and setup
git clone https://github.com/your-username/mcp-webscraper.git
cd mcp-webscraper
npm install --production

# Install PM2
sudo npm install -g pm2
pm2 start server.js --name mcp-webscraper
pm2 save
pm2 startup
```

### 💰 Cost Estimates (Monthly)

| Provider | Instance Type | vCPUs | RAM | Storage | Cost/Month |
|----------|--------------|-------|------|---------|------------|
| **AWS EC2** | t3.medium | 2 | 4GB | 20GB | ~$30 |
| **DigitalOcean** | Basic Droplet | 2 | 4GB | 80GB | $24 |
| **Azure** | B2s | 2 | 4GB | 8GB | ~$30 |
| **Google Cloud** | e2-medium | 2 | 4GB | 10GB | ~$25 |
| **Heroku** | Standard 1X | 1 | 512MB | - | $25 |

**💡 Pro tip**: Start with DigitalOcean for simplicity and cost-effectiveness

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

## 🔄 Rollback Procedures

If deployment fails:

```bash
# PM2 Rollback
pm2 reload mcp-webscraper --update-env
pm2 reset mcp-webscraper  # Reset metrics

# Docker Rollback
docker-compose down
docker-compose up -d --force-recreate mcp-webscraper-prod

# Git Rollback
git checkout HEAD~1
npm install
pm2 restart mcp-webscraper
```

## 📈 Performance Optimization

### Quick Wins
```env
# Increase these for better performance
MAX_WORKERS=16              # Match CPU cores
QUEUE_CONCURRENCY=20        # More parallel operations
CACHE_TTL=7200000          # Longer cache (2 hours)
CONNECTION_POOL_SIZE=100    # More connections
```

### Resource Monitoring
```bash
# PM2 monitoring
pm2 monit

# Docker monitoring
docker stats mcp-webscraper-prod

# System monitoring
htop  # or top
```

## 🔒 Security Best Practices

1. **Always use environment variables** for sensitive data
2. **Enable SSRF protection**: `ENABLE_SSRF_PROTECTION=true`
3. **Set resource limits** to prevent abuse
4. **Use HTTPS** with reverse proxy (nginx/Apache)
5. **Regular updates**: `npm audit fix`
6. **Monitor logs** for suspicious activity

---

## 🔄 Maintenance & Updates

### Regular Maintenance Tasks

**Weekly:**
```bash
# Check logs for errors
tail -n 100 logs/error.log

# Update dependencies
npm audit fix

# Check resource usage
df -h && free -h && top -p $(pgrep -f server.js)
```

**Monthly:**
```bash
# Update to latest version
git pull
npm install
pm2 restart mcp-webscraper  # or docker-compose restart

# Clean up logs
logrotate -f /etc/logrotate.d/mcp-webscraper

# Backup configuration
tar -czf backup-$(date +%Y%m%d).tar.gz .env logs/ config/
```

### Health Monitoring

**Setup Health Checks:**
```bash
# Add to crontab (crontab -e)
*/5 * * * * curl -f http://localhost:3000/health || systemctl restart mcp-webscraper
```

**Monitor Key Metrics:**
- Response time < 2 seconds
- Memory usage < 80% of available
- Error rate < 5%
- Disk space > 10% free

### Rollback Plan

**If deployment fails:**
```bash
# PM2 rollback
pm2 restart mcp-webscraper --update-env

# Docker rollback
docker-compose down
docker-compose up -d --force-recreate

# Git rollback
git checkout HEAD~1
npm install
pm2 restart mcp-webscraper
```

---

## 📈 Next Steps

**After deployment:**
1. 🔍 **Monitor logs** for first 24 hours
2. 📊 **Set up alerts** for critical metrics
3. 🔄 **Schedule backups** of configuration
4. 📈 **Plan scaling** based on usage patterns
5. 🔒 **Review security** settings monthly

**Learn More:**
- [Architecture Details](./ADVANCED.md) - System internals
- [Troubleshooting](./TROUBLESHOOTING.md) - Common issues  
- [Performance Tuning](./ADVANCED.md#performance) - Optimization
- [API Reference](./API_REFERENCE.md) - Tool documentation

**Need Help?** Open an issue on GitHub with your deployment details.