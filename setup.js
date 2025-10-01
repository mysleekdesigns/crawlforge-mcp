#!/usr/bin/env node

/**
 * CrawlForge MCP Server Setup Script
 * Interactive setup wizard for first-time users
 */

import readline from 'readline';
import AuthManager from './src/core/AuthManager.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function main() {
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
      rl.close();
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
    rl.close();
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
    console.log('Quick start:');
    console.log('  npm start              # Start the MCP server');
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
    rl.close();
    process.exit(1);
  }

  rl.close();
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('');
  console.error('❌ Setup error:', error.message);
  console.error('');
  rl.close();
  process.exit(1);
});

// Run setup
main().catch((error) => {
  console.error('❌ Fatal error:', error);
  rl.close();
  process.exit(1);
});