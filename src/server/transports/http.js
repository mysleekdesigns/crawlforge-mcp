/**
 * HTTP transport — back-compat shim.
 *
 * As of v3.2.0 ("Modernize") the canonical HTTP entry point is
 * `connectStreamableHttp` in ./streamableHttp.js. This module is retained
 * so older imports (`./http.js`) keep working; it forwards to the new
 * implementation in stateless ("legacy") mode by default.
 *
 * @deprecated Use connectStreamableHttp from ./streamableHttp.js
 */

import { connectStreamableHttp } from './streamableHttp.js';

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {import('../../core/AuthManager.js').default} authManager
 * @param {import('../../utils/Logger.js').logger} logger
 * @param {number} [port=3000]
 */
export async function connectHttp(server, authManager, logger, port = 3000) {
  return connectStreamableHttp(server, authManager, logger, { port, legacy: true });
}
