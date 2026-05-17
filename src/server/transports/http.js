/**
 * HTTP (StreamableHTTP) transport setup — extracted from server.js runServer().
 * Used when server is launched with the --http flag or MCP_HTTP=true.
 *
 * Responsibilities:
 *  - CORS headers for Smithery gateway
 *  - Health check endpoint (/health)
 *  - Server card discovery (/.well-known/mcp/server-card.json)
 *  - Per-request Bearer / X-API-Key auth on /mcp (bypassed in creator mode)
 *  - 404 for all other paths
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';

const SERVER_VERSION = '3.0.19';

/**
 * Connect the MCP server to an HTTP transport on the given port.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {import('../../core/AuthManager.js').default} authManager
 * @param {import('../../utils/Logger.js').logger} logger
 * @param {number} [port=3000]
 */
export async function connectHttp(server, authManager, logger, port = 3000) {
  // Stateless transport — no session tracking; each request is independent.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);

  const httpServer = createServer(async (req, res) => {
    // CORS headers for Smithery gateway
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '3.0' }));
      return;
    }

    // Smithery discovery
    if (req.url === '/.well-known/mcp/server-card.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        serverInfo: {
          name: 'crawlforge',
          version: SERVER_VERSION,
          description: 'Production-ready MCP server with 20 web scraping, crawling, and content processing tools. Features stealth browsing, deep research, structured extraction, and change tracking.',
          homepage: 'https://www.crawlforge.dev',
          icon: 'https://www.crawlforge.dev/icon.png'
        },
        transport: { type: 'streamable-http', url: '/mcp' },
        configSchema: {
          type: 'object',
          properties: {
            apiKey: {
              type: 'string',
              title: 'CrawlForge API Key',
              description: 'Your CrawlForge API key. Get one free at https://www.crawlforge.dev/signup (includes 1,000 credits)',
              'x-from': { header: 'x-api-key' }
            }
          },
          required: ['apiKey']
        }
      }));
      return;
    }

    // MCP endpoint
    if (req.url === '/mcp' || req.url === '/') {
      // Per-request auth (bypassed in creator mode)
      if (!authManager.isCreatorMode()) {
        const authHeader = req.headers['authorization'] || '';
        const apiKeyHeader = req.headers['x-api-key'] || '';
        let providedKey = '';

        if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
          providedKey = authHeader.slice(7).trim();
        } else if (typeof apiKeyHeader === 'string' && apiKeyHeader.length > 0) {
          providedKey = apiKeyHeader.trim();
        }

        const expectedKey = authManager.getConfig()?.apiKey;
        if (!providedKey || !expectedKey || providedKey !== expectedKey) {
          logger.warn('HTTP transport request rejected: missing or invalid bearer token', {
            hasAuthHeader: Boolean(authHeader),
            hasXApiKey: Boolean(apiKeyHeader),
            remoteAddress: req.socket?.remoteAddress
          });
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Unauthorized',
            message: 'CrawlForge HTTP transport requires Authorization: Bearer <api-key> (or X-API-Key) on every request.'
          }));
          return;
        }
      }

      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  httpServer.listen(port, () => {
    console.error(`CrawlForge MCP Server v3.0 running on HTTP port ${port}`);
    console.error(`MCP endpoint: http://localhost:${port}/mcp`);
    console.error(`Health check: http://localhost:${port}/health`);
  });
}
