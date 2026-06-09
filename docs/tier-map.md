# CrawlForge Tool Tier Map — Free-Local vs Paid-Server

**Status:** Proposal / decision input · **Drafted:** 2026-06-09
**Drives:** `TOOL_CREDIT_COSTS` (both repos), MCP-client routing, pricing-page copy, Stripe (no change).

## Why this exists

Today every tool runs **locally** in the MCP client (`crawlforge-mcp-server`) and the backend
only *meters* usage via a self-reported `/api/v1/usage` call. That makes 25 of 26 tools
trivially bypassable (delete one function, all tools run free) — see
`docs/api-bypass-analysis.md` / `docs/security-remediation-plan.md`.

The fix is not "meter harder" (unenforceable on the client) — it's to **move the tools whose
value is real infrastructure server-side**, and stop pretending to bill the cheap ones that
anyone can reimplement with `curl`. This doc assigns every tool a tier and gives the single
reconciled credit-cost table both repos should adopt.

Key enabling facts (verified in source):
- The backend **already has** 23 server-side tool routes scaffolded at
  `crawlforge-website/src/app/api/v1/tools/<tool>/route.ts` — auth, SSRF, `creditDeduction.deduct()`,
  and usage logging are wired. They currently call `simulate*` stubs
  (`fetch_url/route.ts:56`, comment line 139: *"would proxy to the actual CrawlForge MCP service"*).
- The real tool logic already exists, fully written, in `crawlforge-mcp-server/src/tools/*`.
  Migration = lift that code into the stubs, not write new engines.
- **Stripe sells credits, not tools.** Plans, webhooks, and credit packages are tool-agnostic
  (`crawlforge-website/src/lib/stripe/products.ts`, `.../webhooks/stripe/route.ts`). Re-tiering
  tools needs **zero** Stripe product/price/webhook changes.

---

## The two tiers

### Tier 0 — Free / Local (loss-leader, $0, runs on the user's machine)
Cheap, single-fetch or operate-on-provided-input, no CrawlForge infrastructure, and
**reimplementable in minutes anyway** — so charging for them buys nothing but support burden.
They stay in the npm client as a free, openly-inspectable adoption funnel. Key optional.

### Tier 1 — Paid / Server (metered, runs on CrawlForge backend)
Real marginal cost (proxy bandwidth, headless-browser CPU, Google CSE fees) **or** real IP
(anti-bot, residential proxy pool, scale orchestration). These **must** run server-side — that
is the only thing that makes the credit charge enforceable *and* delivers value the user
can't self-host. A "paid" tool still running locally is still bypassable, so **tier 1 ⇒ the
server-side migration is a prerequisite, not optional.**

---

## Tier assignment (all 26 tools)

