# Phase 4 — HTTP Transport, Protocol Hygiene & Medium/Low Cleanup

_19 findings · part of the [CrawlForge audit remediation plan](./README.md). Full failure detail in [`docs/CODEBASE_AUDIT_2026-08.md`](../docs/CODEBASE_AUDIT_2026-08.md)._

**Goal:** make the HTTP/streamable-HTTP deployment path production-usable (it currently degrades to one session and bricks on reconnect/DELETE), fix the unretrievable `getting-started` prompt, and clear the remaining medium/low catalog (charset detection, `<base href>`, webhook HMAC/timeout, schema drifts, stale discovery metadata, stdout hygiene on auto-setup).

**Note:** this phase is only load-bearing for `npm run start:http` / remote deployments; the default stdio path is unaffected. If a hosted remote endpoint (Phase 6) is on the roadmap, do the transport rework here first.

---

## Checklist

- [ ] 🟠 **getting-started prompt is unusable: config object misinterpreted as argsSchema by the SDK** · CONFIRMED
  - `server.js:115`
  - Failure: server.prompt('getting-started', { description: ... }, cb) hits the SDK's positional overload (mcp.js:706): a non-string second arg becomes argsSchema, so the plain object {description: '...'} is treated as a Zod raw shape whose 'value' is a string. Verified against SDK 1.29.0 with a live in-memory client: prompts/list advertises a bogus REQUIRED argument named 'description' (and no prompt description); prompts/get without arguments fails with -32602 'Invalid arguments'; with arguments it fails with -32603 'keyValidator._parse is not a function'. The prompt can never be retrieved by any client. The compliance suite never exercises prompts, so this ships silently.
  - Fix: Use server.registerPrompt('getting-started', { description }, cb) (the config-object API used for the other 5 prompts at server.js:264), or pass the description as a plain string.
- [ ] 🟠 **Stateful streamable HTTP uses one shared transport: only one session ever; reconnect or DELETE bricks /mcp until restart** · CONFIRMED
  - `src/server/transports/streamableHttp.js:53`
  - Failure: A single StreamableHTTPServerTransport is created once and reused for all requests. In SDK 1.29.0 (webStandardStreamableHttp.js:425-427) a second initialize while _initialized is true returns 400 'Invalid Request: Server already initialized' — so a second concurrent client can never connect, and a single client that reconnects after a network drop (standard MCP client behavior: re-initialize) is rejected. Worse, DELETE /mcp (session terminate) calls transport.close(), which clears streams but never resets _initialized or sessionId (SDK close() at line 630), so after any clean client disconnect the endpoint returns 400/404 for everything until process restart. A deployed HTTP server (Render, per the port comment) degrades to one-shot.
  - Fix: Follow the SDK's documented stateful pattern: keep a map of sessionId -> transport, create a new transport per initialize request, and dispose it on DELETE/onsessionclosed.
- [ ] 🟠 **Legacy stateless mode (--legacy-http / connectHttp) fails on every request after the first** · CONFIRMED
  - `src/server/transports/streamableHttp.js:152`
  - Failure: With legacy=true, sessionIdGenerator is undefined and the single transport is reused for all requests. SDK 1.29.0 explicitly forbids this: webStandardStreamableHttp.js:139-141 throws 'Stateless transport cannot be reused across requests. Create a new transport per request.' once _hasHandledRequest is set by the first request. The throw propagates out of the unguarded 'await transport.handleRequest(req, res)' inside the async createServer callback — an unhandled rejection (logged by the process handler) and a response that is never ended, so the client hangs until timeout. Every request after the first fails for the lifetime of the process, making the advertised one-release deprecation window a dead mode.
  - Fix: In legacy mode construct a fresh StreamableHTTPServerTransport per request (and connect it to the server per SDK stateless example), and wrap transport.handleRequest in try/catch that ends the response with a 500.
- [ ] 🟡 **scrape inlines full base64 screenshot bytes into the JSON tool result despite publishing a resource URI**
  - `server.js:901`
  - Failure: The screenshot objects produced by ActionExecutor.captureScreenshot carry `data` (base64 of the PNG/JPEG, ActionExecutor.js:801). server.js stores the image in resourceRegistry and adds resourceUri, but returns `{...shot, resourceUri}` — `data` is kept — and the whole result is JSON.stringify'd into a single text content block. `scrape({url, formats:["screenshot"], screenshotOptions:{fullPage:true}})` therefore ships several MB of base64 into the conversation even though the tool description says it "returns crawlforge://screenshot/{id} resources", blowing the client's context/response limits for no benefit.
  - Fix: Strip `data` from the returned shot once it has been stored in resourceRegistry (keep actionId, format, fullPage, timestamp, resourceUri), so the bytes are only retrievable through the resource.
