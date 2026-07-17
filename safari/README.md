# Very Good AdBlock for Safari

The macOS container app that ships the Safari Web Extension build of
[Very Good AdBlock](https://verygoodadblock.org).

- `VeryGoodAdBlock/` — the SwiftUI container app (shows extension state, opens
  Safari's extension settings).
- `VeryGoodAdBlock Extension/` — the Safari Web Extension target. Its
  `Resources/` folder is a git-ignored mirror of `dist-safari/`, produced by
  `bun run safari:sync`.
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
bun run safari:app            # build extension → validate → zip → sync → xcodebuild
```

or step by step:

```bash
bun run build:safari          # dist-safari/
bun run safari:sync           # mirror into "VeryGoodAdBlock Extension/Resources"
open safari/VeryGoodAdBlock.xcodeproj   # or: xcodebuild -project safari/VeryGoodAdBlock.xcodeproj -scheme VeryGoodAdBlock build
```

Then launch **VeryGoodAdBlock.app** once (it registers the extension with
Safari) and enable **Very Good AdBlock** in
*Safari → Settings → Extensions*, granting it website access.

## Signing

The project ships with `DEVELOPMENT_TEAM` empty so anyone can build.

**Local, unsigned (no Apple account):** `bun run safari:app` builds with
`CODE_SIGNING_ALLOWED=NO`. Unsigned extensions require
*Safari → Develop → Allow Unsigned Extensions* (resets on Safari updates).
If the Develop menu is hidden: *Settings → Advanced → Show Develop menu*.

**Signed (Apple Developer Program):** set your team in
`safari/VeryGoodAdBlock.xcodeproj` → target *Signing & Capabilities* → **Team**
(both targets), then:

```bash
bun run safari:app --signed            # Debug, Apple Development identity
bun run safari:app --signed --release  # Release
```

## Distribution

Two supported paths once signed:

- **Mac App Store** — `xcodebuild archive` (or Xcode → Product → Archive), then
  Xcode Organizer → Distribute App → App Store Connect. Needs an App ID for
  `org.verygoodadblock.VeryGoodAdBlock` (and the `.Extension` suffix id is
  covered by the same App Group-less setup) plus an App Store Connect record.
- **Developer ID + notarization** — archive, export with a Developer ID
  profile, then `xcrun notarytool submit … --wait && xcrun stapler staple
  VeryGoodAdBlock.app`. The project already enables the hardened runtime.

Either way, bump `MARKETING_VERSION` in the project when
[`package.json`](../package.json) releases.

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
