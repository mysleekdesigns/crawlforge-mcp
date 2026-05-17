/**
 * withAuth — wraps a tool handler with authentication, credit tracking,
 * and structured invocation logging (audit phase A2).
 *
 * Extracted from server.js in v3.0.19 so unit tests can assert the
 * "every invocation produces a log line" contract without spinning the
 * full MCP server.
 *
 * Contract:
 *   - resolves toolCost once per call
 *   - try/finally guarantees a single `tool invocation` log line per call
 *   - log payload: { toolName, paramHash, durationMs, outcome, creditCost, creatorMode }
 *   - outcome ∈ { 'success' | 'error' | 'insufficient_credits' }
 */

import { createHash } from 'node:crypto';

export function hashParams(params) {
  try {
    return createHash('sha256').update(JSON.stringify(params ?? {})).digest('hex').slice(0, 12);
  } catch {
    return 'unhashable';
  }
}

/**
 * @param {string} toolName
 * @param {(params: any) => Promise<any>} handler
 * @param {object} deps - { authManager, logger }
 */
export function makeWithAuth({ authManager, logger }) {
  return function withAuth(toolName, handler) {
    return async (params) => {
      const startTime = Date.now();
      const paramHash = hashParams(params);
      const creatorMode = authManager.isCreatorMode();
      const creditCost = creatorMode ? 0 : authManager.getToolCost(toolName);
      let outcome = 'pending';

      try {
        if (!creatorMode) {
          const hasCredits = await authManager.checkCredits(creditCost);
          if (!hasCredits) {
            outcome = 'insufficient_credits';
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  error: 'Insufficient credits',
                  message: `This operation requires ${creditCost} credits. Please upgrade your plan at https://www.crawlforge.dev/pricing`,
                  creditsRequired: creditCost
                }, null, 2)
              }]
            };
          }
        }

        const result = await handler(params);
        outcome = 'success';

        if (!creatorMode) {
          await authManager.reportUsage(toolName, creditCost, params, 200, Date.now() - startTime);
        }

        return result;
      } catch (error) {
        outcome = 'error';
        if (!creatorMode) {
          await authManager.reportUsage(
            toolName,
            Math.max(1, Math.floor(creditCost * 0.5)),
            params,
            500,
            Date.now() - startTime
          );
        }
        throw error;
      } finally {
        const durationMs = Date.now() - startTime;
        logger.info('tool invocation', {
          toolName,
          paramHash,
          durationMs,
          outcome,
          creditCost,
          creatorMode
        });
      }
    };
  };
}