- [ ] 🟡 **search_web reads its API key only from env/.env, not from ~/.crawlforge/config.json — fails and half-bills users configured via setup**
  - `src/constants/config.js:306`
  - Failure: getToolConfig('search_web') passes apiKey: config.crawlforge.apiKey (env CRAWLFORGE_API_KEY or package .env only). AuthManager authenticates from ~/.crawlforge/config.json, so a user who ran `npm run setup` and launches with `npm start` (no env var) passes the credit check but SearchWebTool has searchAdapter=null (searchWeb.js:86-88) and every search_web call throws 'CrawlForge API key is required...' — which the server.js handler converts to isError:true, so withAuth bills half of 5 = 2 credits per guaranteed-failure call. Key-source divergence between AuthManager and SearchWebTool.
  - Fix: Fall back to AuthManager.getConfig()?.apiKey when the env var is absent (at instantiation in server.js or inside getToolConfig).
- [ ] 🟡 **Auto-setup path writes status banners to stdout in stdio MCP mode**
  - `src/core/AuthManager.js:169`
  - Failure: server.js:65 calls AuthManager.runSetup(apiKey) whenever CRAWLFORGE_API_KEY is set but ~/.crawlforge/config.json is absent (first launch on a machine, or every container start on an ephemeral filesystem). runSetup uses console.log for '🔧 Setting up...', '✅ Setup complete!', account/credits/plan lines (AuthManager.js:169-193; clearConfig:660 likewise) — all to stdout, which in stdio mode is the JSON-RPC channel. This violates the project's own v4.2.4 stdout-hygiene contract; strict MCP clients can fail the handshake on the non-JSON lines. The stdout-hygiene test explicitly excludes 'AuthManager interactive setup' on the incorrect assumption it is never hit during a server run.
  - Fix: Switch runSetup/clearConfig status output to console.error (as the surrounding startup banners already do), and drop the exclusion from tests/unit/stdout-hygiene.test.js.
- [ ] 🟡 **extract_structured elicitation is wired but never invoked, contradicting the documented behaviour**
  - `src/tools/extract/extractStructured.js:56`
  - Failure: The tool constructs an ElicitationHelper (line 56) and server.js:199 calls setMcpServer to inject the real MCP server, but `this._elicitation` is never referenced inside execute() — grep across src/tools/extract shows only lines 56 and 61. docs/sandboxing-and-approvals.md:140 and CLAUDE.md both state extract_structured asks for confirmation when 'schema has >3 required fields, no LLM configured'. Failure scenario: extract_structured with a 6-required-field schema and no LLM provider silently runs the low-fidelity CSS fallback with no confirmation and no note, while the security documentation asserts the user was asked.
  - Fix: Either call `await this._elicitation.confirm(...)` before the CSS fallback when schema.required.length > 3 and no LLM is available, or remove the claim from the docs and the unused helper.
- [ ] 🟡 **MCP-sampling fallback is dead — SamplingClient is constructed without the MCP server**
  - `src/tools/extract/extractWithLlm.js:482`
  - Failure: Both `new SamplingClient()` here and in summarizeContent.js:214 pass no mcpServer, so SamplingClient's step 3 guard `if (this._mcpServer?.server?.createMessage)` (SamplingClient.js:153) is always false and the client-side sampling leg never runs. Neither tool has a setMcpServer() and neither is wired in server.js (which does wire deepResearch, batchScrape, crawlDeep, extractStructured, agent, trackChanges). Failure scenario: on a sampling-capable MCP client with no Ollama and no API keys, summarize_content({options:{summaryType:'abstractive'}}) returns degraded:true 'no LLM/sampling backend' even though the client could have served the completion, and extract_with_llm's advertised 'Ollama → ... → sampling' chain stops one step early.
  - Fix: Add setMcpServer(server) to both tools and pass it into the SamplingClient constructor, as extractStructured/agent already do.
