# Troubleshooting Guide

🎯 **Purpose**: Fix common issues with MCP WebScraper  
⏱️ **Time Needed**: 2-10 minutes per issue  
📚 **Difficulty**: 🟢 Easy to 🟡 Intermediate

## 🔍 Quick Diagnostics

**Run this one-liner to check everything:**
```bash
node --version && npm --version && cd mcp-webscraper && npm start && echo "✅ All systems go!" || echo "❌ Check the error above"
```

### Manual Diagnostic Steps
```bash
# 1. Check Node version (need v18+)
node --version

# 2. Test server starts
cd /path/to/mcp-webscraper
npm start

# 3. Test a tool works
curl http://localhost:3000/health
```

## ❓ FAQ - Top 10 Issues

### 1. "I can't see the tools in Claude/Cursor"
👉 **Solution**: Check your config path is ABSOLUTE (starts with / or C:\)

### 2. "Server won't start"
👉 **Solution**: Run `npm install` in the mcp-webscraper folder

### 3. "Permission denied errors"
👉 **Solution**: Run `chmod +x server.js` (Mac/Linux)

### 4. "Tools appear but don't work"
👉 **Solution**: Restart your IDE completely (quit and reopen)

### 5. "Search returns no results"
👉 **Solution**: You're using DuckDuckGo by default - this is normal, just slower

### 6. "Out of memory errors"
👉 **Solution**: Add to .env: `MAX_WORKERS=4`

### 7. "Can't install dependencies"
👉 **Solution**: Delete node_modules and run `npm install` again

### 8. "Wrong Node version"
👉 **Solution**: Download Node.js 18+ from https://nodejs.org

### 9. "Port already in use"
👉 **Solution**: Another app is using port 3000 - stop it or change the port

### 10. "JSON syntax error in config"
👉 **Solution**: Validate your JSON at https://jsonlint.com

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

## 🗺️ Troubleshooting Flowchart

```
Problem with MCP WebScraper?
│
├─> Can't see tools in IDE?
│   ├─> Check path is absolute → Fixed? ✅
│   ├─> Check JSON syntax → Fixed? ✅
│   └─> Restart IDE completely → Fixed? ✅
│
├─> Server won't start?
│   ├─> Check Node version (18+) → Update if needed
│   ├─> Run npm install → Fixed? ✅
│   └─> Check port 3000 → Change if busy
│
├─> Tools error when used?
│   ├─> Check server is running → Start it
│   ├─> Check network connection → Fix connection
│   └─> Check error logs → Follow error message
│
└─> Performance issues?
    ├─> Reduce MAX_WORKERS → Fixed? ✅
    ├─> Enable caching → Fixed? ✅
    └─> Check memory usage → Increase limits
```

## 📝 Diagnostic Script

Save and run this script to diagnose issues:

```bash
#!/bin/bash
# diagnose.sh - MCP WebScraper Diagnostic Tool

echo "🔍 MCP WebScraper Diagnostic Tool"
echo "================================="

# Check Node.js
echo -n "Node.js: "
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "✅ $NODE_VERSION"
else
    echo "❌ Not installed"
fi

# Check npm
echo -n "npm: "
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo "✅ v$NPM_VERSION"
else
    echo "❌ Not installed"
fi

# Check installation
echo -n "Installation: "
if [ -f "server.js" ]; then
    echo "✅ Found"
else
    echo "❌ Not in mcp-webscraper directory"
fi

# Check dependencies
echo -n "Dependencies: "
if [ -d "node_modules" ]; then
    echo "✅ Installed"
else
    echo "❌ Run: npm install"
fi

# Test server
echo -n "Server: "
timeout 2 node server.js 2>/dev/null
if [ $? -eq 124 ]; then
    echo "✅ Starts correctly"
else
    echo "❌ Failed to start"
fi

echo "================================="
echo "Diagnostics complete!"
```

## Getting Help

### 🚑 Quick Help

1. **Read the FAQ** above first
2. **Run the diagnostic script**
3. **Check the flowchart**
4. **Search existing issues** on GitHub

### 📞 Contact Channels

- 💬 **[GitHub Issues](https://github.com/your-username/mcp-webscraper/issues)** - Bug reports
- 💡 **[GitHub Discussions](https://github.com/your-username/mcp-webscraper/discussions)** - Questions
- 📖 **[Documentation](./README.md)** - Full guides
- 🔒 **[Security Issues](mailto:security@example.com)** - Private disclosure

### 🐛 Reporting Bugs

**Good bug report template:**
```markdown
## Environment
- Node.js: v18.12.0
- OS: macOS 13.0
- IDE: Claude Code v1.2.3

## Problem
Tools don't appear in Claude Code

## Steps to Reproduce
1. Installed with `npm install`
2. Added config to mcp.json
3. Restarted Claude Code
4. No tools visible

## Error Messages
[Paste any error messages]

## What I've Tried
- Checked path is absolute ✅
- Validated JSON ✅
- Restarted IDE ✅
```

---

<div align="center">
<b>Still stuck? We're here to help! Open an issue on GitHub.</b>
</div>