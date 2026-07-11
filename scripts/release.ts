#!/usr/bin/env bun
/**
 * Cut a release: bump the version (bumpx), regenerate + version-stamp the
 * changelog (logsmith), commit, tag `v<version>` and push. The pushed tag fires
 * `.github/workflows/release.yml`, which builds + packages the extension and
 * creates the GitHub Release, extracting this version's notes from CHANGELOG.md.
 *
 * This is the exact flow the Stacks CLI's `buddy release` wraps (bumpx +
 * logsmith), run directly so it works before the framework ships the
 * consumer-app-aware version. Swap `bun run release` back to `buddy release`
 * once the framework is published.
 *
 *   bun run release              # interactive bump
 *   bun run release --bump patch # non-interactive
 *   bun run release --dry-run    # print, don't write/commit
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { versionBump } from '@stacksjs/bumpx'
import { generateChangelog, loadLogsmithConfig } from '@stacksjs/logsmith'

const root = resolve(import.meta.dir, '..')
const manifestPath = resolve(root, 'package.json')
const changelogPath = resolve(root, 'CHANGELOG.md')

const args = Bun.argv.slice(2)
const isDryRun = args.includes('--dry-run')
const bumpFlag = args.includes('--bump') ? args[args.indexOf('--bump') + 1] : undefined

function currentVersion(): string {
  return (JSON.parse(readFileSync(manifestPath, 'utf-8')) as { version?: string }).version ?? '0.0.0'
}

// Resolve patch|minor|major to a concrete x.y.z (an explicit version passes through).
function resolveRelease(bump: string | undefined): string | undefined {
  if (!bump || /^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(bump))
    return bump
  const match = currentVersion().match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!match)
    return bump
  const [, major, minor, patch] = match.map(Number)
  if (bump === 'major')
    return `${major + 1}.0.0`
  if (bump === 'minor')
    return `${major}.${minor + 1}.0`
  if (bump === 'patch')
    return `${major}.${minor}.${patch + 1}`
  return bump
}

const release = resolveRelease(bumpFlag)

async function git(...cmd: string[]): Promise<string> {
  const result = await Bun.$`git ${cmd}`.cwd(root).quiet().nothrow()
  if (result.exitCode !== 0)
    throw new Error(`git ${cmd.join(' ')} failed: ${result.stderr.toString().trim()}`)
  return result.stdout.toString().trim()
}

// 1. Bump the version in package.json via bumpx's SDK (no git — we handle it).
await versionBump({
  release: release ?? undefined,
  files: ['./package.json'],
  cwd: root,
  recursive: false,
  commit: false,
  tag: false,
  push: false,
  changelog: false,
  noGitCheck: true,
  dryRun: isDryRun,
  yes: Boolean(release),
})

const nextVersion = isDryRun && release ? release : currentVersion()

// 2. Regenerate the changelog for this release via logsmith's SDK.
const latestTag = (await git('describe', '--abbrev=0', '--tags').catch(() => '')) || undefined
const config = await loadLogsmithConfig({
  dir: root,
  from: latestTag,
  to: 'HEAD',
  output: isDryRun ? false : 'CHANGELOG.md',
  theme: 'github',
})
const result = await generateChangelog(config)

if (isDryRun) {
  console.log(result.content)
  process.exit(0)
}

// 3. Stamp the release version into the committed changelog so CI can extract
//    this release's notes by tag (logsmith headers the new section `…HEAD`).
if (existsSync(changelogPath)) {
  let content = readFileSync(changelogPath, 'utf-8')
  const versionSeen = new RegExp(`\\bv?${nextVersion.replace(/\./g, '\\.')}\\b`)
  if (/\/compare\/[^)\s]+\.\.\.HEAD\)/.test(content))
    content = content.replace(/(\/compare\/[^)\s]+\.\.\.)HEAD(\))/, `$1v${nextVersion}$2`)
  else if (!versionSeen.test(content.split('\n').slice(0, 4).join('\n')))
    content = content.replace(/^(#\s.*\n+)?/, match => `${match ?? ''}## v${nextVersion}\n\n`)
  writeFileSync(changelogPath, content)
}

// 4. Commit, tag and push — the tag triggers the release workflow.
await git('add', '--all')
await git('commit', '-m', `chore: release v${nextVersion}`)
await git('tag', `v${nextVersion}`)
await git('push')
await git('push', 'origin', `v${nextVersion}`)

console.log(`Released v${nextVersion} — the release workflow will publish the packaged extension.`)
