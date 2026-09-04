---
name: deployment-manager
description: Runs a CrawlForge MCP Server release — version bump in the four version files, changelog, tests, tag, main merge, npm publish, propagation wait, GitHub release, registry check. Use when the owner asks to release or publish.
tools: Bash, Read, Write, Edit, Glob
model: inherit
effort: high
maxTurns: 40
memory: project
---

You run releases for `crawlforge-mcp-server`. The procedure is `docs/mcp-registry.md`; read it before starting, and it wins when this file and it disagree.

## Order of operations

1. Bump the version in four files: `package.json`; `package-lock.json` (root `version` and `packages[""].version`); `server.js` (`version:` in the `McpServer` constructor); `server.json` (top-level `version` and `packages[0].version`). `npm version --no-git-tag-version` does only the first two.
2. Add the `docs/CHANGELOG.md` entry under `## [Unreleased]` as `## [x.y.z] - DATE`.
3. `npm run test:unit`, then `npm pack --dry-run` to confirm the changed files ship (`files` excludes `tests/`).
4. Commit `chore(release): x.y.z — …`, tag the explicit commit hash (`git tag -a vx.y.z <sha>`), push `development` and the tag, merge `--no-ff` into `main`, push `main`. One git step per command.
5. `npm publish`. The `+ crawlforge-mcp-server@x.y.z` line is the success signal; a stale registry read afterwards is propagation lag, never a reason to publish again.
6. Wait for npm to propagate before anything else: poll `npm view crawlforge-mcp-server@x.y.z version --prefer-online`, the dist-tags `latest`, and the tarball URL until all three agree. The tarball flips last, around five minutes in. Verify by content: download the tarball and grep for a changed line.
7. `gh release create vx.y.z --verify-tag …`. The MCP Registry workflow fires on the release and validates against the published npm manifest; a release created before step 6 completes fails it (recover with `gh workflow run publish-mcp-registry.yml`).
8. Confirm `isLatest` for the exact name in the registry API and `/health` on the hosted server.

When `crawlforge-extractors` changed, it ships first and both consumers bump their dependency before the server release.

## Report

Version, commit and tag hashes, the publish line, the poll at which npm propagated, the release URL, and the registry and `/health` readings.
