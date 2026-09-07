/**
 * ElicitationHelper — MCP Elicitation for CrawlForge
 *
 * Allows tools to request user confirmation before an expensive or ambiguous
 * operation. Falls back gracefully when the MCP client cannot be asked.
 *
 * Phase 4.4 moved confirmations from an inline server→client request to the
 * 2026-07-28 MULTI-ROUND-TRIP form: `confirm()` no longer sends anything and no
 * longer awaits. It returns a verdict, and when the user must be asked the
 * verdict carries an `input_required` result for the tool to RETURN. The SDK
 * then either hands it to a 2026-era client or, on a 2025-era connection, runs
 * its own legacy shim (real `elicitation/create` + handler re-entry). One shape
 * serves both eras, which is why nothing here branches on the protocol version
 * any more — the previous era guard reported "unsupported" on 2026-07-28 and
 * every prompt there was silently skipped.
 *
 * THE HANDLER IS RE-ENTERED. Everything a tool does above its gate runs a
 * second time when the answer arrives, so a gate belongs above every fetch and
 * every side effect. Billing is not a caller's problem: `withAuth` charges an
 * `input_required` return zero and reports no usage, so a round trip and a
 * declined confirmation are both free (G4).
 *
 * Two properties of the old helper are deliberately preserved:
 *
 *   - **Fail-open.** A client that never declared elicitation is not asked, and
 *     the operation proceeds. This is not politeness — the SDK answers an
 *     `input_required` return on such a connection with `isError: true`
 *     ("did not declare the required capability"), so dropping the capability
 *     gate would turn a nicety into a failed call. Verified against the SDK.
 *   - **We ask at most once.** `inputResponses` is absent on a first entry and
 *     present on a retry, so a retry whose answer did not survive the trip
 *     (a dropped key, an answer of another kind) proceeds rather than asking
 *     again until the shim's round limit fails the call.
 *
 * The one case that cannot be preserved: a client that DECLARES elicitation and
 * then throws answering it now yields an `isError` result from the SDK where the
 * old inline path proceeded. The failure happens inside the SDK after the
 * handler has returned, so nothing here can intercept it. It costs nothing — the
 * handler did no work, so `withAuth` bills zero.
 *
 * Which server instance we ask matters as much as what we ask. server.js
 * constructs this against the top-level template McpServer, but neither HTTP
 * leg serves from it — the 2025-era path connects a clone per session and the
 * modern leg builds one per request, so the template is never `.connect()`ed
 * and reports no client capabilities. The transport stamps the serving clone on
 * the request context; this resolves it from there and falls back to the
 * injected instance, which on stdio IS the connected one. On a 2026-era request
 * there is no connected instance to read at all — capabilities arrive per
 * request in the `_meta` envelope, which is why `ctx` is consulted first.
 */

import { inputRequired, inputResponse, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';
import { servingRequestId, servingServer } from '../server/requestContext.js';

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
   * The client's declared capabilities for the request in flight. A 2026-era
   * request carries them per-request in the `_meta` envelope and has no
   * connected server instance to read; a 2025-era one has them on the serving
   * instance and no envelope.
   * @private
   */
  _clientCapabilities(ctx) {
    const fromEnvelope = ctx?.mcpReq?.envelope?.[CLIENT_CAPABILITIES_META_KEY];
    if (fromEnvelope) return fromEnvelope;
    try {
      return this._server?.server?.getClientCapabilities?.();
    } catch {
      return undefined;
    }
  }

  /**
   * Whether asking will actually reach the user rather than fail the call.
   * @param {object} [ctx] the SDK per-request context the handler received
   * @returns {boolean}
   */
  supported(ctx) {
    return formElicitationDeclared(this._clientCapabilities(ctx));
  }

  /**
   * Ask for user confirmation before proceeding with an expensive operation.
   * SYNCHRONOUS — it performs no I/O. Do not `await` it.
   *
   * @param {object|undefined} ctx - the SDK per-request context the handler received
   * @param {string} key - stable identifier for this question, unique across tools
   * @param {string} message - human-readable explanation of what requires confirmation
   * @param {object} [details] - additional context (projected cost, URL count, etc.)
   * @returns {{status:'proceed'}|{status:'cancelled'}|{status:'ask', result: object}}
   *   `ask` carries an `input_required` result the caller must RETURN verbatim.
   */
  confirm(ctx, key, message, details = {}) {
    const responses = ctx?.mcpReq?.inputResponses;
    const answered = inputResponse(responses, key);

    if (answered.kind === 'elicit') {
      // Only an explicit accept + confirmed=true proceeds; decline/cancel = stop.
      return answered.action === 'accept' && answered.content?.confirmed === true
        ? { status: 'proceed' }
        : { status: 'cancelled' };
    }

    // A retry carries an `inputResponses` object even when this key's answer
    // did not survive it. Asking again would burn the shim's rounds and end in
    // a failed call, so one unanswered round trip proceeds instead.
    if (responses !== undefined) {
      this._logger.warn('Elicitation answer did not come back — proceeding without confirmation', { key });
      return { status: 'proceed' };
    }

    if (!this.supported(ctx)) {
      this._logger.warn('Elicitation not supported by client — proceeding without confirmation', { message });
      return { status: 'proceed' };
    }

    const detailLines = Object.entries(details)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');
    const fullMessage = detailLines ? `${message}\n\n${detailLines}` : message;

    return {
      status: 'ask',
      result: inputRequired({
        inputRequests: {
          [key]: inputRequired.elicit({ message: fullMessage, requestedSchema: CONFIRM_SCHEMA }),
        },
      }),
    };
  }

  /**
   * Ask the user to provide a string value (e.g. missing schema field).
   *
   * Still the 2025-era inline form, and still reached by no tool — this is the
   * repo's one caller-less elicitation path, left as-is under G6 (dead code is
   * reported, not deleted). It therefore keeps the era guard that `confirm()`
   * shed: an inline request throws on a 2026-era connection, so the default is
   * returned there rather than the call being failed. Converting it to a round
   * trip is speculative until something calls it.
   *
   * @param {string} message
   * @param {object} [options]
   * @param {string} [options.fieldName]
   * @param {string} [options.fieldDescription]
   * @param {string} [options.defaultValue]
   * @returns {Promise<string|null>} - The user-provided value or null if cancelled/unsupported
   */
  async requestString(message, { fieldName = 'value', fieldDescription = '', defaultValue } = {}) {
    const server = this._server?.server;
    const inlineUsable = typeof server?.request === 'function'
      && !this._modernEra(server)
      && formElicitationDeclared(this._clientCapabilities());

    if (!inlineUsable) {
      this._logger.warn('Elicitation not supported — using default value', { fieldName, defaultValue });
      return defaultValue || null;
    }

    try {
      // relatedRequestId ties the prompt to the tools/call in flight. Without it
      // the 2025-era HTTP transport puts the request on the standalone GET SSE
      // stream and drops it outright when the client never opened one.
      const relatedRequestId = servingRequestId();
      const result = await server.request(
        {
          method: 'elicitation/create',
          params: {
            message,
            requestedSchema: {
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
            },
            mode: 'form',
          },
        },
        relatedRequestId === null ? undefined : { relatedRequestId }
      );

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

  /** @private The 2026-07-28 era has no server→client request channel. */
  _modernEra(server) {
    try {
      const negotiated = server?.getNegotiatedProtocolVersion?.();
      return typeof negotiated === 'string' && negotiated >= '2026-07-28';
    } catch {
      return false;
    }
  }
}
