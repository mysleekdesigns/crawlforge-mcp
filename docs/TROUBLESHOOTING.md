# Troubleshooting Guide

Solve common issues with the MCP WebScraper server, including Claude Code and Cursor IDE specific problems.

## Quick Diagnostics

Run this command to check your setup:
```bash
# Check Node version
node --version  # Should be v18+

# Check if server starts
cd /path/to/mcp-webscraper
npm start

# Test a tool
curl -X POST http://localhost:3000/tools/fetch_url \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

## Claude Code Issues

### Tools Not Showing

**Problem**: WebScraper tools don't appear in Claude Code

**Solutions**:

1. **Check Config Location**:
   ```bash
   # macOS/Linux
   cat ~/.config/claude/mcp.json
   
   # Windows
   type %APPDATA%\claude\mcp.json
   ```

2. **Verify Path is Absolute**:
   ```json
   {
     "mcpServers": {
       "webscraper": {
         "command": "node",
         "args": ["/absolute/path/to/server.js"]  // ✅ Absolute
         // NOT: ["./server.js"]  // ❌ Relative
       }
     }
   }
   ```

3. **Check JSON Syntax**:
   ```bash
   # Validate JSON
   python -m json.tool ~/.config/claude/mcp.json
   ```

4. **Restart Claude Code**:
   - Quit Claude Code completely (Cmd+Q / Alt+F4)
   - Start Claude Code again
   - Check MCP panel

### Connection Errors

**Problem**: "Failed to connect to MCP server"

**Solutions**:

1. **Test Server Directly**:
   ```bash
   cd /path/to/mcp-webscraper
   npm start
   # Should see: "MCP WebScraper server v3.0.0 running"
   ```

2. **Check Permissions**:
   ```bash
   # Make server executable
   chmod +x server.js
   
   # Fix npm permissions
   npm config set prefix ~/.npm-global
   export PATH=~/.npm-global/bin:$PATH
   ```

3. **Clear Claude Cache**:
   ```bash
   # macOS/Linux
   rm -rf ~/.config/claude/cache
   
   # Windows
   rmdir /s %APPDATA%\claude\cache
   ```

## Cursor IDE Issues

### MCP Not Available

**Problem**: MCP options don't appear in Cursor settings

**Solutions**:

1. **Update Cursor**:
   - Help → Check for Updates
   - Install latest version (MCP support added in v0.8+)

2. **Enable MCP Feature**:
   ```json
   // settings.json
   {
     "mcp.enabled": true,
     "mcp.servers": {
       "webscraper": {
         "command": "node",
         "args": ["/path/to/server.js"]
       }
     }
   }
   ```

3. **Reload Configuration**:
   - Open Command Palette (Cmd+Shift+P)
   - Run: "MCP: Reload Servers"

### Tools Not Working

**Problem**: Tools appear but fail when used

**Solutions**:

1. **Check Output Panel**:
   - View → Output
   - Select "MCP" from dropdown
   - Look for error messages

2. **Verify Node Path**:
   ```json
   {
     "mcp.servers": {
       "webscraper": {
         "command": "/usr/local/bin/node",  // Full path
         "args": ["/path/to/server.js"]
       }
     }
   }
   ```

3. **Test with Simple Tool**:
   ```
   // In Cursor, try:
   Use fetch_url to get https://httpbin.org/get
   ```

## Installation Issues

### npm install Fails

**Problem**: Dependencies won't install

**Solutions**:

1. **Clear npm Cache**:
   ```bash
   npm cache clean --force
   rm -rf node_modules package-lock.json
   npm install
   ```

2. **Use Different Registry**:
   ```bash
   npm install --registry https://registry.npmjs.org/
   ```

3. **Install with Legacy Peer Deps**:
   ```bash
   npm install --legacy-peer-deps
   ```

### Node Version Issues

**Problem**: "Node version 18+ required"

**Solutions**:

1. **Update Node.js**:
   ```bash
   # Using nvm
   nvm install 18
   nvm use 18
   
   # Direct download
   # Visit https://nodejs.org/
   ```

2. **Check Multiple Node Versions**:
   ```bash
   which -a node
   node --version
   /usr/local/bin/node --version
   ```

## Runtime Errors

### Memory Issues

**Problem**: "JavaScript heap out of memory"

**Solutions**:

1. **Increase Memory Limit**:
   ```bash
   NODE_OPTIONS="--max-old-space-size=2048" npm start
   ```

2. **Reduce Concurrency**:
   ```env
   MAX_WORKERS=4
   QUEUE_CONCURRENCY=5
   ```

3. **Enable Garbage Collection**:
   ```bash
   node --expose-gc server.js
   ```

### Timeout Errors

**Problem**: "Request timeout" errors

**Solutions**:

1. **Increase Timeouts**:
   ```env
   REQUEST_TIMEOUT=60000  # 60 seconds
   ```

2. **Check Network**:
   ```bash
   # Test connectivity
   curl -I https://example.com
   ping google.com
   ```

3. **Reduce Load**:
   ```env
   RATE_LIMIT_REQUESTS_PER_SECOND=5
   ```

## Tool-Specific Issues

### search_web Not Working

**Problem**: Search returns no results

**Solutions**:

1. **Check Search Provider**:
   ```env
   SEARCH_PROVIDER=duckduckgo  # Default, no API key needed
   ```

2. **For Google Search**:
   ```env
   SEARCH_PROVIDER=google
   GOOGLE_API_KEY=your_key
   GOOGLE_SEARCH_ENGINE_ID=your_id
   ```

3. **Test Search**:
   ```bash
   curl -X POST http://localhost:3000/tools/search_web \
     -H "Content-Type: application/json" \
     -d '{"query": "test search"}'
   ```

### crawl_deep Fails

**Problem**: Crawling stops or fails

**Solutions**:

1. **Respect robots.txt**:
   ```env
   RESPECT_ROBOTS_TXT=false  # For testing only
   ```

2. **Reduce Depth**:
   ```json
   {
     "max_depth": 2,  // Instead of 5
     "max_pages": 50  // Instead of 100
   }
   ```

3. **Check Site Availability**:
   ```bash
   curl -I https://target-site.com
   ```

### PDF Processing Errors

**Problem**: process_document fails on PDFs

**Solutions**:

1. **Install PDF Dependencies**:
   ```bash
   npm install pdf-parse canvas
   ```

2. **Check File Size**:
   ```env
   MAX_REQUEST_SIZE=104857600  # 100MB
   ```

## Performance Issues

### Slow Response Times

**Solutions**:

1. **Enable Caching**:
   ```env
   CACHE_TTL=7200000  # 2 hours
   CACHE_SIZE=10000
   ```

2. **Optimize Workers**:
   ```env
   MAX_WORKERS=8  # Match CPU cores
   ```

3. **Monitor Performance**:
   ```bash
   # Check resource usage
   top -p $(pgrep -f server.js)
   ```

### High CPU Usage

**Solutions**:

1. **Limit Concurrency**:
   ```env
   QUEUE_CONCURRENCY=5
   MAX_WORKERS=4
   ```

2. **Enable Rate Limiting**:
   ```env
   RATE_LIMIT_REQUESTS_PER_SECOND=10
   ```

## Network Issues

### Proxy Configuration

**Behind Corporate Proxy**:

```env
HTTP_PROXY=http://proxy.company.com:8080
HTTPS_PROXY=http://proxy.company.com:8080
NO_PROXY=localhost,127.0.0.1
```

### SSL Certificate Errors

**Solutions**:

1. **Disable SSL Verification** (dev only):
   ```env
   NODE_TLS_REJECT_UNAUTHORIZED=0
   ```

2. **Add CA Certificate**:
   ```env
   NODE_EXTRA_CA_CERTS=/path/to/ca-cert.pem
   ```

## Debug Mode

### Enable Detailed Logging

```env
# .env file
LOG_LEVEL=debug
DEBUG=mcp:*
```

### View Logs

```bash
# Application logs
tail -f logs/app.log

