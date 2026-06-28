---
title: Install
description: Build and load Adblock as an unpacked Chrome extension.
---

# Install

Adblock is currently built as a Chrome Manifest V3 extension.

## Requirements

- Bun
- Chrome or a Chromium-based browser with extension developer mode

## Build

```bash
bun install
bun run build
```

The extension is generated into `dist/`.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable developer mode.
3. Click **Load unpacked**.
4. Select the generated `dist/` directory.

## Package

```bash
bun run package
```

This creates a zip artifact for distribution.
