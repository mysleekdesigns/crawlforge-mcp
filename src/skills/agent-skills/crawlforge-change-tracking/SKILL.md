---
name: crawlforge-change-tracking
description: "Monitors web pages for changes over time with CrawlForge's track_changes tool. Use when the user wants to track changes to a page, watch a URL, monitor competitor pricing, detect when content updates, get notified of regulation or product-availability changes, or diff a page against a saved baseline. Workflow: create a baseline with operation create_baseline, then periodically compare with operation compare to get a change percentage and a diff; supports CSS-selector scoping, webhooks, and scheduled monitoring."
metadata:
  version: 4.8.0
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

Run continuous monitoring with webhooks instead of polling manually:

```json
{
  "tool": "track_changes",
  "params": {
    "url": "https://example.com/pricing",
    "operation": "create_scheduled_monitor",
    "monitoringOptions": {
      "enabled": true,
      "interval": 300000,
      "notificationThreshold": "moderate",
      "enableWebhook": true,
      "webhookUrl": "https://my-site.com/notify"
    }
  }
}
```

CLI (runs until Ctrl+C):
`crawlforge monitor https://example.com --interval 60 --webhook https://my-site.com/notify`.

## Other operations

| Operation | Purpose |
|-----------|---------|
| `create_baseline` | Save the first snapshot to diff against. |
| `compare` (default) | Diff current content vs baseline → % change + diff. |
| `monitor` | One monitoring pass. |
| `get_history` | Retrieve past change records (`queryOptions`). |
| `get_stats` | Summary statistics for a tracked URL. |
| `create_scheduled_monitor` / `stop_scheduled_monitor` | Manage cron-style monitors. |
| `get_dashboard` | Aggregate status, recent alerts, trends. |
| `export_history` | Export change history as `json` or `csv`. |
| `create_alert_rule` | Conditional alerts (webhook / email / slack). |
| `generate_trend_report` | Trend analysis over time. |
| `get_monitoring_templates` | List built-in monitoring presets. |

You can also pass `content` or `html` directly to compare pre-fetched content
against the baseline without re-fetching.

## Cost note

`track_changes` = 3 credits per call. A typical watch is one `create_baseline`
plus periodic `compare` calls; scheduled monitors run server-side and notify via
webhook/Slack so you don't pay for manual polling loops.
