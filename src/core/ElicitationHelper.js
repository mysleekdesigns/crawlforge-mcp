/**
 * ElicitationHelper — MCP Elicitation for CrawlForge
 *
 * Allows tools to request user confirmation or input mid-execution for
 * expensive or ambiguous operations. Falls back gracefully when the
 * MCP client does not support elicitation.
 *
 * The request goes out as a 2025-era server→client `elicitation/create`,
 * awaited inline in the middle of a tool's work. Two things the SDK does NOT
 * do for us, and which `supported` therefore decides before we send:
 *
 *   - `Server.elicitInput()` refuses a client that declared a bare
 *     `elicitation: {}` (it demands `elicitation.form`), even though the SDK's
 *     own capability rule counts a bare declaration as form-capable — that is
 *     the pre-mode 2025 meaning, and it is what the SDK's legacy shim and its
 *     2026 seam both apply. We send through `Server.request()`, which applies
 *     that same lenient rule, so those clients get their prompt.
 *
 *   - Both `elicitInput()` and `request()` throw on a 2026-07-28-era
 *     connection: that revision has no server→client request channel at all.
 *     There is no inline substitute — the replacement is an `input_required`
 *     result RETURNED by a tools/call handler, which this helper cannot do
 *     from the middle of a tool's execution. So `supported` reports false and
 *     the operation proceeds unasked, exactly as it does for a client with no
 *     elicitation capability. A confirmation prompt is a nicety; failing the
 *     call is not an acceptable substitute. See docs/mcp-spec-adoption.md.
 *
 * Which server instance we ask matters as much as what we ask. server.js
 * constructs this against the top-level template McpServer, but neither HTTP
 * leg serves from it — the 2025-era path connects a clone per session and the
 * modern leg builds one per request, so the template is never `.connect()`ed
 * and reports no negotiated version and no client capabilities. The transport
 * stamps the serving clone on the request context; this resolves it from there
 * and falls back to the injected instance, which on stdio IS the connected one.
 */

import { servingRequestId, servingServer } from '../server/requestContext.js';

/**
 * First revision of the modern protocol era. Revisions are ISO dates, so
 * lexicographic comparison orders them chronologically (the SDK's own rule).
 */
const FIRST_MODERN_PROTOCOL_VERSION = '2026-07-28';

/** The one-boolean schema a confirmation asks with. */
const CONFIRM_SCHEMA = {
  type: 'object',
  properties: {
    confirmed: {
      type: 'boolean',
      title: 'Proceed?',
      description: 'Confirm to proceed with the operation',
    },
  },
  required: ['confirmed'],
};

/**
 * Whether the client's declared capabilities cover FORM elicitation, by the
 * SDK's own rule: `elicitation.form` counts, and so does a bare `elicitation`
 * declaration naming neither mode (the pre-mode 2025 meaning). A client that
 * declared only `elicitation.url` has not declared form support.
 */
function formElicitationDeclared(caps) {
  const elicitation = caps?.elicitation;
  if (!elicitation) return false;
  if (elicitation.form !== undefined) return true;
  return elicitation.url === undefined;
}

export class ElicitationHelper {
  /**
   * @param {object} options
   * @param {object|null} options.mcpServer - McpServer instance
   * @param {object|null} options.logger
   */
  constructor({ mcpServer, logger } = {}) {
    this._mcpServer = mcpServer || null;
    this._logger = logger || { warn: () => {}, info: () => {} };
  }

  /**
   * The McpServer this request is served from: the clone the transport stamped
   * on the request context, else the constructor-injected instance (stdio, and
   * any caller outside a request context).
   * @private
   */
  get _server() {
    return servingServer() ?? this._mcpServer;
  }

  /**
   * Whether an inline elicitation round trip will actually reach the user.
   * @returns {boolean}
   */
  get supported() {
    const server = this._server?.server;
    if (typeof server?.request !== 'function') return false;
    try {
      // No server→client request channel exists on the 2026-07-28 era.
      const negotiated = server.getNegotiatedProtocolVersion?.();
      if (typeof negotiated === 'string' && negotiated >= FIRST_MODERN_PROTOCOL_VERSION) return false;
      return formElicitationDeclared(server.getClientCapabilities?.());
    } catch {
      return false;
    }
  }

  /**
   * Send one form-mode `elicitation/create` and return the ElicitResult.
   * This is byte-for-byte the message `Server.elicitInput()` sends; it just
   * does not impose that method's stricter `elicitation.form` gate.
   * @private
   */
  async _elicit(message, requestedSchema) {
    // relatedRequestId ties the prompt to the tools/call in flight. Without it
    // the 2025-era HTTP transport puts the request on the standalone GET SSE
    // stream and drops it outright when the client never opened one — a silent
    // 60-second timeout instead of a prompt. The stdio transport takes only the
    // message and drops the options, so stdio is unchanged either way; null (a
    // caller outside any tool invocation) sends no options at all, which is the
    // single-argument call this made before.
    const relatedRequestId = servingRequestId();
    return this._server.server.request(
      {
        method: 'elicitation/create',
        params: { message, requestedSchema, mode: 'form' },
      },
      relatedRequestId === null ? undefined : { relatedRequestId }
    );
  }

  /**
   * Ask for user confirmation before proceeding with an expensive operation.
   * Returns true if confirmed (or if elicitation is unsupported — fail-open
   * so tools continue working in non-elicitation clients).
   *
   * @param {string} message - Human-readable explanation of what requires confirmation
   * @param {object} [details] - Additional context (projected cost, URL count, etc.)
   * @returns {Promise<boolean>} - true = proceed, false = cancel
   */
  async confirm(message, details = {}) {
    if (!this.supported) {
      this._logger.warn('Elicitation not supported by client — proceeding without confirmation', { message });
      return true;
    }

    try {
      const detailLines = Object.entries(details)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n');
      const fullMessage = detailLines ? `${message}\n\n${detailLines}` : message;

      const result = await this._elicit(fullMessage, CONFIRM_SCHEMA);

      // Only an explicit accept + confirmed=true proceeds; decline/cancel = stop.
      return result?.action === 'accept' && result?.content?.confirmed === true;
    } catch (err) {
      this._logger.warn('Elicitation request failed — proceeding without confirmation', { error: err.message });
      return true; // fail-open
    }
  }

  /**
   * Ask the user to provide a string value (e.g. missing schema field).
   *
   * @param {string} message
   * @param {object} [options]
   * @param {string} [options.fieldName]
   * @param {string} [options.fieldDescription]
   * @param {string} [options.defaultValue]
   * @returns {Promise<string|null>} - The user-provided value or null if cancelled/unsupported
   */
  async requestString(message, { fieldName = 'value', fieldDescription = '', defaultValue } = {}) {
    if (!this.supported) {
      this._logger.warn('Elicitation not supported — using default value', { fieldName, defaultValue });
      return defaultValue || null;
    }

    try {
      const result = await this._elicit(message, {
        type: 'object',
        properties: {
          [fieldName]: {
            type: 'string',
            title: fieldName,
            description: fieldDescription,
            ...(defaultValue ? { default: defaultValue } : {}),
          },
        },
        required: [fieldName],
      });

      // The answer is client-supplied and no longer schema-checked by the SDK
      // on this path, so hold it to the type we asked for.
      if (result?.action === 'accept' && typeof result?.content?.[fieldName] === 'string') {
        return result.content[fieldName];
      }
      return defaultValue || null;
    } catch (err) {
      this._logger.warn('Elicitation request failed', { error: err.message });
      return defaultValue || null;
    }
  }
}
