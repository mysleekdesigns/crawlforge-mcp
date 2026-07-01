/**
 * withAuth — wraps a tool handler with authentication, credit tracking,
 * structured invocation logging (audit phase A2), and observability
 * (OpenTelemetry spans + Prometheus counters) added in v3.2.0.
 *
 * Contract:
 *   - resolves toolCost once per call; every tool is metered (no free tier),
 *     so a valid API key is required for every invocation
 *   - try/finally guarantees a single `tool invocation` log line per call
 *   - log payload: { toolName, paramHash, durationMs, outcome, creditCost, creatorMode }
 *   - outcome ∈ { 'success' | 'error' | 'insufficient_credits' }
 *   - emits an OTel span via src/observability/tracing.js (no-op if disabled)
 *   - increments Prometheus counters via src/observability/metrics.js (if registry passed)
 */

import { createHash } from 'node:crypto';
import { recordToolInvocation } from '../observability/tracing.js';

export function hashParams(params) {
  try {
    return createHash('sha256').update(JSON.stringify(params ?? {})).digest('hex').slice(0, 12);
  } catch {
    return 'unhashable';
  }
}

/**
 * @param {object} deps
 * @param {object} deps.authManager
 * @param {object} deps.logger
 * @param {object} [deps.metrics]  — optional Prometheus registry (see src/observability/metrics.js)
 */
export function makeWithAuth({ authManager, logger, metrics = null }) {
  return function withAuth(toolName, handler) {
    return async (params) => {
      const startTime = Date.now();
      const paramHash = hashParams(params);
      const creatorMode = authManager.isCreatorMode();
      const creditCost = creatorMode ? 0 : authManager.getToolCost(toolName, params);
      let outcome = 'pending';
      let thrown = null;

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

        // Tools catch their own failures and return { isError:true } rather than
        // throwing (the shared pattern in server.js). That is still an ERROR
        // outcome: bill it the half-credit error rate — not full — and log/metric
        // it as an error, honoring CLAUDE.md's "half credits on error" contract.
        const isErrorResult = result?.isError === true;
        outcome = isErrorResult ? 'error' : 'success';
        const charge = creditCost === 0
          ? 0
          : (isErrorResult ? Math.max(1, Math.floor(creditCost * 0.5)) : creditCost);

        // D3.5: Surface cost transparency in all tool responses
        try {
          const projection = authManager.projectCost(toolName, params);
          const remainingCredits = creatorMode ? Infinity : (authManager.creditCache ? [...authManager.creditCache.values()][0] ?? null : null);
          const costMeta = {
            projected: creditCost,
            actual: creatorMode ? 0 : charge,
            remaining_credits: remainingCredits,
            projection_note: projection.note
          };

          // Inject _cost into the first text content item if it's JSON
          if (result && Array.isArray(result.content) && result.content[0]?.type === 'text') {
            try {
              const parsed = JSON.parse(result.content[0].text);
              parsed._cost = costMeta;
              result.content[0].text = JSON.stringify(parsed, null, 2);
            } catch {
              // Not JSON — skip injection silently
            }
          }
        } catch {
          // Cost injection must never break the request path
        }

        // creditCost === 0 means a genuinely free call (e.g. serp_rank when
        // DataForSEO is unconfigured — a no-op). Emit NO usage event at all so
        // the backend has nothing to (re-)price; reporting 0 would still create
        // a serp_rank record the backend could recompute to full cost.
        if (!creatorMode && creditCost > 0) {
          await authManager.reportUsage(toolName, charge, params, isErrorResult ? 500 : 200, Date.now() - startTime);
        }

        return result;
      } catch (error) {
        outcome = 'error';
        thrown = error;
        // Half-charge on error — but never charge a free (0-cost) call, and
        // never let Math.max(1, …) floor a 0 up to 1 credit.
        if (!creatorMode && creditCost > 0) {
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

        // Prometheus (no-op unless registry was supplied)
        if (metrics) {
          try {
            metrics.incCounter('crawlforge_tool_requests_total', { tool: toolName, outcome });
            if (outcome === 'error') {
              metrics.incCounter('crawlforge_tool_errors_total', {
                tool: toolName,
                error_class: thrown?.name ?? 'Error'
              });
            }
            metrics.observeHistogram('crawlforge_tool_duration_ms', { tool: toolName }, durationMs);
            if (outcome === 'success' && creditCost > 0) {
              metrics.incCounter('crawlforge_credits_consumed_total', { tool: toolName }, creditCost);
            }
          } catch {
            // metrics must never break the request path
          }
        }

        // OpenTelemetry (no-op when OTEL_SDK_DISABLED !== 'false')
        recordToolInvocation(toolName, {
          duration_ms: durationMs,
          outcome,
          credit_cost: creditCost,
          creator_mode: creatorMode
        }, thrown);
      }
    };
  };
}
