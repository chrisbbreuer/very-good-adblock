/**
 * The Chrome Web Store's two promotional tiles.
 *
 * The listing takes three kinds of image and only one of them is a screenshot:
 * the small tile (440x280) is what a search result and a category row draw,
 * and the marquee (1400x560) is what a featured collection draws. Neither is a
 * crop of a screenshot — at 440x280 the popup's own labels are sub-pixel mush —
 * so they are composed here from the same palette, faces and captures as the
 * social cards and the App Store set (`config/images.ts`).
 *
 * Composed at final size rather than at 2x and downsampled: the type is drawn
 * by an anti-aliasing rasteriser at the size it ships, and the product shot is
 * a 780px-wide capture, so drawing it larger than that would only invent
 * detail and then blur it.
 *
 * Both tiles are written without an alpha channel — the store asks for "24-bit
 * PNG (no alpha)", and every pixel here is opaque anyway.
 */
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { png } from '@stacksjs/ts-png'
import { createSurface, drawImage, drawText, dropShadow, loadFont, parseColor } from 'ts-images'
import type { Font, ImageData, RGBA } from 'ts-images'
import images from '../../../config/images'

export interface PromoTile {
  /** File name written into the output directory. */
  name: string
  width: number
  height: number
}

export const promoTiles: PromoTile[] = [
  { name: 'promo-small.png', width: 440, height: 280 },
  { name: 'promo-marquee.png', width: 1400, height: 560 },
]

const headline = 'Ads gone before the page loads.'
const marqueeSubtitle = 'Blocks ads, pop-ups, and trackers at the source, before the page can show them.'
const smallSubtitle = 'Ads gone before the page loads.'
const eyebrow = 'CHROME · FIREFOX · SAFARI'

/** Compose both tiles and return them as encoded PNG bytes, keyed by file name. */
export async function renderPromoTiles(): Promise<Map<string, Uint8Array>> {
  const title = loadFont(new Uint8Array(await readFile(resolveFont(images.fonts?.title))))
  const body = loadFont(new Uint8Array(await readFile(resolveFont(images.fonts?.body ?? images.fonts?.title))))
  const mark = await loadImage(images.mark ?? 'public/icons/icon-128.png')
  const popup = await loadImage('dist/captures/popup.png')

  const out = new Map<string, Uint8Array>()
  for (const tile of promoTiles) {
    const canvas = await createSurface(tile.width, tile.height, background())
    if (tile.name === 'promo-small.png') drawSmall(canvas, { title, body, mark })
    else drawMarquee(canvas, { title, body, mark, popup })

    out.set(tile.name, encodeOpaquePng(canvas))
  }

  return out
}

/**
 * Encode as 24-bit RGB, dropping the alpha channel.
 *
 * Everything the Chrome Web Store takes — screenshots and both tiles — is
 * specified as "JPEG or 24-bit PNG (no alpha)", and `ts-images`' PNG encoder
 * always writes RGBA (it hands the codec four channels and never sets a colour
 * type). Every pixel produced here is opaque, so this drops a channel that
 * carries nothing and an upload cannot be refused over it.
 */
export function encodeOpaquePng(canvas: ImageData): Uint8Array {
  const buffer = png.sync.write(
    { width: canvas.width, height: canvas.height, data: Buffer.from(Uint8Array.from(canvas.data)) },
    { colorType: 2, inputHasAlpha: true, deflateLevel: 9 },
  )

  return new Uint8Array(buffer)
}

interface SmallParts {
  title: Font
  body: Font
  mark: ImageData
}

/**
 * 440x280, read at a glance in a list: the mark, the product's name, and one
 * line about it. A headline set to fill this canvas would be four words tall.
 */
function drawSmall(canvas: ImageData, parts: SmallParts): void {
  const pad = 34

  drawImage(canvas, parts.mark, { x: pad, y: 62, width: 60, height: 60 })

  drawText(canvas, {
    text: images.brand ?? 'Very Good AdBlock',
    font: parts.title,
    size: 34,
    x: pad,
    y: 170,
    maxWidth: canvas.width - pad * 2,
    lineHeight: 1.12,
    color: color(images.color, '#fbf3f3'),
  })

  drawText(canvas, {
    text: smallSubtitle,
    font: parts.body,
    size: 18,
    x: pad,
    y: 210,
    maxWidth: canvas.width - pad * 2 - 20,
    lineHeight: 1.45,
    maxLines: 2,
    color: muted(0.72),
  })
}

interface MarqueeParts extends SmallParts {
  popup: ImageData
}

/**
 * 1400x560, drawn large in a featured collection: the claim on the left, the
 * real popup on the right. The shot runs off the bottom edge on purpose — a
 * tile this wide with the whole thing floating in it reads as a slide.
 */
function drawMarquee(canvas: ImageData, parts: MarqueeParts): void {
  const left = 88
  const measure = 660

  drawImage(canvas, parts.mark, { x: left, y: 74, width: 46, height: 46 })

  drawText(canvas, {
    text: eyebrow,
    font: parts.body,
    size: 15,
    x: left + 62,
    y: 104,
    letterSpacing: 0.12,
    color: color(images.accent, '#ef4444'),
  })

  drawText(canvas, {
    text: headline,
    font: parts.title,
    size: 66,
    x: left,
    y: 216,
    maxWidth: measure,
    lineHeight: 1.08,
    maxLines: 2,
    color: color(images.color, '#fbf3f3'),
  })

  drawText(canvas, {
    text: marqueeSubtitle,
    font: parts.body,
    size: 23,
    x: left,
    y: 390,
    maxWidth: measure - 40,
    lineHeight: 1.5,
    maxLines: 2,
    color: muted(0.7),
  })

  // The capture is 780x1418; height drives the fit so the aspect is the
  // popup's own, and the bottom is allowed to leave the canvas.
  const shotHeight = 620
  const shotWidth = Math.round(shotHeight * (parts.popup.width / parts.popup.height))
  const shot = { x: 960, y: 92, width: shotWidth, height: shotHeight }
  const radius = Math.round(shotWidth * (images.device?.radius ?? 0.035) * 2)

  const shadow = images.device?.shadow
  dropShadow(canvas, { ...shot, radius }, {
    blur: 60,
    offsetY: 26,
    color: color(shadow ? shadow.color : undefined, '#00000080'),
  })
  drawImage(canvas, parts.popup, { ...shot, radius })
}

function background(): Parameters<typeof createSurface>[2] {
  const source = images.background
  if (!source) return undefined

  return {
    color: source.color ? parseColor(source.color) : undefined,
    gradient: source.gradient && {
      angle: source.gradient.angle,
      stops: source.gradient.stops.map(stop => ({ offset: stop.offset, color: parseColor(stop.color) })),
    },
    glows: source.glows?.map(glow => ({ ...glow, color: parseColor(glow.color) })),
  }
}

function color(value: string | undefined, fallback: string): RGBA {
  return parseColor(value ?? fallback)
}

/** The site's `--muted`: the text colour at a fraction of its opacity. */
function muted(alpha: number): RGBA {
  return { ...color(images.color, '#fbf3f3'), a: Math.round(alpha * 255) }
}

function resolveFont(spec: string | undefined): string {
  if (!spec) throw new Error('config/images.ts declares no fonts; the tiles have nothing to set type in.')
  return Bun.resolveSync(spec, process.cwd())
}

async function loadImage(path: string): Promise<ImageData> {
  const { decode } = await import('ts-images')
  return decode(new Uint8Array(await readFile(path)))
}
