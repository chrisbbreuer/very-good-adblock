import { buildExtension } from '@stacksjs/browser-extension'
import extension from '../config/extension'
import packageJson from '../package.json'

/**
 * Safari Web Extension build.
 *
 * buddy's `extension:build` only knows the chrome/firefox targets, so the
 * Safari bundle is produced here: build the Chrome-shaped output into
 * `dist-safari`, then post-process it into something Safari will load:
 *
 *   1. Manifest — drop Chrome-only keys (`minimum_chrome_version`, the
 *      `type: "module"` background hint the IIFE bundle doesn't need) and pin
 *      `browser_specific_settings.safari.strict_min_version` to 18.4, the
 *      first Safari with everything this extension uses: `world: "MAIN"`
 *      content scripts (18.0) and `match_about_blank` (18.4) for the in-page
 *      pruners/pop-up guard, MV3 service workers (15.4), and
 *      declarativeNetRequest incl. dynamic rules + getMatchedRules (15.4).
 *   2. Namespace — the codebase calls promise-style `chrome.*` (49 sites).
 *      Safari's `chrome.*` namespace is callback-flavoured while `browser.*`
 *      is promise-native, so every shipped bundle is rewritten from
 *      `chrome.<api>.` to `browser.<api>.` for the known API surface. The
 *      rewrite is anchored to the audited API list, so string literals (UA
 *      labels, "Chrome 126 on macOS") are never touched.
 *
 * Output feeds two consumers: `package:safari` (a zip, the input format
 * `xcrun safari-web-extension-converter` expects) and `safari:sync`, which
 * mirrors the bundle into the Xcode project's extension Resources.
 */

const outdir = 'dist-safari'

// The Chrome build shape is the right base: Safari 15.4+ runs MV3 background
// service workers, and the manifest differs from Chrome's only in the keys
// rewritten below.
const { outdir: built } = await buildExtension(extension, {
  target: 'chrome',
  version: packageJson.version,
  outdir,
})

// ---------------------------------------------------------------------------
// 1. Manifest
// ---------------------------------------------------------------------------

interface SafariManifest {
  minimum_chrome_version?: string
  background?: Record<string, unknown>
  browser_specific_settings?: Record<string, unknown>
  [key: string]: unknown
}

const manifestPath = `${built}/manifest.json`
const manifest = await Bun.file(manifestPath).json() as SafariManifest

delete manifest.minimum_chrome_version

// Keep the service worker (Safari 15.4+), drop the `type: "module"` hint —
// the bundle is a classic IIFE, and module workers buy nothing here.
manifest.background = { service_worker: 'background.js' }

// gecko settings are Firefox-only; Safari reads its own sub-key.
// strict_min_version 18.4 = first Safari with MAIN-world scripts + match_about_blank.
manifest.browser_specific_settings = {
  safari: { strict_min_version: '18.4' },
}

await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

// ---------------------------------------------------------------------------
// 2. chrome.* → browser.* namespace rewrite (promise parity)
// ---------------------------------------------------------------------------

// Anchored to the complete audited API surface (see docs/architecture/safari.md).
// Only `chrome.<ns>.` / `chrome.<ns>?.` with a known namespace is rewritten —
// nothing else in the bundles can match, so string literals are structurally
// safe. The `[?.]` lookahead covers optional-chained namespaces
// (`chrome.alarms?.create`, where `?.` directly follows the namespace).
const apiNamespaces = ['runtime', 'tabs', 'declarativeNetRequest', 'storage', 'action', 'alarms']
const namespacePattern = new RegExp(`\\bchrome\\.(?=(?:${apiNamespaces.join('|')})[?.])`, 'g')

// Every shipped bundle that can hold extension-API calls. The MAIN-world
// inpage scripts (x/yt/popup-guard) use page globals only and are skipped.
const bundles = ['background.js', 'content.js', 'popup.js', 'options.js']

for (const file of bundles) {
  const path = `${built}/${file}`
  const source = await Bun.file(path).text()
  const rewritten = source.replace(namespacePattern, 'browser.')
  const replacements = source.length !== rewritten.length
  if (replacements) await Bun.write(path, rewritten)

  const count = (source.match(namespacePattern) ?? []).length
  console.log(`${file}: rewrote ${count} chrome.* call${count === 1 ? '' : 's'} to browser.*`)
}

console.log(`Safari extension built at ${built}/ (manifest ${manifest.manifest_version}, strict_min_version 18.4)`)
