import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { GeneratedManifest as BuildManifestResult } from '@stacksjs/browser-extension'

const targetArg = Bun.argv.find(arg => arg.startsWith('--target='))?.split('=')[1]
const target = targetArg === 'firefox' || targetArg === 'safari' ? targetArg : 'chrome'
const dist = target === 'firefox' ? 'dist-firefox' : target === 'safari' ? 'dist-safari' : 'dist'
const manifestPath = join(dist, 'manifest.json')

if (!existsSync(manifestPath)) {
  throw new Error(`${manifestPath} is missing. Run bun run build:${target} first.`)
}

const manifest = await Bun.file(manifestPath).json() as BuildManifestResult
const requiredFiles = new Set<string>([
  'popup.html',
  'options.html',
  'background.js',
  'content.js',
  'popup.js',
  'options.js',
  'styles.css',
  'rules/static.json',
])

// Cast to a plain record: Omit<> in BuildManifestResult drops ManifestBase's index
// signature, which otherwise makes TS infer `unknown` for Object.values/entries here.
const icons = (manifest.icons ?? {}) as Record<string, string>

for (const icon of Object.values(icons)) requiredFiles.add(icon)
for (const resource of manifest.declarative_net_request?.rule_resources ?? []) requiredFiles.add(resource.path)
for (const script of manifest.content_scripts ?? []) {
  for (const js of script.js ?? []) requiredFiles.add(js)
  for (const css of (script as { css?: string[] }).css ?? []) requiredFiles.add(css)
}

const webAccessible = new Set<string>()
for (const entry of manifest.web_accessible_resources ?? []) {
  for (const resource of (entry as { resources?: string[] }).resources ?? []) {
    webAccessible.add(resource)
    requiredFiles.add(resource)
  }
}

if (manifest.background && 'service_worker' in manifest.background) {
  requiredFiles.add(manifest.background.service_worker)
}
if (manifest.background && 'scripts' in manifest.background) {
  for (const script of manifest.background.scripts ?? []) requiredFiles.add(script)
}

if (manifest.action?.default_popup) requiredFiles.add(manifest.action.default_popup)
if (manifest.options_page) requiredFiles.add(manifest.options_page)

if (target === 'firefox') {
  if (!manifest.browser_specific_settings?.gecko?.id) throw new Error('Firefox manifest is missing browser_specific_settings.gecko.id')
  if (!manifest.background || !('scripts' in manifest.background)) throw new Error('Firefox manifest must use background.scripts, not a service worker')
}
else if (target === 'safari') {
  // GeneratedManifest types browser_specific_settings as gecko-only; Safari
  // replaces it wholesale, so read it as a loose record here.
  const bss = manifest.browser_specific_settings as ({ safari?: { strict_min_version?: string } } & Record<string, unknown>) | undefined
  const background = manifest.background as Record<string, unknown> | undefined
  if (!bss?.safari?.strict_min_version) throw new Error('Safari manifest is missing browser_specific_settings.safari.strict_min_version')
  if (bss && 'gecko' in bss) throw new Error('Safari manifest must not carry Firefox gecko settings')
  if (manifest.minimum_chrome_version) throw new Error('Safari manifest must not carry minimum_chrome_version')
  // Service worker (Safari 15.4+) without the module hint — the bundle is a classic IIFE.
  if (!background || !('service_worker' in background)) throw new Error('Safari manifest must use background.service_worker')
  if ('type' in background) throw new Error('Safari background must not declare type: module (IIFE bundle)')

  // The Safari build rewrites promise-style chrome.* to browser.* (Safari's
  // chrome.* is callback-flavoured). Any leftover chrome.* API access in a
  // shipped bundle is a build-pipeline bug. `[?.]` also catches optional-
  // chained namespaces (`chrome.alarms?.`).
  const chromeApiLeft = /\bchrome\.(?:runtime|tabs|declarativeNetRequest|storage|action|alarms)[?.]/
  for (const bundle of ['background.js', 'content.js', 'popup.js', 'options.js']) {
    const code = await Bun.file(join(dist, bundle)).text()
    if (chromeApiLeft.test(code)) throw new Error(`${bundle} still uses the chrome.* namespace — run bun run build:safari`)
  }
}
else if (manifest.background && !('service_worker' in manifest.background)) {
  throw new Error('Chrome manifest must use background.service_worker')
}

for (const file of requiredFiles) {
  const path = join(dist, file)
  if (!existsSync(path)) throw new Error(`Manifest references missing file: ${file}`)
}

for (const [size, icon] of Object.entries(icons)) {
  if (extname(icon) !== '.png') throw new Error(`Manifest icon ${size} must be PNG for store readiness: ${icon}`)
  const bytes = await Bun.file(join(dist, icon)).arrayBuffer()
  if (bytes.byteLength < 100) throw new Error(`Manifest icon ${size} is unexpectedly small: ${icon}`)
}

// Only the genuine extension pages run under the MV3 CSP. The marketing site
// pages (marketing/features + per-feature) are built here for the site build but
// served on the web, where root-relative links are correct and expected — they
// are excluded from the store package (see package-extension.ts).
for (const htmlFile of ['popup.html', 'options.html']) {
  const html = await Bun.file(join(dist, htmlFile)).text()
  const inlineScript = /<script(?![^>]+\bsrc=)[^>]*>/i
  const inlineStyle = /<style\b/i
  const inlineHandler = /\son[a-z]+=/i
  const absoluteExtensionAsset = /(href|src)="\//i

  if (inlineScript.test(html)) throw new Error(`${htmlFile} contains an inline script`)
  if (inlineStyle.test(html)) throw new Error(`${htmlFile} contains an inline style`)
  if (inlineHandler.test(html)) throw new Error(`${htmlFile} contains an inline event handler`)
  if (absoluteExtensionAsset.test(html)) throw new Error(`${htmlFile} contains a root-relative extension asset URL`)
}

const staticRules = await Bun.file(join(dist, 'rules/static.json')).json() as chrome.declarativeNetRequest.Rule[]
if (!Array.isArray(staticRules) || staticRules.length < 1000) throw new Error('Static ruleset is too small')

const ruleIds = new Set<number>()
for (const rule of staticRules) {
  if (ruleIds.has(rule.id)) throw new Error(`Duplicate static DNR id: ${rule.id}`)
  ruleIds.add(rule.id)
  if (!rule.action?.type) throw new Error(`Static DNR rule ${rule.id} has no action`)
  if (!rule.condition?.resourceTypes?.length) throw new Error(`Static DNR rule ${rule.id} has no resource types`)

  const extensionPath = (rule.action as { redirect?: { extensionPath?: string } }).redirect?.extensionPath
  if (rule.action.type === 'redirect' && extensionPath) {
    const relative = extensionPath.replace(/^\//, '')
    if (!existsSync(join(dist, relative))) throw new Error(`Redirect rule ${rule.id} targets missing file: ${extensionPath}`)
    if (!webAccessible.has(relative)) throw new Error(`Redirect rule ${rule.id} target is not web-accessible: ${extensionPath}`)
  }
}

console.log(`Validated ${target} MV3 artifact: ${requiredFiles.size} referenced files, ${staticRules.length} static rules`)
