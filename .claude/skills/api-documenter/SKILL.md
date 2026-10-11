---
name: api-documenter
description: Hands a CrawlForge MCP Server documentation update to the api-documenter agent — README, docs/*.md, tool descriptions and examples, integration guides.
argument-hint: "[what changed, or which doc to update]"
disable-model-invocation: true
context: fork
agent: api-documenter
background: false
---

Documentation task: $ARGUMENTS

`bash .claude/skills/api-documenter/scripts/check-coverage.sh --verbose` lists any tool registered in `server.js` that the README does not cover. If the task above is empty, run it and report the gaps without editing.
