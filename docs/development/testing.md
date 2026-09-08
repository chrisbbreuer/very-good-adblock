---
title: Testing
description: How Very Good AdBlock verifies rules, UI, performance-sensitive video helpers, and packaged output.
---

# Testing

Very Good AdBlock has focused unit tests, rule validation, artifact validation, package checks, and Bun WebView smoke coverage.

## Core Checks

```bash
bun run test
bun run typecheck
bun run lint
bun run build
```

## Extension Validation

```bash
bun run validate:rules
bun run validate:extension
bun run package
```

## Browser Smoke

```bash
bun run smoke:chrome
```

The smoke test uses Bun WebView. It checks:

- YouTube watch pages and Shorts skip assist.
- YouTube skip-button automation.
- Cosmetic hiding of YouTube feed/masthead/display ads and Twitch display banners, with real feed videos and video-ad markers left visible.
- Twitch video-ad marker detection and estimated saved-time events.
- Popup and options dashboard rendering.
- Reset/export controls.
- Desktop and mobile overflow.

## Headless Browser

Every headless view — the WebView tests and the smoke run — goes through
`resources/scripts/lib/browser-view.ts`, which picks the Chromium binary and
applies the requested viewport.

Dia (`/Applications/Dia.app`) is preferred over Chrome where it exists: the
harness then never contends with the Chrome the machine is already running,
which used to fail whole batches with `Failed to spawn Chrome` partway through
a run. `BUN_CHROME_PATH` overrides the choice, and where neither Dia nor that
variable is present (CI) Bun auto-detects Chrome as before.

Dia's headless targets start at 0x0, so the helper hops through `about:blank`
to get a live CDP session and applies the size override there — without it,
`innerWidth` and every element rect measure as zero.

## Cached YouTube Regression

`bun run test` regenerates and validates a cached YouTube-like fixture through `ts-web-scraper` when that local dependency is available. The committed fixture keeps CI deterministic and offline-friendly.
