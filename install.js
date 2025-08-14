#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Platform-specific config paths
function getConfigPath() {
  const platform = os.platform();
  const homeDir = os.homedir();
  
  switch (platform) {
    case 'darwin': // macOS
      return path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    case 'win32': // Windows
      return path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
    case 'linux':
    default:
      return path.join(homeDir, '.config', 'claude', 'claude_desktop_config.json');
  }
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    googleApiKey: process.env.GOOGLE_API_KEY,
    googleSearchEngineId: process.env.GOOGLE_SEARCH_ENGINE_ID,
    interactive: true,
    help: false
  };
  
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--google-api-key=')) {
      options.googleApiKey = arg.split('=')[1];
      options.interactive = false;
    } else if (arg.startsWith('--google-search-engine-id=')) {
      options.googleSearchEngineId = arg.split('=')[1];
      options.interactive = false;
    } else if (arg === '--no-interactive') {
      options.interactive = false;
    }
  }
  
  return options;
}

// Show help message
function showHelp() {
  console.log(`
📦 MCP WebScraper Setup

Usage: npx mcp-webscraper-setup [options]

Options:
  --google-api-key=KEY           Set Google API key (can also use GOOGLE_API_KEY env var)
  --google-search-engine-id=ID   Set Google Search Engine ID (can also use GOOGLE_SEARCH_ENGINE_ID env var)
  --no-interactive               Don't prompt for missing values
  --help, -h                     Show this help message

Examples:
  # Interactive setup (recommended)
  npx mcp-webscraper-setup

  # Non-interactive with flags
  npx mcp-webscraper-setup --google-api-key=YOUR_KEY --google-search-engine-id=YOUR_ID

  # Non-interactive with environment variables
  GOOGLE_API_KEY=YOUR_KEY GOOGLE_SEARCH_ENGINE_ID=YOUR_ID npx mcp-webscraper-setup --no-interactive

Note: Google API credentials are optional. If not provided, DuckDuckGo will be used as the search provider.
`);
}

// Prompt for credentials
async function promptForCredentials(existingKey, existingId) {
  const rl = readline.createInterface({ input, output });
  
  console.log('\n🔐 Google Search API Configuration (optional)');
  console.log('   Press Enter to skip and use DuckDuckGo instead\n');
  
  try {
    const apiKey = existingKey || await rl.question(`Google API Key${existingKey ? ' [' + existingKey.substring(0, 10) + '...]' : ''}: `);
    const searchEngineId = existingId || await rl.question(`Search Engine ID${existingId ? ' [' + existingId.substring(0, 10) + '...]' : ''}: `);
    
    rl.close();
    
    return {
      googleApiKey: apiKey.trim(),
      googleSearchEngineId: searchEngineId.trim()
    };
  } catch (error) {
    rl.close();
    throw error;
  }
}

// Main installation function
async function install() {
  const options = parseArgs();
  
  if (options.help) {
    showHelp();
    process.exit(0);
  }
  
  console.log('🚀 MCP WebScraper Setup\n');
  
  // Get credentials
  let googleApiKey = options.googleApiKey;
  let googleSearchEngineId = options.googleSearchEngineId;
  
  if (options.interactive && (!googleApiKey || !googleSearchEngineId)) {
    const creds = await promptForCredentials(googleApiKey, googleSearchEngineId);
    googleApiKey = creds.googleApiKey || googleApiKey;
    googleSearchEngineId = creds.googleSearchEngineId || googleSearchEngineId;
  }
  
  // Determine search provider
  const hasGoogleCreds = googleApiKey && googleSearchEngineId;
  const searchProvider = hasGoogleCreds ? 'google' : 'duckduckgo';
  
  console.log(`\n📌 Using search provider: ${searchProvider}`);
  
  // Create MCP configuration
  const mcpServerConfig = {
    command: 'npx',
    args: ['-y', 'mcp-webscraper'],
    env: {
      SEARCH_PROVIDER: searchProvider
    }
  };
  
  // Add Google credentials if provided
  if (hasGoogleCreds) {
    mcpServerConfig.env.GOOGLE_API_KEY = googleApiKey;
    mcpServerConfig.env.GOOGLE_SEARCH_ENGINE_ID = googleSearchEngineId;
  }
  
  // Get config file path
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  
  // Ensure config directory exists
  try {
    await fs.mkdir(configDir, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
  
  // Read existing config or create new one
  let config = { mcpServers: {} };
  
  if (existsSync(configPath)) {
    try {
      const existingConfig = await fs.readFile(configPath, 'utf-8');
      config = JSON.parse(existingConfig);
      console.log('✅ Found existing Claude configuration');
    } catch (error) {
      console.error('⚠️  Error reading existing config, will create new one');
    }
  } else {
    console.log('📝 Creating new Claude configuration');
  }
  
  // Ensure mcpServers object exists
  if (!config.mcpServers) {
    config.mcpServers = {};
  }
  
  // Check if webscraper already exists
  if (config.mcpServers.webscraper) {
    console.log('⚠️  WebScraper MCP already configured, updating...');
  }
  
  // Add or update webscraper configuration
  config.mcpServers.webscraper = mcpServerConfig;
  
  // Write updated configuration
  try {
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    console.log(`✅ Configuration saved to: ${configPath}`);
  } catch (error) {
    console.error('❌ Failed to save configuration:', error.message);
    console.log('\n📋 Manual configuration:');
    console.log('Add this to your Claude MCP settings:\n');
    console.log(JSON.stringify({ webscraper: mcpServerConfig }, null, 2));
    process.exit(1);
  }
  
  // Success message
  console.log('\n✨ MCP WebScraper installed successfully!\n');
  console.log('📌 Next steps:');
  console.log('   1. Restart Claude to load the new configuration');
  console.log('   2. The WebScraper MCP will be available immediately');
  console.log('\n🛠️  Available tools:');
  console.log('   • fetch_url, extract_text, extract_links, extract_metadata');
  console.log('   • search_web, crawl_deep, map_site, batch_scrape');
  console.log('   • summarize_content, analyze_content, deep_research');
  console.log('   • And more!');
  
  if (!hasGoogleCreds) {
    console.log('\n💡 Tip: Using DuckDuckGo for search (no API key required)');
    console.log('   To use Google Search, run setup again with credentials');
  }
  
  // Create .env.example for reference
  const envExample = `# MCP WebScraper Configuration

# Search Provider Configuration
# Options: auto, google, duckduckgo
SEARCH_PROVIDER=${searchProvider}

# Google Custom Search API (optional)
# Get your API key from: https://developers.google.com/custom-search/v1/overview
GOOGLE_API_KEY=${googleApiKey || 'your-api-key-here'}
GOOGLE_SEARCH_ENGINE_ID=${googleSearchEngineId || 'your-search-engine-id-here'}

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
    const envPath = join(process.cwd(), '.env.example');
    await fs.writeFile(envPath, envExample);
    console.log(`\n📄 Created .env.example in current directory for reference`);
  } catch (error) {
    // Ignore errors creating .env.example
  }
}

// Run the installer
install().catch(error => {
  console.error('❌ Installation failed:', error.message);
  process.exit(1);
});