#!/bin/bash
# Test a single MCP tool with sample input
# Usage: ./test-tool.sh <tool-name> [json-params]
# Example: ./test-tool.sh fetch_url '{"url": "https://example.com"}'

set -e

TOOL_NAME=${1:-""}
PARAMS=${2:-"{}"}
PROJECT_ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)

cd "$PROJECT_ROOT"

echo "=== CrawlForge MCP Tool Tester ==="
echo "Project root: $PROJECT_ROOT"
echo ""

if [ -z "$TOOL_NAME" ]; then
  echo "Usage: ./test-tool.sh <tool-name> [json-params]"
  echo ""
  echo "Available tools (19 total):"
  echo ""
  echo "  Basic Tools:"
  echo "    fetch_url          - Fetch content from URL"
  echo "    extract_text       - Extract clean text from webpage"
  echo "    extract_links      - Extract all links from webpage"
  echo "    extract_metadata   - Extract metadata from webpage"
  echo "    scrape_structured  - Extract data using CSS selectors"
  echo ""
  echo "  Search & Crawl:"
  echo "    search_web         - Search the web (requires API key)"
  echo "    crawl_deep         - Deep crawl websites"
  echo "    map_site           - Map website structure"
  echo ""
  echo "  Content Processing:"
  echo "    extract_content    - Extract main content"
  echo "    process_document   - Process documents (PDF, web)"
  echo "    summarize_content  - Generate summaries"
  echo "    analyze_content    - Analyze content"
  echo ""
  echo "  Advanced (Wave 2):"
  echo "    batch_scrape       - Process multiple URLs"
  echo "    scrape_with_actions - Browser automation"
  echo ""
  echo "  Research & Tracking (Wave 3):"
  echo "    deep_research      - Multi-stage research"
  echo "    track_changes      - Content change tracking"
  echo "    generate_llms_txt  - Generate LLMs.txt"
  echo "    stealth_mode       - Anti-detection scraping"
  echo "    localization       - Multi-language support"
  echo ""
  echo "Example:"
  echo "  ./test-tool.sh fetch_url '{\"url\": \"https://example.com\"}'"
  exit 1
fi

echo "Tool: $TOOL_NAME"
echo "Params: $PARAMS"
echo ""

# Create a temporary test script
TEST_SCRIPT=$(mktemp)
cat > "$TEST_SCRIPT" << 'SCRIPT_EOF'
const { spawn } = require('child_process');

const toolName = process.argv[2];
const params = JSON.parse(process.argv[3] || '{}');

// Start the MCP server
const server = spawn('node', ['server.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, NODE_ENV: 'test' }
});

let output = '';

server.stdout.on('data', (data) => {
  output += data.toString();
});

server.stderr.on('data', (data) => {
  console.error('Server log:', data.toString());
});

// Send MCP initialize request
const initRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-tool-script', version: '1.0.0' }
  }
};

server.stdin.write(JSON.stringify(initRequest) + '\n');

// Wait a moment then send tool call
setTimeout(() => {
  const toolRequest = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: params
    }
  };
  server.stdin.write(JSON.stringify(toolRequest) + '\n');

  // Wait for response
  setTimeout(() => {
    console.log('\n=== Response ===');
    const lines = output.split('\n').filter(l => l.trim());
    const lastResponse = lines[lines.length - 1];
    try {
      const parsed = JSON.parse(lastResponse);
      console.log(JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log(output);
    }
    server.kill();
    process.exit(0);
  }, 5000);
}, 1000);
SCRIPT_EOF

echo "Starting MCP server and testing tool..."
echo ""

# Run the test
node "$TEST_SCRIPT" "$TOOL_NAME" "$PARAMS"

# Cleanup
rm -f "$TEST_SCRIPT"
