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
 *   - error results get a "Next step:" hint naming the tool to try next
 *     (src/server/fallbackHints.js) so a failure is not followed by a blind retry
 *   - emits an OTel span via src/observability/tracing.js (no-op if disabled)
 *   - increments Prometheus counters via src/observability/metrics.js (if registry passed)
 */

import { createHash } from 'node:crypto';
import { recordToolInvocation } from '../observability/tracing.js';
import { isInternalRequest, preflightRefusal, reportedActualCost, requestContext } from './requestContext.js';
import { appendFallbackHint } from './fallbackHints.js';
import { INLINE_THRESHOLD_TOOLS, applyInlineThreshold } from './inlineThreshold.js';
import { REDACTION_TOOLS, redactionSurcharge, runRedactionStage } from './redaction.js';
import { getResultStore } from '../core/ResultStore.js';

/**
 * Replace an over-threshold JSON text result (and its structuredContent, if
 * any) with the shaped preview + handle. Non-JSON text is left alone.
 */
function shapeLargeResult(toolName, result, params) {
  if (!result || !Array.isArray(result.content) || result.content[0]?.type !== 'text') return;
  let parsed;
  try { parsed = JSON.parse(result.content[0].text); } catch { return; }
  const { result: shaped, stored } = applyInlineThreshold(toolName, parsed, params, { store: getResultStore() });
  if (!stored) return;
  result.content[0].text = JSON.stringify(shaped, null, 2);
  if (result.structuredContent) result.structuredContent = shaped;
}

/**
 * Redact the result's page text in place (Phase 5, 5.3). Runs BEFORE
 * shapeLargeResult: a result stored unredacted would be served straight back
 * out by read_result, which is the hole redact_pii exists to close.
 *
 * @returns {Promise<boolean>} whether a model pass actually completed
 */
