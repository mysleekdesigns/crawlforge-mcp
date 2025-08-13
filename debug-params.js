#!/usr/bin/env node

/**
 * Debug parameter handling in MCP WebScraper
 */

import { spawn } from 'child_process';

async function debugParameterHandling() {
    console.log('🔍 Debug: Testing MCP parameter handling...\n');
    
    return new Promise((resolve, reject) => {
        const server = spawn('node', ['server.js'], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdoutBuffer = '';
        let stderrBuffer = '';

        const timeout = setTimeout(() => {
            server.kill('SIGKILL');
            reject(new Error('Timeout'));
        }, 10000);

        server.stdout.on('data', (data) => {
            stdoutBuffer += data.toString();
            console.log('STDOUT:', data.toString());
        });

        server.stderr.on('data', (data) => {
            stderrBuffer += data.toString();
            console.log('STDERR:', data.toString());
        });

        server.on('exit', () => {
            clearTimeout(timeout);
            resolve({ stdout: stdoutBuffer, stderr: stderrBuffer });
        });

        // Send a simple tool request
        const request = {
            jsonrpc: "2.0",
            method: "tools/call",
            id: 1,
            params: {
                name: "fetch_url",
                arguments: {
                    url: "https://httpbin.org/get",
                    timeout: 5000
                }
            }
        };

        console.log('Sending request:', JSON.stringify(request, null, 2));
        server.stdin.write(JSON.stringify(request) + '\n');
        
        setTimeout(() => {
            server.stdin.end();
        }, 2000);
    });
}

debugParameterHandling().catch(console.error);