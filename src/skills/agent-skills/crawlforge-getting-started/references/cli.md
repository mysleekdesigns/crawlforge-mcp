# CrawlForge CLI — Subcommand Summary

The `crawlforge` CLI exposes the tools as command-line subcommands for scripts,
CI, and pipelines.

## Install & auth

```bash
npm install -g crawlforge-mcp-server      # or: npx crawlforge-mcp-server <command>
export CRAWLFORGE_API_KEY="your_api_key_here"   # or pass --api-key per command
crawlforge init                            # detect key, install skills, merge MCP config
```

## Global flags

| Flag | Description |
|------|-------------|
| `--json` | Compact JSON output (pipe-friendly). |
| `--pretty` | Pretty-printed JSON. |
| `--quiet` | Suppress stdout (exit code only). |
| `--api-key <key>` | Override `CRAWLFORGE_API_KEY`. |
| `--timeout <ms>` | Request timeout (default 30000). |
| `--version` / `--help` | Version / help. |

## Tool commands (15)

| Command | Maps to | Example |
|---------|---------|---------|
| `scrape <url>` | fetch_url / extract_content | `crawlforge scrape https://example.com --extract --format markdown` |
| `search <query>` | search_web | `crawlforge search "MCP tutorial" --limit 5` |
| `crawl <url>` | crawl_deep | `crawlforge crawl https://docs.example.com --depth 3 --max-pages 200` |
| `map <url>` | map_site | `crawlforge map https://example.com --format xml` |
| `extract <url>` | extract_structured / extract_with_llm | `crawlforge extract <url> --prompt "title, author" --model llama3.2` |
| `track <url>` | track_changes | `crawlforge track <url> --selector ".price" --threshold 1` |
| `analyze <url>` | analyze_content | `crawlforge analyze <url> --depth full` |
| `research <topic>` | deep_research | `crawlforge research "AI trends 2025" --depth deep --max-urls 30` |
| `stealth <url>` | stealth_mode | `crawlforge stealth <url> --engine camoufox --screenshot` |
| `batch <file>` | batch_scrape | `crawlforge batch urls.txt --format markdown --concurrency 10` |
| `actions <url>` | scrape_with_actions | `crawlforge actions <url> --script flow.json --screenshot` |
| `localize <url>` | localization | `crawlforge localize <url> --locale fr-FR --country FR` |
| `llmstxt <url>` | generate_llms_txt | `crawlforge llmstxt <url> --include-full` |
| `template <id> <target>` | scrape_template | `crawlforge template github-repo https://github.com/owner/repo` |
| `monitor <url>` | track_changes (scheduled) | `crawlforge monitor <url> --interval 60 --webhook <url>` |

## Skill commands (2)

| Command | Purpose |
|---------|---------|
| `install-skills --target <claude-code\|cursor\|vscode\|all>` | Install skill files into your AI tool. |
| `uninstall-skills --target <...>` | Remove them. |

## Output modes

```bash
crawlforge search "nodejs MCP"                       # human-readable
crawlforge research "AI 2025" --pretty > report.json  # pretty JSON to file
crawlforge search "nodejs" --json | jq '.results[].url'  # compact JSON to jq
crawlforge scrape https://example.com --quiet && echo ok  # exit code only
```

## Relevant env vars

| Variable | Purpose |
|----------|---------|
| `CRAWLFORGE_API_KEY` | API key (required for production). |
| `OLLAMA_BASE_URL` | Ollama server (default http://localhost:11434). |
| `OLLAMA_DEFAULT_MODEL` | Default model for `extract`. |
| `CRAWLFORGE_STEALTH_ENGINE` | Force `playwright` or `camoufox`. |
| `CRAWLFORGE_BROWSER_BACKEND` | `local` or `browserbase`. |

Exit code 0 = success, 1 = error. `crawlforge <command> --help` for per-command help.
