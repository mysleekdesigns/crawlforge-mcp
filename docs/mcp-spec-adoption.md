# MCP Spec Adoption

CrawlForge implements the MCP spec plus a small set of experimental extensions from the
spec-enhancement-proposal (SEP) pipeline. Over stdio it speaks the 2025 era (negotiated by
`initialize`); the HTTP `/mcp` endpoint additionally serves the 2026-07-28 revision statelessly
on the same route — see sections 8 and 9. This document is the wire-level
reference for those features. Everything here is additive — clients that don't understand a
given feature ignore the fields they don't recognize and continue to work off the plain-text
`content` result, exactly as before.

## Contents

1. [Structured tool output](#1-structured-tool-output)
2. [Tool Execution Errors for invalid input (SEP-1303)](#2-tool-execution-errors-for-invalid-input-sep-1303)
3. [JSON Schema 2020-12, deterministic ordering, cacheable-result hints (SEP-2549)](#3-json-schema-2020-12-deterministic-ordering-cacheable-result-hints-sep-2549)
4. [Icons (SEP-973)](#4-icons-sep-973)
5. [Async tasks — retired](#5-async-tasks--retired)
6. [Client-side tool selection](#6-client-side-tool-selection)
7. [MCP Registry](#7-mcp-registry)
8. [Dual-era HTTP transport (2026-07-28 + 2025)](#8-dual-era-http-transport-2026-07-28--2025)
9. [Elicitation and Sampling under the 2026-07-28 revision](#9-elicitation-and-sampling-under-the-2026-07-28-revision)

---

## 1. Structured tool output

**What it is:** Alongside the traditional `content` array (a JSON string wrapped in a text
block), tool results now include a `structuredContent` object — a directly machine-parseable
result validated against a published `outputSchema` in the tool's `tools/list` entry. This is
the MCP 2025-06-18 structured-output feature.

**Which tools:** `scrape`, `map_site`, `serp_rank`, `search_web`, `extract_structured`, `crawl_deep`.

**`tools/list` entry (excerpt, `map_site`):**

```json
{
  "name": "map_site",
  "description": "Discover and map website structure, optionally ranked by relevance to a search query.",
  "inputSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "url": { "type": "string" },
      "search": { "type": "string" }
    },
    "required": ["url"]
  },
  "outputSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "urls": { "type": "array", "items": { "type": "string" } },
      "ranked_urls": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "url": { "type": "string" },
            "score": { "type": "number" }
          }
        }
      }
    },
    "required": ["urls"]
  }
}
```

**`tools/call` response (excerpt):**

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "result": {
    "content": [
      { "type": "text", "text": "{\"urls\":[\"https://example.com/\",\"https://example.com/docs\"],\"ranked_urls\":[{\"url\":\"https://example.com/docs\",\"score\":0.92}]}" }
    ],
    "structuredContent": {
      "urls": ["https://example.com/", "https://example.com/docs"],
      "ranked_urls": [{ "url": "https://example.com/docs", "score": 0.92 }]
    },
    "isError": false
  }
}
```

**Client compatibility:** Clients that don't read `structuredContent` are unaffected — the
`content` text block carries the same JSON it always has.

---

## 2. Tool Execution Errors for invalid input (SEP-1303)

**What it is:** Previously, malformed tool arguments (missing required field, wrong type)
surfaced as a JSON-RPC protocol error (`-32602 Invalid params`), which most MCP clients hand
back to the calling model as an opaque failure it can't act on. As of MCP SDK 1.30, validation
failures instead come back as a normal tool result with `isError: true` and a human-readable
`content` message — the same shape as a runtime error — so the calling model can read what was
wrong and retry with corrected arguments.

**Before:**

```json
{
  "jsonrpc": "2.0",
  "id": 12,
  "error": { "code": -32602, "message": "Invalid params: url is required" }
}
```

**Now:**

```json
{
  "jsonrpc": "2.0",
  "id": 12,
  "result": {
    "content": [
      { "type": "text", "text": "Invalid input: \"url\" is required and must be a valid http(s) URL." }
    ],
    "isError": true
  }
}
```

**Which tools:** All 31 registered tools — this is a transport/SDK-level behavior change, not
a per-tool opt-in.

**Client compatibility:** Any client already checking `isError` on tool results (the standard
pattern) handles this identically to a runtime failure. Clients that only checked for JSON-RPC
`error` objects on bad input will now see a successful RPC envelope with `isError: true` inside
— check the result body, not just the envelope.

---

## 3. JSON Schema 2020-12, deterministic ordering, cacheable-result hints (SEP-2549)

**What it is:** Three related hygiene improvements to `tools/list`:

- Every `inputSchema` / `outputSchema` declares `"$schema": "https://json-schema.org/draft/2020-12/schema"`,
  the dialect the current MCP spec expects (see the `map_site` excerpt above).
- `tools/list` returns tools in a stable, sorted order on every call, so clients that cache a
  prompt keyed on the tools list get cache hits instead of invalidating on incidental reordering.
- Read-only tools (fetch/search/lookup-style — e.g. `fetch_url`, `search_web`, `serp_rank`,
  `map_site`, `extract_metadata`) carry a cacheable-result hint in `_meta` telling the client how
  long the result is safe to reuse:

```json
{
  "name": "serp_rank",
  "_meta": {
    "io.modelcontextprotocol/cacheable": { "ttlMs": 300000, "cacheScope": "private" }
  }
}
```

**Client compatibility:** Clients ignoring `_meta` or the `$schema` keyword behave exactly as
before; both are additive metadata, not behavioral requirements.

---

## 4. Icons (SEP-973)

**What it is:** Icon metadata (SEP-973) attached to the server's `initialize` response, and to
each tool and prompt, pointing at `https://www.crawlforge.dev/icon.png`. Clients that render a
tool/prompt picker can show a CrawlForge icon instead of a generic placeholder.

```json
{
  "name": "scrape",
  "icons": [
    { "src": "https://www.crawlforge.dev/icon.png", "sizes": "any", "mimeType": "image/png" }
  ]
}
```

**Client compatibility:** Clients that don't render icons simply ignore the field.

---

## 5. Async tasks — RETIRED

**Status: removed 2026-09-06.** This server used to offer an opt-in async-task mode on
`crawl_deep`, `batch_scrape`, `deep_research` and `agent`: a client could pass a top-level
`task` param, get a handle back immediately and poll `tasks/get` / `tasks/result`.

That mode was built on the MCP TypeScript SDK's **experimental** tasks API. **SEP-2663 removed
that API entirely** — the 2026-07-28 revision moved tasks to the Extensions Track, and SDK v2
deletes the `taskStore` server option, the `extra.taskStore` / `taskId` / `taskRequestedTtl`
handler context and `registerToolTask`. On a 2026-era connection an inbound `tasks/get` answers
`-32601` even where a handler is registered. There was therefore nothing left to build on, and
the mode was retired rather than reimplemented against a surface the spec had dropped.

**What changed for callers:** a `task` param is no longer accepted, and the four tools no longer
advertise `execution.taskSupport`. They behave exactly as they always did for every caller who
did not opt in — the call runs synchronously and returns its result. Nothing else about the four
tools changed.

**If you need long-running work not to hold a connection open:** use `batch_scrape`'s existing
async webhook mode, or the `result_handle` / `read_result` pattern (section 1) to keep a large
result out of the context while you page through it.

## 6. Client-side tool selection

**What it is:** Two environment variables let an MCP client (or the person configuring it)
whitelist which of the 31 registered tools are actually exposed over `tools/list` — useful for
trimming context/tool-budget on smaller clients, or for locking a deployment down to a specific
workflow.

| Variable | Format | Effect |
|---|---|---|
| `CRAWLFORGE_TOOLS` | comma-separated tool names | Expose only the named tools |
| `CRAWLFORGE_TOOL_GROUPS` | comma-separated group names | Expose every tool in the named groups |

Both may be set together (the union is exposed). Leaving both unset exposes all tools
(the default, unchanged). Unknown tool names or group names are ignored, with a warning
logged to stderr. Enabling the `batch_scrape` tool (by name or via the `batch` group)
automatically enables `get_batch_results`, since the latter is only useful to retrieve the
former's paginated results. Likewise, enabling any tool that can return a `result_handle`
(`scrape`, `fetch_url`, `extract_content`, `crawl_deep`, `batch_scrape`, `stealth_mode`,
`scrape_with_actions`, `process_document`, `deep_research`, `extract_embedded_state`)
automatically enables `read_result`, so the hint on a truncated result never names an
unregistered tool.

**Groups:**

| Group | Tools |
|---|---|
| `basic` | `fetch_url`, `extract_text`, `extract_links`, `extract_metadata`, `scrape_structured`, `read_result` |
| `search` | `search_web`, `serp_rank`, `reddit_search` |
| `crawl` | `crawl_deep`, `map_site` |
| `extract` | `extract_content`, `process_document`, `summarize_content`, `analyze_content`, `extract_structured`, `extract_with_llm`, `list_ollama_models`, `extract_embedded_state` |
| `batch` | `batch_scrape`, `get_batch_results`, `scrape_with_actions` |
| `research` | `deep_research` |
| `tracking` | `track_changes` |
| `llmstxt` | `generate_llms_txt` |
| `stealth` | `stealth_mode`, `localization` |
| `templates` | `scrape_template` |
| `scrape` | `scrape` |
| `agent` | `agent` |

**Example — a lean client config exposing only basic fetch, search, and unified scrape:**

```json
{
  "mcpServers": {
    "crawlforge": {
      "command": "npx",
      "args": ["-y", "crawlforge-mcp-server"],
      "env": {
        "CRAWLFORGE_API_KEY": "cf_live_your_api_key_here",
        "CRAWLFORGE_TOOL_GROUPS": "basic,search,scrape"
      }
    }
  }
}
```

**Example — an explicit tool-name whitelist:**

```json
{
  "env": {
    "CRAWLFORGE_API_KEY": "cf_live_your_api_key_here",
    "CRAWLFORGE_TOOLS": "scrape,search_web,extract_content"
  }
}
```

**Client compatibility:** This filtering happens entirely server-side before `tools/list` is
answered — no client-side support is required. A client that ignores these variables (or that
you don't set them for) sees every tool, as before.

---

## 7. MCP Registry

CrawlForge also publishes a `server.json` and a CI workflow for listing in the MCP Registry.
See [docs/mcp-registry.md](mcp-registry.md) for the registry entry and publishing details.

---

## 8. Dual-era HTTP transport (2026-07-28 + 2025)

**What it is:** The `/mcp` endpoint serves both protocol eras on one route. Which era a request
belongs to is decided by the MCP SDK's own `isLegacyRequest` predicate — the same code the SDK's
own HTTP entry runs — so CrawlForge can never disagree with it about a borderline request.

- **2026-07-28 ("modern")** — stateless. A request qualifies by carrying the per-request `_meta`
  envelope (`io.modelcontextprotocol/protocolVersion`, `clientInfo`, `clientCapabilities`) plus
  the SEP-2243 `Mcp-Method` header, and `Mcp-Name` on `tools/call`. There is no handshake and no
  session: each request is served by its own server instance and no `Mcp-Session-Id` is issued.
  `server/discover` replaces `initialize` as the negotiation step.
- **2025 era** — sessionful, exactly as before. `POST /mcp` with an `initialize` body issues an
  `Mcp-Session-Id`; the client re-sends it on every subsequent request; `GET /mcp` opens the
  server-to-client SSE stream and `DELETE /mcp` terminates the session.

**This applies to the HTTP transport only.** A stdio connection (`npx crawlforge-mcp-server`,
the default for desktop clients) negotiates the 2025 era through `initialize` exactly as it always
has; `server/discover` over stdio answers `-32601`.

**A minimal 2026-07-28 call:**

    POST /mcp HTTP/1.1
    Authorization: Bearer <crawlforge-api-key>
    Content-Type: application/json
    Accept: application/json, text/event-stream
    Mcp-Method: tools/call
    Mcp-Name: scrape

    {
      "jsonrpc": "2.0",
      "id": 1,
      "method": "tools/call",
      "params": {
        "_meta": {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { "name": "my-client", "version": "1.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {}
        },
        "name": "scrape",
        "arguments": { "url": "https://example.com", "formats": ["markdown"] }
      }
    }

**Validation the endpoint enforces** (all of it the SDK's; none of it re-implemented here):

| Condition | Answer |
|---|---|
| `Content-Type` is not `application/json` on a modern POST | `415`, `-32000` |
| `Mcp-Method` absent, or naming a different method than the body | `400`, `-32020` `HeaderMismatch` |
| `Mcp-Name` absent or naming a different tool than `params.name` | `400`, `-32020` `HeaderMismatch` |
| Envelope names a revision this server does not serve | `400`, unsupported-protocol-version |

Each of these is refused before the tool runs, so a rejected request is never billed.

**Auth is identical on both eras and runs before era routing.** Every request needs
`Authorization: Bearer <api-key-or-oauth-token>` or `X-API-Key`; a keyless request receives the
same `401` body whichever era it claims. Creator mode (loopback only) and the internal-proxy
`X-Internal-Secret` path behave the same on both legs.

**Server-to-client requests are not available on the 2026-07-28 era.** The revision has no
server-to-client request channel, so `elicitation/create`, `sampling/createMessage` and
`roots/list` cannot be *sent* while serving a modern request. Confirmations do not go unasked
there: a gated tool **returns** an `input_required` result and the client fulfils it. Sampling and
`roots/list` have no such replacement in use here and degrade. See section 9.

**`server/discover` cache hint (SEP-2549).** The discover result is the same for every caller and
only changes on redeploy, so it carries `"ttlMs": 300000, "cacheScope": "public"`:

    {
      "supportedVersions": ["2026-07-28"],
      "capabilities": { "tools": { "listChanged": true }, "prompts": {…}, "resources": {…} },
      "instructions": "CrawlForge: metered web tools (credits per call)…",
      "ttlMs": 300000,
      "cacheScope": "public"
    }

**Health probe.** `GET /health` reports every revision the endpoint serves, newest first:

    { "status": "ok", "version": "6.0.0", "mode": "streamable-stateful",
      "protocolVersions": ["2026-07-28","2025-11-25","2025-06-18","2025-03-26","2024-11-05","2024-10-07"] }

**`CRAWLFORGE_LEGACY_HTTP` / `--legacy-http` are gone.** The v3.1 stateless HTTP mode was kept
behind that flag for one release and has now been removed. Nothing needs to change for callers:
2025-era clients are served by the sessionful path, which is the default and always was.

---

## 9. Elicitation and Sampling under the 2026-07-28 revision

**Status: adopted. Confirmations are multi-round-trip `input_required` returns and serve both
eras from one code path.**

SEP-2577 removed the server→client request channel. Under the 2026-07-28 revision a server no
longer *sends* `elicitation/create` or `sampling/createMessage`; a `tools/call`, `prompts/get`
or `resources/read` handler instead **returns** an `input_required` result carrying the embedded
requests, the client fulfils them, and the client retries the original call with the answers
attached. SDK v2 ships both halves — `inputRequired()` builds the result,
`acceptedContent()` / `inputResponse()` read an answer back off `ctx.mcpReq.inputResponses` on
re-entry — plus a default-on **legacy shim** (`maxRounds: 8`, `roundTimeoutMs: 600_000`) that
fulfils an `input_required` return on a 2025-era connection by issuing the real server→client
request itself and re-entering the handler. One return serves both eras, which is why nothing in
CrawlForge branches on the protocol revision to decide how to ask.

**What CrawlForge does.** Five tools (`deep_research`, `batch_scrape`, `agent`, `crawl_deep`,
`extract_structured`) and the low-credit check in `AuthManager` confirm through
`ElicitationHelper.confirm(ctx, key, message, details)`. It is synchronous and sends nothing. It
returns one of three verdicts: `proceed` (the client cannot be asked, or the user accepted),
`cancelled` (declined, cancelled, or answered `confirmed: false`), or `ask` — whose `result` the
tool **returns verbatim**. `server.js` recognises it with `isInputRequiredResult()` and passes it
to the transport unwrapped, because it is the SDK's result shape rather than a tool payload.

**The handler is re-entered, so gates sit above the work.** Everything a tool does above its gate
runs a second time when the answer arrives. Each of the five gates is therefore placed above every
network fetch and every side effect; where that meant moving one (`batch_scrape` registered its
webhook above the old gate; `extract_structured` gated after the page fetch), it was moved.

**Billing: a round trip is free.** An `input_required` result is not `isError`, so without a branch
for it `withAuth` would book it a success, charge in full and report usage — then the shim
re-enters and it bills again, up to eight rounds, for a call that fetched nothing, and a declined
confirmation would be billed too. `withAuth` detects the return, sets outcome `input_required`,
charges nothing and reports no usage; whichever entry finally produces a real result bills once, at
the price the call always had. `_cost.projected` therefore remains a true ceiling (G4).

**Client capability, and why the gate is not cosmetic.** The SDK's canonical rule counts a bare
`elicitation: {}` declaration as declaring `elicitation.form` — the pre-mode 2025 meaning — while a
client declaring only `elicitation.url` has not declared form support. CrawlForge applies that rule
before asking, and a client that declared nothing is not asked. That gate is load-bearing: the SDK
answers an `input_required` return on such a connection with `isError: true` ("the client on this
2025-era connection did not declare the required capability"), so dropping it would convert a
nicety into a failed billed call. Verified against the SDK, not inferred.

**We ask at most once.** `ctx.mcpReq.inputResponses` is absent on a first entry and present on a
retry. A retry whose answer for this key did not survive — a dropped entry, or a response of
another kind — proceeds rather than asking again, which would burn the shim's rounds and end in a
failed call.

**The one case that degrades.** A client that *declares* elicitation and then throws while
answering yields an `isError` result from the SDK, where the old inline path proceeded. The failure
happens inside the SDK after the handler has returned, so nothing in CrawlForge can intercept it.
It costs the caller nothing: the handler did no work, so the charge is zero.

**Capabilities are read from the right place per era.** A 2026-era request carries the client's
capabilities per-request in the `_meta` envelope
(`ctx.mcpReq.envelope['io.modelcontextprotocol/clientCapabilities']`) and has no connected server
instance to interrogate. A 2025-era connection has them on the serving instance and no envelope.
`ElicitationHelper` consults the envelope first and falls back to the instance.

**HTTP transport.** Elicitation works on both transports — but it did not until this release.

Neither HTTP leg serves from the template `McpServer` that `server.js` registers its tools on: the
2025-era path connects one clone per session and the modern leg builds one per request (see
`cloneServerForSession` in `src/server/transports/streamableHttp.js`). Only a clone is ever
`.connect()`ed, so only a clone has a negotiated protocol version, the client's declared
capabilities, and a channel to send on. The template has none of those, which is why a helper
reading them off it saw `undefined` on every HTTP request and reported `supported: false` — from
v3.2.0 until this release, every HTTP session proceeded unasked. It failed safe: no throw, no
mis-bill, no failed call, and so nothing surfaced it.

Both legs now stamp the serving clone and its wire era on the per-request `AsyncLocalStorage`
context (`setServingServer` in `src/server/requestContext.js`), and `ElicitationHelper` resolves
`servingServer() ?? <constructor-injected instance>`. The fallback is the stdio case, where the
top-level instance is the connected one and behaviour is unchanged.

**`requestString()` is unconverted, and unreached.** It is the one elicitation path no tool calls.
It keeps the inline 2025-era form and the era guard `confirm()` shed, so on a 2026-era connection
it returns its default rather than failing. Converting it is speculative until something calls it.

**Sampling.** `SamplingClient`'s chain is unchanged: Ollama, then a server-side
`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`, then MCP sampling. SEP-2577 deprecated Sampling on
2026-07-28 and the spec keeps it for at least twelve months, so the third rung is removed **on
or after 2027-07-28**. When it serves a completion it now writes one deprecation line to stderr
naming that date. Configure Ollama or a server-side key and the rung is never reached.
