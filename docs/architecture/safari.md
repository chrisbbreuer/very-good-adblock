---
title: Safari
description: How the Safari Web Extension build works — the dist-safari pipeline, the namespace rewrite, the manifest transform, and the macOS container app.
---

# Safari

Safari Web Extensions ship inside a macOS app, so the Safari port has two halves:

1. **`dist-safari/`** — the web extension itself, built from the same codebase by
   `bun run build:safari` (`buddy extension:build --target safari`, provided by
   `@stacksjs/browser-extension`).
2. **`safari/`** — a checked-in Xcode project with the container app
   (`VeryGoodAdBlock`) and the Safari Web Extension target
   (`VeryGoodAdBlock Extension`) that embeds the synced bundle. New projects
   generate the equivalent tree with `buddy extension:safari:init`.

## Requirements

- **Safari 18.4+** — pinned via `browser_specific_settings.safari.strict_min_version`.
  That is the first Safari with every API this extension uses:

  | Feature | Safari | Used for |
  |---|---|---|
  | `declarativeNetRequest` + dynamic rules + `getMatchedRules` | 15.4 | network blocking, per-tab stats |
  | MV3 background **service workers** | 15.4 | `background.js` |
  | `action` badge APIs | 15.4 | per-tab blocked counter |
  | `content_scripts` `world: "MAIN"` | 18.0 | YouTube/X/Twitch in-page pruners, pop-up guard |
  | `match_about_blank` | 18.4 | pop-up guard inside `about:blank` frames |

- **Xcode** (full install, not just Command Line Tools) to build the app.
  `buddy extension:safari:app` checks and tells you what to do; point
  `DEVELOPER_DIR` at a beta toolchain (e.g.
  `/Applications/Xcode-beta.app/Contents/Developer`) to avoid changing the
  system default.

## The build pipeline

`buddy extension:build --target safari` (from `@stacksjs/browser-extension`)
builds the Chrome-shaped output into `dist-safari` and post-processes it — the
safari target is a first-class framework target, so there is no repo-local
build script:

### Manifest transform

- Drops `minimum_chrome_version` (Chrome-only).
- Keeps `background.service_worker` but drops `type: "module"` — the bundle is
  a classic IIFE, and the module hint buys nothing.
- Replaces `browser_specific_settings` with
  `{ safari: { strict_min_version: "18.4" } }` (the gecko block is Firefox-only).
- Everything else — permissions (including `declarativeNetRequestFeedback`,
  which Safari honors for `getMatchedRules`), host permissions, content
  scripts, the static ruleset, web-accessible stubs — carries over verbatim.

### Namespace rewrite (`chrome.*` → `browser.*`)

The codebase calls promise-style `chrome.*` everywhere (49 call sites). That
works in Chrome and in Firefox 140+, but Safari's `chrome.*` namespace is
callback-flavored while its `browser.*` namespace is promise-native. The build
therefore rewrites `chrome.<ns>.` → `browser.<ns>.` in the four shipped bundles
(`background.js`, `content.js`, `popup.js`, `options.js`), anchored to the
audited API list (`runtime`, `tabs`, `declarativeNetRequest`, `storage`,
`action`, `alarms`) so string literals can never match. The MAIN-world in-page
scripts (`x-inpage`, `yt-inpage`, `popup-guard`) use page globals only and are
untouched. `validate:extension:safari` fails the build if any `chrome.*` API
access survives.

## The container app

`safari/VeryGoodAdBlock.xcodeproj` is a hand-maintained Xcode project (two
targets, macOS only, SwiftUI) — no `safari-web-extension-converter` step needed
day-to-day:

- **`VeryGoodAdBlock`** — a single-window SwiftUI app that shows the extension
  state and opens Safari's extension settings. This is what users install and
  launch once; the extension registers with Safari when the app runs.
- **`VeryGoodAdBlock Extension`** — the appex. Its `Resources/` folder (a
  folder reference, so no per-file project edits) receives the exact contents
  of `dist-safari` when `buddy extension:safari:app` syncs, minus the
  marketing-site pages listed as `safariExclude` in `config/extension.ts`.
  `SafariWebExtensionHandler.swift` implements the native-messaging protocol;
  the extension keeps all state in the web layer, so it only echoes.

Bundle IDs: `org.verygoodadblock.VeryGoodAdBlock` and `….Extension`.

## Build commands

```bash
bun run build:safari              # buddy extension:build --target safari → dist-safari/
bun run package:safari            # + validate + very-good-adblock-<v>-safari.zip
bun run safari:app                # buddy extension:safari:app — build + sync + xcodebuild
bun run safari:app --skip-xcodebuild   # build + sync only (CI-friendly)
bun run safari:init               # buddy extension:safari:init — re-scaffold project + icons
```

See [`safari/README.md`](../../safari/README.md) for signing, unsigned local
builds, and distribution (App Store vs Developer ID + notarization).

## Known Safari differences

Deliberate degradations, all feature-detected in the shared code:

- **`storage.sync` does not sync** in Safari — it behaves like `local`
  (settings/stats stay on the device; everything still works).
- **`action.setBadgeTextColor` is absent** and `setBadgeBackgroundColor` is a
  no-op — the badge falls back to Safari's default colors (calls are
  optional-chained).
- **`onRuleMatchedDebug` is absent** — packed Chrome installs already count via
  `getMatchedRules`, which Safari supports; behavior is unchanged.
- **Report screenshots**: `tabs.captureVisibleTab` works, but writing PNG to
  the clipboard from an extension page is best-effort — the pre-filled GitHub
  issue still opens either way, and the report labels the browser as
  "Safari x.y on macOS" (UA client hints don't exist in Safari).
- **Content scripts need per-site approval** — Safari asks the user to grant
  website access for the extension (toolbar icon → "Always Allow on Every
  Website"), standard for all Safari content blockers.
