# CrawlForge CLI Usage Guide

The `crawlforge` CLI exposes all 23 MCP tools as command-line subcommands.

## Installation

```bash
npm install -g crawlforge-mcp-server
# or run without installing:
npx crawlforge-mcp-server <command>
```

## Global Flags

All commands support these flags:
- `--json` — output compact JSON
- `--pretty` — output pretty-printed JSON
- `--quiet` — suppress output (exit code only)
- `--api-key <key>` — override CRAWLFORGE_API_KEY env var
- `--timeout <ms>` — global request timeout (default: 30000)

## Commands

### scrape — Fetch a URL
```bash
crawlforge scrape https://example.com
crawlforge scrape https://example.com --extract --format markdown
crawlforge scrape https://example.com --pretty
```

### search — Search the web
```bash
crawlforge search "MCP server tutorial" --limit 10
crawlforge search "nodejs scraping" --provider searxng --json
```

### crawl — Deep website crawl
```bash
crawlforge crawl https://docs.example.com --depth 3 --max-pages 200
crawlforge crawl https://example.com --no-robots --concurrency 20
```

### map — Generate sitemap
```bash
crawlforge map https://example.com --pretty
crawlforge map https://example.com --format xml > sitemap.xml
```

### extract — Structured data extraction
```bash
# Schema-based extraction
crawlforge extract https://example.com/product --schema product-schema.json

# LLM-guided extraction
crawlforge extract https://example.com/article --prompt "extract title, author, date, summary"
```

### track — Track content changes
```bash
crawlforge track https://example.com --threshold 10
crawlforge track https://example.com --selector ".main-content"
```

### analyze — Content analysis
```bash
crawlforge analyze https://example.com --depth full --pretty
```

### research — Deep research
```bash
crawlforge research "state of AI in 2025" --depth deep --max-urls 30
crawlforge research "competitor pricing" --output-format detailed --json
```

### stealth — Anti-bot scraping
```bash
crawlforge stealth https://protected-site.com
crawlforge stealth https://protected-site.com --engine camoufox --screenshot
```

### batch — Batch scrape from file
```bash
# Create a URLs file:
cat > urls.txt << EOF
https://example.com/page1
https://example.com/page2
https://example.com/page3
EOF

crawlforge batch urls.txt --format markdown --concurrency 10
```

### actions — Browser automation
```bash
# Create an actions script:
cat > login.json << EOF
[
  { "type": "click", "selector": "#login-btn" },
  { "type": "type", "selector": "#email", "text": "user@example.com" },
  { "type": "wait", "duration": 1000 }
]
EOF

crawlforge actions https://example.com --script login.json --screenshot
```

### localize — Geo-targeted fetch
```bash
crawlforge localize https://example.com --locale fr-FR --country FR
crawlforge localize https://shop.example.com --locale en-GB --currency GBP
```

### llmstxt — Generate llms.txt
```bash
crawlforge llmstxt https://example.com
crawlforge llmstxt https://example.com --include-full > llms.txt
```

### template — Pre-built site scrapers
```bash
crawlforge template github-repo https://github.com/owner/repo
crawlforge template amazon-product https://amazon.com/dp/B0XXXXX
crawlforge template npm-package https://npmjs.com/package/commander
crawlforge template --list  # list all available templates
```

### monitor — Continuous change monitoring
```bash
crawlforge monitor https://example.com --interval 60 --webhook https://my-site.com/hook
crawlforge monitor https://example.com --selector ".price" --threshold 1
```

### install-skills — Install AI assistant skills
```bash
crawlforge install-skills --target claude-code
crawlforge install-skills --target cursor --force
crawlforge install-skills --target all --dry-run
```

### uninstall-skills — Remove AI assistant skills
```bash
crawlforge uninstall-skills --target claude-code
crawlforge uninstall-skills --target all
```

## Output Piping Examples

```bash
# Extract markdown and save to file
crawlforge scrape https://example.com --extract --format markdown > page.md

# Search and parse with jq
crawlforge search "nodejs MCP" --json | jq '.results[].url'

# Batch scrape and process results
crawlforge batch urls.txt --json | jq '.results | length'
```
