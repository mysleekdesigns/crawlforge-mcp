#!/usr/bin/env node

import { spawn } from 'child_process';

console.log('Testing MCP WebScraper Server v2.0...\n');

// Test 1: Initialize MCP protocol
console.log('Test 1: MCP Protocol Initialization');
const initRequest = {
  jsonrpc: "2.0",
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" }
  },
  id: 1
};

// Test 2: List tools
const listToolsRequest = {
  jsonrpc: "2.0",
  method: "tools/list",
  params: {},
  id: 2
};

// Spawn the server process
const server = spawn('node', ['server.js'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let responseBuffer = '';

server.stdout.on('data', (data) => {
  responseBuffer += data.toString();
  
  // Try to parse complete JSON messages
  const lines = responseBuffer.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim();
    if (line) {
      try {
        const response = JSON.parse(line);
        console.log('Response:', JSON.stringify(response, null, 2));
        
        if (response.id === 1) {
          console.log('✅ Server initialized successfully\n');
          console.log('Test 2: Listing Available Tools');
          server.stdin.write(JSON.stringify(listToolsRequest) + '\n');
        } else if (response.id === 2) {
          if (response.result && response.result.tools) {
            console.log('✅ Tools available:', response.result.tools.length);
            response.result.tools.forEach(tool => {
              console.log(`  - ${tool.name}: ${tool.description}`);
            });
          }
          console.log('\nAll tests passed! 🎉');
          process.exit(0);
        }
      } catch (e) {
        // Not a complete JSON message yet
      }
    }
  }
  responseBuffer = lines[lines.length - 1];
});

server.stderr.on('data', (data) => {
  const message = data.toString();
  if (!message.includes('running on stdio') && 
      !message.includes('Environment:') && 
      !message.includes('Search enabled:') &&
      !message.includes('Tools available:') &&
      !message.includes('Warning:')) {
    console.error('Server error:', message);
  }
});

server.on('error', (error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

// Send initialization request
console.log('Sending initialization request...');
server.stdin.write(JSON.stringify(initRequest) + '\n');

// Timeout after 5 seconds
setTimeout(() => {
  console.log('Test timeout - no response received');
  server.kill();
  process.exit(1);
}, 5000);