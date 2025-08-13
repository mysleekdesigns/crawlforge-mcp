# Docker Guide for MCP WebScraper

🐳 **Purpose**: Learn how to run MCP WebScraper using Docker containers  
⏱️ **Time Needed**: 10-15 minutes for basic setup  
📚 **Difficulty**: 🟢 Easy (no Docker experience needed)

## Table of Contents

1. [What is Docker?](#what-is-docker) - For complete beginners
2. [Quick Start](#quick-start) - Get running in 3 minutes
3. [Docker Compose](#docker-compose) - Multi-container setup
4. [Available Services](#available-services) - All container options
5. [Common Commands](#common-commands) - Essential Docker commands
6. [Troubleshooting](#troubleshooting) - Fix common issues
7. [Advanced Features](#advanced-features) - Monitoring & scaling

## What is Docker?

### 🤔 Why Use Docker?

Docker is like a **shipping container for software**. Just as shipping containers allow goods to be transported anywhere regardless of what's inside, Docker containers let you run software anywhere regardless of the computer's setup.

**Benefits for MCP WebScraper**:
- ✅ **No installation hassles** - Everything is pre-configured
- ✅ **Consistent environment** - Works the same on any computer
- ✅ **Easy cleanup** - Remove everything with one command
- ✅ **Resource isolation** - Won't affect other programs

### 📦 Docker vs Traditional Installation

| Traditional Install | Docker |
|-------------------|--------|
| Install Node.js manually | ✅ Included in container |
| Install dependencies | ✅ Pre-installed |
| Configure environment | ✅ Pre-configured |
| Worry about versions | ✅ Fixed versions |
| Manual cleanup | ✅ Simple removal |

## Quick Start

### Prerequisites

First, install Docker:
- **Windows/Mac**: Download [Docker Desktop](https://www.docker.com/products/docker-desktop)
- **Linux**: Run `curl -fsSL https://get.docker.com | sh`

Verify installation:
```bash
docker --version
# Should show: Docker version 20.x or higher
```

### 🚀 Fastest Way to Start

**Step 1**: Clone the repository
```bash
git clone https://github.com/your-username/mcp-webscraper.git
cd mcp-webscraper
```

**Step 2**: Start the development container
```bash
docker-compose up mcp-webscraper-dev
```

**Step 3**: Verify it's working
```bash
# In a new terminal, test a tool
curl http://localhost:3000/health
# Should return: {"status":"healthy"}
```

🎉 **Success!** The server is running at `http://localhost:3000`

### 🛑 Stop the Container

Press `Ctrl+C` in the terminal, or run:
```bash
docker-compose down
```

## Docker Compose

Docker Compose lets you manage multiple containers easily. Think of it as a **recipe** that tells Docker exactly how to set up your application.

### Understanding docker-compose.yml

Our project includes several pre-configured setups:

#### 🟢 Development Mode
Perfect for testing and development:
```bash
docker-compose up mcp-webscraper-dev
```
- **Features**: Hot reload, debug logs, DuckDuckGo search (no API key needed)
- **URL**: http://localhost:3000
- **Use when**: Developing or testing locally

#### 🟡 Production Mode
Optimized for real-world use:
```bash
docker-compose up mcp-webscraper-prod
```
- **Features**: Optimized performance, info logs, Google search support
- **URL**: http://localhost:3001
- **Use when**: Running in production

#### 🔴 Testing Mode
Run automated tests:
```bash
docker-compose --profile testing up mcp-webscraper-test
```
- **Features**: Runs all tests, generates reports
- **Use when**: Validating changes

### Environment Variables

Create a `.env` file to customize settings:

```bash
# Basic configuration
SEARCH_PROVIDER=duckduckgo  # or 'google' if you have API keys
LOG_LEVEL=debug             # debug, info, warn, error

# Google Search (optional)
GOOGLE_API_KEY=your_key_here
GOOGLE_SEARCH_ENGINE_ID=your_id_here

# Performance
MAX_WORKERS=5               # Number of worker threads
QUEUE_CONCURRENCY=5         # Concurrent operations
```

## Available Services

### Core Services

| Service | Purpose | Command | Port |
|---------|---------|---------|------|
| **mcp-webscraper-dev** | Development with hot reload | `docker-compose up mcp-webscraper-dev` | 3000 |
| **mcp-webscraper-prod** | Production deployment | `docker-compose up mcp-webscraper-prod` | 3001 |
| **mcp-webscraper-test** | Run tests | `docker-compose --profile testing up mcp-webscraper-test` | - |
| **mcp-webscraper-perf** | Performance testing | `docker-compose --profile performance up mcp-webscraper-perf` | - |

### Optional Services

#### 📊 Monitoring Stack
Monitor your scraper's performance:

```bash
# Start monitoring services
docker-compose --profile monitoring up -d

# Access dashboards:
# - Prometheus: http://localhost:9090
# - Grafana: http://localhost:3002 (admin/admin)
```

#### 🗄️ Redis Cache
Add high-performance caching:

```bash
docker-compose --profile cache up -d redis
```

#### 📝 ELK Stack (Logging)
Advanced log aggregation:

```bash
docker-compose --profile logging up -d

# Access Kibana: http://localhost:5601
```

## Common Commands

### Essential Docker Commands

#### Container Management

```bash
# Start a service
docker-compose up service-name

# Start in background (detached)
docker-compose up -d service-name

# Stop all services
docker-compose down

# Stop and remove everything (including volumes)
docker-compose down -v

# Restart a service
docker-compose restart service-name
```

#### Viewing Logs

```bash
# View logs from all services
docker-compose logs

# View logs from specific service
docker-compose logs mcp-webscraper-dev

# Follow logs in real-time
docker-compose logs -f mcp-webscraper-dev

# View last 100 lines
docker-compose logs --tail=100
```

#### Checking Status

```bash
# List running containers
docker-compose ps

# Check resource usage
docker stats

# Inspect a service
docker-compose exec mcp-webscraper-dev sh
```

### Useful Workflows

#### 🔄 Update and Rebuild

After changing code:
```bash
# Rebuild the container
docker-compose build mcp-webscraper-dev

# Restart with new changes
docker-compose up --build mcp-webscraper-dev
```

#### 🧹 Clean Everything

Remove all traces:
```bash
# Stop and remove containers, networks, volumes
docker-compose down -v --remove-orphans

# Remove unused Docker resources
docker system prune -a
```

#### 📊 Monitor Performance

```bash
# Check memory and CPU usage
docker stats mcp-webscraper-dev

# See detailed container info
docker inspect mcp-webscraper-dev
```

## Troubleshooting

### Common Issues and Solutions

#### ❌ "Cannot connect to Docker daemon"

**Problem**: Docker isn't running  
**Solution**: 
- Windows/Mac: Start Docker Desktop
- Linux: `sudo systemctl start docker`

#### ❌ "Port 3000 already in use"

**Problem**: Another service is using the port  
**Solution**:
```bash
# Find what's using port 3000
lsof -i :3000  # Mac/Linux
netstat -ano | findstr :3000  # Windows

# Either stop that service or change the port:
# Edit docker-compose.yml and change "3000:3000" to "3001:3000"
```

#### ❌ "Permission denied" errors

**Problem**: Docker doesn't have necessary permissions  
**Solution**:
```bash
# Linux: Add user to docker group
sudo usermod -aG docker $USER
# Then log out and back in

# Mac/Windows: Make sure Docker Desktop is running
```

#### ❌ Container keeps restarting

**Problem**: Application crashing  
**Solution**:
```bash
# Check logs for errors
docker-compose logs --tail=50 mcp-webscraper-dev

# Common fixes:
# 1. Check .env file is valid
# 2. Ensure Node modules are installed
docker-compose exec mcp-webscraper-dev npm install
```

#### ❌ "No space left on device"

**Problem**: Docker using too much disk space  
**Solution**:
```bash
# Clean up unused resources
docker system prune -a --volumes

# Check disk usage
docker system df
```

### Getting Help

```bash
# Check container health
docker-compose exec mcp-webscraper-dev node -e "console.log('Container is healthy')"

# Access container shell for debugging
docker-compose exec mcp-webscraper-dev sh

# View detailed container logs
docker-compose logs --timestamps --details mcp-webscraper-dev
```

## Advanced Features

### Resource Limits

Control how much CPU and memory containers can use:

```yaml
# In docker-compose.yml
deploy:
  resources:
    limits:
      cpus: '1.0'      # Use max 1 CPU core
      memory: 512M      # Use max 512MB RAM
```

### Multi-Stage Builds

Our Dockerfile uses multi-stage builds for efficiency:

1. **Builder Stage**: Compiles and prepares the app
2. **Production Stage**: Minimal image with only runtime needs
3. **Development Stage**: Includes debugging tools
4. **Testing Stage**: Includes test frameworks

This keeps production images small (~150MB vs ~1GB).

### Scaling Services

Run multiple instances for higher throughput:

```bash
# Run 3 instances of the scraper
docker-compose up --scale mcp-webscraper-prod=3
```

### Custom Networks

Isolate services in custom networks:

```bash
# Create custom network
docker network create mcp-network

# Run container in custom network
docker run --network mcp-network mcp-webscraper:latest
```

### Volume Management

Persist data between container restarts:

```bash
# List volumes
docker volume ls

# Inspect volume
docker volume inspect mcp-webscraper_cache_dev

# Backup volume
docker run --rm -v mcp-webscraper_cache_dev:/data -v $(pwd):/backup alpine tar czf /backup/cache-backup.tar.gz /data
```

## Best Practices

### 🔐 Security

1. **Never commit .env files** with real credentials
2. **Use read-only volumes** where possible
3. **Run containers as non-root** user (already configured)
4. **Keep Docker updated** for security patches

### 🚀 Performance

1. **Use Docker BuildKit** for faster builds:
   ```bash
   DOCKER_BUILDKIT=1 docker-compose build
   ```

2. **Limit resources** to prevent system overload
3. **Use volumes** for persistent data, not bind mounts
4. **Enable caching** for frequently accessed data

### 🛠️ Development

1. **Use .dockerignore** to exclude unnecessary files
2. **Tag images properly** for version control
3. **Use health checks** to monitor container status
4. **Keep containers focused** on single responsibilities

## Next Steps

- 📖 [Quick Start Guide](./QUICK_START.md) - Configure Claude Code/Cursor
- 🚀 [Deployment Guide](./DEPLOYMENT.md) - Production deployment options
- 🔧 [Troubleshooting](./TROUBLESHOOTING.md) - Solve common problems
- 📚 [API Reference](./API_REFERENCE.md) - Learn about all tools

## Need Help?

- 💬 Check container logs: `docker-compose logs`
- 🔍 Inspect running containers: `docker ps`
- 📊 Monitor resources: `docker stats`
- ❓ [Open an issue](https://github.com/your-username/mcp-webscraper/issues) on GitHub