# CrawlForge CLI Guide

Complete reference for the `crawlforge` command-line interface.

## Installation

```bash
# Global install (recommended)
npm install -g crawlforge-mcp-server

# One-off usage without installing
npx crawlforge-mcp-server <command>
```

After installing, set your API key:
```bash
export CRAWLFORGE_API_KEY="your_api_key_here"
# Or use the --api-key flag per command
```

## Global Flags

All commands accept these flags:

| Flag | Description |
|------|-------------|
| `--json` | Output compact JSON |
| `--pretty` | Output pretty-printed JSON |
| `--quiet` | Suppress all stdout output (exit code only) |
| `--api-key <key>` | Override `CRAWLFORGE_API_KEY` env var |
| `--timeout <ms>` | Global request timeout (default: 30000) |
| `--version` | Print CLI version |
| `--help` | Print help |

## Tool Commands (15)

### scrape

Fetch a URL and return its content.

```bash
crawlforge scrape <url> [options]

Options:
  --extract           Use extract_content for cleaned text/markdown
  --format <format>   Output format: text, markdown, html (default: text)
  --timeout <ms>      Request timeout in milliseconds

Examples:
  crawlforge scrape https://example.com
  crawlforge scrape https://example.com --extract --format markdown
  crawlforge scrape https://example.com --pretty > page.json
```

Without `--extract`: calls `fetch_url` (returns raw headers + body).
With `--extract`: calls `extract_content` (returns cleaned content).

---

### search

Search the web.

```bash
crawlforge search <query> [options]

Options:
  --limit <n>      Number of results (default: 10)
  --lang <lang>    Language code (default: en)
  --provider <p>   Search provider: crawlforge or searxng (default: crawlforge)
  --no-safe-search Disable safe search

Examples:
  crawlforge search "MCP server tutorial" --limit 5
  crawlforge search "nodejs scraping" --provider searxng --json
  crawlforge search "openai API" --lang fr
```

---

### crawl

Deep crawl a website following links.

```bash
crawlforge crawl <url> [options]

Options:
  --depth <n>        Maximum crawl depth, 1-5 (default: 3)
  --max-pages <n>    Maximum pages to crawl (default: 100)
  --no-robots        Ignore robots.txt
  --follow-external  Follow links to external domains
  --concurrency <n>  Concurrent requests, 1-20 (default: 10)

Examples:
  crawlforge crawl https://docs.example.com --depth 2 --max-pages 50
  crawlforge crawl https://example.com --no-robots --concurrency 20 --json
```

---

### map

Generate a sitemap for a website.

```bash
crawlforge map <url> [options]

Options:
  --depth <n>       Maximum crawl depth (default: 3)
  --max-pages <n>   Maximum pages to include (default: 500)
  --format <fmt>    Output format: json or xml (default: json)

Examples:
  crawlforge map https://example.com --pretty
  crawlforge map https://example.com --format xml > sitemap.xml
  crawlforge map https://example.com --depth 2 --json
```

---

### extract

Extract structured data from a URL.

```bash
crawlforge extract <url> [options]

Options:
  --schema <file>    JSON schema file for structured extraction (uses extract_structured)
  --prompt <text>    Natural language prompt for LLM extraction (uses extract_with_llm)
  --model <model>    LLM model name (Ollama model or openai/anthropic)

Examples:
  # Schema-based extraction
  crawlforge extract https://example.com/product --schema ./product-schema.json

  # LLM-guided extraction
  crawlforge extract https://example.com/article --prompt "extract title, author, date, and summary"

  # With specific model
  crawlforge extract https://example.com --prompt "get all prices" --model llama3.2
```

Requires either `--schema` or `--prompt`. Without one, the command exits with an error.

---

### track

Track content changes on a URL.

```bash
crawlforge track <url> [options]

Options:
  --selector <css>    CSS selector to scope change tracking
  --threshold <pct>   Change threshold percentage 0-100 (default: 5)

Examples:
  crawlforge track https://example.com --threshold 10
  crawlforge track https://example.com --selector ".main-content"
  crawlforge track https://pricing.example.com --selector ".price" --threshold 1 --json
```

