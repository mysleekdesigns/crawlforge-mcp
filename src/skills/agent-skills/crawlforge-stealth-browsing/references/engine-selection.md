# Stealth Engine Selection

`stealth_mode` supports two browser engines via the `engine` parameter.

## playwright (default)

- Chromium-based with stealth patches applied.
- Masks `webdriver`, User-Agent, and navigator properties.
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

## Global override

```bash
export CRAWLFORGE_STEALTH_ENGINE=camoufox
```

Forces the engine for all stealth calls regardless of the `engine` parameter.

## Sandboxing note

Stealth Chromium runs with `--no-sandbox` + `--disable-web-security` (a
deliberate fingerprint-spoofing trade-off). Camoufox (Firefox) is the
alternative when that trade-off is unacceptable.
