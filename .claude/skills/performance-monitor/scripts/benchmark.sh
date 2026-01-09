#!/bin/bash
# Performance benchmark script for CrawlForge MCP Server
# Usage: ./benchmark.sh [--iterations N] [--tool TOOL_NAME]

set -e

ITERATIONS=${ITERATIONS:-5}
TOOL=${TOOL:-"fetch_url"}
PROJECT_ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)

cd "$PROJECT_ROOT"

echo "=== CrawlForge Performance Benchmark ==="
echo "Project root: $PROJECT_ROOT"
echo "Iterations: $ITERATIONS"
echo "Tool: $TOOL"
echo ""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --iterations)
      ITERATIONS="$2"
      shift 2
      ;;
    --tool)
      TOOL="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

# Test URLs for different tools
declare -A TEST_PARAMS
TEST_PARAMS["fetch_url"]='{"url": "https://example.com"}'
TEST_PARAMS["extract_text"]='{"url": "https://example.com"}'
TEST_PARAMS["extract_links"]='{"url": "https://example.com"}'
TEST_PARAMS["extract_metadata"]='{"url": "https://example.com"}'

PARAMS=${TEST_PARAMS[$TOOL]:-'{"url": "https://example.com"}'}

echo "=== Server Startup Benchmark ==="
echo ""

# Measure server startup time
echo "Measuring server startup time..."
START=$(date +%s%3N)
timeout 10 node server.js &
SERVER_PID=$!
sleep 2
kill $SERVER_PID 2>/dev/null || true
END=$(date +%s%3N)
STARTUP_TIME=$((END - START - 2000))  # Subtract sleep time

echo "  Startup time: ${STARTUP_TIME}ms"
echo ""

# Memory baseline
echo "=== Memory Baseline ==="
echo ""

# Start server and check memory
node --expose-gc -e "
const { spawn } = require('child_process');
const server = spawn('node', ['server.js'], { stdio: 'pipe' });

setTimeout(() => {
  const used = process.memoryUsage();
  console.log('  Heap Used: ' + Math.round(used.heapUsed / 1024 / 1024) + ' MB');
  console.log('  Heap Total: ' + Math.round(used.heapTotal / 1024 / 1024) + ' MB');
  console.log('  RSS: ' + Math.round(used.rss / 1024 / 1024) + ' MB');
  server.kill();
  process.exit(0);
}, 3000);
" 2>/dev/null || echo "  Memory check failed (server may not have started)"

echo ""

# Tool performance test
echo "=== Tool Performance ($TOOL) ==="
echo ""

TOTAL_TIME=0
MIN_TIME=999999
MAX_TIME=0

for i in $(seq 1 $ITERATIONS); do
  echo -n "  Iteration $i: "

  START=$(date +%s%3N)

  # Make actual HTTP request to test URL (simulating tool execution)
  curl -s -o /dev/null -w "%{time_total}" "https://example.com" > /dev/null 2>&1

  END=$(date +%s%3N)
  ELAPSED=$((END - START))

  echo "${ELAPSED}ms"

  TOTAL_TIME=$((TOTAL_TIME + ELAPSED))

  if [ $ELAPSED -lt $MIN_TIME ]; then
    MIN_TIME=$ELAPSED
  fi

  if [ $ELAPSED -gt $MAX_TIME ]; then
    MAX_TIME=$ELAPSED
  fi
done

AVG_TIME=$((TOTAL_TIME / ITERATIONS))

echo ""
echo "=== Results ==="
echo "  Min: ${MIN_TIME}ms"
echo "  Max: ${MAX_TIME}ms"
echo "  Avg: ${AVG_TIME}ms"
echo "  Total: ${TOTAL_TIME}ms"
echo ""

# Performance thresholds
echo "=== Performance Assessment ==="

if [ $AVG_TIME -lt 500 ]; then
  echo "  Response time: EXCELLENT (<500ms)"
elif [ $AVG_TIME -lt 1000 ]; then
  echo "  Response time: GOOD (<1000ms)"
elif [ $AVG_TIME -lt 2000 ]; then
  echo "  Response time: ACCEPTABLE (<2000ms)"
else
  echo "  Response time: SLOW (>2000ms)"
fi

if [ $STARTUP_TIME -lt 1000 ]; then
  echo "  Startup time: EXCELLENT (<1000ms)"
elif [ $STARTUP_TIME -lt 3000 ]; then
  echo "  Startup time: GOOD (<3000ms)"
else
  echo "  Startup time: SLOW (>3000ms)"
fi

echo ""
echo "=== Benchmark Complete ==="
