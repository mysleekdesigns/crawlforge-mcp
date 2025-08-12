# MCP WebScraper Server

A Model Context Protocol (MCP) server that provides comprehensive web scraping capabilities for use with Claude Code, Cursor, and other MCP-compatible clients.

## Features

- **5 Powerful Web Scraping Tools**:
  - `fetch_url` - Fetch content from URLs with headers and timeout support
  - `extract_text` - Extract clean text content from webpages
  - `extract_links` - Extract and filter links from webpages
  - `extract_metadata` - Extract comprehensive metadata (title, description, Open Graph, etc.)
  - `scrape_structured` - Extract structured data using CSS selectors

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd webScraper-1.0

# Install dependencies
npm install

# Make executable (optional)
chmod +x server.js
```

## Usage

### Direct Execution
```bash
node server.js
# or
npm start
```

### Configuration for Claude Code

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "mcp-webscraper": {
      "command": "node",
      "args": ["/path/to/webScraper-1.0/server.js"]
    }
  }
}
```

### Configuration for Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mcp-webscraper": {
      "command": "node",
      "args": ["/path/to/webScraper-1.0/server.js"]
    }
  }
}
```

### After Publishing to NPM

Once published, you can use npx:

```json
{
  "mcpServers": {
    "mcp-webscraper": {
      "command": "npx",
      "args": ["-y", "mcp-webscraper"]
    }
  }
}
```

## Available Tools

### 1. fetch_url
Fetches content from a URL with optional headers and timeout.

**Parameters:**
- `url` (string, required): The URL to fetch
- `headers` (object, optional): HTTP headers to include
- `timeout` (number, optional): Request timeout in milliseconds (1000-30000, default: 10000)

**Returns:** Status, headers, body, content type, size, and final URL

### 2. extract_text
Extracts clean text content from HTML, removing scripts, styles, and non-content elements.

**Parameters:**
- `url` (string, required): The URL to extract text from
- `remove_scripts` (boolean, optional): Remove script tags (default: true)
- `remove_styles` (boolean, optional): Remove style tags (default: true)

**Returns:** Cleaned text, word count, character count

### 3. extract_links
Extracts all links from a webpage with filtering options.

**Parameters:**
- `url` (string, required): The URL to extract links from
- `filter_external` (boolean, optional): Keep only internal links (default: false)
- `base_url` (string, optional): Base URL for resolving relative links

**Returns:** Array of links with href, text, and external status

### 4. extract_metadata
Extracts comprehensive metadata from a webpage.

**Parameters:**
- `url` (string, required): The URL to extract metadata from

**Returns:** Title, description, keywords, Open Graph tags, Twitter Card tags, canonical URL, author, robots, viewport, charset

### 5. scrape_structured
Extracts structured data using CSS selectors.

**Parameters:**
- `url` (string, required): The URL to scrape
- `selectors` (object, required): Object mapping field names to CSS selectors

**Returns:** Structured data based on provided selectors

## Requirements

- Node.js 18.0.0 or higher
- npm or yarn

## Dependencies

- `@modelcontextprotocol/sdk` - MCP SDK for server implementation
- `cheerio` - HTML parsing and manipulation
- `zod` - Schema validation

## Testing

Test the server with MCP protocol:

```bash
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}' | node server.js
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.