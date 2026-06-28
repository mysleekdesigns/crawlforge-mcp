# scrape_with_actions — Action Types

`scrape_with_actions` runs an ordered `actions[]` array (1–20 items) before
scraping. Only these 7 action types are allowed (allow-listed in ActionExecutor).
Each action object has a `type` plus type-specific fields. Common optional
fields on every action: `timeout`, `description`, `continueOnError`, `retries`
(0–5), `captureAfter`.

## 1. wait

Pause or wait for a condition.

| Field | Type | Notes |
|-------|------|-------|
| `duration` | number | Milliseconds to wait (0–30000). |
| `selector` | string | Element to wait on. |
| `condition` | enum | `visible`, `hidden`, `enabled`, `disabled`, `stable`. |

```json
{ "type": "wait", "duration": 1500 }
{ "type": "wait", "selector": "#results", "condition": "visible" }
```

## 2. click

| Field | Type | Notes |
|-------|------|-------|
| `selector` | string | Element to click. |
| `button` | enum | `left`, `right`, `middle`. |
| `clickCount` | number | 1–3. |
| `delay` | number | ms (0–1000). |
| `force` | boolean | Bypass actionability checks. |
| `position` | object | `{x, y}` relative offset. |

```json
{ "type": "click", "selector": "#login" }
```

## 3. type

| Field | Type | Notes |
|-------|------|-------|
| `selector` | string | Input to type into. |
| `text` | string | Text to enter. |
| `clear` | boolean | Clear the field first. |
| `delay` | number | Per-keystroke delay (ms). |

```json
{ "type": "type", "selector": "#email", "text": "user@a.com", "clear": true }
```

## 4. press

| Field | Type | Notes |
|-------|------|-------|
| `key` | string | Key to press (e.g. `Enter`). |
| `modifiers` | enum[] | `Alt`, `Control`, `Meta`, `Shift`. |

```json
{ "type": "press", "key": "Enter" }
```

## 5. scroll

| Field | Type | Notes |
|-------|------|-------|
| `direction` | enum | `up`, `down`, `left`, `right`. |
| `distance` | number | Pixels. |
| `smooth` | boolean | Smooth scrolling. |
| `toElement` | string | Selector to scroll to. |

```json
{ "type": "scroll", "direction": "down", "distance": 800 }
```

## 6. screenshot

| Field | Type | Notes |
|-------|------|-------|
| `fullPage` | boolean | Capture full page. |
| `format` | enum | `png`, `jpeg`. |
| `quality` | number | 0–100 (jpeg). |

Saved as a `crawlforge://screenshot/{actionId}` resource.

```json
{ "type": "screenshot", "fullPage": true, "format": "png" }
```

## 7. executeJavaScript (gated)

Disabled unless the deployment sets `ALLOW_JAVASCRIPT_EXECUTION=true`.

| Field | Type | Notes |
|-------|------|-------|
| `script` | string | JS to run in page context. |
| `args` | any[] | Arguments passed to the script. |
| `returnResult` | boolean | Return the script's result. |

```json
{ "type": "executeJavaScript", "script": "return document.title", "returnResult": true }
```

## Top-level options

| Option | Default | Notes |
|--------|---------|-------|
| `formats` | `["json"]` | `markdown`, `html`, `json`, `text`, `screenshots`. |
| `captureIntermediateStates` | `false` | Snapshot after each action. |
| `captureScreenshots` | `true` | Screenshot during execution. |
| `formAutoFill` | — | Declarative form fill: `fields[]` + `submitSelector`. |
| `browserOptions` | — | `headless`, `userAgent`, `viewportWidth/Height`, `timeout`. |
| `continueOnActionError` | `false` | Keep going if one action fails. |
| `maxRetries` | `1` | 0–3 retries on failure. |
| `screenshotOnError` | `true` | Capture a screenshot when an error occurs. |

## CLI action-script format

```json
[
  { "type": "click", "selector": "#button" },
  { "type": "type", "selector": "#input", "text": "hello" },
  { "type": "wait", "duration": 1000 }
]
```

Run with `crawlforge actions <url> --script ./flow.json --screenshot`.
