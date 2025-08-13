# MCP WebScraper Troubleshooting Guide

## Overview

This guide helps you diagnose and resolve common issues with the MCP WebScraper server. Issues are organized by category with step-by-step solutions and prevention tips.

## Table of Contents

- [Quick Diagnostics](#quick-diagnostics)
- [Installation Issues](#installation-issues)
- [Configuration Problems](#configuration-problems)
- [Runtime Errors](#runtime-errors)
- [Tool-Specific Issues](#tool-specific-issues)
- [Performance Problems](#performance-problems)
- [Network and Security Issues](#network-and-security-issues)
- [Error Code Reference](#error-code-reference)
- [Debug Mode and Logging](#debug-mode-and-logging)
- [Getting Help](#getting-help)

---

## Quick Diagnostics

### Health Check Script

Create this script to quickly diagnose your setup:

```bash
#!/bin/bash
# File: diagnose-webscraper.sh

echo "=== MCP WebScraper Diagnostics ==="
echo

# Check Node.js
echo "1. Node.js Version:"
node --version || echo "❌ Node.js not found"
echo

# Check npm
echo "2. npm Version:"
npm --version || echo "❌ npm not found"
echo

# Check server directory
SERVER_PATH="/path/to/mcp-webscraper"  # Update this path
echo "3. Server Directory:"
if [ -d "$SERVER_PATH" ]; then
    echo "✅ Directory exists: $SERVER_PATH"
    if [ -f "$SERVER_PATH/server.js" ]; then
        echo "✅ server.js found"
    else
        echo "❌ server.js not found"
    fi
    if [ -f "$SERVER_PATH/package.json" ]; then
        echo "✅ package.json found"
    else
        echo "❌ package.json not found"
    fi
else
    echo "❌ Directory not found: $SERVER_PATH"
fi
echo

# Check dependencies
echo "4. Dependencies:"
cd "$SERVER_PATH" 2>/dev/null && npm list --depth=0 2>/dev/null || echo "❌ Dependencies not installed"
echo

# Test server startup
echo "5. Server Test:"
cd "$SERVER_PATH" 2>/dev/null && timeout 5s node server.js >/dev/null 2>&1
if [ $? -eq 124 ]; then
    echo "✅ Server starts successfully"
else
    echo "❌ Server startup failed"
fi
echo

# Check MCP config
echo "6. MCP Configuration:"
for config_path in \
    "./.mcp.json" \
    "~/.config/claude-code/.mcp.json" \
    "~/Library/Application Support/Cursor/mcp.json" \
    "$APPDATA/Cursor/mcp.json"; do
    if [ -f "$config_path" ]; then
        echo "✅ Found config: $config_path"
    fi
done
echo

echo "=== End Diagnostics ==="
```

Make it executable and run:
```bash
chmod +x diagnose-webscraper.sh
./diagnose-webscraper.sh
```

### Quick Test Commands

```bash
# Test Node.js and server startup
cd /path/to/mcp-webscraper
node --version
node server.js &
sleep 2
kill %1

# Test MCP protocol
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}' | node server.js

# Test basic tool
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"fetch_url","arguments":{"url":"https://httpbin.org/get"}},"id":2}' | node server.js
```

---

## Installation Issues

### Issue: Node.js Version Incompatibility

**Symptoms:**
- "Node.js version not supported" error
- Syntax errors during startup
- Missing ECMAScript features

**Solutions:**

1. **Check current version:**
   ```bash
   node --version
   ```

2. **Install Node.js 18+ (recommended method):**
   ```bash
   # Using Node Version Manager (recommended)
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   nvm install 18
   nvm use 18
   
   # Or download from nodejs.org
   # Visit https://nodejs.org/en/download/
   ```

3. **Verify installation:**
   ```bash
   node --version  # Should show v18.x.x or higher
   npm --version   # Should show v8.x.x or higher
   ```

### Issue: npm Install Failures

**Symptoms:**
- "EACCES: permission denied" errors
- "Cannot resolve dependency" errors
- Network timeout errors

**Solutions:**

1. **Fix npm permissions (macOS/Linux):**
   ```bash
   sudo chown -R $(whoami) ~/.npm
   npm config set prefix ~/.npm-global
   echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
   source ~/.bashrc
   ```

2. **Clear npm cache:**
   ```bash
   npm cache clean --force
   rm -rf node_modules package-lock.json
   npm install
   ```

3. **Use npm ci for production:**
   ```bash
   npm ci  # Uses exact versions from package-lock.json
   ```

4. **Configure proxy (if behind corporate firewall):**
   ```bash
   npm config set proxy http://proxy.company.com:8080
   npm config set https-proxy http://proxy.company.com:8080
   ```

### Issue: Missing Dependencies

**Symptoms:**
- "Module not found" errors
- "Cannot find package" errors

**Solutions:**

1. **Install missing dependencies:**
   ```bash
   cd /path/to/mcp-webscraper
   npm install
   ```

2. **Check for peer dependencies:**
   ```bash
   npm ls
   npm audit fix
   ```

3. **Manual dependency installation:**
   ```bash
   npm install @modelcontextprotocol/sdk cheerio zod
   ```

---

## Configuration Problems

### Issue: MCP Configuration Not Found

**Symptoms:**
- WebScraper tools not available in Claude Code/Cursor
- "No MCP servers configured" messages
- Tools don't appear in IDE

**Solutions:**

1. **Verify configuration file location:**
   ```bash
   # Claude Code
   ls -la .mcp.json  # Project level
   ls -la ~/.config/claude-code/.mcp.json  # Global level
   
   # Cursor (macOS)
   ls -la ~/Library/Application\ Support/Cursor/mcp.json
   
   # Cursor (Linux)
   ls -la ~/.config/Cursor/mcp.json
   
   # Cursor (Windows)
   dir %APPDATA%\Cursor\mcp.json
   ```

2. **Create missing configuration:**
   ```bash
   # Example for Claude Code
   cat > .mcp.json << 'EOF'
   {
     "mcpServers": {
       "webscraper": {
         "command": "node",
         "args": ["/absolute/path/to/mcp-webscraper/server.js"]
       }
     }
   }
   EOF
   ```

3. **Validate JSON syntax:**
   ```bash
   # Check for syntax errors
   python3 -m json.tool .mcp.json
   # or
   node -e "console.log(JSON.parse(require('fs').readFileSync('.mcp.json', 'utf8')))"
   ```

### Issue: Incorrect Server Path

**Symptoms:**
- "Command not found" errors
- "No such file or directory" errors
- Server fails to start

**Solutions:**

1. **Use absolute paths:**
   ```json
   {
     "mcpServers": {
       "webscraper": {
         "command": "node",
         "args": ["/home/user/mcp-webscraper/server.js"]
       }
     }
   }
   ```

2. **Find correct path:**
   ```bash
   # Find the server file
   find / -name "server.js" -path "*/mcp-webscraper/*" 2>/dev/null
   
   # Or use pwd to get current directory
   cd /path/to/mcp-webscraper
   pwd  # Use this output in your config
   ```

3. **Test path manually:**
   ```bash
   node /absolute/path/to/mcp-webscraper/server.js
   ```

### Issue: Environment Variables Not Working

**Symptoms:**
- Search tools not working despite configuration
- Default values being used instead of custom values
- "API key not configured" errors

**Solutions:**

1. **Check environment variable format:**
   ```json
   {
     "mcpServers": {
       "webscraper": {
         "command": "node",
         "args": ["/path/to/server.js"],
         "env": {
           "GOOGLE_API_KEY": "your_key_here",
           "SEARCH_PROVIDER": "google"
         }
       }
     }
   }
   ```

2. **Verify .env file (if using):**
   ```bash
   cd /path/to/mcp-webscraper
   cat .env
   # Ensure no spaces around = signs
   # GOOGLE_API_KEY=your_key_here (correct)
   # GOOGLE_API_KEY = your_key_here (incorrect)
   ```

3. **Test environment variables:**
   ```bash
   # Test if variables are passed correctly
   GOOGLE_API_KEY=test_key node -e "console.log(process.env.GOOGLE_API_KEY)"
   ```

---

## Runtime Errors

### Issue: Server Startup Failures

**Symptoms:**
- Process exits immediately
- "Cannot read property" errors
- "Port already in use" errors

**Solutions:**

1. **Check for syntax errors:**
   ```bash
   cd /path/to/mcp-webscraper
   node --check server.js
   ```

2. **Review startup logs:**
   ```bash
   node server.js 2>&1 | tee startup.log
   ```

3. **Check for port conflicts:**
   ```bash
   # If using HTTP transport instead of stdio
   lsof -i :3000  # Replace with your port
   kill -9 PID    # Kill conflicting process
   ```

4. **Run with debug information:**
   ```bash
   DEBUG=* node server.js
   ```

### Issue: Memory and Resource Errors

**Symptoms:**
- "JavaScript heap out of memory" errors
- Slow performance
- Process killed by system

**Solutions:**

1. **Increase Node.js memory limit:**
   ```bash
   node --max-old-space-size=4096 server.js
   ```

2. **Reduce concurrent operations:**
   ```json
   {
     "env": {
       "MAX_WORKERS": "5",
       "QUEUE_CONCURRENCY": "3",
       "CACHE_MAX_SIZE": "500"
     }
   }
   ```

3. **Monitor memory usage:**
   ```bash
   # Monitor memory in real-time
   watch -n 1 'ps aux | grep "node.*server.js"'
   
   # Or use htop
   htop -p $(pgrep -f "node.*server.js")
   ```

### Issue: Unhandled Promise Rejections

**Symptoms:**
- "UnhandledPromiseRejectionWarning" messages
- Server becomes unresponsive
- Inconsistent behavior

**Solutions:**

1. **Enable strict error handling:**
   ```bash
   node --unhandled-rejections=strict server.js
   ```

2. **Add global error handlers (for debugging):**
   ```javascript
   // Add to server.js for debugging
   process.on('unhandledRejection', (reason, promise) => {
     console.error('Unhandled Rejection at:', promise, 'reason:', reason);
   });
   
   process.on('uncaughtException', (error) => {
     console.error('Uncaught Exception:', error);
     process.exit(1);
   });
   ```

---

## Tool-Specific Issues

### Search Tools Issues

#### Issue: Google Search Not Working

**Symptoms:**
- "API key not configured" errors
- "Invalid search engine ID" errors
- Empty search results

**Solutions:**

1. **Verify Google API setup:**
   ```bash
   # Test API key validity
   curl "https://www.googleapis.com/customsearch/v1?key=YOUR_API_KEY&cx=YOUR_ENGINE_ID&q=test"
   ```

2. **Check API quotas:**
   - Visit Google Cloud Console
   - Check Custom Search API quotas
   - Verify billing is enabled (if required)

3. **Use DuckDuckGo as fallback:**
   ```json
   {
     "env": {
       "SEARCH_PROVIDER": "duckduckgo"
     }
   }
   ```

#### Issue: DuckDuckGo Rate Limiting

**Symptoms:**
- "Too many requests" errors
- Incomplete search results
- Temporary blocks

**Solutions:**

1. **Reduce request rate:**
   ```json
   {
     "env": {
       "RATE_LIMIT_REQUESTS_PER_SECOND": "2",
       "SEARCH_DELAY_MS": "1000"
     }
   }
   ```

2. **Implement backoff strategy:**
   ```bash
   # Test with delays between requests
   sleep 2
   ```

### Crawling Issues

#### Issue: Robots.txt Blocking

**Symptoms:**
- "Blocked by robots.txt" errors
- Limited crawl results
- Permission denied messages

**Solutions:**

1. **Check robots.txt:**
   ```bash
   curl https://example.com/robots.txt
   ```

2. **Override robots.txt (use responsibly):**
   ```json
   {
     "respect_robots": false
   }
   ```

3. **Use different user agent:**
   ```json
   {
     "env": {
       "USER_AGENT": "Mozilla/5.0 (compatible; Research Bot)"
     }
   }
   ```

#### Issue: Crawl Timeouts

**Symptoms:**
- "Request timeout" errors
- Incomplete crawl results
- Slow crawling performance

**Solutions:**

1. **Increase timeouts:**
   ```json
   {
     "env": {
       "REQUEST_TIMEOUT": "30000",
       "CONNECTION_TIMEOUT": "15000"
     }
   }
   ```

2. **Reduce concurrency:**
   ```json
   {
     "concurrency": 3,
     "max_pages": 50
   }
   ```

3. **Use smaller batches:**
   ```json
   {
     "max_depth": 2,
     "max_pages": 25
   }
   ```

### Content Extraction Issues

#### Issue: Empty Content Extraction

**Symptoms:**
- Empty text results
- "No content found" errors
- Missing main content

**Solutions:**

1. **Check if JavaScript is required:**
   ```json
   {
     "options": {
       "requiresJavaScript": true,
       "waitForTimeout": 10000
     }
   }
   ```

2. **Disable readability extraction:**
   ```json
   {
     "options": {
       "useReadability": false,
       "extractMetadata": true
     }
   }
   ```

3. **Use custom selectors:**
   ```json
   {
     "selectors": {
       "content": "article, .content, .post-content, main"
     }
   }
   ```

---

## Performance Problems

### Issue: Slow Response Times

**Symptoms:**
- Tools take longer than 30 seconds
- Timeout errors
- High CPU usage

**Diagnostic Steps:**

1. **Monitor performance:**
   ```bash
   # Monitor CPU usage
   top -p $(pgrep -f "node.*server.js")
   
   # Monitor network activity
   netstat -i
   
   # Check disk I/O
   iotop -p $(pgrep -f "node.*server.js")
   ```

2. **Profile Node.js performance:**
   ```bash
   node --prof server.js
   # Run some operations
   # Kill server
   node --prof-process isolate-*.log > profile.txt
   ```

**Solutions:**

1. **Optimize cache settings:**
   ```json
   {
     "env": {
       "CACHE_TTL": "7200000",
       "CACHE_MAX_SIZE": "2000"
     }
   }
   ```

2. **Reduce worker count on lower-end systems:**
   ```json
   {
     "env": {
       "MAX_WORKERS": "3",
       "QUEUE_CONCURRENCY": "2"
     }
   }
   ```

3. **Use connection pooling:**
   ```json
   {
     "env": {
       "ENABLE_CONNECTION_POOLING": "true",
       "MAX_CONNECTIONS_PER_HOST": "5"
     }
   }
   ```

### Issue: High Memory Usage

**Symptoms:**
- Memory usage keeps increasing
- System becomes sluggish
- Out of memory errors

**Solutions:**

1. **Enable garbage collection optimization:**
   ```bash
   node --expose-gc --optimize-for-size server.js
   ```

2. **Limit cache size:**
   ```json
   {
     "env": {
       "CACHE_MAX_SIZE": "100",
       "CACHE_TTL": "1800000"
     }
   }
   ```

3. **Monitor memory leaks:**
   ```javascript
   // Add to server.js for debugging
   setInterval(() => {
     const used = process.memoryUsage();
     console.log('Memory usage:', {
       rss: Math.round(used.rss / 1024 / 1024) + 'MB',
       heapTotal: Math.round(used.heapTotal / 1024 / 1024) + 'MB',
       heapUsed: Math.round(used.heapUsed / 1024 / 1024) + 'MB'
     });
   }, 30000);
   ```

---

## Network and Security Issues

### Issue: Proxy Configuration

**Symptoms:**
- "ENOTFOUND" errors
- Connection timeouts
- "Unable to verify certificate" errors

**Solutions:**

1. **Configure HTTP proxy:**
   ```json
   {
     "env": {
       "HTTP_PROXY": "http://proxy.company.com:8080",
       "HTTPS_PROXY": "http://proxy.company.com:8080",
       "NO_PROXY": "localhost,127.0.0.1"
     }
   }
   ```

2. **Handle certificate issues:**
   ```json
   {
     "env": {
       "NODE_TLS_REJECT_UNAUTHORIZED": "0"
     }
   }
   ```
   **⚠️ Warning:** Only use in development environments.

3. **Test proxy connectivity:**
   ```bash
   curl --proxy http://proxy.company.com:8080 https://httpbin.org/get
   ```

### Issue: SSL/TLS Certificate Errors

**Symptoms:**
- "UNABLE_TO_VERIFY_LEAF_SIGNATURE" errors
- "CERT_UNTRUSTED" errors
- HTTPS connection failures

**Solutions:**

1. **Update Node.js certificates:**
   ```bash
   npm update -g
   ```

2. **Use custom CA certificates:**
   ```bash
   export NODE_EXTRA_CA_CERTS=/path/to/company-ca.pem
   node server.js
   ```

3. **Configure certificate checking:**
   ```json
   {
     "env": {
       "NODE_TLS_REJECT_UNAUTHORIZED": "1",
       "HTTPS_CA_BUNDLE": "/path/to/ca-bundle.pem"
     }
   }
   ```

### Issue: Firewall Blocking

**Symptoms:**
- Connection timeouts to specific domains
- "ECONNREFUSED" errors
- Inconsistent network access

**Solutions:**

1. **Test network connectivity:**
   ```bash
   # Test specific URLs
   curl -I https://example.com
   
   # Test with different user agents
   curl -H "User-Agent: MCP-WebScraper/3.0" https://example.com
   ```

2. **Configure firewall rules:**
   ```bash
   # Allow outbound HTTPS (port 443)
   sudo ufw allow out 443
   
   # Allow outbound HTTP (port 80)
   sudo ufw allow out 80
   ```

3. **Use alternative DNS:**
   ```json
   {
     "env": {
       "DNS_SERVERS": "8.8.8.8,8.8.4.4"
     }
   }
   ```

---

## Error Code Reference

### HTTP Error Codes

| Code | Description | Solution |
|------|-------------|----------|
| `400` | Bad Request | Check URL format and parameters |
| `401` | Unauthorized | Verify API keys and credentials |
| `403` | Forbidden | Check robots.txt and permissions |
| `404` | Not Found | Verify URL exists and is accessible |
| `429` | Too Many Requests | Implement rate limiting and delays |
| `500` | Internal Server Error | Retry after delay |
| `502` | Bad Gateway | Check proxy configuration |
| `503` | Service Unavailable | Retry with exponential backoff |
| `504` | Gateway Timeout | Increase timeout values |

### Application Error Codes

| Code | Description | Solution |
|------|-------------|----------|
| `NETWORK_ERROR` | Network connectivity issues | Check internet connection |
| `TIMEOUT_ERROR` | Request timeout exceeded | Increase timeout or reduce load |
| `RATE_LIMITED` | Rate limit exceeded | Reduce request frequency |
| `INVALID_URL` | Malformed URL | Check URL format |
| `ROBOTS_BLOCKED` | Blocked by robots.txt | Review robots.txt rules |
| `CONTENT_EXTRACTION_FAILED` | Content extraction error | Try different extraction options |
| `SEARCH_FAILED` | Search provider error | Check API configuration |
| `CRAWL_FAILED` | Crawling operation failed | Reduce scope or check permissions |
| `VALIDATION_ERROR` | Parameter validation failed | Check parameter format and values |

### Search Provider Error Codes

#### Google Custom Search API

| Error | Description | Solution |
|-------|-------------|----------|
| `keyInvalid` | Invalid API key | Check Google Cloud Console |
| `quotaExceeded` | API quota exceeded | Check billing and upgrade plan |
| `invalid` | Invalid search query | Simplify search terms |
| `accessNotConfigured` | API not enabled | Enable Custom Search API |

#### DuckDuckGo Errors

| Error | Description | Solution |
|-------|-------------|----------|
| `rate_limited` | Too many requests | Reduce request frequency |
| `blocked` | IP temporarily blocked | Wait and retry |
| `invalid_query` | Query format error | Simplify search terms |

---

## Debug Mode and Logging

### Enable Debug Mode

1. **Full debug mode:**
   ```bash
   DEBUG=* node server.js
   ```

2. **MCP-specific debugging:**
   ```bash
   DEBUG=mcp:* node server.js
   ```

3. **Component-specific debugging:**
   ```bash
   DEBUG=webscraper:search,webscraper:crawl node server.js
   ```

### Configure Logging

1. **Set log level:**
   ```json
   {
     "env": {
       "LOG_LEVEL": "debug",
       "LOG_FORMAT": "json",
       "LOG_FILE": "/tmp/webscraper.log"
     }
   }
   ```

2. **Enable request logging:**
   ```json
   {
     "env": {
       "LOG_REQUESTS": "true",
       "LOG_RESPONSES": "true",
       "LOG_ERRORS": "true"
     }
   }
   ```

### Log Analysis

1. **View recent errors:**
   ```bash
   tail -f /tmp/webscraper.log | grep ERROR
   ```

2. **Analyze performance:**
   ```bash
   grep "processing_time" /tmp/webscraper.log | awk '{print $NF}' | sort -n
   ```

3. **Monitor specific tools:**
   ```bash
   grep "search_web" /tmp/webscraper.log | tail -20
   ```

### Performance Monitoring

1. **Add performance metrics:**
   ```javascript
   // Add to server.js for monitoring
   const startTime = process.hrtime();
   
   setInterval(() => {
     const uptime = process.uptime();
     const memory = process.memoryUsage();
     console.log('Server metrics:', {
       uptime: Math.floor(uptime),
       memory: Math.round(memory.rss / 1024 / 1024) + 'MB',
       heap: Math.round(memory.heapUsed / 1024 / 1024) + 'MB'
     });
   }, 60000);
   ```

2. **Monitor event loop lag:**
   ```bash
   npm install @nodejs/clinic
   clinic doctor -- node server.js
   ```

---

## Getting Help

### Before Asking for Help

1. **Check this troubleshooting guide**
2. **Review the logs** for specific error messages
3. **Test with minimal configuration**
4. **Verify your environment** meets requirements

### Information to Include

When reporting issues, include:

1. **Environment details:**
   ```bash
   node --version
   npm --version
   uname -a  # or systeminfo on Windows
   ```

2. **Configuration:**
   ```bash
   # Sanitized MCP configuration (remove API keys)
   cat .mcp.json | sed 's/"GOOGLE_API_KEY".*/"GOOGLE_API_KEY": "REDACTED"/'
   ```

3. **Error logs:**
   ```bash
   # Last 50 lines of logs
   tail -50 /tmp/webscraper.log
   ```

4. **Steps to reproduce:**
   - Exact commands used
   - Expected vs actual behavior
   - Frequency of the issue

### Community Resources

1. **GitHub Issues:**
   - Search existing issues first
   - Use issue templates
   - Provide complete information

2. **Stack Overflow:**
   - Tag with `mcp-webscraper` and `model-context-protocol`
   - Include minimal reproducible example

3. **Discord/Forums:**
   - Join the MCP community Discord
   - Search previous discussions

### Professional Support

For production deployments or complex issues:

1. **Check documentation** thoroughly
2. **Consider professional consulting** for custom implementations
3. **Review enterprise support options** if available

### Contributing Back

Help others by:

1. **Documenting solutions** you find
2. **Submitting bug fixes** via pull requests
3. **Improving documentation** with your learnings
4. **Sharing configurations** that work well

---

## Prevention Tips

### Regular Maintenance

1. **Keep dependencies updated:**
   ```bash
   npm audit
   npm update
   ```

2. **Monitor log files:**
   ```bash
   # Setup log rotation
   sudo logrotate -f /etc/logrotate.d/webscraper
   ```

3. **Health checks:**
   ```bash
   # Create a health check script
   curl -s http://localhost:3000/health || echo "Server down"
   ```

### Best Practices

1. **Use absolute paths** in configurations
2. **Set appropriate timeouts** for your use case
3. **Monitor resource usage** regularly
4. **Test configuration changes** in development first
5. **Keep backups** of working configurations
6. **Document custom configurations** for your team

### Security Considerations

1. **Protect API keys** and sensitive data
2. **Use HTTPS** when possible
3. **Implement proper rate limiting**
4. **Monitor for unusual activity**
5. **Keep server software updated**
6. **Use firewalls** and network security

By following this troubleshooting guide, you should be able to resolve most issues with the MCP WebScraper server. Remember that many problems can be prevented with proper configuration and regular maintenance.