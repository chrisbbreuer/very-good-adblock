#!/usr/bin/env bun
/**
 * Cut a release: bump the version in package.json, regenerate CHANGELOG.md
 * with changelogen, commit, tag `v*`, and push. The pushed tag then triggers
 * the Release workflow (.github/workflows/release.yml), which packages the
 * extensions and creates the GitHub Release.
 *
 * `buddy release` cannot do this in a consumer project — its bump step reads
 * the Stacks framework monorepo at storage/framework — so this script stays
 * repo-local and dependency-light.
 *
 * Usage: bun --bun scripts/release.ts --bump <patch|minor|major|x.y.z> [--dry-run]
 */
import { $ } from 'bun'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const bumpIndex = args.indexOf('--bump')
const bump = bumpIndex >= 0 ? args[bumpIndex + 1] : ''
const explicitVersion = /^\d+\.\d+\.\d+$/.test(bump)

if (!['patch', 'minor', 'major'].includes(bump) && !explicitVersion) {
  console.error('Usage: bun --bun scripts/release.ts --bump <patch|minor|major|x.y.z> [--dry-run]')
  process.exit(1)
}

const branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim()
if (branch !== 'main') fail(`Releases are cut from main (currently on ${branch}).`)

const dirty = (await $`git status --porcelain`.text()).trim()
if (dirty) fail('Working tree is not clean. Commit or stash everything first.')

// Fetch failure is fatal for a real run (stale tags are dangerous), but only a
// warning for a dry run so the plan can still be reviewed offline.
const fetchResult = await $`git fetch origin --tags`.quiet().nothrow()
if (fetchResult.exitCode !== 0 && !dryRun) fail('Could not fetch origin — check the network and credentials.')
if (fetchResult.exitCode !== 0) console.warn('warning: could not fetch origin; tag/version checks use local state only')

const head = (await $`git rev-parse HEAD`.text()).trim()
const remote = (await $`git rev-parse origin/main`.text()).trim()
if (head !== remote) fail(`main is not in sync with origin/main (${head.slice(0, 7)} vs ${remote.slice(0, 7)}). Pull or push first.`)

const manifestPath = 'package.json'
const manifest = await Bun.file(manifestPath).text()
const versionMatch = manifest.match(/"version": "([^"]+)"/)
if (!versionMatch) fail('No top-level "version" found in package.json.')
const current = versionMatch[1]
if (manifest.split(`"version": "${current}"`).length !== 2) fail(`"version": "${current}" is ambiguous in package.json.`)

const next = explicitVersion ? bump : bumpVersion(current, bump as 'patch' | 'minor' | 'major')
if ((await $`git tag -l v${next}`.text()).trim()) fail(`Tag v${next} already exists.`)

const previousTag = (await $`git describe --abbrev=0 --tags`.text()).trim()
const commitCount = Number((await $`git rev-list --count ${previousTag}..HEAD`.text()).trim())
const remoteUrl = (await $`git remote get-url origin`.text()).trim()
const repoUrl = remoteUrl.replace(/\.git$/, '').replace(/^git@([^:]+):/, 'https://$1/')

const steps = [
  `bump package.json ${current} → ${next} (${commitCount} commits since ${previousTag})`,
  `regenerate CHANGELOG.md (changelogen --from ${previousTag} --to HEAD -r ${next})`,
  `git commit -m "chore: release v${next}"`,
  `git tag v${next}`,
  'git push origin main && git push origin the new tag',
  `Release workflow then runs at ${repoUrl}/actions`,
]

if (dryRun) {
  console.log(`Dry run — no changes. Releasing v${next} would:\n${steps.map((step, index) => `  ${index + 1}. ${step}`).join('\n')}`)
  process.exit(0)
}

await Bun.write(manifestPath, manifest.replace(`"version": "${current}"`, `"version": "${next}"`))
await $`bunx --bun changelogen --output CHANGELOG.md --from ${previousTag} --to HEAD -r ${next}`
await $`git add package.json CHANGELOG.md`
await $`git commit -m ${`chore: release v${next}`}`
await $`git tag v${next}`
await $`git push origin main`
await $`git push origin v${next}`

console.log(`Released v${next}. The Release workflow is running: ${repoUrl}/actions`)

function bumpVersion(version: string, type: 'patch' | 'minor' | 'major'): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!match) fail(`Cannot parse current version "${version}" — pass an explicit x.y.z instead.`)
  const [, major, minor, patch] = match.map(Number)
  if (type === 'major') return `${major + 1}.0.0`
  if (type === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

function fail(message: string): never {
  console.error(`release: ${message}`)
  process.exit(1)
}