- [ ] 🟡 **Screenshot failures are reported as 'produced no image', discarding the real error**
  - `src/tools/scrape/unifiedScrape.js:351`
  - Failure: ActionExecutor.executeActionChain never throws on failure — its outer catch returns {success:false, error, screenshots:[]} (ActionExecutor.js:300-311). unifiedScrape only inspects r.screenshots, so any real failure (navigation timeout, ERR_NAME_NOT_RESOLVED, browser launch failure, 'Action failed: …') is flattened to the warning "screenshot: capture produced no image" and r.error is dropped. The caller gets no way to distinguish a blank page from a browser that never started, and cannot decide whether retrying is worthwhile.
  - Fix: Check `r?.success === false` (or r.error) first and push `screenshot: ${r.error}` as the warning; keep the 'no image' message only for a successful chain that genuinely produced zero screenshots.
- [ ] ⚪ **projectCost reads params.maxPages for crawl_deep but the tool's schema field is max_pages — projection always uses the default**
  - `src/core/AuthManager.js:602`
  - Failure: crawl_deep's input schema (server.js:419) uses snake_case max_pages, but projectCost checks params?.maxPages || params?.options?.maxPages || 10, so a crawl_deep call with max_pages: 1000 still projects Math.ceil(10/20)*4 = 4 credits. The _cost.projected transparency metadata injected into every crawl_deep response is therefore wrong for any non-default page count (actual billing is unaffected since the charge is the flat base).
  - Fix: Read params?.max_pages (keeping maxPages as a fallback).
- [ ] ⚪ **BrowserBaseBackend.connect throws an empty Error, discarding status and response body**
  - `src/core/StealthBrowserManager.js:2104`
  - Failure: On a failed BrowserBase session create, line 2103 reads the error body into `err` and line 2104 does `throw new Error();` with no message — the status code and `err` body are dropped, so any caller gets a message-less error with zero diagnostics. Separately, this whole backend is dead code: resolveBrowserBackend (line 2144) is never called anywhere, and the comment at line 2019 references StealthBrowserManager.getBrowserBackend() which does not exist, so the documented graceful fallback to local Playwright is not wired. Latent, but would bite the moment the backend is connected.
  - Fix: throw new Error(`BrowserBase session create failed: HTTP ${sessionRes.status} ${err}`); and either wire resolveBrowserBackend/getBrowserBackend or remove the unused backend + misleading comment.
- [ ] ⚪ **HMAC signature covers only event.payload, not the delivered body — standard verification always fails**
  - `src/core/WebhookDispatcher.js:433`
  - Failure: generateSignature signs JSON.stringify(payload) (lines 433-438), but the POSTed body is the envelope {event,id,timestamp,data:payload,metadata} (lines 388-394). Receivers following the universal webhook pattern (HMAC over the raw request body) compute a different digest and reject every delivery, making the signingSecret feature unusable without reverse-engineering that only the `data` sub-object is signed — which no docs state.
  - Fix: Sign the exact serialized request body string that is sent.
- [ ] ⚪ **retryableStatusCodes on the webhook RetryManager never matches — HTTP 5xx errors carry no .response**
  - `src/core/WebhookDispatcher.js:73`
  - Failure: The RetryManager is configured with retryableStatusCodes [408,429,500,...] (line 73), but deliverWebhook throws plain new Error('HTTP 500: ...') (line 406) with no .response property, and RetryManager.isRetryableError only checks error.response.status (RetryManager.js:161-163). So RetryManager never retries HTTP failures; only the outer queue-level re-enqueue in processEvent provides retries. Behavior still converges, but the configured inner retry policy for status codes is dead code and delivery retry timing differs from what the config implies.
  - Fix: Attach the status to the thrown error (err.response = { status: response.status }) or drop the misleading config.
- [ ] ⚪ **Public discovery metadata is stale: server-card advertises '20 tools' and version 3.5.1 on a 27-tool v4.10.0 server**
  - `src/server/transports/streamableHttp.js:106`
  - Failure: SERVER_VERSION is hard-coded '3.5.1' (line 31) and surfaces in /health, startup banners, and the Smithery server-card, whose description says '20 web scraping ... tools' (line 106) versus the actual 27 tools and package version 4.10.0. Clients using Smithery discovery or health-based version checks get wrong information.
  - Fix: Derive the version from package.json and update the card description (or reuse the McpServer description string from server.js).
