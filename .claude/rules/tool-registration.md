---
paths:
  - "server.js"
  - "src/tools/**"
  - "src/server/**"
  - "src/core/AuthManager.js"
---

# Tool registration and billing

## Adding or changing a tool

- Register in `server.js` with `registerToolIfEnabled(name, { description, annotations, inputSchema, outputSchema?, _meta? }, withAuth(name, handler))`. The four async tools (`crawl_deep`, `batch_scrape`, `deep_research`, `agent`) use `server.experimental.tasks.registerToolTask`.
- The tool class implements `execute(params)`; if it holds resources it implements `destroy()` or `cleanup()` and goes in the `gracefulShutdown` cleanup array.
- Every fetching tool spreads `COMPLIANCE_PARAMS` (`respect_robots`, `user_agent`) into its schema and forwards them to the tool class. A wrapper that drops them silently disables the robots gate; `tests/unit/complianceParamForwarding.test.js` guards this.
- A description leads with when to use the tool, names the tool to use instead for the cases it is not for, and ends with `Cost: N credits` and an example. `tests/unit/toolSelectionSurface.test.js` pins the cost and the 2,048-char cap.
- A new tool also needs: a cost in `AuthManager.getToolCost`, a hint in `src/server/fallbackHints.js`, a group in `src/server/toolFilter.js`, the tool count updated in the startup log, and a row in `crawlforge-website/src/lib/credits.ts` (`scripts/verify-cost-parity.mjs` checks parity).

## Billing (`withAuth`)

- Checks credits before execution (skipped in creator mode) and reports usage on success.
- An error result bills half. A compliance refusal bills nothing (`preflightRefusal` in `src/server/requestContext.js`).
- Handlers catch their own failures and return `{ content: [{ type: "text", text }], isError: true }`; `withAuth` appends the "Next step:" hint and logs one `tool invocation` line per call.
- Creator mode (maintainer only) has unlimited access: `server.js` loads `.env` early and validates the secret by SHA256 hash comparison.
