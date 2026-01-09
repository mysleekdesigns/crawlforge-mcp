#!/bin/bash
# Check project progress and TODO status
# Usage: ./check-progress.sh [--verbose]

set -e

VERBOSE=${1:-""}
PROJECT_ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)

cd "$PROJECT_ROOT"

echo "=== CrawlForge MCP Server Progress Check ==="
echo "Project root: $PROJECT_ROOT"
echo "Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo ""

# Check version
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
echo "Current version: $VERSION"
echo ""

# Check git status
echo "=== Git Status ==="
BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "Branch: $BRANCH"

UNCOMMITTED=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [ "$UNCOMMITTED" -eq 0 ]; then
  echo "Working tree: Clean"
else
  echo "Working tree: $UNCOMMITTED uncommitted changes"
  if [ "$VERBOSE" = "--verbose" ]; then
    git status --short
  fi
fi

UNPUSHED=$(git log @{u}..HEAD --oneline 2>/dev/null | wc -l | tr -d ' ')
if [ "$UNPUSHED" -eq 0 ]; then
  echo "Unpushed commits: None"
else
  echo "Unpushed commits: $UNPUSHED"
fi
echo ""

# Check TODO/FIXME items in code
echo "=== Code TODOs ==="
TODO_COUNT=$(grep -r "TODO" --include="*.js" --include="*.ts" src/ 2>/dev/null | wc -l | tr -d ' ')
FIXME_COUNT=$(grep -r "FIXME" --include="*.js" --include="*.ts" src/ 2>/dev/null | wc -l | tr -d ' ')
echo "TODO items: $TODO_COUNT"
echo "FIXME items: $FIXME_COUNT"

if [ "$VERBOSE" = "--verbose" ] && [ "$TODO_COUNT" -gt 0 ]; then
  echo ""
  echo "TODO locations:"
  grep -rn "TODO" --include="*.js" --include="*.ts" src/ 2>/dev/null | head -10
fi
echo ""

# Check test status
echo "=== Test Status ==="
if [ -f "package.json" ] && grep -q '"test"' package.json; then
  echo "Test command: npm test"
  echo "Run 'npm test' to execute tests"
else
  echo "No test script found"
fi
echo ""

# Check PRODUCTION_READINESS.md
echo "=== Production Readiness ==="
if [ -f "PRODUCTION_READINESS.md" ]; then
  # Extract overall status
  STATUS=$(grep -m1 "Status:" PRODUCTION_READINESS.md 2>/dev/null | head -1 || echo "Unknown")
  echo "Status file: Found"
  echo "Current status: $STATUS"

  # Count completed items
  COMPLETED=$(grep -c "\\[x\\]" PRODUCTION_READINESS.md 2>/dev/null || echo "0")
  PENDING=$(grep -c "\\[ \\]" PRODUCTION_READINESS.md 2>/dev/null || echo "0")
  echo "Checklist: $COMPLETED completed, $PENDING pending"
else
  echo "PRODUCTION_READINESS.md: Not found"
fi
echo ""

# Check npm audit
echo "=== Security Status ==="
AUDIT_RESULT=$(npm audit --json 2>/dev/null | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8')).metadata?.vulnerabilities || {}" 2>/dev/null || echo "{}")
if [ "$AUDIT_RESULT" != "{}" ]; then
  echo "Vulnerabilities found (run 'npm audit' for details)"
else
  echo "No vulnerabilities detected (or npm audit unavailable)"
fi
echo ""

# Summary
echo "=== Summary ==="
echo "Version: $VERSION"
echo "Branch: $BRANCH"
echo "TODOs: $TODO_COUNT | FIXMEs: $FIXME_COUNT"
echo "Uncommitted: $UNCOMMITTED | Unpushed: $UNPUSHED"
