# Using CrawlForge with n8n

CrawlForge works with [n8n](https://n8n.io) out of the box. There are two supported connection paths — pick the one that matches your n8n deployment:

| | Transport | n8n Cloud | Self-hosted n8n | n8n node |
|---|---|---|---|---|
| **Option A (recommended)** | Streamable HTTP | ✅ | ✅ | Built-in [MCP Client Tool](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp) |
| **Option B** | STDIO | ❌ | ✅ | Community [`n8n-nodes-mcp`](https://github.com/nerding-io/n8n-nodes-mcp) |

> **Note on SSE:** n8n's client also offers a deprecated "SSE" transport. CrawlForge implements the modern **Streamable HTTP** transport (MCP spec 2025-03-26+), not the legacy HTTP+SSE transport — always select **HTTP Streamable** in n8n, not SSE.

Both paths require a CrawlForge API key ([free signup, 1,000 trial credits](https://www.crawlforge.dev/signup)). Tool calls consume credits exactly as they do from any other MCP client.

---

## Option A: Streamable HTTP (built-in MCP Client Tool node)

### 1. Run CrawlForge in HTTP mode

```bash
export CRAWLFORGE_API_KEY=your_api_key
npm run start:http        # equivalent to: node server.js --http
```

Or with Docker (the published image runs HTTP mode by default):

```bash
docker run -p 10000:10000 --rm \
  -e CRAWLFORGE_API_KEY=your_api_key \
  crawlforge:latest
```

The server listens on `$PORT` (default **10000**) and exposes:

| Endpoint | Purpose |
|---|---|
| `POST/GET/DELETE /mcp` | MCP Streamable HTTP endpoint (stateful sessions via `Mcp-Session-Id`) |
| `GET /health` | Health check — `{"status":"ok","version":...,"mode":"streamable-stateful"}` |
| `GET /metrics` | Prometheus metrics (when `CRAWLFORGE_METRICS=true`) |

### 2. Configure the n8n node

In your workflow, add an **AI Agent** node, then attach an **MCP Client Tool** sub-node:

- **Endpoint**: `http://<your-host>:10000/mcp`
- **Server Transport**: `HTTP Streamable`
- **Authentication**: `Bearer` — create a credential whose token is the **same API key the server was started with** (`CRAWLFORGE_API_KEY`). A generic-header credential with `X-API-Key: <key>` also works.
- **Tools to Include**: `All`, or cherry-pick (e.g. just `scrape`, `search_web`, `extract_content`) to keep the agent's tool list focused.

n8n will discover all 27 tools automatically via `tools/list`.

### 3. Security notes

- The HTTP endpoint authenticates every request, but against a **single shared static key** (the server's own configured API key) — it is not multi-tenant.
- CORS is `Access-Control-Allow-Origin: *`.
- For n8n Cloud the endpoint must be reachable from the internet: put it behind a TLS reverse proxy (Caddy, nginx, Cloudflare Tunnel) or a private tunnel/VPN. Do not expose the bare HTTP port publicly.
- Requests without a valid key get `401`. If the server was started **without** any API key configured, every `/mcp` request 401s until one is set.

---

## Option B: STDIO (community node, self-hosted n8n only)

1. Install the community package **`n8n-nodes-mcp`** (Settings → Community Nodes).
2. Allow community nodes as AI Agent tools — set on the n8n instance:

   ```bash
   N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true
   ```

3. Create an **MCP Client (STDIO)** credential:
   - **Command**: `npx`
   - **Arguments**: `-y crawlforge-mcp-server`
   - **Environment**: `CRAWLFORGE_API_KEY=your_api_key`

Requirements: the n8n host/container needs **Node.js ≥ 20.16** and outbound network access to `crawlforge.dev` (the server validates the API key at startup).

---

## Verifying the connection

```bash
# Health
curl http://localhost:10000/health

# MCP initialize handshake (what n8n does under the hood)
curl -i -X POST http://localhost:10000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
```

A successful initialize returns the server info plus an `Mcp-Session-Id` response header.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `401 missing-credentials` / `invalid-credentials` | Bearer token doesn't match the server's configured `CRAWLFORGE_API_KEY`, or the server has no key configured. |
| `404 Session not found` | The server restarted and the old `Mcp-Session-Id` is gone — n8n re-initializes automatically on the next run. |
| Connection works but n8n shows no tools | You selected the deprecated **SSE** transport — switch to **HTTP Streamable**. CrawlForge has no legacy `/sse` endpoint. |
| Server exits at startup | The API key failed validation against crawlforge.dev (or no network). Fix the key; for air-gapped starts with an already-saved config, `CRAWLFORGE_SKIP_STARTUP_VALIDATION=true` skips the startup re-validation. |
| Tool calls fail with "CrawlForge not configured" | Server started with no API key — set `CRAWLFORGE_API_KEY` and restart. |
