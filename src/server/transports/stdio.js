/**
 * stdio transport setup — extracted from server.js runServer().
 * Used when server is launched without the --http flag.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/**
 * Connect the MCP server to stdio transport and log startup message.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export async function connectStdio(server) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('CrawlForge MCP Server v3.0 running on stdio');
}