---

### analyze

Analyze content of a URL (sentiment, entities, readability).

```bash
crawlforge analyze <url> [options]

Options:
  --depth <level>   Analysis depth: basic or full (default: basic)

Examples:
  crawlforge analyze https://example.com
  crawlforge analyze https://blog.example.com/article --depth full --pretty
```

---

### research

Conduct deep research on a topic using multiple web sources.

```bash
crawlforge research <topic> [options]

Options:
  --depth <level>         Research depth: basic, standard, or deep (default: standard)
  --max-urls <n>          Maximum URLs to analyze (default: 20)
  --output-format <fmt>   Output format: summary or detailed (default: summary)

Examples:
  crawlforge research "React vs Vue in 2025"
  crawlforge research "competitor pricing analysis" --depth deep --max-urls 30
  crawlforge research "MCP protocol" --output-format detailed --json > report.json
```

Note: When `max_urls > 50`, the tool triggers an elicitation asking for confirmation.

---

### stealth

Scrape a URL using stealth/anti-bot browser mode.

```bash
crawlforge stealth <url> [options]

Options:
  --engine <engine>   Browser engine: playwright or camoufox (default: playwright)
  --wait <ms>         Wait time after page load in ms (default: 2000)
  --screenshot        Capture a screenshot

Examples:
  crawlforge stealth https://protected-site.com
  crawlforge stealth https://example.com --engine camoufox --wait 3000
  crawlforge stealth https://example.com --screenshot --pretty
```

Use `camoufox` for sites with DataDome, Cloudflare, or PerimeterX protection.

---

### batch

Scrape multiple URLs from a newline-delimited file.

```bash
crawlforge batch <urls-file> [options]

Options:
  --format <fmt>       Output format: text, markdown, html (default: markdown)
  --concurrency <n>    Concurrent requests (default: 5)
  --max-retries <n>    Maximum retries per URL (default: 2)

Examples:
  # Create URLs file
  printf "https://example.com/page1\nhttps://example.com/page2\n" > urls.txt

  crawlforge batch urls.txt
  crawlforge batch urls.txt --format markdown --concurrency 10
  crawlforge batch urls.txt --json | jq '.results | length'
```

Lines starting with `#` are ignored as comments.

---

### actions

Run browser automation actions against a URL.

```bash
crawlforge actions <url> --script <file> [options]

Options:
  --script <file>    JSON file containing action script (required)
  --screenshot       Capture screenshot after actions
  --wait <ms>        Wait time between actions in ms (default: 500)

Action script format:
[
  { "type": "click", "selector": "#button" },
  { "type": "type", "selector": "#input", "text": "hello" },
  { "type": "wait", "duration": 1000 },
  { "type": "scroll", "x": 0, "y": 500 }
]

Examples:
  crawlforge actions https://example.com --script ./login.json
  crawlforge actions https://example.com --script ./flow.json --screenshot --pretty
```

---

### localize

Fetch a URL with locale/geo-aware settings.

```bash
crawlforge localize <url> [options]

Options:
  --locale <locale>    Locale code (default: en-US)
  --country <code>     Country code for geo-targeting (e.g. US, FR)
  --currency <code>    Currency code (e.g. USD, EUR)

Examples:
  crawlforge localize https://example.com --locale fr-FR --country FR
  crawlforge localize https://shop.example.com --locale en-GB --currency GBP
  crawlforge localize https://example.com --locale de-DE --json
```

---

### llmstxt

Generate llms.txt for a website (AI compliance file).

```bash
crawlforge llmstxt <url> [options]

Options:
  --include-full      Also generate llms-full.txt content
  --max-pages <n>     Maximum pages to analyze (default: 50)

Examples:
  crawlforge llmstxt https://example.com
  crawlforge llmstxt https://example.com --include-full > llms.txt
  crawlforge llmstxt https://docs.example.com --max-pages 100 --pretty
```

