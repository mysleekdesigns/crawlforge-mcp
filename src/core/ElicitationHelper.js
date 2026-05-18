/**
 * ElicitationHelper — MCP Elicitation for CrawlForge
 *
 * Allows tools to request user confirmation or input mid-execution for
 * expensive or ambiguous operations. Falls back gracefully when the
 * MCP client does not support elicitation.
 *
 * MCP Spec 2025-11-25: client/elicit request with requestedSchema
 */

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
   * Whether the connected MCP client supports elicitation.
   * @returns {boolean}
   */
  get supported() {
    return !!(this._mcpServer?.server?.elicit);
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

      const result = await this._mcpServer.server.elicit({
        message: fullMessage,
        requestedSchema: {
          type: 'object',
          properties: {
            confirmed: {
              type: 'boolean',
              title: 'Proceed?',
              description: 'Confirm to proceed with the operation',
            },
          },
          required: ['confirmed'],
        },
      });

      return result?.content?.confirmed === true;
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
      const result = await this._mcpServer.server.elicit({
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
      });

      return result?.content?.[fieldName] || defaultValue || null;
    } catch (err) {
      this._logger.warn('Elicitation request failed', { error: err.message });
      return defaultValue || null;
    }
  }
}