async function redactResult(toolName, result, params, mcpServer) {
  if (!result || !Array.isArray(result.content) || result.content[0]?.type !== 'text') return false;
  let parsed;
  try { parsed = JSON.parse(result.content[0].text); } catch { return false; }
  const { redacted, modelRan } = await runRedactionStage(toolName, parsed, params, { mcpServer });
  if (!redacted) return false;
  result.content[0].text = JSON.stringify(parsed, null, 2);
  if (result.structuredContent) result.structuredContent = parsed;
  return modelRan;
}

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
export function makeWithAuth({ authManager, logger, metrics = null, mcpServer = null }) {
  return function withAuth(toolName, handler) {
    const invoke = async (params, ctx) => {
      const startTime = Date.now();
      const paramHash = hashParams(params);
      const creatorMode = authManager.isCreatorMode();
      // Internal = a request from the website REST proxy (see requestContext).
      // Billing-exempt like creator mode — the website already checked and
      // charged the end user's credits — but auth still happened per-request.
      const internal = isInternalRequest();
      const billingExempt = creatorMode || internal;
      const creditCost = billingExempt ? 0 : authManager.getToolCost(toolName, params);
      // redact_pii's model pass runs at this seam, AFTER the handler, so the
      // handler's own setActualCost report cannot know about it. Split the
      // projection: the tool prices its own work, and the model surcharge is
      // added back only when a model actually completed (G4).
      const redactionCost = billingExempt ? 0 : Math.min(redactionSurcharge(toolName, params), creditCost);
      const toolCost = creditCost - redactionCost;
      let redactionModelRan = false;
      let outcome = 'pending';
      let thrown = null;
      // Only bill the error-path half-charge once the handler has actually run.
      // A throw from the credit check itself (backend down, key rejected, etc.)
      // means the tool never executed and must cost nothing.
      let handlerStarted = false;
      // A handler may report a lower spend (setActualCost). The projection is
      // the ceiling the caller saw before the call, so a report can only ever
      // lower the charge, never raise it.
      const billable = () => {
        const reported = reportedActualCost();
        const spent = reported == null ? toolCost : Math.min(reported, toolCost);
        return spent + (redactionModelRan ? redactionCost : 0);
      };

      try {
        // billingExempt covers creator mode and authenticated internal-proxy
        // requests (the website REST layer has already checked AND charged the
        // end user's credits before forwarding — checking the static key's
        // balance here would gate users on an unrelated account).
        if (!billingExempt) {
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
              }],
              isError: true
            };
          }
        }

        handlerStarted = true;
        const result = await handler(params, ctx);

        // Tools catch their own failures and return { isError:true } rather than
        // throwing (the shared pattern in server.js). That is still an ERROR
        // outcome: bill it the half-credit error rate — not full — and log/metric
        // it as an error, honoring CLAUDE.md's "half credits on error" contract.
        const isErrorResult = result?.isError === true;
        outcome = isErrorResult ? 'error' : 'success';
        // A pre-flight refusal (robots.txt disallowed the path, or the host is
        // blocklisted) means we fetched nothing at all, so it costs nothing —
        // not even the half-credit error rate, which exists for work that ran
        // and then failed. Only when the refusal actually sank the call: a
        // multi-URL tool that skipped one disallowed URL and still returned a
        // result did real work and bills for it.
        const refused = isErrorResult && preflightRefusal() !== null;

        // Phase 5 (5.3): redact_pii scrubs the page text this call returns.
        // It runs BEFORE the inline-threshold stage below, so what gets
        // stored — and what read_result later serves — is already redacted.
        // Internal (website REST proxy) requests are redacted too: the text
        // is the same text, and the website has no copy of it to scrub.
        if (!isErrorResult && toolName in REDACTION_TOOLS) {
          try {
            redactionModelRan = await redactResult(toolName, result, params, mcpServer);
          } catch {
            /* redaction must never break the request path */
          }
        }

        // Phase 2: a result over max_inline_chars is stored and returned as
        // a preview plus a result_handle for read_result. Internal (website
        // REST proxy) requests are left whole — the website applies its own
        // threshold with its own store.
        if (!isErrorResult && !internal && toolName in INLINE_THRESHOLD_TOOLS) {
          try { shapeLargeResult(toolName, result, params); } catch { /* shaping must never break the request path */ }
        }

        const base = billable();
        const charge = creditCost === 0 || refused
          ? 0
          : (isErrorResult ? Math.max(1, Math.floor(base * 0.5)) : base);

        // D3.5: Surface cost transparency in all tool responses. For internal
        // proxy requests the meaningful balance is the end user's, which only
        // the website knows — report null rather than the static key's cache.
        try {
          const projection = authManager.projectCost(toolName, params);
          const remainingCredits = creatorMode
            ? Infinity
            : internal
              ? null
              : (authManager.creditCache ? [...authManager.creditCache.values()][0] ?? null : null);
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

        // Selection hint: tell the model what to try instead of the same call.
        if (isErrorResult) {
          try { appendFallbackHint(toolName, result); } catch { /* never break the request path */ }
        }

        // creditCost === 0 means a genuinely free call (e.g. serp_rank when
        // DataForSEO is unconfigured — a no-op). Emit NO usage event at all so
        // the backend has nothing to (re-)price; reporting 0 would still create
        // a serp_rank record the backend could recompute to full cost. The
        // same goes for a handler that reported a 0 spend.
        if (!creatorMode && creditCost > 0 && !refused && charge > 0) {
          await authManager.reportUsage(toolName, charge, params, isErrorResult ? 500 : 200, Date.now() - startTime);
        }

        return result;
      } catch (error) {
        outcome = 'error';
        thrown = error;
        // Half-charge on error — but never charge a free (0-cost) call, never
        // let Math.max(1, …) floor a 0 up to 1 credit, and never bill at all
        // if the handler never ran (e.g. the credit check itself threw).
        if (!creatorMode && creditCost > 0 && handlerStarted && preflightRefusal() === null) {
          await authManager.reportUsage(
            toolName,
            Math.max(1, Math.floor(billable() * 0.5)),
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
          creatorMode,
          internal
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
          creator_mode: creatorMode,
          internal
        }, thrown);
      }
    };

    // Every invocation runs in its own context so the compliance gate can stamp
    // a refusal where the billing decision can see it. Any outer store (the
    // HTTP transport's `internal` flag, the serving McpServer) is spread in,
    // not replaced — and stdio callers, who have no transport-provided store,
    // get one here.
    //
    // `ctx` is the SDK's per-request context (v2 calls a tool callback with
    // `(args, ctx)`). It is passed straight through to the handler; existing
    // 1-arity handlers ignore it. Its request id is stamped on the context so a
    // server-to-client request sent from inside the tool can ride the same
    // stream as this call — see servingRequestId() in requestContext.js.
    return async (params, ctx) => requestContext.run(
      {
        ...(requestContext.getStore() ?? {}),
        preflightRefusal: null,
        actualCost: null,
        servingRequestId: ctx?.mcpReq?.id
      },
      () => invoke(params, ctx)
    );
  };
}
