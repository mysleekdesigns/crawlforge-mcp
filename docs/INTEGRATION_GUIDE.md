# MCP WebScraper Integration Guide

## Overview

This guide provides step-by-step instructions for integrating the MCP WebScraper server with Claude Code and Cursor IDE. The WebScraper server implements the Model Context Protocol (MCP) and provides 12 powerful tools for web scraping, searching, and content analysis.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Server Installation](#server-installation)
- [Claude Code Integration](#claude-code-integration)
- [Cursor IDE Integration](#cursor-ide-integration)
- [Configuration Options](#configuration-options)
- [Verification and Testing](#verification-and-testing)
- [Advanced Configuration](#advanced-configuration)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### System Requirements

- **Node.js:** Version 18.0.0 or higher
- **npm:** Version 8.0.0 or higher (comes with Node.js)
- **Operating Systems:** Windows 10+, macOS 10.15+, Linux (Ubuntu 18.04+)
- **Memory:** Minimum 512MB RAM available
- **Network:** Internet connection for web scraping operations

### Check Your Environment

Verify your Node.js installation:

```bash
node --version  # Should show v18.0.0 or higher
npm --version   # Should show v8.0.0 or higher
```

If Node.js is not installed or outdated:

- **Windows/macOS:** Download from [nodejs.org](https://nodejs.org/)
- **Linux (Ubuntu/Debian):** 
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```
- **Linux (CentOS/RHEL):**
  ```bash
  curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
  sudo yum install -y nodejs
  ```

---

## Server Installation

### Method 1: Git Clone (Recommended for Development)

```bash
# Clone the repository
git clone https://github.com/your-username/mcp-webscraper.git
cd mcp-webscraper

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Make the server executable (optional)
chmod +x server.js
```

### Method 2: NPM Installation (When Published)

```bash
# Install globally
npm install -g mcp-webscraper

# Or install locally in your project
npm install mcp-webscraper
```

### Method 3: Direct Download

1. Download the latest release from the GitHub releases page
2. Extract the archive to your desired location
3. Navigate to the extracted directory
4. Run `npm install`

### Initial Configuration

Edit the `.env` file to configure the server:

```env
# Search Provider Settings (optional)
SEARCH_PROVIDER=auto
GOOGLE_API_KEY=your_google_api_key_here
GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id_here

# Performance Settings
MAX_WORKERS=10
QUEUE_CONCURRENCY=10
CACHE_TTL=3600000

# Rate Limiting
RATE_LIMIT_REQUESTS_PER_SECOND=10
```

### Verify Installation

Test the server installation:

```bash
# Navigate to the server directory
cd /path/to/mcp-webscraper

# Test server startup
node server.js
```

You should see output similar to:
```
MCP WebScraper server v3.0 running on stdio
Environment: development
Search enabled: true (provider: duckduckgo)
Tools available: fetch_url, extract_text, extract_links, extract_metadata, scrape_structured, search_web, crawl_deep, map_site, extract_content, process_document, summarize_content, analyze_content
```

Press `Ctrl+C` to stop the test.

---

## Claude Code Integration

### Step 1: Create MCP Configuration

Claude Code uses a `.mcp.json` file to configure MCP servers. Create this file in your project root or global configuration directory.

#### Project-Level Configuration

Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "webscraper": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-webscraper/server.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

#### Global Configuration

For system-wide access, create the configuration in your home directory:

**macOS/Linux:**
```bash
# Create the config directory if it doesn't exist
mkdir -p ~/.config/claude-code

# Create the MCP configuration
cat > ~/.config/claude-code/.mcp.json << 'EOF'
{
  "mcpServers": {
    "webscraper": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-webscraper/server.js"],
      "env": {
        "NODE_ENV": "production",
        "SEARCH_PROVIDER": "auto"
      }
    }
  }
}
EOF
```

**Windows:**
```powershell
# Create the config directory
New-Item -ItemType Directory -Force -Path "$env:APPDATA\claude-code"

# Create the MCP configuration
@'
{
  "mcpServers": {
    "webscraper": {
      "command": "node",
      "args": ["C:\\absolute\\path\\to\\mcp-webscraper\\server.js"],
      "env": {
        "NODE_ENV": "production",
        "SEARCH_PROVIDER": "auto"
      }
    }
  }
}
'@ | Out-File -FilePath "$env:APPDATA\claude-code\.mcp.json" -Encoding UTF8
```

### Step 2: Advanced Claude Code Configuration

For enhanced functionality, use this advanced configuration:

```json
{
  "mcpServers": {
    "webscraper": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-webscraper/server.js"],
      "env": {
        "NODE_ENV": "production",
        "SEARCH_PROVIDER": "auto",
        "MAX_WORKERS": "15",
        "QUEUE_CONCURRENCY": "10",
        "RATE_LIMIT_REQUESTS_PER_SECOND": "8",
        "CACHE_TTL": "7200000",
        "RESPECT_ROBOTS_TXT": "true"
      },
      "timeout": 30000,
      "initializationTimeout": 10000
    }
  }
}
```

### Step 3: Environment-Specific Configurations

#### Development Configuration

```json
{
  "mcpServers": {
    "webscraper-dev": {
      "command": "node",
      "args": ["/path/to/mcp-webscraper/server.js"],
      "env": {
        "NODE_ENV": "development",
        "DEBUG": "mcp:*",
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

#### Production Configuration with Google Search

```json
{
  "mcpServers": {
    "webscraper-prod": {
      "command": "node",
      "args": ["/path/to/mcp-webscraper/server.js"],
      "env": {
        "NODE_ENV": "production",
        "SEARCH_PROVIDER": "google",
        "GOOGLE_API_KEY": "your_google_api_key",
        "GOOGLE_SEARCH_ENGINE_ID": "your_search_engine_id",
        "MAX_WORKERS": "20",
        "CACHE_TTL": "3600000"
      }
    }
  }
}
```

### Step 4: Restart Claude Code

After creating or modifying the MCP configuration:

1. Close Claude Code completely
2. Restart Claude Code
3. The WebScraper tools should now be available

---

## Cursor IDE Integration

### Step 1: Locate Cursor Configuration Directory

Cursor uses a similar MCP configuration system. The configuration file location depends on your operating system:

- **macOS:** `~/Library/Application Support/Cursor/mcp.json`
- **Windows:** `%APPDATA%\Cursor\mcp.json`
- **Linux:** `~/.config/Cursor/mcp.json`

### Step 2: Create Cursor MCP Configuration

#### macOS Configuration

```bash
# Create the Cursor config directory
mkdir -p ~/Library/Application\ Support/Cursor

# Create the MCP configuration
cat > ~/Library/Application\ Support/Cursor/mcp.json << 'EOF'
{
  "mcpServers": {
    "webscraper": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-webscraper/server.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
EOF
```

#### Windows Configuration

```powershell
# Create the Cursor config directory
New-Item -ItemType Directory -Force -Path "$env:APPDATA\Cursor"

# Create the MCP configuration
@'
{
  "mcpServers": {
    "webscraper": {
      "command": "node",
      "args": ["C:\\absolute\\path\\to\\mcp-webscraper\\server.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
'@ | Out-File -FilePath "$env:APPDATA\Cursor\mcp.json" -Encoding UTF8
```

#### Linux Configuration

```bash
# Create the Cursor config directory
mkdir -p ~/.config/Cursor

# Create the MCP configuration
cat > ~/.config/Cursor/mcp.json << 'EOF'
{
  "mcpServers": {
    "webscraper": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-webscraper/server.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
EOF
```

### Step 3: Advanced Cursor Configuration

For enhanced performance in Cursor:

```json
{
  "mcpServers": {
    "webscraper": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-webscraper/server.js"],
      "env": {
        "NODE_ENV": "production",
        "SEARCH_PROVIDER": "auto",
        "MAX_WORKERS": "12",
        "QUEUE_CONCURRENCY": "8",
        "CACHE_TTL": "3600000",
        "RATE_LIMIT_REQUESTS_PER_SECOND": "10"
      },
      "timeout": 45000,
      "maxRetries": 3
    }
  }
}
```

### Step 4: Restart Cursor

1. Close Cursor completely
2. Restart Cursor
3. Open the Command Palette (`Cmd+Shift+P` on macOS, `Ctrl+Shift+P` on Windows/Linux)
4. Look for MCP-related commands or WebScraper tools

---

## Configuration Options

### Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Runtime environment |
| `SEARCH_PROVIDER` | `auto` | Search provider: `auto`, `google`, `duckduckgo` |
| `GOOGLE_API_KEY` | - | Google Custom Search API key |
| `GOOGLE_SEARCH_ENGINE_ID` | - | Google Custom Search Engine ID |
| `MAX_WORKERS` | `10` | Maximum worker threads |
| `QUEUE_CONCURRENCY` | `10` | Concurrent request limit |
| `CACHE_TTL` | `3600000` | Cache time-to-live (ms) |
| `CACHE_MAX_SIZE` | `1000` | Maximum cache entries |
| `RATE_LIMIT_REQUESTS_PER_SECOND` | `10` | Rate limit per second |
| `RATE_LIMIT_PER_DOMAIN` | `true` | Enable per-domain rate limiting |
| `MAX_CRAWL_DEPTH` | `5` | Maximum crawl depth |
| `MAX_PAGES_PER_CRAWL` | `100` | Maximum pages per crawl |
| `RESPECT_ROBOTS_TXT` | `true` | Respect robots.txt rules |
| `USER_AGENT` | `MCP-WebScraper/3.0` | User agent string |
| `LOG_LEVEL` | `info` | Logging level |
| `DEBUG` | - | Debug mode pattern |

### Performance Tuning

#### For High-Volume Usage

```json
{
  "env": {
    "MAX_WORKERS": "20",
    "QUEUE_CONCURRENCY": "15",
    "CACHE_TTL": "7200000",
    "RATE_LIMIT_REQUESTS_PER_SECOND": "15"
  }
}
```

#### For Resource-Constrained Systems

```json
{
  "env": {
    "MAX_WORKERS": "5",
    "QUEUE_CONCURRENCY": "3",
    "CACHE_MAX_SIZE": "500",
    "RATE_LIMIT_REQUESTS_PER_SECOND": "5"
  }
}
```

#### For Development/Testing

```json
{
  "env": {
    "NODE_ENV": "development",
    "LOG_LEVEL": "debug",
    "DEBUG": "mcp:*",
    "CACHE_TTL": "300000"
  }
}
```

---

## Verification and Testing

### Test MCP Protocol Compliance

```bash
# Navigate to server directory
cd /path/to/mcp-webscraper

# Test protocol compliance
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}' | node server.js
```

Expected response:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": {}
    },
    "serverInfo": {
      "name": "mcp_webScraper",
      "version": "3.0.0"
    }
  }
}
```

### Test Tool Availability

```bash
# List available tools
echo '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}' | node server.js
```

### Test Basic Functionality

Create a test script `test-webscraper.js`:

```javascript
import { spawn } from 'child_process';

const server = spawn('node', ['server.js'], {
  stdio: ['pipe', 'pipe', 'inherit']
});

// Initialize
server.stdin.write(JSON.stringify({
  jsonrpc: "2.0",
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" }
  },
  id: 1
}) + '\n');

// Test fetch_url
setTimeout(() => {
  server.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "fetch_url",
      arguments: {
        url: "https://httpbin.org/get"
      }
    },
    id: 2
  }) + '\n');
}, 1000);

server.stdout.on('data', (data) => {
  console.log('Server response:', data.toString());
});

setTimeout(() => {
  server.kill();
}, 5000);
```

Run the test:
```bash
node test-webscraper.js
```

---

## Advanced Configuration

### Multi-Environment Setup

Create different configurations for different environments:

#### `.mcp.development.json`
```json
{
  "mcpServers": {
    "webscraper-dev": {
      "command": "node",
      "args": ["/path/to/mcp-webscraper/server.js"],
      "env": {
        "NODE_ENV": "development",
        "LOG_LEVEL": "debug",
        "CACHE_TTL": "60000"
      }
    }
  }
}
```

#### `.mcp.production.json`
```json
{
  "mcpServers": {
    "webscraper-prod": {
      "command": "node",
      "args": ["/path/to/mcp-webscraper/server.js"],
      "env": {
        "NODE_ENV": "production",
        "MAX_WORKERS": "20",
        "CACHE_TTL": "3600000"
      }
    }
  }
}
```

### Docker Integration

Create a Dockerfile for containerized deployment:

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
EXPOSE 3000

CMD ["node", "server.js"]
```

Docker Compose configuration:

```yaml
version: '3.8'
services:
  webscraper:
    build: .
    environment:
      - NODE_ENV=production
      - SEARCH_PROVIDER=auto
      - MAX_WORKERS=15
    volumes:
      - ./cache:/app/cache
    restart: unless-stopped
```

### Load Balancing Setup

For high-availability deployments:

```json
{
  "mcpServers": {
    "webscraper-1": {
      "command": "node",
      "args": ["/path/to/mcp-webscraper/server.js"],
      "env": {
        "INSTANCE_ID": "webscraper-1",
        "PORT": "3001"
      }
    },
    "webscraper-2": {
      "command": "node",
      "args": ["/path/to/mcp-webscraper/server.js"],
      "env": {
        "INSTANCE_ID": "webscraper-2",
        "PORT": "3002"
      }
    }
  }
}
```

### Monitoring and Logging

Enhanced logging configuration:

```json
{
  "env": {
    "LOG_LEVEL": "info",
    "LOG_FORMAT": "json",
    "LOG_FILE": "/var/log/webscraper/app.log",
    "ENABLE_PERFORMANCE_MONITORING": "true",
    "METRICS_PORT": "9090"
  }
}
```

---

## Troubleshooting

### Common Issues

#### Issue: "Command not found: node"

**Solution:**
- Ensure Node.js is installed and in your PATH
- Try using the full path to node: `/usr/local/bin/node` or `C:\Program Files\nodejs\node.exe`

#### Issue: "Module not found" errors

**Solution:**
```bash
cd /path/to/mcp-webscraper
npm install
```

#### Issue: Server starts but tools are not available

**Solutions:**
1. Check the MCP configuration file syntax
2. Verify the server path is absolute
3. Check file permissions
4. Restart the IDE completely

#### Issue: "Permission denied" errors

**Solution:**
```bash
# Make server executable
chmod +x /path/to/mcp-webscraper/server.js

# Or fix npm permissions
sudo chown -R $(whoami) ~/.npm
```

#### Issue: Search tools not working

**Solutions:**
1. Check if `GOOGLE_API_KEY` and `GOOGLE_SEARCH_ENGINE_ID` are set correctly
2. Verify Google Custom Search API is enabled
3. Try using DuckDuckGo by setting `SEARCH_PROVIDER=duckduckgo`

### Debug Mode

Enable debug mode for troubleshooting:

```json
{
  "env": {
    "NODE_ENV": "development",
    "DEBUG": "mcp:*",
    "LOG_LEVEL": "debug"
  }
}
```

### Performance Issues

If experiencing slow performance:

1. **Reduce concurrency:**
   ```json
   {
     "env": {
       "MAX_WORKERS": "5",
       "QUEUE_CONCURRENCY": "3"
     }
   }
   ```

2. **Increase cache TTL:**
   ```json
   {
     "env": {
       "CACHE_TTL": "7200000"
     }
   }
   ```

3. **Monitor resource usage:**
   ```bash
   # Check memory usage
   ps aux | grep "node.*server.js"
   
   # Monitor with htop
   htop -p $(pgrep -f "node.*server.js")
   ```

### Network Issues

For network-related problems:

1. **Check proxy settings:**
   ```json
   {
     "env": {
       "HTTP_PROXY": "http://proxy.company.com:8080",
       "HTTPS_PROXY": "http://proxy.company.com:8080"
     }
   }
   ```

2. **Increase timeouts:**
   ```json
   {
     "env": {
       "REQUEST_TIMEOUT": "30000",
       "CONNECTION_TIMEOUT": "10000"
     }
   }
   ```

### Getting Help

If you continue to experience issues:

1. **Check the logs:**
   ```bash
   tail -f /path/to/mcp-webscraper/logs/app.log
   ```

2. **Create a GitHub issue** with:
   - Your operating system
   - Node.js version (`node --version`)
   - MCP configuration (remove sensitive data)
   - Error messages and logs
   - Steps to reproduce

3. **Community support:**
   - Join the MCP Discord server
   - Check Stack Overflow for similar issues
   - Review the project's documentation

---

## Best Practices

### Security

1. **Protect API keys:**
   - Use environment variables for sensitive data
   - Never commit API keys to version control
   - Consider using a secrets management system

2. **Network security:**
   - Use HTTPS URLs when possible
   - Implement proper firewall rules
   - Monitor network traffic

### Performance

1. **Optimize cache settings:**
   - Set appropriate TTL values
   - Monitor cache hit rates
   - Clean up old cache files periodically

2. **Resource management:**
   - Monitor memory usage
   - Set appropriate worker limits
   - Use rate limiting to prevent abuse

3. **Error handling:**
   - Implement retry logic
   - Handle network timeouts gracefully
   - Log errors for debugging

### Maintenance

1. **Regular updates:**
   ```bash
   cd /path/to/mcp-webscraper
   git pull origin main
   npm update
   ```

2. **Log rotation:**
   ```bash
   # Setup logrotate for log files
   sudo nano /etc/logrotate.d/webscraper
   ```

3. **Monitoring:**
   - Set up health checks
   - Monitor error rates
   - Track performance metrics

---

## Next Steps

After successful integration:

1. **Explore the tools:** Try each of the 12 available tools
2. **Read the API Reference:** Understand detailed parameters and responses
3. **Check the examples:** Review practical usage examples
4. **Join the community:** Connect with other users and contributors
5. **Contribute:** Help improve the project with feedback and contributions

For detailed API documentation, see [API_REFERENCE.md](./API_REFERENCE.md).
For troubleshooting common issues, see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).