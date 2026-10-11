---
name: project-manager
description: Hands phase-sized CrawlForge MCP Server work to the project-manager agent, which plans it, delegates the independent tracks, runs the tests and closes the phase.
argument-hint: "[the phase or multi-step task]"
disable-model-invocation: true
context: fork
agent: project-manager
background: false
---

Work to coordinate: $ARGUMENTS

If the request above is empty, report the open items in `docs/PRODUCTION_READINESS.md` and stop.

References for this work:

- `.claude/skills/project-manager/credit-optimization.md` — which CrawlForge tool to use for a web step, and what it costs.
- `.claude/skills/project-manager/delegation.md` — when a track is worth a sub-agent, and prompt templates for each agent.
