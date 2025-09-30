#!/bin/bash

# CrawlForge Comprehensive Test Suite Runner
# Runs all tests and provides a summary

set -e

echo "🧪 CrawlForge Comprehensive Test Suite"
echo "======================================"
echo ""

TESTS_PASSED=0
TESTS_FAILED=0
FAILED_TESTS=()

# Function to run a test
run_test() {
    local test_name=$1
    local test_command=$2

    echo ""
    echo "📝 Running: $test_name"
    echo "----------------------------------------"

    if eval "$test_command"; then
        echo "✅ $test_name: PASSED"
        ((TESTS_PASSED++))
    else
        echo "❌ $test_name: FAILED"
        ((TESTS_FAILED++))
        FAILED_TESTS+=("$test_name")
    fi
}

# Test 1: MCP Protocol Compliance
run_test "MCP Protocol Compliance" "npm test"

# Test 2: Tool Functionality
run_test "Tool Functionality (All Tools)" "node test-tools.js"

# Test 3: Real-World Scenarios
run_test "Real-World Usage Scenarios" "node test-real-world.js"

# Print summary
echo ""
echo ""
echo "📊 Test Suite Summary"
echo "======================================"
echo "✅ Tests Passed: $TESTS_PASSED"
echo "❌ Tests Failed: $TESTS_FAILED"
echo "📈 Total Tests: $((TESTS_PASSED + TESTS_FAILED))"

if [ $TESTS_FAILED -eq 0 ]; then
    echo ""
    echo "🎉 All tests passed! CrawlForge is working perfectly."
    echo ""
    exit 0
else
    echo ""
    echo "⚠️  Failed tests:"
    for test in "${FAILED_TESTS[@]}"; do
        echo "   • $test"
    done
    echo ""
    exit 1
fi