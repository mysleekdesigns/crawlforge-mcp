---
name: performance-monitor
description: Investigates CrawlForge MCP Server latency, memory or cache behaviour in the performance-monitor agent and reports measured numbers.
argument-hint: "[slow tool or symptom, optional]"
disable-model-invocation: true
context: fork
agent: performance-monitor
---

Investigation: $ARGUMENTS

If the request above is empty, report p50 and p95 `durationMs` and the error rate per tool from the `tool invocation` lines in `logs/app.log`, with sample sizes.
