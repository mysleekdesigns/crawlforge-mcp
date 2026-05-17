/**
 * registerTool — thin wrapper around McpServer.registerTool that:
 *   1. Accepts a plain descriptor object
 *   2. Wraps the handler with withAuth (credit tracking + audit logging)
 *
 * This removes the ~1200 LOC of repetitive registration boilerplate from
 * server.js — every `server.registerTool(name, { … }, withAuth(name, fn))`
 * call becomes a single call to `registerTool(server, withAuth, descriptor)`.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {Function} withAuth  — from makeWithAuth() in src/server/withAuth.js
 * @param {Object}  descriptor
 * @param {string}  descriptor.name         — tool name (MCP identifier)
 * @param {string}  descriptor.description  — human-readable description
 * @param {Object}  descriptor.inputSchema  — Zod shape (plain object, not z.object())
 * @param {Object}  [descriptor.annotations] — MCP annotations (readOnlyHint, etc.)
 * @param {Function} descriptor.handler     — async (params) => { content: [...] }
 */
export function registerTool(server, withAuth, { name, description, inputSchema, annotations = {}, handler }) {
  server.registerTool(
    name,
    { description, inputSchema, annotations },
    withAuth(name, handler)
  );
}
