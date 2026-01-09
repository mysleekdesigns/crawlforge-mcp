#!/bin/bash
# Check documentation coverage for all 19 MCP tools
# Usage: ./check-coverage.sh [--verbose]

set -e

VERBOSE=${1:-""}
PROJECT_ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)

cd "$PROJECT_ROOT"

echo "=== CrawlForge Documentation Coverage Check ==="
echo "Project root: $PROJECT_ROOT"
echo ""

# Expected tools (19 total)
TOOLS=(
  "fetch_url"
  "extract_text"
  "extract_links"
  "extract_metadata"
  "scrape_structured"
  "search_web"
  "crawl_deep"
  "map_site"
  "extract_content"
  "process_document"
  "summarize_content"
  "analyze_content"
  "batch_scrape"
  "scrape_with_actions"
  "deep_research"
  "track_changes"
  "generate_llms_txt"
  "stealth_mode"
  "localization"
)

TOTAL=${#TOOLS[@]}
DOCUMENTED=0
UNDOCUMENTED=0
MISSING_TOOLS=()

# Check README.md
README_FILE="README.md"
if [ ! -f "$README_FILE" ]; then
  echo "Warning: README.md not found"
  echo ""
fi

# Check each tool
echo "Checking tool documentation in README.md and docs/..."
echo ""

for tool in "${TOOLS[@]}"; do
  # Check if tool is mentioned in README
  README_MENTION=$(grep -c "$tool" "$README_FILE" 2>/dev/null || echo "0")

  # Check if tool has dedicated docs
  DOCS_EXIST=0
  if [ -d "docs" ]; then
    DOCS_MENTION=$(grep -r "$tool" docs/ 2>/dev/null | wc -l | tr -d ' ')
    if [ "$DOCS_MENTION" -gt 0 ]; then
      DOCS_EXIST=1
    fi
  fi

  # Check if tool is registered in server.js
  SERVER_REGISTERED=$(grep -c "registerTool.*['\"]$tool['\"]" server.js 2>/dev/null || echo "0")

  if [ "$README_MENTION" -gt 0 ] || [ "$DOCS_EXIST" -eq 1 ]; then
    DOCUMENTED=$((DOCUMENTED + 1))
    if [ "$VERBOSE" = "--verbose" ]; then
      echo "  $tool: Documented (README: $README_MENTION, docs: $DOCS_EXIST)"
    fi
  else
    UNDOCUMENTED=$((UNDOCUMENTED + 1))
    MISSING_TOOLS+=("$tool")
    if [ "$VERBOSE" = "--verbose" ]; then
      echo "  $tool: NOT DOCUMENTED"
    fi
  fi

  # Check if tool is registered but not documented
  if [ "$SERVER_REGISTERED" -eq 0 ]; then
    echo "  Warning: $tool not found in server.js"
  fi
done

# Calculate coverage
COVERAGE=$((DOCUMENTED * 100 / TOTAL))

echo ""
echo "=== Coverage Summary ==="
echo "Total tools: $TOTAL"
echo "Documented: $DOCUMENTED"
echo "Undocumented: $UNDOCUMENTED"
echo "Coverage: $COVERAGE%"
echo ""

if [ ${#MISSING_TOOLS[@]} -gt 0 ]; then
  echo "=== Undocumented Tools ==="
  for tool in "${MISSING_TOOLS[@]}"; do
    echo "  - $tool"
  done
  echo ""
fi

# Check for required documentation files
echo "=== Documentation Files ==="
DOC_FILES=("README.md" "CLAUDE.md" "docs/api-reference.md" "docs/getting-started.md")

for doc in "${DOC_FILES[@]}"; do
  if [ -f "$doc" ]; then
    LINES=$(wc -l < "$doc" | tr -d ' ')
    echo "  $doc: $LINES lines"
  else
    echo "  $doc: NOT FOUND"
  fi
done
echo ""

# Final status
if [ "$COVERAGE" -ge 90 ]; then
  echo "Status: EXCELLENT ($COVERAGE% coverage)"
  exit 0
elif [ "$COVERAGE" -ge 70 ]; then
  echo "Status: GOOD ($COVERAGE% coverage)"
  exit 0
elif [ "$COVERAGE" -ge 50 ]; then
  echo "Status: NEEDS IMPROVEMENT ($COVERAGE% coverage)"
  exit 1
else
  echo "Status: POOR ($COVERAGE% coverage)"
  exit 1
fi
