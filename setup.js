#!/usr/bin/env node

/**
 * CrawlForge MCP Server Setup Script
 * Interactive setup wizard for first-time users
 */

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import os from 'os';
import AuthManager from './src/core/AuthManager.js';

/**
 * Add CrawlForge to an MCP client configuration file
 * @param {string} configPath - Path to the config file
 * @param {string} clientName - Name of the client (for messages)
 * @param {string} apiKey - The CrawlForge API key to include in env
 * @returns {object} Result with success status and message
 */
function addToMcpConfig(configPath, clientName, apiKey) {
  // Check if config exists
  if (!fs.existsSync(configPath)) {
    return {
      success: false,
      message: `${clientName} config not found (${configPath}). You may need to configure manually.`,
      notInstalled: true
    };
  }

  try {
    // Read existing config
    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configContent);

    // Ensure mcpServers object exists
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    // Check if crawlforge is already configured with the correct API key
    const existingConfig = config.mcpServers.crawlforge;
    if (existingConfig && existingConfig.env?.CRAWLFORGE_API_KEY === apiKey) {
      return {
        success: true,
        message: `CrawlForge already configured in ${clientName}`,
        alreadyConfigured: true
      };
    }

    // Add or update crawlforge MCP server configuration with API key
    config.mcpServers.crawlforge = {
      type: "stdio",
      command: "crawlforge",
      args: [],
      env: {
        CRAWLFORGE_API_KEY: apiKey
      }
    };

    // Write updated config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    return {
      success: true,
      message: existingConfig
        ? `CrawlForge API key updated in ${clientName} MCP config`
        : `CrawlForge added to ${clientName} MCP config`
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to update ${clientName} config: ${error.message}`
    };
  }
}

/**
 * Configure all detected MCP clients
 * @param {string} apiKey - The CrawlForge API key to include in env
 * @returns {object} Results for each client
 */
function configureMcpClients(apiKey) {
  const results = {
    claudeCode: null,
    cursor: null
  };

  // Claude Code config path
  const claudeConfigPath = path.join(os.homedir(), '.claude.json');
  results.claudeCode = addToMcpConfig(claudeConfigPath, 'Claude Code', apiKey);

  // Cursor config path (macOS)
  const cursorConfigPath = path.join(os.homedir(), '.cursor', 'mcp.json');
  if (fs.existsSync(path.join(os.homedir(), '.cursor'))) {
    // Cursor directory exists, try to configure
    if (!fs.existsSync(cursorConfigPath)) {
      // Create mcp.json if it doesn't exist
      try {
        fs.writeFileSync(cursorConfigPath, JSON.stringify({ mcpServers: {} }, null, 2));
      } catch (e) {
        // Ignore creation errors
      }
    }
    results.cursor = addToMcpConfig(cursorConfigPath, 'Cursor', apiKey);
  }

  return results;
}

let rl = null;

function getReadline() {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }
  return rl;
}

const question = (query) => new Promise((resolve) => getReadline().question(query, resolve));

function closeReadline() {
  if (rl) {
    rl.close();
    rl = null;
  }
}

async function main() {
  // Check if running interactively
  const isInteractive = process.stdin.isTTY;

  if (!isInteractive) {
    console.log('');
    console.log('❌ Setup requires an interactive terminal.');
    console.log('');
    console.log('Please run this command directly in your terminal:');
    console.log('  npx crawlforge-setup');
    console.log('');
    process.exit(1);
  }

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║           CrawlForge MCP Server Setup Wizard          ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Welcome to CrawlForge! This wizard will help you set up');
  console.log('your MCP server for the first time.');
  console.log('');
  console.log('You\'ll need:');
  console.log('  • Your CrawlForge API key');
  console.log('  • An internet connection');
  console.log('');
  console.log('Don\'t have an API key yet?');
  console.log('Get one free at: https://www.crawlforge.dev/signup');
  console.log('(Includes 1,000 free credits to get started!)');
  console.log('');
  console.log('────────────────────────────────────────────────────────');
  console.log('');

  // Check if already configured
  await AuthManager.initialize();
  if (AuthManager.isAuthenticated()) {
    const config = AuthManager.getConfig();
    console.log(`✅ Already configured for: ${config.email}`);
    console.log('');
    const overwrite = await question('Do you want to reconfigure? (y/N): ');
    
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Setup cancelled.');
      closeReadline();
      process.exit(0);
    }
    console.log('');
  }

  // Get API key
  const apiKey = await question('Enter your CrawlForge API key: ');
  
  if (!apiKey || !apiKey.trim()) {
    console.log('');
    console.log('❌ API key is required');
    console.log('Get your free API key at: https://www.crawlforge.dev/signup');
    closeReadline();
    process.exit(1);
  }

  console.log('');
  console.log('🔄 Validating API key...');
  
  // Run setup
  const success = await AuthManager.runSetup(apiKey.trim());
  
  if (success) {
    console.log('');
    console.log('────────────────────────────────────────────────────────');
    console.log('');
    console.log('🎉 Setup complete! You can now use CrawlForge MCP Server.');
    console.log('');

    // Auto-configure MCP clients (Claude Code, Cursor) with API key
    console.log('🔧 Configuring MCP client integrations...');
    const clientResults = configureMcpClients(apiKey.trim());
    let anyConfigured = false;
    let needsRestart = false;

    // Report Claude Code status
    if (clientResults.claudeCode) {
      if (clientResults.claudeCode.success) {
        anyConfigured = true;
        if (clientResults.claudeCode.alreadyConfigured) {
          console.log('✅ Claude Code: Already configured');
        } else {
          console.log('✅ Claude Code: Added to MCP config (~/.claude.json)');
          needsRestart = true;
        }
      } else if (!clientResults.claudeCode.notInstalled) {
        console.log(`⚠️  Claude Code: ${clientResults.claudeCode.message}`);
      }
    }

    // Report Cursor status
    if (clientResults.cursor) {
      if (clientResults.cursor.success) {
        anyConfigured = true;
        if (clientResults.cursor.alreadyConfigured) {
          console.log('✅ Cursor: Already configured');
        } else {
          console.log('✅ Cursor: Added to MCP config (~/.cursor/mcp.json)');
          needsRestart = true;
        }
      } else if (!clientResults.cursor.notInstalled) {
        console.log(`⚠️  Cursor: ${clientResults.cursor.message}`);
      }
    }

    // Show restart warning if any client was configured
    if (needsRestart) {
      console.log('');
      console.log('⚠️  IMPORTANT: Restart your IDE to load the new MCP server');
    }

    // Show manual config instructions if no clients detected
    if (!anyConfigured && clientResults.claudeCode?.notInstalled && !clientResults.cursor) {
      console.log('ℹ️  No MCP clients detected. Manual configuration needed:');
      console.log('');
      console.log('   Add this to your MCP client config:');
      console.log('   {');
      console.log('     "mcpServers": {');
      console.log('       "crawlforge": {');
      console.log('         "type": "stdio",');
      console.log('         "command": "crawlforge",');
      console.log('         "env": {');
      console.log(`           "CRAWLFORGE_API_KEY": "${apiKey.trim()}"`);
      console.log('         }');
      console.log('       }');
      console.log('     }');
      console.log('   }');
    }

    console.log('');
    console.log('────────────────────────────────────────────────────────');
    console.log('');
    console.log('Quick start:');
    console.log('  crawlforge             # Start the MCP server');
    console.log('  npm run test           # Test your setup');
    console.log('');
    console.log('Need help? Visit: https://www.crawlforge.dev/docs');
    console.log('');
  } else {
    console.log('');
    console.log('Setup failed. Please check your API key and try again.');
    console.log('');
    console.log('Need help?');
    console.log('  • Documentation: https://www.crawlforge.dev/docs');
    console.log('  • Support: support@crawlforge.dev');
    console.log('');
    closeReadline();
    process.exit(1);
  }

  closeReadline();
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('');
  console.error('❌ Setup error:', error.message);
  console.error('');
  closeReadline();
  process.exit(1);
});

// Run setup
main().catch((error) => {
  console.error('❌ Fatal error:', error);
  closeReadline();
  process.exit(1);
});