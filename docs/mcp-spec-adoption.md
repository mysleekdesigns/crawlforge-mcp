# MCP Spec Adoption

CrawlForge implements the current MCP spec (2025-06-18) plus a small set of experimental
extensions from the spec-enhancement-proposal (SEP) pipeline. This document is the wire-level
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

**Which tools:** All 28 registered tools — this is a transport/SDK-level behavior change, not
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
    "cacheHint": { "ttlMs": 600000, "cacheScope": "session" }
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
whitelist which of the 28 registered tools are actually exposed over `tools/list` — useful for
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
