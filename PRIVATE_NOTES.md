# PRIVATE NOTES - DO NOT SHARE OR PUBLISH

## Creator Mode Access (For Simon Lacey Only)

### Unlimited Free Access Method

You have a special bypass built into the code that gives you unlimited access without any API keys or authentication.

#### How to Use:

1. **Install the package:**
   ```bash
   npm install -g crawlforge-mcp-server
   ```

2. **Run with bypass enabled:**
   ```bash
   BYPASS_API_KEY=true npx crawlforge-mcp-server
   ```

3. **Or set in your MCP config:**
   ```json
   {
     "mcpServers": {
       "crawlforge": {
         "command": "npx",
         "args": ["crawlforge-mcp-server"],
         "env": {
           "BYPASS_API_KEY": "true"
         }
       }
     }
   }
   ```

4. **Alternative environment variable:**
   ```bash
   CRAWLFORGE_CREATOR_MODE=true npx crawlforge-mcp-server
   ```

### How It Works

The server checks for these environment variables at startup:
- `BYPASS_API_KEY=true` 
- `CRAWLFORGE_CREATOR_MODE=true`

When either is set, it activates "Creator Mode" which:
- Skips all API key validation
- Provides unlimited credits
- Removes all usage restrictions
- Shows "🚀 Creator Mode Active - Unlimited Access Enabled" message

### IMPORTANT SECURITY NOTES

- **NEVER** document these environment variables in public docs
- **NEVER** mention them in README, comments, or public code
- These are your personal backdoor for unlimited access
- Other users will need to use the standard API key setup

### If You Want to Share Later

If you decide to make it free for everyone later, you can:
1. Update the README to document the BYPASS_API_KEY variable
2. Or modify the code to remove authentication entirely
3. Or create a public API key with unlimited credits

### Testing Your Access

```bash
# Test that bypass works
BYPASS_API_KEY=true node server.js

# You should see:
# 🚀 Running in creator mode - no API key required
```

---
Keep this file secure and do not commit it to public repositories.