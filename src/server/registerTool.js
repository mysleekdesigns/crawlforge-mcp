/**
 * registerTool — thin wrapper around McpServer.registerTool that:
 *   1. Accepts a plain descriptor object
 *   2. Wraps the handler with withAuth (credit tracking + audit logging)
 *   3. Optionally declares `outputSchema` (MCP SDK ≥1.10 structured outputs, C3)
 *
 * Structured outputs:
 *   When `outputSchema` is provided, the handler's return value should include
 *   `structuredContent` alongside the legacy `content` array. The MCP SDK
 *   validates `structuredContent` against the schema; legacy clients keep
 *   reading the JSON-stringified `content` for backward compatibility.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {Function} withAuth  — from makeWithAuth() in src/server/withAuth.js
 * @param {Object}  descriptor
 * @param {string}  descriptor.name         — tool name (MCP identifier)
 * @param {string}  descriptor.description  — human-readable description
 * @param {Object}  descriptor.inputSchema  — Zod shape (plain object, not z.object())
 * @param {Object}  [descriptor.outputSchema] — Zod shape for structured output (optional)
 * @param {Object}  [descriptor.annotations] — MCP annotations (readOnlyHint, etc.)
 * @param {Function} descriptor.handler     — async (params) => { content, structuredContent? }
 */
export function registerTool(server, withAuth, { name, description, inputSchema, outputSchema, annotations = {}, handler }) {
  const registration = { description, inputSchema, annotations };
  if (outputSchema) registration.outputSchema = outputSchema;
  server.registerTool(name, registration, withAuth(name, handler));
}

/**
 * Helper for tool handlers that want to emit both legacy `content` and
 * MCP-2025-06-18 `structuredContent` from one shot.
 *
 * @param {object} structured  — JSON-serializable object matching outputSchema
 * @returns {{content: object[], structuredContent: object}}
 */
export function dualOutput(structured) {
  return {
    structuredContent: structured,
    content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }]
  };
}
