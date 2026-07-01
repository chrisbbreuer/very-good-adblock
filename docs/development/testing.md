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
- No cosmetic DOM hiding on YouTube or Twitch fixtures.
- Twitch video-ad marker detection and estimated saved-time events.
- Popup and options dashboard rendering.
- Reset/export controls.
- Desktop and mobile overflow.

## Cached YouTube Regression

`bun run test` regenerates and validates a cached YouTube-like fixture through `ts-web-scraper` when that local dependency is available. The committed fixture keeps CI deterministic and offline-friendly.
