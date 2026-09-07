---
name: crawlforge-change-tracking
description: "Monitors web pages for changes over time with CrawlForge's track_changes tool. Use when the user wants to track changes to a page, watch a URL, monitor competitor pricing, detect when content updates, get notified of regulation or product-availability changes, or diff a page against a saved baseline. Workflow: create a baseline with operation create_baseline, then periodically compare with operation compare to get a change percentage and a diff; supports CSS-selector scoping, webhooks, and scheduled monitoring."
metadata:
  version: 5.6.6
  source: crawlforge-mcp-server
---

# CrawlForge Change Tracking

Detect when a web page changes over time using the `track_changes` tool. Useful
for competitor pricing, regulation updates, product availability, and any page
you need to watch for edits.

## When to use

- "Track changes to this page" / "watch this URL"
- "Tell me when competitor pricing changes"
- "Detect when this content updates"
- "Diff this page against last week's version"
- "Notify me when product availability / a regulation changes"

## Core workflow

`track_changes` is one tool driven by an `operation` parameter (cost: 3 credits
per call).

1. **Create a baseline** the first time:

```json
{ "tool": "track_changes", "params": { "url": "https://example.com/pricing", "operation": "create_baseline" } }
```

2. **Compare** later to get the change percentage + diff:

```json
{ "tool": "track_changes", "params": { "url": "https://example.com/pricing", "operation": "compare" } }
```

`compare` is the default operation. It returns a change percentage and a
structured diff against the stored baseline.

## Scoping to part of a page

Use `trackingOptions` to ignore noise and focus on what matters:

```json
{
  "tool": "track_changes",
  "params": {
    "url": "https://example.com/pricing",
    "operation": "compare",
    "trackingOptions": {
      "granularity": "element",
      "customSelectors": [".price", ".plan-name"],
      "excludeSelectors": [".timestamp", ".ad"],
      "ignoreWhitespace": true
    }
  }
}
```

`granularity`: `page`, `section` (default), `element`, `text`. Toggle
`trackText`, `trackStructure`, `trackLinks`, `trackImages`. Set
`significanceThresholds` (`minor`/`moderate`/`major`) to classify change size.

CLI: `crawlforge track https://example.com --selector ".price" --threshold 1`.

## Scheduled monitoring & notifications

`create_scheduled_monitor` repeats `compare` on a schedule and notifies on
change. It comes in two kinds.

**Local** (default): persisted in `~/.crawlforge/monitors/`; fires in-process
only while this MCP server runs (missed runs catch up on restart; `crawlforge
monitor:run-due` from system cron guarantees firing). Notifies by webhook or
Slack — never email. `goal` (plain-English LLM judge) and
`notificationThreshold` apply to local monitors only.

```json
{
  "tool": "track_changes",
  "params": {
    "url": "https://example.com/pricing",
    "operation": "create_scheduled_monitor",
    "scheduledMonitorOptions": { "interval": 1800000, "notificationThreshold": "moderate" },
    "notificationOptions": { "webhook": { "enabled": true, "url": "https://my-site.com/notify" } }
  }
}
```

**Hosted** (`scheduledMonitorOptions.hosted: true`): registered with
CrawlForge's hosted monitors API under your API key; nothing is created locally
and this process never fetches the page. CrawlForge's own scheduler runs every
check whether or not this process is alive, records it, and notifies by email
and signed webhook on every changed, new, blocked or errored page. Passing
`goal` or `notificationThreshold` adds a `warnings` entry.

```json
{
  "tool": "track_changes",
  "params": {
    "url": "https://example.com/pricing",
    "operation": "create_scheduled_monitor",
    "trackingOptions": { "customSelectors": [".price"] },
    "scheduledMonitorOptions": { "hosted": true, "interval": 21600000 },
    "notificationOptions": {
      "email": { "enabled": true, "recipients": ["you@example.com"] },
      "webhook": { "enabled": true, "url": "https://my-site.com/notify" }
    }
  }
}
```

Hosted mapping: each `customSelectors` entry becomes a target selector on the
URL; `schedule` (cron) passes through, otherwise `interval` becomes a cron of
5–60 minutes dividing 60, whole hours dividing 24, or daily — other values
round to the nearest and `warnings` says what they became. Up to 5 email
recipients. `webhook.signingSecret` (16–128 chars) becomes the webhook secret;
omit it and the response returns a generated `webhookSecret`. The response's
`monitor` carries the hosted `id`, `nextRunAt`, `estimatedCreditsPerMonth` and
a `dashboardUrl` for managing it.

CLI: `crawlforge monitor:create <url> --every 1800 --webhook <url>` (local) or
`crawlforge monitor:create <url> --hosted --email you@example.com` (hosted);
`monitor:list` shows both kinds and `monitor:stop <id>` removes either.

## Other operations

| Operation | Purpose |
|-----------|---------|
| `create_baseline` | Save the first snapshot to diff against. |
| `compare` (default) | Diff current content vs baseline → % change + diff. |
| `monitor` | One monitoring pass. |
| `get_history` | Retrieve past change records (`queryOptions`). |
| `get_stats` | Summary statistics for a tracked URL. |
| `create_scheduled_monitor` | Recurring `compare` + notify; local by default, `scheduledMonitorOptions.hosted: true` for a CrawlForge-run monitor (see above). |
| `list_scheduled_monitors` | Local monitors (`hosted: false`) then hosted ones (`hosted: true`), with `localCount`/`hostedCount`; `hostedError` if the website is unreachable. |
| `stop_scheduled_monitor` | By `scheduledMonitorOptions.monitorId`: stops a local monitor, or deletes the hosted one with that id. By `url` alone: stops every local monitor on it and deletes hosted monitors whose targets are all that exact URL. |
| `get_dashboard` | Aggregate status, recent alerts, trends. |
| `export_history` | Export change history as `json` or `csv`. |
| `create_alert_rule` | Conditional alerts fired from `compare` (webhook / slack; the email action is not sent by a local process — use a hosted monitor for email). |
| `generate_trend_report` | Trend analysis over time. |
| `get_monitoring_templates` | List built-in monitoring presets. |

You can also pass `content` or `html` directly to compare pre-fetched content
against the baseline without re-fetching.

## Cost note

`track_changes` = 3 credits per call, except that creating a hosted monitor or
stopping a hosted-only one charges 0 (3 is the projected ceiling). A typical
watch is one `create_baseline` plus periodic `compare` calls, or one scheduled
monitor. Each hosted check bills 3 credits per compared target to your account;
blocked and errored targets are free.
