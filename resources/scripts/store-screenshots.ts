/**
 * Build every store's screenshot set.
 *
 * Three steps, in order:
 *
 *   1. capture the real popup and dashboard, raw (`capture-surfaces.ts`);
 *   2. compose the App Store set from `config/images.ts` (`buddy
 *      generate:app-store`), which frames those captures at Apple's exact
 *      dimensions for every declared device class;
 *   3. downscale the Mac frames to the 1280x800 the Chrome Web Store and AMO
 *      accept — the same 16:10 ratio, so it is a resample and not a re-crop.
 *
 * This used to be one script that rendered a marketing frame in HTML per store
 * size and then leaned on `sips` to force the dimensions, which meant every new
 * device class was a new CSS block, every listing got exactly one screenshot,
 * and macOS was a build requirement. The composition now lives in `ts-images`,
 * so a device class — or a fourth slide — is a line of config.
 *
 * Run `bun run build` first (the `screenshots` script does this for you).
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { decode, encode, resize } from 'ts-images'

const appStoreDir = resolve('resources/app-store/screenshots')
// Committed, not left in dist/: the release workflow never runs a capture, so
// the Firefox preview sync has to find these in the checkout — and the Chrome
// Web Store has no API for listing images at all, so a human needs a stable
// path to upload from.
const webStoreDir = resolve('resources/web-store')

// The Chrome Web Store requires exactly 1280x800 (or 640x400); AMO accepts the
// same file.
const WEB_STORE = { width: 1280, height: 800 }

await run('bun', ['--bun', 'resources/scripts/capture-surfaces.ts'])
await run('bun', ['node_modules/@stacksjs/buddy/dist/cli.js', 'generate:app-store'])

if (!existsSync(appStoreDir))
  throw new Error(`${appStoreDir} is missing — did \`buddy generate:app-store\` run?`)

const desktop = (await readdir(appStoreDir))
  .filter(name => name.startsWith('app-desktop-') && name.endsWith('.png'))
  .sort()

if (!desktop.length)
  throw new Error('No app-desktop-*.png frames were generated; check `appStore.displays` in config/images.ts.')

await rm(webStoreDir, { recursive: true, force: true })
await mkdir(webStoreDir, { recursive: true })

for (const [index, name] of desktop.entries()) {
  const source = await decode(new Uint8Array(await readFile(join(appStoreDir, name))))
  const scaled = resize(source, { ...WEB_STORE, fit: 'cover' })
  const outPath = join(webStoreDir, `${String(index + 1).padStart(2, '0')}.png`)

  await writeFile(outPath, await encode(scaled, 'png'))
  console.log(`Wrote ${outPath} (${WEB_STORE.width}x${WEB_STORE.height})`)
}

async function run(command: string, args: string[]): Promise<void> {
  const proc = Bun.spawn([command, ...args], { stdout: 'inherit', stderr: 'inherit' })
  const code = await proc.exited
  if (code !== 0)
    throw new Error(`${command} ${args.join(' ')} exited with ${code}`)
}
