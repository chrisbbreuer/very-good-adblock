---
title: Install
description: Build and load the performant, minimal, modern Very Good AdBlock extension for Chrome and Firefox.
---

# Install

Very Good AdBlock is built as a performant, minimal, modern Manifest V3 extension for both Chrome and Firefox from one codebase, with a browser-specific manifest generated at build time.

## Requirements

- Bun
- Chrome/Chromium or Firefox with extension developer mode

## Build for Chrome

```bash
bun install
bun run build
```

The extension is generated into `dist/`. (`bun run build:chrome` is an explicit alias for the same thing.)

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable developer mode.
3. Click **Load unpacked**.
4. Select the generated `dist/` directory.

## Build for Firefox

```bash
bun install
bun run build:firefox
```

The extension is generated into `dist-firefox/`, using Firefox's event-page `background.scripts` instead of a service worker and adding the `browser_specific_settings.gecko` block Firefox requires to sign and publish an MV3 add-on.

## Load In Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `dist-firefox/manifest.json`.

Or run `bun run dev:firefox`, which builds and launches Firefox with the extension loaded via [`web-ext`](https://github.com/mozilla/web-ext).

A temporary add-on is removed when Firefox closes; publishing to addons.mozilla.org (AMO) is required for a permanent install.

## Package

```bash
bun run package          # Chrome zip
bun run package:firefox  # Firefox zip
```

Each also runs its target's `validate:extension` step first and creates a zip artifact for distribution (`very-good-adblock-<version>-chrome.zip` and `very-good-adblock-<version>-firefox.zip`).
