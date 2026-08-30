# MCP Registry Publication

How CrawlForge MCP Server is listed in the official [MCP Registry](https://registry.modelcontextprotocol.io) — the
central, machine-readable directory that MCP clients (Claude Code, Claude Desktop, Cursor, etc.) can query to
discover and install servers.

## What `server.json` is

[`server.json`](../server.json) (repo root) is the metadata file the registry ingests. It declares:

- **`name`** — `io.github.mysleekdesigns/crawlforge-mcp-server`, the reverse-DNS registry namespace. This must exactly
  match the `mcpName` field already present in `package.json`; the registry uses that field to verify we actually own
  the npm package before it will accept a publish under this namespace.
- **`packages[0]`** — the npm package (`crawlforge-mcp-server`, registry type `npm`) with a `stdio` transport, since
  the server communicates over stdio (`npx crawlforge-mcp-server` with no arguments starts the MCP server directly —
  see `src/cli/index.js`).
- **`environmentVariables`** — `CRAWLFORGE_API_KEY` (required secret) plus `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD`
  (optional secrets, only needed to enable the `serp_rank` tool).
- **`version`** and `packages[0].version` — must stay in sync with the version actually published to npm
  (`package.json`'s `version`). The registry publish will fail if the referenced npm version doesn't exist yet.

It validates against the `2025-12-11` version of the official schema
(`https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`).

## How the CI workflow publishes on release

[`.github/workflows/publish-mcp-registry.yml`](../.github/workflows/publish-mcp-registry.yml) runs on:

- **`workflow_dispatch`** — manual trigger, for ad-hoc re-publishes (e.g. after fixing a registry-side rejection
  without cutting a new release).
- **`release: published`** — automatically whenever a GitHub Release is published on this repo.

Because the registry only hosts metadata (not artifacts), **the npm package must already be published at the target
version before this workflow runs** — publishing npm is a separate step/workflow, not part of this one. When
triggered by a release, the workflow first rewrites `server.json`'s `version` (and `packages[0].version`) to match the
release tag, then:

1. Downloads the `mcp-publisher` CLI release binary.
2. Authenticates to the registry via GitHub OIDC (`mcp-publisher login github-oidc`) — no stored secret needed; the
   registry trusts GitHub's OIDC token for the `mysleekdesigns` namespace since we authenticate as that GitHub org/user.
3. Runs `mcp-publisher publish`.

## Verifying a publish

`mcp-publisher publish` exiting 0 only means the registry accepted the request, so the workflow reads the version back
and fails if it does not match. To check by hand:

```bash
curl -sSf "https://registry.modelcontextprotocol.io/v0/servers?search=crawlforge-mcp-server&limit=100" \
  | jq -r '[ .servers[]
             | select(.server.name == "io.github.mysleekdesigns/crawlforge-mcp-server")
             | select(._meta["io.modelcontextprotocol.registry/official"].isLatest == true)
             | .server.version ] | first'
```

**The filter is not optional.** The registry keeps *every* published version as its own record under the same name — 23
of them as of 5.5.2 — and they are not ordered newest-last. Reading `.servers[0].server.version` returns `4.6.2`, a
version from June, which looks exactly like a publish that silently failed. Always filter to the exact `name` and then
take the record flagged `isLatest`.

`limit=100` is defensive headroom, not a current requirement — the default page returns all 23 records today, `isLatest`
among them. It is there because the record count grows by one every release and a page that silently truncates would
reintroduce exactly the failure above. Past 100 versions this query needs a cursor.

## Manual fallback

If the workflow is unavailable or a one-off publish is needed, run these locally from the repo root (requires a
GitHub account with `mysleekdesigns` namespace ownership):

```bash
# 1. Install the mcp-publisher CLI
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher
sudo mv mcp-publisher /usr/local/bin/

# 2. Interactive GitHub device-flow login (opens a browser prompt)
mcp-publisher login github

# 3. Publish server.json to the registry
mcp-publisher publish
```

## Prerequisites, every time

Before either the CI workflow or the manual fallback can succeed:

1. The npm package (`crawlforge-mcp-server`) must already be published at the version referenced in `server.json`.
2. That published npm manifest must contain the `mcpName` field matching `server.json`'s `name` — it does today
   (verified against the currently published `4.10.0` on `registry.npmjs.org`).

Skipping either of these causes `mcp-publisher publish` to fail registry-side ownership verification.

## Reference

- Registry docs and `mcp-publisher` source: <https://github.com/modelcontextprotocol/registry>
- `server.json` schema (2025-12-11): <https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json>
