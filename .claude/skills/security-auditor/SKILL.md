---
name: security-auditor
description: Runs a read-only security review of the CrawlForge MCP Server in the security-auditor agent — SSRF, compliance-gate bypasses, injection, secrets, dependencies.
argument-hint: "[files, diff or area to audit, optional]"
disable-model-invocation: true
context: fork
agent: security-auditor
---

Audit scope: $ARGUMENTS

If the scope above is empty, audit the changes on the current branch since it diverged from `main` (`git diff main...HEAD`), plus `npm audit`.
