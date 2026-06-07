# Security Policy

## Supported versions

CrawlForge MCP Server is actively maintained. Security fixes are applied to the latest
released `4.x` version. Please upgrade to the most recent version before reporting an issue.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report privately via either:

- GitHub's [private security advisories](https://github.com/mysleekdesigns/crawlforge-mcp/security/advisories/new), or
- Email **support@crawlforge.dev** with the subject line `SECURITY`.

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce (proof of concept if possible)
- The affected version

We aim to acknowledge reports within 72 hours and to provide a remediation timeline after
triage. We will credit reporters in the release notes unless you prefer to remain anonymous.

## Scope & hardening

The server ships with several built-in protections. See
[docs/sandboxing-and-approvals.md](docs/sandboxing-and-approvals.md) for the full reference:

- **SSRF protection** — every scraped URL is validated (http/https only; blocks loopback,
  RFC1918, IPv6 private/link-local ranges, cloud metadata endpoints, and dangerous ports;
  redirects re-validated per hop).
- **Backend endpoint guard** — the server's own API calls use a fail-closed allow-list.
- **Action allowlist** — `scrape_with_actions` accepts only 7 vetted action types;
  `executeJavaScript` is gated off by default.
- **Per-tool credit gating** — all tools are wrapped with fail-closed authentication.

Run `npm audit` to check dependencies. CI runs dependency audits, secret scanning, and
CodeQL analysis (see `.github/workflows/security.yml`).
