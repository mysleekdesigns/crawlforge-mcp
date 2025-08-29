# Publishing CrawlForge MCP Server to NPM

## Prerequisites

1. Create an npm account at https://www.npmjs.com/signup (if you don't have one)
2. Login to npm from your terminal:
   ```bash
   npm login
   ```

## Publishing Steps

### 1. First-time Publishing

```bash
# Make sure you're in the project directory
cd /Users/simonlacey/Documents/GitHub/mcp-server/webScraper-1.0

# Test the package locally first
npm pack --dry-run

# Publish to npm
npm publish --access public
```

### 2. Updating the Package

When you make changes and want to publish a new version:

```bash
# Update version (choose one):
npm version patch  # For bug fixes (3.0.0 -> 3.0.1)
npm version minor  # For new features (3.0.0 -> 3.1.0)
npm version major  # For breaking changes (3.0.0 -> 4.0.0)

# Publish the update
npm publish
```

## Installing Your Package

Once published, you can install it in any project:

```bash
# Install globally to use as MCP server
npm install -g crawlforge-mcp-server

# Or install in a project
npm install crawlforge-mcp-server

# Run setup after installation
npx crawlforge-setup
```

## Using Without API Keys

Since you're the creator, you can modify the server to work without API keys for personal use:

1. Create a local `.env` file with:
   ```
   BYPASS_API_KEY=true
   ```

2. Or set environment variable:
   ```bash
   export BYPASS_API_KEY=true
   ```

## MCP Configuration

Add to your MCP client configuration (e.g., Claude Desktop):

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

## Notes

- The package is published as `crawlforge-mcp-server`
- It's set to public access by default
- The main executable is `crawlforge` which runs the MCP server
- `crawlforge-setup` helps with initial configuration
- All 16+ tools are included and ready to use

## Troubleshooting

If you encounter issues:

1. Check npm login status:
   ```bash
   npm whoami
   ```

2. Verify package contents:
   ```bash
   npm pack --dry-run
   ```

3. Test local installation:
   ```bash
   npm link
   # Then in another project:
   npm link crawlforge-mcp-server
   ```