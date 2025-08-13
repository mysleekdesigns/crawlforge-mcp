# Quick Start Guide - MCP WebScraper

🎯 **Purpose**: Get MCP WebScraper running with your AI assistant  
⏱️ **Time Needed**: 5 minutes  
📚 **Difficulty**: 🟢 Easy

## ✅ Prerequisites Check

Run this diagnostic script to check your system:
```bash
# Check everything at once
node --version && npm --version && echo "✅ Ready to install!" || echo "❌ Please install Node.js from https://nodejs.org"
```

**Expected output:**
- Node.js: v18.0.0 or higher ✅
- npm: v8.0.0 or higher ✅
- Message: "✅ Ready to install!"

## 🚀 Installation

### Fastest Setup (Copy & Paste)

```bash
# One command to set everything up
git clone https://github.com/your-username/mcp-webscraper.git && \
cd mcp-webscraper && \
npm install && \
cp .env.example .env && \
echo "🎉 Installation complete! Now configure your IDE (see below)"
```

### Verify Installation Works

```bash
# Test the server starts correctly
npm start

# You should see:
# "MCP WebScraper server v3.0.0 running"
# Press Ctrl+C to stop
```

## 🤖 Claude Code Setup

### Step 1: Find Your Config Location

<details>
<summary><b>🍎 macOS</b></summary>

```bash
# Open config file
nano ~/.config/claude/mcp.json

# Or create if it doesn't exist
mkdir -p ~/.config/claude
touch ~/.config/claude/mcp.json
```
</details>

<details>
<summary><b>🐧 Linux</b></summary>

```bash
# Open config file  
nano ~/.config/claude/mcp.json

# Or create if it doesn't exist
mkdir -p ~/.config/claude
touch ~/.config/claude/mcp.json
```
</details>

<details>
<summary><b>🪟 Windows</b></summary>

```powershell
# Open config file
notepad %APPDATA%\claude\mcp.json

# Or create if it doesn't exist
mkdir %APPDATA%\claude
echo {} > %APPDATA%\claude\mcp.json
```
</details>

### Step 2: Add Configuration

Copy this **exactly**, replacing only the path:

```json
{
  "mcpServers": {
    "webscraper": {
      "command": "node",
      "args": ["/YOUR/ACTUAL/PATH/mcp-webscraper/server.js"]
    }
  }
}
```

#### 🔍 Find Your Path:
```bash
# Run this in the mcp-webscraper directory:
pwd  # macOS/Linux
cd   # Windows (shows current directory)
```

Then append `/server.js` to that path.

### Step 3: Restart & Verify

1. **Quit Claude Code completely** (Cmd+Q / Alt+F4)
2. **Start Claude Code again**
3. **Check it worked**: Type "list available tools" in Claude

✅ **Success looks like**: Claude lists 12 web scraping tools

## 💻 Cursor IDE Setup

### Step 1: Open Settings

- **Mac**: Press `Cmd + ,`
- **Windows/Linux**: Press `Ctrl + ,`
- Search for "MCP" in the search bar

### Step 2: Add Configuration

In the MCP settings section, add:

```json
{
  "mcp.servers": {
    "webscraper": {
      "command": "node",
      "args": ["/YOUR/ACTUAL/PATH/mcp-webscraper/server.js"]
    }
  }
}
```

### Step 3: Activate

1. Open Command Palette:
   - **Mac**: `Cmd + Shift + P`
   - **Windows/Linux**: `Ctrl + Shift + P`
2. Type: `MCP: Reload Servers`
3. Press Enter

✅ **Success check**: Type `MCP: List Tools` in Command Palette - should show 12 tools

## 🎯 Your First Success

### Test These Commands

Ask your AI assistant these exact phrases to verify everything works:

1. **Simple Test**:
   > "Use the search_web tool to search for 'weather today'"

2. **Extract Content**:
   > "Extract the main text from https://example.com"

3. **Get Links**:
   > "Find all links on https://wikipedia.org"

### 🎉 Success Indicators

✅ **Working correctly if**:
- AI responds with actual search results
- You see website content in the response
- No error messages about "tool not found"

❌ **Not working if**:
- "I don't have access to web scraping tools"
- "Tool not found" errors
- No response or timeout

## 🔍 Optional: Better Search Results

**Default**: Uses DuckDuckGo (free, no setup needed)  
**Upgrade**: Use Google Search for better results

👉 [Google Search Setup Guide](./GOOGLE_SEARCH_SETUP.md) - Takes 5 minutes

## 🚨 Troubleshooting Checklist

### Problem: "Tools not showing"

Run this diagnostic:
```bash
# 1. Check server works
cd mcp-webscraper && npm start
# Should see "MCP WebScraper server v3.0.0 running"

# 2. Check your config path
pwd  # Copy this path and add /server.js

# 3. Verify JSON syntax
python -m json.tool ~/.config/claude/mcp.json
# Should output formatted JSON, no errors
```

### Problem: "Server won't start"

```bash
# Fix 1: Check Node version
node --version  # Need v18+

# Fix 2: Reinstall
rm -rf node_modules package-lock.json
npm install

# Fix 3: Check for port conflicts
lsof -i :3000  # Mac/Linux
netstat -ano | findstr :3000  # Windows
```

### Problem: "Permission denied"

```bash
# Mac/Linux fix:
chmod +x server.js
chmod -R 755 .

# Windows fix: Run as Administrator
```

### Still Stuck?

1. **Check logs**: Look for error messages when starting
2. **Path issues**: Ensure you're using ABSOLUTE paths (starting with / or C:\)
3. **JSON errors**: Use a JSON validator online
4. **Restart completely**: Quit and restart your IDE

## 📚 What's Next?

Now that you're set up, explore:

### Learn the Tools
- 🟢 **Start with**: [Basic Examples](#your-first-success) above
- 🟡 **Then try**: [API Reference](./API_REFERENCE.md) for all 12 tools
- 🔴 **Advanced**: [Architecture Guide](./ADVANCED.md) for customization

### Deploy & Scale
- 🐳 [Docker Guide](./docker.md) - Container deployment
- 🚀 [Production Setup](./DEPLOYMENT.md) - Deploy to cloud
- 📊 [Performance Tuning](./ADVANCED.md#performance) - Optimize speed

### Get Help
- 💬 [Troubleshooting Guide](./TROUBLESHOOTING.md) - Common fixes
- 🐛 [Report Issues](https://github.com/your-username/mcp-webscraper/issues)
- 💡 [Ask Questions](https://github.com/your-username/mcp-webscraper/discussions)

---

<div align="center">
<b>🎉 Congratulations! You're ready to scrape the web with AI!</b>
</div>