- [ ] ⚪ **Insufficient-credits refusal is returned without isError:true**
  - `src/server/withAuth.js:48`
  - Failure: When checkCredits returns false, withAuth returns a content-only result carrying a JSON error body but no isError flag, unlike every other failure path in server.js. MCP clients and automation that branch on isError treat the refusal as a successful tool result; the calling model must parse the text to discover the call was refused.
  - Fix: Add isError: true to the insufficient-credits return object.
- [ ] ⚪ **result.metadata.finalUrl is always undefined (reads wrong property path)**
  - `src/tools/advanced/ScrapeWithActionsTool.js:443`
  - Failure: executeSession sets finalUrl: chainResult.metadata?.finalUrl (line 443), but executeActionChain returns finalUrl at the top level of chainResult (ActionExecutor.js:287), not inside metadata. So the scrape_with_actions result's metadata.finalUrl is always undefined even after navigation-changing actions, hiding where the browser actually ended up (extractFinalContent uses the correct chainResult.finalUrl, so content is right but the reported URL is not).
  - Fix: Use chainResult?.finalUrl.
- [ ] ⚪ **Recordings made with captureIntermediateStates save unreplayable executeJavaScript entries**
  - `src/tools/advanced/scrapeWithActions/recorder.js:158`
  - Failure: ScrapeWithActionsTool records the expanded actionChain (including injected capture actions), but buildRecordedEntry (lines 158-176) preserves only selector/text/key/duration/etc. and drops `script`. A recording made with record:true + captureIntermediateStates:true therefore contains {type:'executeJavaScript'} entries with no script; on replay, ActionChainSchema.parse in ActionExecutor rejects them (script is required, ActionExecutor.js:81-86) and the entire replay fails with a validation error.
  - Fix: Either record only the user's original actions (params.actions) or preserve the script field in buildRecordedEntry.
- [ ] ⚪ **No coverage for the failure modes found above: prompt retrieval, second HTTP session/request, credit-check-throw billing**
  - `tests/unit/streamableHttp.test.js:57`
  - Failure: The transport suite only exercises /health, /metrics, auth rejection, and single OAuth pass-through — never a second POST /mcp in legacy mode nor a re-initialize in stateful mode, which is exactly where both transports break. tests/integration/mcp-protocol-compliance.test.js contains zero prompt coverage (grep 'prompt' matches nothing), letting the dead getting-started prompt report '100% COMPLIANT'. withAuth tests cover checkCredits returning false but not checkCredits throwing, missing the bill-on-refusal path.
  - Fix: Add: a prompts/get test for every registered prompt; a two-request legacy-mode test and a reconnect/second-initialize stateful test; a withAuth test where checkCredits rejects asserting no usage is reported.
- [ ] ⚪ **No tests exercise the real browser lifecycle, webhook SSRF/timeout, or async get_batch_results paths**
  - `tests/unit/tools/advanced/scrapeWithActions.test.js:96`
  - Failure: scrapeWithActions.test.js stubs the executor entirely (the 'page is always closed' test at line 138 tracks a stub's close, so the goto-failure leak and context leak are invisible). webhookDispatcher.test.js covers registration/signature/queueing but never a real delivery, so the ignored fetch timeout and unguarded URL are untested. batchScrape.test.js and jobManager.test.js never test get_batch_results against an in-progress async job, batchResults cache eviction, or cancelBatch actually stopping work — exactly the paths found defective above.
  - Fix: Add tests: getBatchResults during a running async job; a delivery against a local HTTPS endpoint asserting abort at config.timeout; an initializePage goto-failure asserting page/context close; batchResults eviction after TTL.

---

## Verification gate
- [ ] `streamableHttp` supports a **second** concurrent session, a client **reconnect** after disconnect, and a **DELETE** followed by a fresh `initialize` — each succeeds (per-session transport map).
- [ ] Legacy stateless mode either serves every request (fresh transport per request) or is removed; no unhandled rejection, no hung response.
- [ ] `prompts/list` advertises `getting-started` with a description and no bogus required arg; `prompts/get` retrieves it.
- [ ] Nothing but JSON-RPC reaches stdout in stdio mode even on first-launch auto-setup (assert in `stdout-hygiene.test.js`).
- [ ] Discovery metadata reports the real tool count (27) and version (4.10.0).
- [ ] `npm run test:unit` and `npm test` green.
