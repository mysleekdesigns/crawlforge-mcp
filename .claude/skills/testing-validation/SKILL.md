---
name: testing-validation
description: Runs and repairs the CrawlForge MCP Server test suites in the testing-validation agent — unit, integration, MCP protocol compliance, stdio smoke.
argument-hint: "[suite or failing test, optional]"
disable-model-invocation: true
context: fork
agent: testing-validation
background: false
---

Testing task: $ARGUMENTS

If the task above is empty, run `npm run test:unit` and `npm test`, and report the counts and any failures without changing code.
