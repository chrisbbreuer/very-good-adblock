import { existsSync } from 'node:fs'

/**
 * Build the Safari container app from the current extension source.
 *
 * Pipeline: dist-safari (must exist — run `bun run package:safari`, or let
 * `safari:app` do it) → sync into the Xcode project's extension Resources →
 * xcodebuild. The Xcode project is checked in (safari/), so no
 * safari-web-extension-converter step is needed; `safari/README.md` documents
 * how to regenerate it that way if Apple changes the template.
 *
 * Flags:
 *   --release   Build the Release configuration (default Debug).
 *   --signed    Allow code signing (requires an Apple Development identity).
 *               Without it, an unsigned local build is produced — loadable
 *               after enabling "Allow Unsigned Extensions" in Safari's
 *               Develop menu. Signing needs full Xcode + a developer account.
 */

const release = Bun.argv.includes('--release')
const signed = Bun.argv.includes('--signed')

const project = 'safari/VeryGoodAdBlock.xcodeproj'
const derivedData = 'safari/build'
const configuration = release ? 'Release' : 'Debug'

if (!existsSync('dist-safari/manifest.json')) {
  throw new Error('dist-safari/manifest.json is missing. Run bun run build:safari first.')
}

// 1. Mirror the extension bundle into the appex Resources.
await Bun.$`bun --bun scripts/safari-sync-resources.ts`

// 2. xcodebuild needs full Xcode, not just the Command Line Tools.
const developerDir = (await Bun.$`xcode-select -p`.text()).trim()
if (!developerDir.includes('Xcode.app')) {
  console.error(`
Full Xcode is required to build the app, but the active developer directory is
${developerDir}

Install Xcode from the Mac App Store (or developer.apple.com/download), then:
  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
  xcodebuild -license accept   # first launch only
and re-run this script.

The extension bundle itself is already built and synced:
  dist-safari/                                    → the web extension
  safari/VeryGoodAdBlock Extension/Resources/     → the appex payload

Alternative without this repo's checked-in project:
  xcrun safari-web-extension-converter dist-safari --app-name "VeryGoodAdBlock" \\
    --bundle-identifier org.verygoodadblock.VeryGoodAdBlock --swift --macos-only
`)
  process.exit(1)
}

// 3. Build.
const signing = signed ? [] : ['CODE_SIGNING_ALLOWED=NO']
await Bun.$`xcodebuild -project ${project} -scheme VeryGoodAdBlock -configuration ${configuration} -derivedDataPath ${derivedData} ${signing} build`

const appPath = `${derivedData}/Build/Products/${configuration}/VeryGoodAdBlock.app`
console.log(`
Built ${appPath}

Next steps:
  1. Open the app once (registers the extension with Safari).
  2. Enable "Very Good AdBlock" in Safari → Settings → Extensions.
  ${signed ? '3. For distribution: xcodebuild archive + notarize, or upload via Xcode Organizer. See safari/README.md.' : 'Unsigned build: enable Develop → Allow Unsigned Extensions in Safari first (re-checks after every Safari update).'}
`)