| Tool | Tier | Why | Server-side today? |
|---|---|---|---|
| `fetch_url` | **0 Free-local** | Single GET. Zero IP — `curl` does it. | n/a (local) |
| `extract_text` | **0 Free-local** | fetch + cheerio/Readability. | n/a |
| `extract_links` | **0 Free-local** | fetch + parse. | n/a |
| `extract_metadata` | **0 Free-local** | fetch + parse. | n/a |
| `scrape_structured` | **0 Free-local** | fetch + CSS selectors. | n/a |
| `scrape_template` | **0 Free-local** | fetch + predefined selectors. | n/a |
| `extract_content` | **0 Free-local** | fetch + Readability. Same class as `extract_text`. | n/a |
| `scrape` (unified) | **0 Free-local\*** | Firecrawl-parity adoption tool: single fetch → markdown/html/links/metadata/text. **\*Exception:** `screenshot` format needs a server browser → route that format to Tier 1. | partial |
| `summarize_content` | **0 Free-local** | Operates on **provided `text`** (no fetch). Heuristic, or user's own LLM. | n/a |
| `analyze_content` | **0 Free-local** | Same — provided `text`, no infra. | n/a |
| `extract_with_llm` | **0 Free-local** | Uses the **user's own** LLM key / Ollama. Can't bill for compute you don't supply. | n/a |
| `extract_structured` | **0 Free-local** | Same class as `extract_with_llm` — user's own LLM (or local cheerio fallback). _(Confirmed 2026-06-09.)_ | n/a |
| `process_document` | **0 Free-local** | Parses a **user-provided** document (PDF/etc.). | n/a |
| `list_ollama_models` | **0 Free-local** | Local discovery. Already 0 credits. | n/a |
| `search_web` | **1 Paid-server** | **Already server-side.** Pays Google CSE per query. The model to copy. | ✅ live (`/api/v1/search`) |
| `stealth_mode` | **1 Paid-server** | Crown jewel: residential proxies + anti-bot browser. Highest COGS + real IP. | ❌ stub |
| `scrape_with_actions` | **1 Paid-server** | Headless-browser automation (Playwright farm). | ❌ stub |
| `crawl_deep` | **1 Paid-server** | Many fetches; needs proxy rotation + rate-limit mgmt at scale. | ❌ stub |
| `batch_scrape` | **1 Paid-server** | Bulk fetching; proxy pool + job queue. | ❌ stub |
| `get_batch_results` | **1 (free retrieval)** | Reads results of a paid batch job. Charge 0; gated to the job owner. | ❌ stub |
| `deep_research` | **1 Paid-server** | Orchestrates search (your infra) + multi-source fetch + synth. | ❌ stub |
| `agent` | **1 Paid-server** | Autonomous loop over search + fetch + LLM. Uses your search infra. | ❌ stub |
| `localization` | **1 Paid-server** | Geo-targeted fetching → needs geo/residential proxies. | ❌ stub |
| `map_site` | **1 Paid-server (light)** | Sitemap + crawl discovery. Cheaper than `crawl_deep` but still a crawl. | ❌ stub |
| `track_changes` | **1 Paid-server (light)** | Scheduled re-fetch + **snapshot persistence** (server storage = the value). | ❌ stub |
| `generate_llms_txt` | **1 Paid-server (light)** | Crawls a site to build llms.txt. The crawl is the cost. | ❌ stub |

**Borderline calls, stated explicitly:** `scrape` is deliberately Tier 0 (it's your Firecrawl
parity hook — keep it free to win adoption) except the browser-backed `screenshot` format.
`map_site` / `generate_llms_txt` / `track_changes` are "light" Tier 1 — they could be free-local
for tiny inputs, but they crawl/persist, so server-side is the honest home. If you'd rather
maximize the free funnel, `map_site` is the one most defensible to drop to Tier 0.

---

## Reconciled credit-cost table (single source of truth)

Both repos currently disagree (e.g. `search_web` is **2** in the client, **5** in the backend;
`stealth_mode` **10** vs **5**; `map_site` **5** vs **2**). Because `/api/v1/usage:69` does
`creditsUsed || getToolCreditCost(tool)`, the **client's** number bills today and the backend
table is a dead fallback. Adopt one table in **both** `crawlforge-mcp-server/src/core/AuthManager.js`
(`getToolCost`) and `crawlforge-website/src/lib/credits.ts` (`TOOL_CREDIT_COSTS`):

