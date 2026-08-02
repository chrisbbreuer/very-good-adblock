/**
 * Fail the build when a social card's copy would be silently truncated.
 *
 * `generateSocialCard` caps a title at three lines and a subtitle at one, and
 * drops whatever is left with no ellipsis and no warning. On the 1.91:1 card
 * the text column is 492px wide next to the product shot, which is narrow
 * enough that a normal sentence overflows: six of the seven cards were
 * shipping headlines that stopped mid-clause, and nothing in the pipeline
 * said so. The cards render, the build passes, and the link preview reads
 * "Blocked before the request".
 *
 * So the copy is measured here against the same fonts and the same box the
 * renderer uses, and an overflow stops the build instead of shipping.
 */
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { layoutText, loadFont } from 'ts-images'
import config from '../../config/images'

// Mirrors the renderer's own arithmetic: the margin is 6.5% of the width, the
// title 6.2%, the subtitle 2.45%, and a card with a product shot gives its
// text `textWidth` (0.54 by default) of the canvas minus both margins.
const WIDTH = 1200
const MARGIN = Math.round(WIDTH * 0.065)
const TEXT_WIDTH = (config.social?.device as { textWidth?: number } | undefined)?.textWidth ?? 0.54
const BOX = WIDTH * TEXT_WIDTH - MARGIN * 2
const TITLE_SIZE = Math.round(WIDTH * 0.062)
const SUBTITLE_SIZE = Math.round(WIDTH * 0.0245)
const TITLE_LINES = 3
const SUBTITLE_LINES = 1

async function font(spec: string): Promise<ReturnType<typeof loadFont>> {
  return loadFont(new Uint8Array(await readFile(Bun.resolveSync(spec, process.cwd()))))
}

// The renderer refuses to draw without a title font, so a config that has none
// never gets far enough to truncate anything.
if (!config.fonts?.title)
  throw new Error('config/images.ts has no `fonts.title`; there is nothing to measure against.')

const titleFont = await font(config.fonts.title)
const bodyFont = config.fonts.body ? await font(config.fonts.body) : titleFont

function lines(text: string, options: { font: ReturnType<typeof loadFont>, size: number, tracking?: number }): string[] {
  return layoutText({
    text,
    font: options.font,
    size: options.size,
    maxWidth: BOX,
    lineHeight: 1.14,
    letterSpacing: options.tracking,
    // Deliberately unbounded: the question is how many lines the string wants,
    // not how many it is allowed, and asking for the cap would hide the answer.
    maxLines: 99,
  }).lines
}

const failures: string[] = []

for (const page of config.social?.pages ?? []) {
  const title = lines(page.title, { font: titleFont, size: TITLE_SIZE, tracking: -0.018 })
  if (title.length > TITLE_LINES)
    failures.push(`${page.path} title needs ${title.length} lines, ${TITLE_LINES} render: "${title.slice(0, TITLE_LINES).join(' ')}" (dropped "${title.slice(TITLE_LINES).join(' ')}")`)

  if (!page.subtitle)
    continue

  const subtitle = lines(page.subtitle, { font: bodyFont, size: SUBTITLE_SIZE })
  if (subtitle.length > SUBTITLE_LINES)
    failures.push(`${page.path} subtitle needs ${subtitle.length} lines, ${SUBTITLE_LINES} renders: "${subtitle.slice(0, SUBTITLE_LINES).join(' ')}" (dropped "${subtitle.slice(SUBTITLE_LINES).join(' ')}")`)
}

if (failures.length) {
  console.error(`Social card copy overflows its ${Math.round(BOX)}px column:\n`)
  for (const failure of failures)
    console.error(`  ${failure}`)
  console.error('\nShorten the strings in config/images.ts.')
  process.exit(1)
}

console.log(`Social card copy fits: ${config.social?.pages?.length ?? 0} pages measured against a ${Math.round(BOX)}px column.`)