# Error logs
tail -f logs/error.log

# Performance logs
tail -f logs/performance.log
```

### Test Individual Tools

```javascript
// test-tool.js
import { SearchWebTool } from './src/tools/search/searchWeb.js';

const tool = new SearchWebTool();
const result = await tool.execute({
  query: "test search",
  limit: 5
});
console.log(result);
```

## Common Error Codes

| Code | Meaning | Solution |
|------|---------|----------|
| `EACCES` | Permission denied | Check file permissions |
| `ENOENT` | File not found | Verify paths are correct |
| `ETIMEDOUT` | Request timeout | Increase timeout values |
| `ECONNREFUSED` | Connection refused | Check if server is running |
| `ENOMEM` | Out of memory | Increase memory limit |
| `EADDRINUSE` | Port in use | Kill other process or change port |

## Getting Help

### Before Asking for Help

1. Run diagnostics script
2. Check logs for errors
3. Try solutions in this guide
4. Search existing issues

### Where to Get Help

- **GitHub Issues**: [Report bugs](https://github.com/your-username/mcp-webscraper/issues)
- **Documentation**: [Full docs](https://github.com/your-username/mcp-webscraper/docs)
- **MCP Discord**: [Community support](https://discord.gg/mcp)

### Reporting Issues

Include:
- Node.js version
- Operating system
- Error messages
- Steps to reproduce
- Config files (remove sensitive data)

Example:
```markdown
**Environment:**
- Node: v18.12.0
- OS: macOS 13.0
- IDE: Claude Code v1.2.3

**Error:**
"Failed to connect to MCP server"

**Steps:**
1. Installed with `npm install`
2. Added to mcp.json
3. Restarted Claude Code
4. Tools don't appear

**Config:**
[paste mcp.json without API keys]
```