| Tool | Proposed credits | Client today | Backend today | Note |
|---|---|---|---|---|
| **Tier 0 (all free)** | **0** | 1–5 | 0–3 | Off the meter entirely. |
| `fetch_url` | 0 | 1 | 1 | |
| `extract_text` | 0 | 1 | 1 | |
| `extract_links` | 0 | 1 | 1 | |
| `extract_metadata` | 0 | 1 | 1 | |
| `scrape_structured` | 0 | 2 | 2 | |
| `scrape_template` | 0 | 1 | 1 | |
| `extract_content` | 0 | 3 | 2 | |
| `scrape` | 0 | 2 | — | +2 if `screenshot` format requested (server browser) |
| `summarize_content` | 0 | 2 | 4 | |
| `analyze_content` | 0 | 2 | 3 | |
| `extract_with_llm` | 0 | 5 | 3 | user's own LLM |
| `extract_structured` | 0 | 4 | 3 | user's own LLM (was missing from this table; confirmed Tier 0) |
| `process_document` | 0 | 3 | 2 | |
| `list_ollama_models` | 0 | 1 | 0 | |
| **Tier 1 (metered)** | | | | costs reflect COGS |
| `map_site` | 3 | 5 | 2 | scales with URLs discovered |
| `track_changes` | 3 | 3 | 3 | + snapshot storage |
| `generate_llms_txt` | 5 | 3 | 5 | scales with pages crawled |
| `search_web` | 5 | 2 | 5 | Google CSE fee — **keep at 5** |
| `crawl_deep` | 5 | 5 | 4 | scales with pages |
| `batch_scrape` | 5 | 5 | 5 | scales with URLs (per ~10) |
| `scrape_with_actions` | 5 | 5 | 5 | browser farm |
| `localization` | 5 | 5 | 2 | geo-proxy |
| `agent` | 8 | 8 | — | scales with maxUrls + pro tier |
| `deep_research` | 10 | 10 | 10 | scales with sources |
| `stealth_mode` | 10 | 10 | 5 | **raise to 10** — highest COGS |
| `get_batch_results` | 0 | 1 | — | retrieval of an already-paid job |

**COGS sanity check:** your overage packs price credits at $0.009 (hobby) → $0.003 (business)
(`products.ts` OVERAGE_PACKS). So a 10-credit `stealth_mode` call nets ~$0.03–$0.09 of revenue —
keep each Tier 1 tool's per-call infra cost (proxy bandwidth + browser-seconds + any LLM/CSE fee)
comfortably under that. `search_web` already proves the unit economics work.

---

## What changes, by surface

**Website API** (the real work — mostly finishing what's scaffolded):
1. Fill the `simulate*` stubs in the 10 Tier-1 `/api/v1/tools/*` routes with the real logic
   lifted from `crawlforge-mcp-server/src/tools/*`.
2. Keep deducting via the server cost table at the route (`creditDeduction.deduct(tool)`) —
   this makes the backend table authoritative and kills the client/backend drift.
3. Optionally retire the self-reported `/api/v1/usage` path for Tier-1 tools (no longer trusted).

**MCP client** (`crawlforge-mcp-server`):
1. Tier-0 tools: unchanged — keep running locally, set cost 0, make key optional.
2. Tier-1 tools: replace local execution with a thin POST to `/api/v1/tools/<tool>`.
3. Adopt the reconciled `getToolCost` table.

**Pricing:** re-cut `TOOL_CREDIT_COSTS` per above; update pricing-page copy to
"free local tools + metered premium tools." Plan credit allotments unchanged.

**Stripe:** **no change.** No new products/prices, no webhook edits, no DB migration.

**Cleanup while here:** reconcile plan naming — README advertises *Free / Starter / Professional /
Enterprise*, the live engine uses *free / hobby / professional / business*
(`products.ts`: $19→5k, $99→50k, $399→250k).

---

## Revenue consideration (the one number that decides the free/paid line)

Making Tier 0 free is "free" only if little current **paid** consumption comes from those tools —
that revenue was always uncollectable from anyone who edited one client file. If a large share
of paying usage is bulk `fetch_url`/`extract_text`, consider keeping a **managed/hosted** Tier-1
variant of those (your proxies, no local browser, higher reliability) as a paid convenience, and
let only the bare local versions be free. The deciding data lives in `UsageLog` /
`dashboard/usage` analytics — group `creditsUsed` by `tool` over the last 90 days before locking
the line.

---

## Suggested rollout order

1. **Reconcile the cost table** in both repos (zero behavior risk, kills drift). ← do first
2. **Flip Tier 0 to free** + key-optional in the client (instant DX win, adoption funnel).
3. **Migrate the crown jewels server-side first:** `stealth_mode`, `scrape_with_actions`,
   `batch_scrape` — highest value, highest current bypass loss.
4. Then `crawl_deep`, `deep_research`, `agent`, `localization`, `map_site`, `track_changes`,
   `generate_llms_txt`.
5. Update pricing copy + reconcile plan naming.
