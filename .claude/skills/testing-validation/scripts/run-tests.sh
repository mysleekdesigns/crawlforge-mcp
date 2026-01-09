#!/bin/bash
# Run test suite for CrawlForge MCP Server
# Usage: ./run-tests.sh [type]
# Types: all, unit, integration, mcp, tools

set -e

TEST_TYPE=${1:-all}
PROJECT_ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)

cd "$PROJECT_ROOT"

echo "=== CrawlForge MCP Server Test Runner ==="
echo "Test type: $TEST_TYPE"
echo "Project root: $PROJECT_ROOT"
echo ""

run_unit_tests() {
  echo "Running unit tests..."
  if [ -d "tests/unit" ]; then
    for test_file in tests/unit/*.test.js; do
      if [ -f "$test_file" ]; then
        echo "  Running: $test_file"
        node "$test_file" || echo "  Failed: $test_file"
      fi
    done
  else
    echo "  No unit tests found in tests/unit/"
  fi
}

run_integration_tests() {
  echo "Running integration tests..."
  if [ -d "tests/integration" ]; then
    for test_file in tests/integration/*.test.js; do
      if [ -f "$test_file" ]; then
        echo "  Running: $test_file"
        node "$test_file" || echo "  Failed: $test_file"
      fi
    done
  else
    echo "  No integration tests found in tests/integration/"
  fi
}

run_mcp_tests() {
  echo "Running MCP protocol compliance tests..."
  if [ -f "tests/integration/mcp-protocol-compliance.test.js" ]; then
    node tests/integration/mcp-protocol-compliance.test.js
  else
    echo "  MCP compliance test not found"
  fi
}

run_tool_tests() {
  echo "Running tool functional tests..."
  if [ -f "test-tools.js" ]; then
    node test-tools.js
  else
    echo "  test-tools.js not found"
  fi

  if [ -f "test-real-world.js" ]; then
    echo ""
    echo "Running real-world scenario tests..."
    node test-real-world.js
  fi
}

case $TEST_TYPE in
  "unit")
    run_unit_tests
    ;;
  "integration")
    run_integration_tests
    ;;
  "mcp")
    run_mcp_tests
    ;;
  "tools")
    run_tool_tests
    ;;
  "all")
    echo "=== Unit Tests ==="
    run_unit_tests
    echo ""
    echo "=== Integration Tests ==="
    run_integration_tests
    echo ""
    echo "=== MCP Compliance Tests ==="
    run_mcp_tests
    echo ""
    echo "=== Tool Functional Tests ==="
    run_tool_tests
    ;;
  *)
    echo "Unknown test type: $TEST_TYPE"
    echo "Available types: all, unit, integration, mcp, tools"
    exit 1
    ;;
esac

echo ""
echo "=== Test run complete ==="
