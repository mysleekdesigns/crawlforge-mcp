# Stealth Engine Selection

`stealth_mode` supports two browser engines via the `engine` parameter.

## playwright (default)

- Chromium-based with stealth patches applied.
- Reports `navigator.webdriver` as `false` (not deleted — a missing property is
  itself a marker), and sets the User-Agent, platform, languages and core count
  through CDP, so a Web Worker answers the same as the page.
- Lower resource usage, faster startup.
- Good for most sites with basic bot detection.

## camoufox

- Firefox-based with **native** anti-detection (no runtime patches — uses
  Firefox's genuine properties).
- Scores higher on CreepJS and against DataDome than patched Chromium.
- Heavier; install with `npm install camoufox`.
- Use for advanced fingerprinting: financial, trading, and e-commerce sites.

## Decision table

| Scenario | Recommended engine |
|----------|--------------------|
| General JS-rendered sites | playwright |
| Basic bot-detection bypass | playwright |
| Speed-critical scraping | playwright |
| Cloudflare-protected sites | camoufox |
| Sites with DataDome | camoufox |
| Sites with PerimeterX | camoufox |
| Financial / trading sites | camoufox |

## stealthConfig levels

| Level | Behavior |
|-------|----------|
| `basic` | Minimal fingerprint masking; lowest overhead. |
| `medium` (default) | Balanced fingerprint randomization + header spoofing. |
| `advanced` | Full anti-detection: human-behavior simulation, canvas/WebGL/audio/font/hardware spoofing, WebRTC blocking, timezone spoofing. |

## Key stealthConfig fields

- `randomizeFingerprint`, `hideWebDriver`, `blockWebRTC`, `spoofTimezone`,
  `randomizeHeaders`, `useRandomUserAgent`, `simulateHumanBehavior`.
- `customUserAgent`, `customViewport {width,height}`, `locale`, `timezone`.
- `proxyRotation { enabled, proxies[], rotationInterval }`.
- `antiDetection { cloudflareBypass, recaptchaHandling, hideAutomation,
  spoofMediaDevices, spoofBatteryAPI }`.
- `fingerprinting { canvasNoise, webglSpoofing, audioContextSpoofing,
  fontSpoofing, hardwareSpoofing }`.

On `camoufox`, `customUserAgent` and `customViewport` are not applied: that engine
brings its own Firefox identity, and overriding it from here put a Chrome identity
on a Gecko engine. `locale` is applied, but at browser launch rather than per
call — Camoufox sets language, Accept-Language and `Intl` below the JS layer,
where a Worker matches the document — so the first locale a Camoufox browser is
launched with holds until the browser is cleaned up, and behind a proxy the exit
IP decides it instead. The persona's OS is the host's and is not configurable
(on Camoufox that is a request its current client does not honour).

## Global override

```bash
export CRAWLFORGE_STEALTH_ENGINE=camoufox
```

Forces the engine for all stealth calls regardless of the `engine` parameter.

## Sandboxing note

Stealth Chromium runs with `--no-sandbox` (a deliberate fingerprint-spoofing
trade-off). It no longer runs with `--disable-web-security`, which a page could
read in one line; the non-stealth render browser still does. Camoufox (Firefox)
is the alternative when the `--no-sandbox` trade-off is unacceptable.
