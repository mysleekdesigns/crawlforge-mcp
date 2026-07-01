# Registry & Directory Submission Guide

How to list CrawlForge MCP Server in the official MCP registry and the community
`awesome-mcp-servers` directories. This drives discovery from MCP clients and from Google.

- **GitHub repo:** `mysleekdesigns/crawlforge-mcp`
- **npm package:** `crawlforge-mcp-server`
- **Registry namespace:** `io.github.mysleekdesigns/crawlforge-mcp-server`

---

## A. Official MCP Registry (`registry.modelcontextprotocol.io`)

The canonical, machine-readable registry. The repo already contains the two required pieces:

- `package.json` → `"mcpName": "io.github.mysleekdesigns/crawlforge-mcp-server"`
- `server.json` (repo root) — validated against the `2025-12-11` schema.

> **Keep versions in sync on every release:** bump `version` in both `package.json` and
> `server.json` to the same published npm version, then re-run `mcp-publisher publish`.
> Publish the npm package *before* publishing to the registry.

### Publish (maintainer runs these — `login` opens a browser)

```bash
# 1. Install the mcp-publisher CLI
#    Option A — Homebrew:        brew install mcp-publisher
#    Option B — build from source: git clone https://github.com/modelcontextprotocol/registry
#               cd registry && make publisher && cp bin/mcp-publisher /usr/local/bin/
mcp-publisher --help

# 2. From the repo root (where server.json lives):
mcp-publisher init        # validates / refreshes server.json
mcp-publisher login github   # GitHub OAuth — proves ownership of the io.github.mysleekdesigns namespace
mcp-publisher publish
```

The `io.github.mysleekdesigns/...` namespace can only be published by authenticating as the
`mysleekdesigns` GitHub user (or via GitHub OIDC from this repo's Actions).

### Optional: automate on release (GitHub Actions + OIDC)

Add a workflow step after the npm publish step that runs `mcp-publisher publish` using GitHub
OIDC (no stored secret) so each tagged release updates the registry automatically.

---

## B. Community directories (`awesome-mcp-servers`)

### B1. punkpeye/awesome-mcp-servers (PR)

Fork → edit `README.md` → add the line below under the correct category (likely
**Web Scraping / Browser Automation**), keeping **alphabetical order**, then open a PR.
Check the README's current emoji legend and adjust the emojis to match it.

```
- [mysleekdesigns/crawlforge-mcp](https://github.com/mysleekdesigns/crawlforge-mcp) 📇 ☁️ 🏠 - 27-tool web scraping, crawling, deep-research & autonomous extraction; clean Markdown/JSON, local-Ollama LLM, stealth browsing, 1,000 free credits.
```

Legend reference (verify against the live README): 📇 TypeScript/JS · 🐍 Python · ☁️ Cloud
service · 🏠 Local/self-hostable.

### B2. appcypher/awesome-mcp-servers (PR)

Same flow as B1 — fork, add the same entry under the relevant section, open a PR.

### B3. wong2/awesome-mcp-servers — **no PRs**

Submit via the website instead: <https://mcpservers.org/submit>

### B4. mcp.so

Large directory — submit through <https://mcp.so/>.

---

## C. Pin the repo

GitHub profile → **Customize your pins** → select `crawlforge-mcp`.

---

## Suggested description (reuse everywhere)

> 27-tool MCP server for web scraping, crawling, deep research & autonomous extraction —
> clean Markdown & structured JSON for Claude, Cursor & any MCP client. 1,000 free credits,
> local-Ollama LLM support.
