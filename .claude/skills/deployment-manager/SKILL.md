---
name: deployment-manager
description: Runs a CrawlForge MCP Server release in the deployment-manager agent — version bump, changelog, tests, tag, main merge, npm publish, GitHub release, registry check.
argument-hint: "[patch|minor|major|x.y.z]"
disable-model-invocation: true
context: fork
agent: deployment-manager
background: false
---

Release request: $ARGUMENTS

Run this release following `docs/mcp-registry.md` and your order of operations. If the request above is empty or does not name a version or bump type, report the current version, the unreleased `docs/CHANGELOG.md` entries and the version you would cut, then stop without changing anything.