---

### template

Scrape a URL using a pre-built site template.

```bash
crawlforge template <id> <target> [options]

Options:
  --list   List all available templates

Available templates:
  amazon-product, linkedin-profile, github-repo, youtube-video,
  tweet, reddit-thread, hacker-news-front-page, producthunt-launch,
  stackoverflow-question, npm-package

Examples:
  crawlforge template github-repo https://github.com/owner/repo
  crawlforge template amazon-product https://amazon.com/dp/B0XXXXX --pretty
  crawlforge template npm-package https://npmjs.com/package/commander --json
  crawlforge template --list
```

---

### monitor

Continuously monitor a URL for content changes (scheduled mode).

```bash
crawlforge monitor <url> [options]

Options:
  --interval <seconds>   Check interval in seconds (default: 300)
  --selector <css>       CSS selector to scope monitoring
  --webhook <url>        Webhook URL to notify on changes
  --threshold <pct>      Change threshold percentage 0-100 (default: 5)

Examples:
  crawlforge monitor https://example.com --interval 60
  crawlforge monitor https://example.com --selector ".price" --threshold 1
  crawlforge monitor https://example.com --webhook https://my-site.com/notify
```

Note: This command runs indefinitely. Use Ctrl+C to stop.

---

## Skills Commands (2)

### install-skills

Install CrawlForge skill files into your AI coding tool.

```bash
crawlforge install-skills [options]

Options:
  --target <target>   claude-code, cursor, vscode, or all (default: all)
  --force             Overwrite existing skill files
  --dry-run           Preview what would be installed without writing

Targets:
  claude-code  Copies skill files to ~/.claude/skills/crawlforge-*.md
  cursor       Creates .cursor/rules/crawlforge.mdc (concatenated)
  vscode       Creates .github/instructions/crawlforge.instructions.md (concatenated)

Examples:
  crawlforge install-skills
  crawlforge install-skills --target claude-code
  crawlforge install-skills --target all --force
  crawlforge install-skills --target cursor --dry-run
```

---

### uninstall-skills

Remove CrawlForge skill files from your AI coding tool.

```bash
crawlforge uninstall-skills [options]

Options:
  --target <target>   claude-code, cursor, vscode, or all (default: all)

Examples:
  crawlforge uninstall-skills
  crawlforge uninstall-skills --target cursor
```

---

## Output Formatting

All commands support three output modes:

| Mode | Flag | Description |
|------|------|-------------|
| Human-readable | (default) | Formatted text output |
| Compact JSON | `--json` | Single-line JSON (pipe-friendly) |
| Pretty JSON | `--pretty` | Indented JSON |

Examples:
```bash
# Human-readable (default)
crawlforge search "nodejs MCP"

# Pretty JSON (save to file)
crawlforge research "AI trends 2025" --pretty > report.json

# Compact JSON (pipe to jq)
crawlforge search "nodejs" --json | jq '.results[].url'

# Quiet mode (just exit code)
crawlforge scrape https://example.com --quiet && echo "Success"
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CRAWLFORGE_API_KEY` | API key for CrawlForge.dev (required for production) |
| `CRAWLFORGE_CREATOR_SECRET` | Package maintainer secret (unlimited credits) |
| `CRAWLFORGE_CLI_TIMEOUT` | Default timeout in ms (set by `--timeout` flag) |
| `OLLAMA_BASE_URL` | Ollama server URL (default: http://localhost:11434) |
| `OLLAMA_DEFAULT_MODEL` | Default Ollama model for `extract` commands |
| `CRAWLFORGE_BROWSER_BACKEND` | Browser backend: local or browserbase |
| `BROWSERBASE_API_KEY` | BrowserBase API key (cloud browser backend) |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (tool failure, invalid arguments, or file not found) |

## Getting Help

```bash
# Show all commands
crawlforge --help

# Show help for a specific command
crawlforge scrape --help
crawlforge research --help
crawlforge install-skills --help
```

Get your API key at https://crawlforge.dev/signup (1,000 free credits included).
