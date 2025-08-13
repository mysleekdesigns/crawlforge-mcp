# Deployment Guide

This guide covers deployment options for the MCP WebScraper server across different environments.

## Quick Start

### NPM Installation (Recommended)
```bash
# Install globally
npm install -g mcp-webscraper

# Or install locally
npm install mcp-webscraper

# Run the server
mcp-webscraper
```

### Docker Deployment
```bash
# Quick start with Docker
docker run -d \
  --name mcp-webscraper \
  -e NODE_ENV=production \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/logs:/app/logs \
  mcp-webscraper:latest
```

## Deployment Options

### 1. Production Deployment with Docker

#### Using Docker Compose (Recommended)
```bash
# Clone the repository
git clone https://github.com/mcp-webscraper/mcp-webscraper.git
cd mcp-webscraper

# Copy environment template
cp .env.example .env
# Edit .env with your configuration

# Start production services
docker-compose up -d mcp-webscraper-prod
```

#### Single Container Deployment
```bash
# Build production image
docker build --target production -t mcp-webscraper:prod .

# Run production container
docker run -d \
  --name mcp-webscraper-prod \
  --restart unless-stopped \
  -e NODE_ENV=production \
  -e LOG_LEVEL=info \
  -e MAX_WORKERS=10 \
  -e QUEUE_CONCURRENCY=10 \
  -e GOOGLE_API_KEY=${GOOGLE_API_KEY} \
  -e GOOGLE_SEARCH_ENGINE_ID=${GOOGLE_SEARCH_ENGINE_ID} \
  -v mcp-cache:/app/cache \
  -v mcp-logs:/app/logs \
  -p 3000:3000 \
  --memory=1g \
  --cpus=1.0 \
  mcp-webscraper:prod
```

### 2. Kubernetes Deployment

#### Basic Deployment
```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-webscraper
spec:
  replicas: 3
  selector:
    matchLabels:
      app: mcp-webscraper
  template:
    metadata:
      labels:
        app: mcp-webscraper
    spec:
      containers:
      - name: mcp-webscraper
        image: mcp-webscraper:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: production
        - name: LOG_LEVEL
          value: info
        resources:
          requests:
            memory: "512Mi"
            cpu: "0.5"
          limits:
            memory: "1Gi"
            cpu: "1.0"
        volumeMounts:
        - name: cache-volume
          mountPath: /app/cache
        - name: logs-volume
          mountPath: /app/logs
      volumes:
      - name: cache-volume
        persistentVolumeClaim:
          claimName: mcp-cache-pvc
      - name: logs-volume
        persistentVolumeClaim:
          claimName: mcp-logs-pvc
```

#### ConfigMap for Configuration
```yaml
# k8s/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: mcp-webscraper-config
data:
  NODE_ENV: "production"
  LOG_LEVEL: "info"
  MAX_WORKERS: "10"
  QUEUE_CONCURRENCY: "10"
  CACHE_ENABLE_DISK: "true"
  SEARCH_PROVIDER: "auto"
```

#### Service Configuration
```yaml
# k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: mcp-webscraper-service
spec:
  selector:
    app: mcp-webscraper
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3000
  type: LoadBalancer
```

### 3. Cloud Platform Deployments

#### AWS ECS
```json
{
  "family": "mcp-webscraper",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "containerDefinitions": [
    {
      "name": "mcp-webscraper",
      "image": "mcp-webscraper:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "LOG_LEVEL", "value": "info"}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/mcp-webscraper",
          "awslogs-region": "us-west-2",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

#### Google Cloud Run
```yaml
# cloudrun.yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: mcp-webscraper
  annotations:
    run.googleapis.com/ingress: all
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/maxScale: "10"
        run.googleapis.com/cpu-throttling: "false"
        run.googleapis.com/memory: "1Gi"
    spec:
      containerConcurrency: 100
      containers:
      - image: gcr.io/PROJECT_ID/mcp-webscraper:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: production
        resources:
          limits:
            memory: 1Gi
            cpu: "1"
```

#### Azure Container Instances
```bash
az container create \
  --resource-group myResourceGroup \
  --name mcp-webscraper \
  --image mcp-webscraper:latest \
  --cpu 1 \
  --memory 2 \
  --restart-policy Always \
  --environment-variables \
    NODE_ENV=production \
    LOG_LEVEL=info \
  --ports 3000
```

### 4. Traditional Server Deployment

#### PM2 Process Manager
```bash
# Install PM2
npm install -g pm2

# Install MCP WebScraper
npm install -g mcp-webscraper

# Create PM2 ecosystem file
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'mcp-webscraper',
    script: 'mcp-webscraper',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      MAX_WORKERS: 10,
      QUEUE_CONCURRENCY: 10
    }
  }]
}
EOF

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

#### Systemd Service
```ini
# /etc/systemd/system/mcp-webscraper.service
[Unit]
Description=MCP WebScraper Server
After=network.target

[Service]
Type=simple
User=mcp
WorkingDirectory=/opt/mcp-webscraper
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=LOG_LEVEL=info

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start service
sudo systemctl enable mcp-webscraper
sudo systemctl start mcp-webscraper
sudo systemctl status mcp-webscraper
```

