#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function install() {
  console.log('📦 Installing MCP WebScraper Server...\n');

  // Get the path to the server.js file
  const serverPath = join(__dirname, 'server.js');
  
  // Check if we're running via npx or locally
  const isNpx = process.env.npm_config_user_agent?.includes('npx');
  
  if (isNpx) {
    // When running via npx, the package is in a temporary location
    console.log('Running via npx...');
  }

  // Create the MCP configuration for npx usage
  const mcpConfig = {
    webscraper: {
      command: 'npx',
      args: ['mcp-webscraper@latest'],
      env: {
        SEARCH_PROVIDER: 'duckduckgo' // Default to DuckDuckGo (no API key required)
      }
    }
  };

  // Alternative configuration for local installation
  const localConfig = {
    webscraper: {
      command: 'node',
      args: [serverPath],
      env: {
        SEARCH_PROVIDER: 'duckduckgo'
      }
    }
  };

  // Output the configuration for claude mcp add
  console.log('To add this server to Claude:\n');
  console.log('Option 1: Using npx (recommended):');
  console.log('─────────────────────────────────');
  console.log(JSON.stringify(mcpConfig, null, 2));
  
  if (!isNpx) {
    console.log('\nOption 2: Using local installation:');
    console.log('────────────────────────────────────');
    console.log(JSON.stringify(localConfig, null, 2));
  }
  
  console.log('\n📝 Configuration Notes:');
  console.log('- Default search provider is DuckDuckGo (no API key required)');
  console.log('- For Google search, add your GOOGLE_API_KEY and GOOGLE_SEARCH_ENGINE_ID');
  console.log('- You can also set SEARCH_PROVIDER=google after adding API keys');
  
  console.log('\n✅ MCP WebScraper Ready!');
  console.log('\n🚀 Quick Start:');
  console.log('1. Copy the configuration above');
  console.log('2. Add it to your Claude MCP settings');  
  console.log('3. Restart Claude to load the server');
  console.log('\n💡 Or use with Claude CLI:');
  console.log('claude mcp add webscraper');
  
  // Create a sample .env.example if it doesn't exist
  const envExample = `# Search Provider Configuration
# Options: auto, google, duckduckgo
SEARCH_PROVIDER=duckduckgo

# Google Custom Search API (optional)
# Get your API key from: https://developers.google.com/custom-search/v1/overview
GOOGLE_API_KEY=
GOOGLE_SEARCH_ENGINE_ID=

# Performance Settings
MAX_WORKERS=10
QUEUE_CONCURRENCY=10
CACHE_TTL=3600000
RATE_LIMIT_REQUESTS_PER_SECOND=10

# Crawling Settings
MAX_CRAWL_DEPTH=5
MAX_PAGES_PER_CRAWL=100
RESPECT_ROBOTS_TXT=true

# Server Settings
NODE_ENV=production
LOG_LEVEL=info`;

  try {
    await fs.writeFile(join(__dirname, '.env.example'), envExample);
    console.log('\n📄 Created .env.example with configuration template');
  } catch (error) {
    // File might already exist or no write permissions
  }
}

// Run the installer
install().catch(console.error);