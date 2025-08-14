# Troubleshooting Guide

Quick fixes for common MCP WebScraper issues. Most problems can be solved in under 5 minutes.

## 🚨 Emergency Quick Fixes

| Problem | Quick Fix | Time |
|---------|-----------|------|
| Tools not showing | Check config path is absolute | 1 min |
| Server won't start | Run `npm install` | 2 min |
| Permission errors | Run `chmod +x server.js` | 30 sec |
| Tools don't work | Restart IDE completely | 1 min |
| Memory errors | Add `MAX_WORKERS=4` to .env | 30 sec |

## 🔍 Quick Health Check

**Run this diagnostic:**
```bash
# One-liner health check
node --version && npm --version && cd mcp-webscraper && timeout 3s npm start && echo "✅ Healthy" || echo "❌ Check errors below"
```

**Manual check:**
```bash
# 1. Check Node version (need v18+)
node --version

# 2. Test server starts
npm start

# 3. Verify tools load
echo "Tools should appear in your IDE now"
```

## 🏷️ Issues by Category

### 🔧 Setup Issues

#### "Tools don't show up in my IDE"
**Cause**: Configuration problems  
**Fix**: 
1. Ensure path is absolute: `/full/path/to/server.js`
2. Validate JSON syntax at [jsonlint.com](https://jsonlint.com)
3. Restart IDE completely (Quit → Reopen)

#### "Server won't start"
**Cause**: Missing dependencies or wrong Node version  
**Fix**:
```bash
# Check Node version (need 18+)
node --version

# Fresh install
rm -rf node_modules package-lock.json
npm install
```

#### "Permission denied"
**Cause**: File permissions  
**Fix**:
```bash
# Mac/Linux
chmod +x server.js

# Windows (run as Administrator)
Set-ExecutionPolicy RemoteSigned
```

### 🌐 Network Issues

#### "Request timeouts"
**Cause**: Slow network or large pages  
**Fix**: Increase timeout in .env
```env
REQUEST_TIMEOUT=120000  # 2 minutes
```

#### "Rate limit errors"
**Cause**: Too many requests  
**Fix**: Reduce request rate
```env
RATE_LIMIT_REQUESTS_PER_SECOND=5
DELAY_BETWEEN_REQUESTS=2000
```

#### "Can't reach website"
**Cause**: Network restrictions or proxy  
**Fix**: Check network settings
```bash
# Test connectivity
curl -I https://example.com

# Set proxy if needed
export HTTP_PROXY=http://proxy.company.com:8080
```

### 💾 Performance Issues

#### "Out of memory errors"
**Cause**: Large crawls or too many workers  
**Fix**: Reduce resource usage
```env
MAX_WORKERS=4
QUEUE_CONCURRENCY=5
MAX_PAGES_PER_CRAWL=50
```

#### "Slow response times"
**Cause**: Resource constraints  
**Fix**: Enable caching and optimization
```env
CACHE_TTL=7200000
ENABLE_CONNECTION_POOLING=true
```

### 🖥️ IDE-Specific Issues

#### Claude Code

**Configuration Location**:
```bash
# macOS/Linux
~/.config/claude/mcp.json

# Windows  
%APPDATA%\claude\mcp.json
```

**Correct Config Format**:
```json
{
  "mcpServers": {
    "webscraper": {
      "command": "node",
      "args": ["/absolute/path/to/server.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

**Common Fixes**:
1. Use absolute paths only
2. Restart Claude completely (Cmd+Q → Reopen)
3. Clear cache: `rm -rf ~/.config/claude/cache`
4. Validate JSON syntax

#### Cursor IDE

**Enable MCP Support**:
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

**Debug Steps**:
1. Check Cursor version (need 0.8+)
2. Open Output panel → Select "MCP"
3. Run "MCP: Reload Servers" command
4. Use full Node.js path if needed: `/usr/local/bin/node`

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

## 🔧 Tool-Specific Problems

### Search Tools

#### "No search results"
**Cause**: Using DuckDuckGo (default, slower)  
**Fix**: Switch to Google or wait longer
```env
# For Google (requires API key)
SEARCH_PROVIDER=google
GOOGLE_API_KEY=your_key
GOOGLE_SEARCH_ENGINE_ID=your_id

# Or be patient with DuckDuckGo
SEARCH_PROVIDER=duckduckgo
```

### Crawling Tools

#### "Crawl stops early"
**Cause**: Robots.txt restrictions or rate limits  
**Fix**: Adjust settings
```env
# For testing only
RESPECT_ROBOTS_TXT=false

# Reduce load
DELAY_BETWEEN_REQUESTS=2000
MAX_CONCURRENT_REQUESTS=3
```

### Content Processing

#### "PDF processing fails"
**Cause**: Missing dependencies  
**Fix**: Install PDF tools
```bash
npm install pdf-parse canvas

# On Linux, you might need:
sudo apt-get install libcairo2-dev libjpeg-dev libpango1.0-dev
```

#### "JavaScript pages empty"
**Cause**: Content loaded by JavaScript  
**Fix**: Use browser-based tools
```javascript
{
  "tool": "scrape_with_actions",
  "parameters": {
    "url": "https://spa-website.com",
    "actions": [
      {"type": "wait", "timeout": 3000}
    ]
  }
}
```

## 🐛 Debug Mode

### Enable Detailed Logging

```env
# .env file
LOG_LEVEL=debug
DEBUG=mcp:*
NODE_ENV=development
```

### View Real-time Logs

```bash
# Application logs
tail -f logs/app.log

# Error logs only
tail -f logs/error.log | grep ERROR

# Performance metrics
tail -f logs/performance.log
```

### Test Individual Components

```bash
# Test server startup
node server.js

# Test specific tool
node -e "console.log('Testing basic functionality...')"

# Check memory usage
node --inspect server.js
```

## 📋 Error Code Reference

| Error Code | What It Means | Quick Fix |
|------------|---------------|----------|
| `EACCES` | Permission denied | `chmod +x server.js` |
| `ENOENT` | File not found | Check paths are absolute |
| `ETIMEDOUT` | Request timeout | Increase `REQUEST_TIMEOUT` |
| `ECONNREFUSED` | Connection refused | Check server is running |
| `ENOMEM` | Out of memory | Reduce `MAX_WORKERS` |
| `EADDRINUSE` | Port in use | `lsof -ti:3000 \| xargs kill` |
| `MODULE_NOT_FOUND` | Missing dependency | `npm install` |
| `JSON_PARSE_ERROR` | Invalid JSON config | Validate at jsonlint.com |
| `SSRF_BLOCKED` | Security restriction | Check URL is public |
| `RATE_LIMITED` | Too many requests | Reduce request rate |

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

## 🆘 Still Need Help?

### Self-Help Checklist
- [ ] Tried the quick fixes above
- [ ] Checked error codes reference  
- [ ] Ran diagnostic script
- [ ] Searched existing GitHub issues
- [ ] Verified system requirements

### Getting Support

**For Quick Questions**: Check our FAQ or search GitHub Issues  
**For Bug Reports**: Use GitHub Issues with details below  
**For Feature Requests**: Use GitHub Discussions  
**For Security Issues**: Email privately (don't post publicly)

### Perfect Bug Report

```markdown
## Environment
- Node.js: v18.12.0 (run `node --version`)
- OS: macOS 13.0 / Windows 11 / Ubuntu 22.04
- IDE: Claude Code v1.2.3 / Cursor v0.9.0
- WebScraper: v3.0.0

## Problem  
Clear description of what's wrong

## Steps to Reproduce
1. Specific step
2. Another step  
3. Result that occurs

## Expected vs Actual
**Expected**: Tools should appear  
**Actual**: No tools visible

## Error Messages
```
[Paste exact error messages here]
```

## What I've Tried
- [x] Checked config path is absolute
- [x] Restarted IDE completely
- [ ] Cleared cache (didn't help)

## Config File
```json
[Paste your mcp.json config]
```
```

**Response Time**: Usually within 24 hours for bugs, longer for questions.

---

## ⚡ Pro Tips

- **Keep it simple**: Start with basic examples before complex workflows
- **Check logs first**: Most issues show clear error messages
- **Update regularly**: `npm update` fixes many problems
- **Use absolute paths**: Relative paths cause 80% of setup issues
- **Restart everything**: When in doubt, restart your IDE

**Remember**: Most issues are solved in under 5 minutes with the right approach!