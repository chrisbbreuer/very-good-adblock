import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'

const dist = 'dist'
const manifestPath = join(dist, 'manifest.json')

if (!existsSync(manifestPath)) {
  throw new Error('dist/manifest.json is missing. Run bun run build first.')
}

const manifest = await Bun.file(manifestPath).json() as chrome.runtime.ManifestV3
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

for (const icon of Object.values(manifest.icons ?? {})) requiredFiles.add(icon)
for (const resource of manifest.declarative_net_request?.rule_resources ?? []) requiredFiles.add(resource.path)
for (const script of manifest.content_scripts ?? []) {
  for (const js of script.js ?? []) requiredFiles.add(js)
  for (const css of script.css ?? []) requiredFiles.add(css)
}

if (manifest.background && 'service_worker' in manifest.background) {
  requiredFiles.add(manifest.background.service_worker)
}

if (manifest.action?.default_popup) requiredFiles.add(manifest.action.default_popup)
if (manifest.options_page) requiredFiles.add(manifest.options_page)

for (const file of requiredFiles) {
  const path = join(dist, file)
  if (!existsSync(path)) throw new Error(`Manifest references missing file: ${file}`)
}

for (const [size, icon] of Object.entries(manifest.icons ?? {})) {
  if (extname(icon) !== '.png') throw new Error(`Manifest icon ${size} must be PNG for Chrome store readiness: ${icon}`)
  const bytes = await Bun.file(join(dist, icon)).arrayBuffer()
  if (bytes.byteLength < 100) throw new Error(`Manifest icon ${size} is unexpectedly small: ${icon}`)
}

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
}

console.log(`Validated MV3 artifact: ${requiredFiles.size} referenced files, ${staticRules.length} static rules`)
