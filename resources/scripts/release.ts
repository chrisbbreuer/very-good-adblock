/**
 * Release runner.
 *
 * Cuts a release without depending on the stacks bump action. Its staging
 * step git-adds a monorepo-only glob (anything under storage/framework
 * matching a nested package.json); this repo has no such file, so git exited
 * 128 on the unmatched pathspec and the release died after the version was
 * already bumped.
 *
 * Same outcome as before, explicitly:
 *   1. bump package.json (targeted edit; formatting preserved)
 *   2. sync bun.lock
 *   3. regenerate CHANGELOG.md through buddy (the same generator the old flow
 *      used), pointing the fresh section's compare link at the upcoming tag
 *   4. commit `chore: release x.y.z`, tag it, push branch + tag together —
 *      the v* tag is what triggers the Release workflow (Chrome Web Store,
 *      AMO, App Store Connect, GitHub Release)
 *
 * Usage:
 *   bun --bun resources/scripts/release.ts --bump patch|minor|major|x.y.z [--dry-run] [--no-push]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { $ } from 'bun'

export interface Options {
  bump: string
  dryRun: boolean
  noPush: boolean
}

const repositoryUrl = 'https://github.com/chrisbbreuer/very-good-adblock'
const changelogPath = 'CHANGELOG.md'
const packageJsonPath = 'package.json'

if (import.meta.main) {
  try {
    await run(parseArgs(process.argv.slice(2)))
  }
  catch (error) {
    console.error((error as Error).message)
    process.exit(1)
  }
}

export function parseArgs(argv: string[]): Options {
  let bump = ''
  let dryRun = false
  let noPush = false

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--bump') {
      bump = argv[++index] ?? ''
    }
    else if (arg.startsWith('--bump=')) {
      bump = arg.slice('--bump='.length)
    }
    else if (arg === '--dry-run') {
      dryRun = true
    }
    else if (arg === '--no-push') {
      noPush = true
    }
  }

  return { bump, dryRun, noPush }
}

export async function run(options: Options): Promise<void> {
  const current = await currentVersion()
  const next = nextVersion(current, options.bump)
  const tag = `v${next}`

  if (options.dryRun) {
    console.log(`[dry-run] would release ${current} → ${next} (${tag})`)
    console.log(`[dry-run] steps: bump ${packageJsonPath}, sync bun.lock, regenerate ${changelogPath}, commit "chore: release ${next}", tag ${tag}${options.noPush ? '' : ', push branch + tag'}`)
    return
  }

  await ensureCleanTree()
  await ensureTagFree(tag)
  const fromTag = await latestTag()

  writePackageJsonVersion(current, next)
  await $`bun install`.quiet()
  await regenerateChangelog(fromTag, tag)

  await git('add', packageJsonPath, 'bun.lock', changelogPath)
  await git('commit', '-m', `chore: release ${next}`)
  await git('tag', tag)

  if (options.noPush) {
    console.log(`✅ Released ${next} locally (--no-push): commit + tag created, nothing pushed`)
    return
  }

  const branch = (await git('rev-parse', '--abbrev-ref', 'HEAD')).trim()
  await git('push', 'origin', branch)
  await git('push', 'origin', tag)

  console.log(`🎉 Released ${next}! The ${tag} tag triggers the Release workflow:`)
  console.log(`${repositoryUrl}/actions`)
}

/** patch/minor/major arithmetic, or an explicit x.y.z passthrough. */
export function nextVersion(current: string, bump: string): string {
  const parts = current.split('.').map(part => Number.parseInt(part, 10))
  if (parts.length !== 3 || parts.some(part => !Number.isInteger(part) || part < 0)) {
    throw new Error(`Unsupported current version "${current}"`)
  }

  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump

  const [major, minor, patch] = parts
  switch (bump) {
    case 'patch': return `${major}.${minor}.${patch + 1}`
    case 'minor': return `${major}.${minor + 1}.0`
    case 'major': return `${major + 1}.0.0`
    default: throw new Error(`--bump must be patch, minor, major, or x.y.z — got "${bump}"`)
  }
}

async function currentVersion(): Promise<string> {
  const json = JSON.parse(await Bun.file(packageJsonPath).text()) as { version?: string }
  if (!json.version) throw new Error(`No version field in ${packageJsonPath}`)
  return json.version
}

/** Targeted replace so the file's formatting and key order are untouched. */
function writePackageJsonVersion(current: string, next: string): void {
  const contents = readFileSync(packageJsonPath, 'utf8')
  const updated = contents.replace(`"version": "${current}"`, `"version": "${next}"`)
  if (updated === contents) {
    throw new Error(`Could not find "version": "${current}" in ${packageJsonPath}`)
  }
  writeFileSync(packageJsonPath, updated)
}

/**
 * Regenerate the changelog with buddy and point its fresh top section's
 * compare link at the tag about to be cut. Standalone, buddy writes the new
 * section with a `...HEAD` link (and picks its own base), so the first such
 * link in the file is rewritten to `${fromTag}...${tag}` — matching every
 * released section around it.
 */
async function regenerateChangelog(fromTag: string | undefined, tag: string): Promise<void> {
  const result = await $`bunx --bun buddy changelog`.quiet().nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`buddy changelog failed with exit code ${result.exitCode}`)
  }

  const contents = await Bun.file(changelogPath).text()
  const headLink = /compare\/[^)\s]*\.\.\.HEAD\)/
  if (!headLink.test(contents)) return

  const replacement = `compare/${fromTag ?? 'HEAD~'}...${tag})`
  await Bun.write(changelogPath, contents.replace(headLink, replacement))
}

async function latestTag(): Promise<string | undefined> {
  const result = await $`git describe --tags --abbrev=0`.quiet().nothrow()
  if (result.exitCode !== 0) return undefined
  return result.text().trim() || undefined
}

async function ensureCleanTree(): Promise<void> {
  const status = await git('status', '--porcelain')
  const dirty = status.split('\n').filter(line => line.trim() && !line.startsWith('??'))
  if (dirty.length) {
    throw new Error(`Refusing to release with uncommitted changes:\n${dirty.join('\n')}`)
  }
}

async function ensureTagFree(tag: string): Promise<void> {
  const existing = await git('tag', '--list', tag)
  if (existing.trim()) throw new Error(`Tag ${tag} already exists`)
}

async function git(...args: string[]): Promise<string> {
  const result = await $`git ${args}`.quiet()
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed with exit code ${result.exitCode}: ${result.stderr.toString()}`)
  }
  return result.text()
}
