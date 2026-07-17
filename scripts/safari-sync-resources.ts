import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Mirror the Safari extension bundle (dist-safari) into the Xcode project's
 * extension Resources folder. The project references Resources as a folder
 * (blue folder), so everything synced here lands in the appex verbatim — the
 * sync is the single source of truth for what ships in the app.
 *
 * Run after `bun run build:safari`. The folder contents are git-ignored (they
 * are build output); regenerate with `bun run safari:sync`.
 */

const dist = 'dist-safari'
const resources = join('safari', 'VeryGoodAdBlock Extension', 'Resources')

// Site-only pages built into dist for the marketing site — not part of the
// extension, never shipped in the app (mirrors package-extension.ts).
const siteOnly = new Set([
  'marketing.html',
  'marketing.js',
  'features.html',
  'network-blocking.html',
  'youtube-twitch.html',
  'popups.html',
  'controls.html',
])

if (!existsSync(join(dist, 'manifest.json'))) {
  throw new Error(`${dist}/manifest.json is missing. Run bun run build:safari first.`)
}

function* walk(dir: string, prefix = ''): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const rel = prefix ? `${prefix}/${entry}` : entry
    if (statSync(join(dir, entry)).isDirectory()) yield* walk(join(dir, entry), rel)
    else yield rel
  }
}

// Clear everything except the .gitkeep placeholder, then copy fresh.
if (existsSync(resources)) {
  for (const entry of readdirSync(resources)) {
    if (entry !== '.gitkeep') rmSync(join(resources, entry), { recursive: true, force: true })
  }
}

let copied = 0
for (const rel of walk(dist)) {
  if (siteOnly.has(rel)) continue
  cpSync(join(dist, rel), join(resources, rel))
  copied += 1
}

console.log(`Synced ${copied} files from ${dist}/ to ${resources}/ (excluded ${siteOnly.size} site-only files)`)
