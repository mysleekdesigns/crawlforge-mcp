---
name: mcp-implementation
description: Hands a CrawlForge MCP Server code change to the mcp-implementation agent — tool registration in server.js, tool classes under src/tools, withAuth billing, Zod schemas.
argument-hint: "[the change to make, with file paths if known]"
disable-model-invocation: true
context: fork
agent: mcp-implementation
background: false
---

Implementation task: $ARGUMENTS

If the task above is empty, report that no task was given and stop.
