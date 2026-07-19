# Very Good AdBlock for Safari

The macOS container app that ships the Safari Web Extension build of
[Very Good AdBlock](https://verygoodadblock.org).

- `VeryGoodAdBlock/` — the SwiftUI container app (shows extension state, opens
  Safari's extension settings).
- `VeryGoodAdBlock Extension/` — the Safari Web Extension target. Its
  `Resources/` folder is a git-ignored mirror of `dist-safari/`, produced by
  `bun run safari:app` (`buddy extension:safari:app`).
- `VeryGoodAdBlock.xcodeproj` — checked in on purpose: building the app never
  requires re-running Apple's converter.

## Prerequisites

- macOS with **Safari 18.4+** (the manifest pins
  `browser_specific_settings.safari.strict_min_version` to 18.4).
- Full **Xcode** (Command Line Tools alone are not enough):

  ```bash
  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
  xcodebuild -license accept   # first launch only
  ```

## Build

From the repo root:

```bash
bun install
bun run safari:app            # buddy extension:safari:app — build → sync → xcodebuild
```

or step by step:

```bash
bun run build:safari          # buddy extension:build --target safari → dist-safari/
bun run safari:app --skip-xcodebuild      # mirror dist-safari into the appex Resources
open safari/VeryGoodAdBlock.xcodeproj   # or: xcodebuild -project safari/VeryGoodAdBlock.xcodeproj -scheme VeryGoodAdBlock build
```

Then launch **VeryGoodAdBlock.app** once (it registers the extension with
Safari) and enable **Very Good AdBlock** in
*Safari → Settings → Extensions*, granting it website access.

## Signing

The checked-in project sets `DEVELOPMENT_TEAM = 3JJRNQW6B7` (Very Good
Industries) for both targets; forks should replace it with their own team id
in *Signing & Capabilities*.

**Local, unsigned (no Apple account):** `bun run safari:app` builds with
`CODE_SIGNING_ALLOWED=NO`. Unsigned extensions require
*Safari → Develop → Allow Unsigned Extensions* (resets on Safari updates).
If the Develop menu is hidden: *Settings → Advanced → Show Develop menu*.

**Signed (Apple Developer Program):** the Apple ID must be added in
*Xcode → Settings → Accounts*; `--signed` passes `-allowProvisioningUpdates`
so Xcode creates/fetches profiles and certificates itself:

```bash
bun run safari:app --signed            # Debug, Apple Development identity
bun run safari:app --signed --release  # Release
```

A beta Xcode works without touching `xcode-select`:

```bash
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer bun run safari:app --signed
```

## Distribution

`safari:publish` builds the extension, syncs it into the container app,
archives a signed Release build, and uploads it to App Store Connect:

```bash
export APP_STORE_CONNECT_API_KEY_ID=...
export APP_STORE_CONNECT_API_ISSUER_ID=...
export APP_STORE_CONNECT_API_KEY_PATH=/absolute/path/to/AuthKey_....p8

bun run safari:validate                 # validate without uploading
bun run safari:publish -- --build 42    # archive and upload
```

The command needs an App ID and App Store Connect app record for
`org.verygoodadblock.VeryGoodAdBlock`. Use a stable Xcode release accepted by
App Store Connect. The checked-in `safariTeamId` supplies the team ID, and the
marketing version defaults to `package.json`.

For direct distribution outside the Mac App Store:

- **Developer ID + notarization** — archive, export with a Developer ID
  profile, then `xcrun notarytool submit … --wait && xcrun stapler staple
  VeryGoodAdBlock.app`. The project already enables the hardened runtime.

## Regenerating with Apple's converter (optional)

The checked-in project mirrors what
`safari-web-extension-converter` generates (Swift, macOS-only). If Apple
changes the template and you want a pristine reference:

```bash
bun run package:safari
unzip very-good-adblock-*-safari.zip -d /tmp/vga-safari
xcrun safari-web-extension-converter /tmp/vga-safari \
  --app-name VeryGoodAdBlock \
  --bundle-identifier org.verygoodadblock.VeryGoodAdBlock \
  --swift --macos-only --no-open
```

Keep the repo project as source of truth; use the converter output only to
diff template changes.
