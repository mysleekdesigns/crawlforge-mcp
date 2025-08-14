# Getting Started with MCP WebScraper

🎯 **Goal**: Get you scraping websites in 10 minutes  
📚 **Difficulty**: Beginner-friendly  
⏱️ **Time**: 5-10 minutes

## What You'll Learn

1. ✅ What web scraping is and why it's useful
2. ✅ How to install MCP WebScraper
3. ✅ How to connect it to your AI assistant (Claude or Cursor)
4. ✅ Your first successful web scrape
5. ✅ Which tool to use for different tasks

---

## 🤔 What is Web Scraping?

**Web scraping** is extracting data from websites automatically. Instead of copying information manually, you tell the computer what to get.

**MCP WebScraper** gives your AI assistant 16 specialized tools to:
- 📄 Download web pages
- 🔍 Search Google or DuckDuckGo
- 📊 Extract specific data
- 🔄 Monitor websites for changes
- 🧠 Conduct deep research
- And much more!

---

## 📋 Before You Start

You need Node.js installed. Check with this command:

```bash
node --version
```

**Need to install Node.js?**
- Download from [nodejs.org](https://nodejs.org) (get the LTS version)
- After installing, restart your terminal

---

## 🚀 Installation (5 minutes)

### Step 1: Download and Setup

Copy and paste this entire block:

```bash
# Download the code
git clone https://github.com/your-username/mcp-webscraper.git

# Go into the folder
cd mcp-webscraper

# Install dependencies
npm install

# Create configuration file
cp .env.example .env

echo "✅ Installation complete!"
```

### Step 2: Test It Works

```bash
npm start
```

You should see:
```
MCP WebScraper server v3.0 running on stdio
Environment: development
Tools available: fetch_url, extract_text, extract_links...
```

Press `Ctrl+C` to stop.

---

## 🤖 Connect to Your AI Assistant

<details>
<summary><b>Using Claude Code? Click here</b></summary>

### For Claude Code

#### 1. Find Your Config File

**Mac/Linux:**
```bash
nano ~/.config/claude/mcp.json
```

**Windows:**
```powershell
notepad %APPDATA%\claude\mcp.json
```

#### 2. Add This Configuration

Replace `/YOUR/PATH/` with your actual path:

```json
{
  "mcpServers": {
    "webscraper": {
      "command": "node",
      "args": ["/YOUR/PATH/mcp-webscraper/server.js"]
    }
  }
}
```

**How to find your path:**
```bash
# In the mcp-webscraper folder, run:
pwd  # This shows your current path
```

#### 3. Restart Claude

1. Completely quit Claude Code (Cmd+Q or Alt+F4)
2. Start Claude Code again
3. Test by asking: "What MCP tools are available?"

</details>

<details>
<summary><b>Using Cursor IDE? Click here</b></summary>

### For Cursor IDE

#### 1. Open Settings
- **Mac**: `Cmd + ,`
- **Windows/Linux**: `Ctrl + ,`

#### 2. Search for "MCP"

#### 3. Add Configuration

```json
{
  "mcp.servers": {
    "webscraper": {
      "command": "node",
      "args": ["/YOUR/PATH/mcp-webscraper/server.js"]
    }
  }
}
```

#### 4. Reload
1. Open Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`)
2. Type: `MCP: Reload Servers`
3. Press Enter

</details>

---

## 🎯 Your First Web Scrape!

Try these commands with your AI assistant:

### 1. Get a Web Page
```
Get the content from https://example.com
```

### 2. Extract Clean Text
```
Extract just the text from https://en.wikipedia.org/wiki/Web_scraping
```

### 3. Find All Links
```
Find all the links on https://news.ycombinator.com
```

### 4. Search the Web
```
Search for "best programming languages 2024" and show me the top 5 results
```

### Success! 🎉
If you see actual website content in the responses, everything is working!

---

## 🔧 Which Tool Should I Use?

Here's a simple decision guide:

| I want to... | Use this tool |
|-------------|---------------|
| Get a webpage | `fetch_url` |
| Extract readable text | `extract_text` |
| Find all links | `extract_links` |
| Get page title/description | `extract_metadata` |
| Extract specific data (prices, names) | `scrape_structured` |
| Search Google/DuckDuckGo | `search_web` |
| Explore an entire website | `crawl_deep` |
| Map a website's structure | `map_site` |
| Process PDFs | `process_document` |
| Summarize content | `summarize_content` |
| Scrape multiple pages | `batch_scrape` |
| Fill forms/click buttons | `scrape_with_actions` |
| Research a topic deeply | `deep_research` |
| Monitor for changes | `track_changes` |

---

## 🔍 Optional: Better Search Results (5 minutes)

By default, MCP WebScraper uses DuckDuckGo (free, no setup). For better results, you can use Google Search.

### Setting Up Google Search

#### 1. Get a Google API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Go to "APIs & Services" → "Library"
4. Search for "Custom Search API" and enable it
5. Go to "APIs & Services" → "Credentials"
6. Click "Create Credentials" → "API Key"
7. Copy your API key

#### 2. Create Search Engine

1. Go to [Google Custom Search](https://cse.google.com/cse/create/new)
2. Choose "Search the entire web"
3. Name it "MCP WebScraper"
4. Click "Create"
5. Copy the Search Engine ID

#### 3. Add to Configuration

Edit your `.env` file:

```bash
GOOGLE_API_KEY=your_api_key_here
GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id_here
SEARCH_PROVIDER=google
```

#### 4. Test It

Restart the server and try:
```
Search Google for "artificial intelligence news"
```

**Note:** Google gives 100 free searches per day. After that, it's $5 per 1000 searches.

---

## 🚨 Troubleshooting

### "Tools not available"
1. Check the server is running: `npm start`
2. Verify your config path is correct
3. Restart your AI assistant completely

### "Permission denied"
```bash
# Mac/Linux:
chmod +x server.js

# Windows: Run as Administrator
```

### "Cannot find module"
```bash
# Reinstall dependencies:
npm install
```

### Still Having Issues?

Run this diagnostic:
```bash
# Check Node version (need 18+)
node --version

# Test the server
cd mcp-webscraper
npm start

# Should see "MCP WebScraper server v3.0 running"
```

---

## 📚 Next Steps

### Learn More Tools
👉 **[Tools Guide](./TOOLS_GUIDE.md)** - Learn all 16 tools, organized by difficulty

### See Examples
👉 **[Examples](./EXAMPLES.md)** - Copy-paste examples for common tasks

### Advanced Topics
- **[API Reference](./API_REFERENCE.md)** - Complete technical documentation
- **[Deployment](./DEPLOYMENT.md)** - Deploy to production
- **[Advanced Features](./ADVANCED.md)** - Performance tuning and customization

---

## 💡 Pro Tips for Beginners

1. **Start Simple**: Use `extract_text` before trying `deep_research`
2. **Small Tests**: Test on simple sites like example.com first
3. **Read Errors**: Error messages usually tell you exactly what's wrong
4. **Use Limits**: Start with small limits (10 pages) to avoid overwhelming results
5. **Be Patient**: Some sites load slowly; increase timeout if needed

---

## 🎓 Quick Tutorial: Your First Project

Let's extract news headlines:

1. **Ask your AI:**
   ```
   Extract all the headlines from https://news.ycombinator.com using the scrape_structured tool with the selector ".titleline"
   ```

2. **AI will use:**
   ```javascript
   {
     "tool": "scrape_structured",
     "url": "https://news.ycombinator.com",
     "selectors": {
       "headlines": ".titleline"
     }
   }
   ```

3. **You'll get:**
   - A list of current headlines
   - Ready to analyze or save

Congratulations! You just scraped your first website! 🎉

---

## 🆘 Getting Help

- **Common Issues:** [Troubleshooting Guide](./TROUBLESHOOTING.md)
- **Tool Details:** [Tools Guide](./TOOLS_GUIDE.md)
- **Ask Questions:** [GitHub Discussions](https://github.com/your-username/mcp-webscraper/discussions)
- **Report Bugs:** [GitHub Issues](https://github.com/your-username/mcp-webscraper/issues)

---

<div align="center">
<h3>🚀 You're Ready to Scrape the Web!</h3>
<p>Start with simple tools and work your way up. Happy scraping!</p>
</div>