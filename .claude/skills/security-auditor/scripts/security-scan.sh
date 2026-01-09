#!/bin/bash
# Security scan script for CrawlForge MCP Server
# Usage: ./security-scan.sh [--full] [--fix]

set -e

MODE=${1:-""}
PROJECT_ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)

cd "$PROJECT_ROOT"

echo "=== CrawlForge Security Scan ==="
echo "Project root: $PROJECT_ROOT"
echo "Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo ""

ISSUES=0
WARNINGS=0

# Run npm audit
echo "=== Dependency Vulnerabilities ==="
echo ""

if command -v npm &> /dev/null; then
  echo "Running npm audit..."
  AUDIT_OUTPUT=$(npm audit --json 2>/dev/null || echo '{"error": true}')

  if echo "$AUDIT_OUTPUT" | grep -q '"error": true'; then
    echo "  npm audit failed or no vulnerabilities found"
  else
    # Parse vulnerabilities
    CRITICAL=$(echo "$AUDIT_OUTPUT" | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8')).metadata?.vulnerabilities?.critical || 0" 2>/dev/null || echo "0")
    HIGH=$(echo "$AUDIT_OUTPUT" | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8')).metadata?.vulnerabilities?.high || 0" 2>/dev/null || echo "0")
    MODERATE=$(echo "$AUDIT_OUTPUT" | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8')).metadata?.vulnerabilities?.moderate || 0" 2>/dev/null || echo "0")
    LOW=$(echo "$AUDIT_OUTPUT" | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8')).metadata?.vulnerabilities?.low || 0" 2>/dev/null || echo "0")

    echo "  Critical: $CRITICAL"
    echo "  High: $HIGH"
    echo "  Moderate: $MODERATE"
    echo "  Low: $LOW"

    if [ "$CRITICAL" -gt 0 ] || [ "$HIGH" -gt 0 ]; then
      ISSUES=$((ISSUES + CRITICAL + HIGH))
    fi
    WARNINGS=$((WARNINGS + MODERATE + LOW))
  fi

  if [ "$MODE" = "--fix" ]; then
    echo ""
    echo "Attempting to fix vulnerabilities..."
    npm audit fix || echo "  Some vulnerabilities could not be auto-fixed"
  fi
else
  echo "  npm not available"
fi

echo ""

# Check for hardcoded secrets
echo "=== Hardcoded Secrets Check ==="
echo ""

SECRET_PATTERNS=(
  "api[_-]?key.*=.*['\"][a-zA-Z0-9]{20,}['\"]"
  "secret.*=.*['\"][a-zA-Z0-9]{20,}['\"]"
  "password.*=.*['\"][^'\"]+['\"]"
  "sk_live_[a-zA-Z0-9]+"
  "cf_live_[a-zA-Z0-9]+"
)

for pattern in "${SECRET_PATTERNS[@]}"; do
  MATCHES=$(grep -rn "$pattern" --include="*.js" --include="*.ts" src/ 2>/dev/null | grep -v "test" | grep -v "example" || echo "")
  if [ -n "$MATCHES" ]; then
    echo "  Potential secret found matching pattern: $pattern"
    if [ "$MODE" = "--full" ]; then
      echo "$MATCHES" | head -5
    fi
    WARNINGS=$((WARNINGS + 1))
  fi
done

echo "  Secrets check complete"
echo ""

# Check for dangerous patterns
echo "=== Dangerous Code Patterns ==="
echo ""

# Check for eval
EVAL_COUNT=$(grep -rn "eval(" --include="*.js" src/ 2>/dev/null | wc -l | tr -d ' ')
if [ "$EVAL_COUNT" -gt 0 ]; then
  echo "  Found $EVAL_COUNT use(s) of eval() - potential security risk"
  WARNINGS=$((WARNINGS + EVAL_COUNT))
fi

# Check for child_process exec without validation
EXEC_COUNT=$(grep -rn "exec(" --include="*.js" src/ 2>/dev/null | grep -v "ActionExecutor" | wc -l | tr -d ' ')
if [ "$EXEC_COUNT" -gt 0 ]; then
  echo "  Found $EXEC_COUNT use(s) of exec() - verify input validation"
  WARNINGS=$((WARNINGS + 1))
fi

# Check for SQL-like patterns (injection risk)
SQL_COUNT=$(grep -rn "SELECT.*FROM\|INSERT.*INTO\|DELETE.*FROM" --include="*.js" src/ 2>/dev/null | wc -l | tr -d ' ')
if [ "$SQL_COUNT" -gt 0 ]; then
  echo "  Found $SQL_COUNT SQL-like pattern(s) - verify parameterization"
  WARNINGS=$((WARNINGS + 1))
fi

echo ""

# Check SSRF protection
echo "=== SSRF Protection Check ==="
echo ""

if grep -q "SSRF" src/ -r 2>/dev/null || grep -q "isPrivateIP" src/ -r 2>/dev/null; then
  echo "  SSRF protection code found"
else
  echo "  Warning: No SSRF protection detected"
  WARNINGS=$((WARNINGS + 1))
fi

echo ""

# Check .env and config security
echo "=== Configuration Security ==="
echo ""

if [ -f ".gitignore" ]; then
  if grep -q "\.env" .gitignore; then
    echo "  .env is in .gitignore"
  else
    echo "  Warning: .env not in .gitignore"
    WARNINGS=$((WARNINGS + 1))
  fi
else
  echo "  Warning: No .gitignore file"
  WARNINGS=$((WARNINGS + 1))
fi

if [ -f ".env" ]; then
  echo "  Warning: .env file exists (ensure it's not committed)"
fi

echo ""

# Summary
echo "=== Security Scan Summary ==="
echo "Critical Issues: $ISSUES"
echo "Warnings: $WARNINGS"
echo ""

if [ "$ISSUES" -gt 0 ]; then
  echo "Status: FAILED - Critical issues found"
  exit 1
elif [ "$WARNINGS" -gt 5 ]; then
  echo "Status: WARNING - Multiple warnings found"
  exit 0
else
  echo "Status: PASSED"
  exit 0
fi
