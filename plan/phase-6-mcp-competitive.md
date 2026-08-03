# Phase 6 — MCP-Spec Adoption & Competitive Roadmap

_Product **DECISIONS** required. This phase is opportunity, not defect repair — do it after Phases 0–4 land. Sources are in [`docs/CODEBASE_AUDIT_2026-08.md`](../docs/CODEBASE_AUDIT_2026-08.md). Part of the [remediation plan](./README.md)._

**Goal:** move CrawlForge from "spec-compliant 2025-06-18 server" to current MCP norms, and close the competitive gaps that are table-stakes for scraping/research MCP servers in mid-2026.

---

## Track A — Low-risk spec adoption (recommended, no product decision)

- [ ] **Emit `outputSchema` + `structuredContent`** on tools that return typed JSON (most of the 27). Structured output has been in-spec since 2025-06-18 and is now the norm; today CrawlForge returns JSON-as-text with no `outputSchema`. Start with the high-value structured tools: `scrape`, `map_site`, `serp_rank`, `search_web`, `extract_structured`, `crawl_deep`.
- [ ] **Surface input-validation (zod) failures as Tool Execution Errors, not Protocol Errors** (SEP-1303) — return `isError:true` content instead of throwing a `-32602`, so the calling model can self-correct on a bad `params`.
- [ ] **JSON Schema 2020-12 dialect** for tool schemas (default dialect as of rev 2025-11-25); CrawlForge currently emits draft-07.
- [ ] **Deterministic tool ordering** in `tools/list` (for client prompt-cache hits) and add **`CacheableResult` `ttlMs` + `cacheScope`** (SEP-2549) where supported.
- [ ] **Publish `server.json` to the official MCP Registry** (live, DNS/GitHub-verified namespace — the package already declares `mcpName: io.github.mysleekdesigns/crawlforge-mcp-server`). Free discovery/distribution.
- [ ] Add **icons metadata** (SEP-973) to tools/prompts/resources.

## Track B — Competitive features (each a DECISION)

Ranked by leverage. Every leading competitor (Firecrawl, Tavily, Exa, Bright Data) ships the top items.

- [ ] **Async task pattern** for the long tools (`crawl_deep`, `batch_scrape`, `deep_research`, `agent`) — return a task/job handle immediately + a poll endpoint, using the MCP `io.modelcontextprotocol/tasks` extension. Satisfies the spec's sanctioned async model **and** matches Firecrawl's `firecrawl_agent` + status-poll. Today `agent` (cost 8) blocks synchronously. **Highest-leverage item — do this one first if any.**
- [ ] **Client-side tool selection** — a `TOOLS` / `GROUPS` env whitelist (Bright Data & Exa both ship this) so clients can load a subset of the 27 tools and cut context bloat. Cheap, high UX value.
- [ ] **Hosted remote MCP endpoint with OAuth** — table-stakes vs `mcp.firecrawl.dev` / `mcp.tavily.com` / `mcp.exa.ai` / `mcp.brightdata.com`. Requires the Phase 4 transport rework + the Phase 1 OAuth fix as prerequisites. Larger initiative.
- [ ] **Keyless free hosted tier** (rate-limited) — Firecrawl & Bright Data both offer no-key/no-card entry; strong acquisition funnel. Product + billing decision.
- [ ] **Scheduled monitoring for `track_changes`** — recurring scrape/crawl + diff + plain-English "goal" change judgment + webhook/email alerts (Firecrawl `monitor_*`). Today `track_changes` is on-demand only; pairs naturally with the Phase 3 monitor-scheduler + `node-cron` 4 work.
- [ ] **Persistent interactive browser sessions** — continue against a session id (Firecrawl `interact`/`interact_stop`, Bright Data snapshot tools). `scrape_with_actions` is one-shot today.
- [ ] **Optional `redactPII: true`** flag on scrape/search outputs (Firecrawl parity).
- [ ] **A cheap vertical structured-data group** (e.g. npm/PyPI "code" tools) — loved by coding agents, low build cost; full marketplace (Apify-style) is out of scope.

## Track C — Long-horizon (its own initiative)

- [ ] **SDK v2 / MCP spec 2026-07-28 migration** — the scoped `@modelcontextprotocol/server@2.0` line implements the stateless core (`server/discover`), MRTR (replacing the `elicitation/create` + `sampling/createMessage` wire calls), and deprecates Roots/Sampling/Logging. It **requires Node ≥20 + zod 4**, so it depends on Phase 5. Use the official `@modelcontextprotocol/codemod` + migration guides. Rework `ElicitationHelper` for the MRTR `resultType:"input_required"` pattern and retire `SamplingClient`'s MCP-sampling path (its Ollama fallback already does the sanctioned "call the provider directly" thing). **Plan and scope this separately after 0–4 ship.**

### Verification gate (per adopted item)
- [ ] New capability exercised over a live MCP connection and covered by a test; `tools/list` and `initialize` still validate against the compliance suite; `npm run test:unit` + `npm test` green.
