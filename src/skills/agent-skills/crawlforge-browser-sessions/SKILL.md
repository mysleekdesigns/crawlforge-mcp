---
name: crawlforge-browser-sessions
description: "Keeps one browser page alive across several tool calls with CrawlForge's browser_session tool. Use when the user needs to log in and then read pages behind that login, work through a multi-step flow (search, filter, paginate, fill a wizard), or look at a page before deciding what to click. The loop is: open a session on a URL, snapshot it to list the interactive elements with stable refs (@e1, @e2), act on those refs, read the content, close. Unlike scrape_with_actions, which is one-shot and closes its browser when the call returns, a session survives between calls, so one login is paid for once and a wrong selector costs one call instead of a whole chain."
metadata:
  version: 5.6.6
  source: crawlforge-mcp-server
---

# CrawlForge Browser Sessions

Drive a real browser across several calls. `browser_session` keeps one page —
its cookies, its login, whatever it has already clicked — alive between calls, so
you can look at the page, act, and look again, instead of guessing a whole chain
of CSS selectors for a page you have never seen.

## When to use

- **Log in once, then read several pages behind the login** → session.
- **You do not know what is on the page yet** — observe, then act → session.
- **A flow that spans more than one tool call** (wizard, filters, pagination,
  multi-step form) → session.
- A **known, fixed** action chain on one page → `scrape_with_actions` instead:
  one call, 5 credits, browser closed for you (see crawlforge-batch-automation).
- A page that renders **without interaction** → `scrape` (2 credits, see
  crawlforge-web-scraping).

## The loop

`open` → `snapshot` → `act` on the refs → (`snapshot` again after a navigation)
→ `read` → `close`.

```json
{ "tool": "browser_session", "params": { "operation": "open", "url": "https://app.example.com/login" } }
```

Returns a `sessionId` every later call passes as `session_id`, plus `expiresAt`
and `idleExpiresAt`.

```json
{ "tool": "browser_session", "params": { "operation": "snapshot", "session_id": "<id>" } }
```

Returns an accessibility tree with a stable ref on every interactive element:

```
[document] "Sign in"
  @e1 [textbox] "Email"
  @e2 [textbox] "Password"
  @e3 [button] "Sign in"
```

Act on those refs — a ref goes in `selector`, exactly where a CSS selector would:

```json
{
  "tool": "browser_session",
  "params": {
    "operation": "act",
    "session_id": "<id>",
    "actions": [
      { "type": "type", "selector": "@e1", "text": "user@example.com" },
      { "type": "type", "selector": "@e2", "text": "hunter2" },
      { "type": "click", "selector": "@e3" },
      { "type": "wait", "duration": 2000 }
    ]
  }
}
```

`actions` is the same array `scrape_with_actions` takes: `wait`, `click`,
`type`, `press`, `scroll`, `select`, `hover`, `navigate`, `screenshot`,
`snapshot`, `executeJavaScript`. 1–20 per call; `continue_on_error: true` keeps
going past a failed one.

```json
{ "tool": "browser_session", "params": { "operation": "read", "session_id": "<id>", "formats": ["markdown"] } }
{ "tool": "browser_session", "params": { "operation": "close", "session_id": "<id>" } }
```

`read` extracts the **live** DOM — post-login, post-click — so it sees what a
fresh scrape of the same URL would not. `formats`: `markdown`, `html`, `text`,
`json`.

Other operations: `screenshot` (`full_page`, `format`, `quality`, `selector` —
a ref works there too; the image is stored as a
`crawlforge://screenshot/{actionId}` resource) and `list` (your open sessions).

## Refs go stale on navigation

`@e1` is only valid for the page the snapshot was taken on. Any navigation —
clicking a link, submitting a form, an in-session `navigate` action — invalidates
every ref. A stale ref does not silently hit the wrong element; it fails and
tells you to take a new snapshot. **After anything that navigates, snapshot
again** before using refs.

`snapshot` is also available as an action type inside `scrape_with_actions`, for
the one-shot case where you want to observe and act within a single call.

## Worked example — log in, then read the dashboard

```json
{"tool":"browser_session","params":{"operation":"open","url":"https://app.example.com/login"}}
→ { "sessionId": "8f2c…", "expiresAt": …, "idleExpiresAt": … }

{"tool":"browser_session","params":{"operation":"snapshot","session_id":"8f2c…"}}
→ tree with @e1 [textbox] "Email", @e2 [textbox] "Password", @e3 [button] "Sign in"

{"tool":"browser_session","params":{"operation":"act","session_id":"8f2c…","actions":[
  {"type":"type","selector":"@e1","text":"user@example.com"},
  {"type":"type","selector":"@e2","text":"hunter2"},
  {"type":"click","selector":"@e3"},
  {"type":"wait","duration":2000}]}}
→ success, url now https://app.example.com/dashboard

{"tool":"browser_session","params":{"operation":"snapshot","session_id":"8f2c…"}}
→ fresh refs for the dashboard (the login refs are gone — the page navigated)

{"tool":"browser_session","params":{"operation":"read","session_id":"8f2c…","formats":["markdown"]}}
→ the dashboard as markdown, logged in

{"tool":"browser_session","params":{"operation":"close","session_id":"8f2c…"}}
```

Total: 3 + 1 + 1 + 1 + 2 + 1 = **9 credits**, and the login happened once. The
same flow as repeated `scrape_with_actions` calls costs 5 per call and logs in
again every time.

## browser_session (cost: 3 to open, then 1–2 per call)

| Operation | Credits |
|-----------|---------|
| `open` | 3 |
| `read` | 2 |
| `snapshot` | 1 |
| `act` | 1 |
| `screenshot` | 1 |
| `close` | 1 |
| `list` | 1 |

The published flat rate is 3 — the ceiling, charged when an operation is not one
of the above. Nothing here is free.

## Limits

- **Two clocks.** A session dies 600s after it opens (`ttl`, 30–3600) or 300s
  after its last use (`activity_ttl`, 10–3600), whichever comes first. Close
  sessions when you are done rather than leaving them to time out.
- **Concurrent sessions.** One account may hold **1** session at a time over
  CrawlForge's hosted REST API; a local (stdio) or self-hosted install allows
  **3** per API key, and the process itself caps the total. A session over the
  cap is refused, never queued — `close` one first.
- **Sessions live in the server process** that opened them. They do not survive
  a server restart, and they are not shared between installs.
- **`executeJavaScript` is refused** in a session on a remotely-served instance
  (the script would run in a browser on the server, not on your machine). Use
  `click` / `type` / `select` / `press`, or run the server locally over stdio.
- **Every in-session navigation is re-gated**: SSRF checks, the host blocklist
  and robots.txt run again on each hop, not just at `open`.
- `stealth: true` on `open` runs the session in the anti-bot browser (see
  crawlforge-stealth-browsing); `viewport` sets the window size.

## CLI

```bash
crawlforge browser https://example.com                      # open, snapshot, close — see the refs
crawlforge browser https://app.example.com --steps flow.json --read
```

One invocation is one session: the CLI opens, snapshots, runs the steps in
`flow.json` (each `{"operation": …}` with the session supplied), optionally
reads, and closes. A session cannot span two CLI invocations — the page lives in
the process. Use the MCP tool when you need a session to outlive the call.

## Cost note

An `open` + `snapshot` + `act` + `read` + `close` round trip is 8 credits, and
each extra look is 1. Reach for `scrape_with_actions` (5) when you can write the
whole interaction down in advance, and for a session when you cannot.