## Environment Configuration

### Required Environment Variables
```bash
# Core configuration
NODE_ENV=production
LOG_LEVEL=info

# Performance settings
MAX_WORKERS=10
QUEUE_CONCURRENCY=10
CACHE_ENABLE_DISK=true
CACHE_TTL=3600000

# Search provider (optional)
SEARCH_PROVIDER=auto
GOOGLE_API_KEY=your_api_key
GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id

# Security settings
SSRF_PROTECTION_ENABLED=true
INPUT_VALIDATION_ENABLED=true
```

### Production Optimization
```bash
# Memory optimization
NODE_OPTIONS="--max-old-space-size=1024"

# Crawler limits
MAX_CRAWL_DEPTH=5
MAX_PAGES_PER_CRAWL=100

# Rate limiting
RATE_LIMIT_REQUESTS_PER_SECOND=10
RESPECT_ROBOTS_TXT=true
```

## Monitoring and Observability

### Health Checks
```bash
# HTTP health check endpoint (if running in HTTP mode)
curl http://localhost:3000/health

# Process health check
docker exec mcp-webscraper node -e "console.log('Health check passed')"
```

### Logging Configuration
```bash
# Log levels: error, warn, info, debug
LOG_LEVEL=info

# Enable security logging
SECURITY_LOGGING=true
VIOLATION_LOGGING=true

# Enable performance metrics
ENABLE_METRICS=true
```

### Monitoring Stack (Optional)
```bash
# Start full monitoring stack
docker-compose --profile monitoring up -d

# Access dashboards
# Grafana: http://localhost:3002 (admin/admin)
# Prometheus: http://localhost:9090
```

## Scaling and High Availability

### Horizontal Scaling
```bash
# Scale with Docker Compose
docker-compose up -d --scale mcp-webscraper-prod=3

# Scale with Kubernetes
kubectl scale deployment mcp-webscraper --replicas=5
```

### Load Balancing
```nginx
# Nginx load balancer configuration
upstream mcp_webscraper {
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
    server 127.0.0.1:3003;
}

server {
    listen 80;
    server_name mcp-webscraper.example.com;
    
    location / {
        proxy_pass http://mcp_webscraper;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Security Considerations

### Container Security
```dockerfile
# Use non-root user
USER mcp

# Read-only root filesystem
--read-only --tmpfs /tmp

# Drop capabilities
--cap-drop=ALL

# Security options
--security-opt=no-new-privileges:true
```

### Network Security
```bash
# Firewall rules
sudo ufw allow 3000/tcp
sudo ufw enable

# TLS/SSL termination (use reverse proxy)
# Never expose the MCP server directly to the internet
```

## Troubleshooting

### Common Issues

#### High Memory Usage
```bash
# Monitor memory usage
docker stats mcp-webscraper

# Adjust memory limits
NODE_OPTIONS="--max-old-space-size=512"
MAX_WORKERS=5
QUEUE_CONCURRENCY=5
```

#### Performance Issues
```bash
# Check performance metrics
npm run test:performance:quick

# Optimize cache settings
CACHE_ENABLE_DISK=true
CACHE_TTL=7200000

# Reduce crawler limits
MAX_CRAWL_DEPTH=3
MAX_PAGES_PER_CRAWL=50
```

#### Connection Issues
```bash
# Check connectivity
docker logs mcp-webscraper

# Verify DNS resolution
docker exec mcp-webscraper nslookup google.com

# Check rate limiting
RATE_LIMIT_REQUESTS_PER_SECOND=5
```

### Logs and Debugging
```bash
# View logs
docker logs -f mcp-webscraper

# Enable debug logging
LOG_LEVEL=debug

# Check specific log files
tail -f logs/app.log
tail -f logs/error.log
tail -f logs/performance.log
```

## Backup and Recovery

### Data Backup
```bash
# Backup cache and logs
docker run --rm -v mcp-cache:/cache -v $(pwd):/backup alpine \
  tar czf /backup/mcp-cache-backup.tar.gz -C /cache .

# Restore cache
docker run --rm -v mcp-cache:/cache -v $(pwd):/backup alpine \
  tar xzf /backup/mcp-cache-backup.tar.gz -C /cache
```

### Configuration Backup
```bash
# Backup configuration
cp .env .env.backup
cp docker-compose.yml docker-compose.yml.backup
```

## Performance Tuning

### Resource Allocation
- **Memory**: 512MB minimum, 1GB recommended for production
- **CPU**: 0.5 cores minimum, 1+ cores for high-load scenarios
- **Storage**: 1GB for cache and logs

### Optimization Settings
```bash
# High-performance configuration
MAX_WORKERS=20
QUEUE_CONCURRENCY=15
CACHE_TTL=7200000
RATE_LIMIT_REQUESTS_PER_SECOND=20
```

For more detailed configuration options, see the [Configuration Guide](CONFIGURATION.md) and [Performance Optimization](docs/PERFORMANCE_OPTIMIZATION.md) documentation.