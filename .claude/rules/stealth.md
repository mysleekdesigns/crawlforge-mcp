---
paths:
  - "src/core/StealthBrowserManager.js"
  - "src/core/ClearanceJar.js"
  - "src/core/BrowserContextPool.js"
  - "src/core/processing/BrowserProcessor.js"
  - "src/core/ResearchOrchestrator.js"
  - "src/utils/impitRung.js"
  - "src/tools/advanced/**"
  - "src/skills/agent-skills/crawlforge-stealth-browsing/**"
---

# Stealth engines and escalation

Background: `docs/STEALTH_REVIEW_2026-09.md`, `docs/stealth-engines.md`.

## Engine selection

- Engine selection goes through one resolver, `resolveStealthEngine(requested)` → `{engine, fallbackWarning}`. `'auto'` (the default for `scrape.escalate_engine` and `stealth_mode.engine`) prefers Camoufox and falls back to Chromium with a caller-visible warning when the Camoufox binary is absent. `'playwright'` is the tool layer's public name for Chromium.
- Camoufox personas are pinned to the installed binary's Firefox major so the UA's `rv:` and `Firefox/` tokens agree.
- Camoufox is an optional dependency whose transitive `language-tags@2.1.0` requires Node ≥22. On Node 20, npm silently drops it and `'auto'` resolves to Chromium, saying so in `fallbackWarning`. `engines.node` stays `>=20.16.0` on purpose: raising it is breaking and a release decision.
- Which engine clears a wall depends on the exit IP (residential favours Camoufox, the hosted datacenter IP favours Chromium; measured twice). There is no correct global value.

## Environment variables

- `CRAWLFORGE_STEALTH_ENGINE` — which engine `auto` resolves to on this deployment: `chromium`/`playwright` pins Chromium; unset or anything else keeps the Camoufox preference. A caller naming an engine always wins.
- `CRAWLFORGE_STEALTH_PROXIES` — comma-separated proxy URLs for the escalation stage, `stealth_mode`, `browser_session`, `scrape_with_actions`, the `deep_research` fallback and the agent's automatic stealth retry when the caller passes none (a proxy passed on the call wins). CrawlForge supplies no proxies, and a datacenter proxy does not defeat these detectors. Distinct from `PROXY_ROTATION_*`, which belongs to `localization`.
- `CRAWLFORGE_IMPIT=off` — skips escalation's impit step (a Chrome TLS handshake with the honest UA, tried before the browser). Exit-IP dependent like the engine: it cleared indeed.com from a residential IP and nothing from the hosted datacenter IP, so `render.yaml` sets it off there. Measure with `scripts/impit-probe.mjs`.
- `CRAWLFORGE_CLEARANCE_JAR=off` — disables the clearance jar: `cf_clearance`/`__cf_bm`/`datadome` cookies a stealth render earned are replayed to the next stealth context with the same engine, UA and proxy. Persisted at `~/.crawlforge/stealth-clearance.json`.

## Browser sandboxing

Stealth Chromium runs with `--no-sandbox` (a deliberate fingerprint trade-off); `--disable-web-security` was removed from it because a page can detect it in one line. The non-stealth render browser (`BrowserProcessor`) still carries both flags.
