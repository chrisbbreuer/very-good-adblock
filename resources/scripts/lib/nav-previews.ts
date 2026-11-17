import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { crop, decode, encode, resize } from 'ts-images'

/**
 * The Features mega menu's preview images, one per feature, cut from the raw
 * surface captures so they always show the UI being shipped.
 *
 * Every preview shares one box (the menu's preview pane at 2x), so the menu
 * can stack them and cross-fade without anything shifting. Each capture is
 * cropped to that box's aspect ratio before it is scaled, anchored top-left:
 * the top of a surface is where its headline number and title live.
 */
const BOX = { width: 600, height: 520 }

const previews = [
  { name: 'network', source: 'popup.png' },
  { name: 'video', source: 'dashboard-protection.png' },
  { name: 'popups', source: 'popup-blocks.png' },
  { name: 'controls', source: 'dashboard.png' },
] as const

export async function writeNavPreviews(capturesDir: string, outDir: string): Promise<string[]> {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  const written: string[] = []
  const ratio = BOX.width / BOX.height

  for (const preview of previews) {
    const image = await decode(new Uint8Array(await readFile(join(capturesDir, preview.source))))
    const width = Math.min(image.width, Math.round(image.height * ratio))
    const height = Math.min(image.height, Math.round(width / ratio))
    const framed = resize(crop(image, { left: 0, top: 0, width, height }), { ...BOX, fit: 'cover' })
    const outPath = join(outDir, `${preview.name}.webp`)

    await writeFile(outPath, await encode(framed, 'webp', { quality: 84 }))
    written.push(outPath)
  }

  return written
}
