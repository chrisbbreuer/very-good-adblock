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
import { decode, layoutText, loadFont, socialCardMetrics } from 'ts-images'
import config from '../../config/images'

// The column is asked for, not re-derived. It used to be spelled out here as
// `width * 0.54 - margin * 2`, which was exactly right until the renderer
// stopped reserving a fixed column and started sizing the shot off its own
// height — at which point this would have kept rejecting copy that now fits.
// It also varies per page: a tall popup leaves the headline more room than a
// wide dashboard panel does.
const WIDTH = 1200
const HEIGHT = 630
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

/** The measure a page's copy actually gets, given the shot beside it. */
async function columnFor(shot: string | undefined): Promise<number> {
  if (!shot)
    return socialCardMetrics({ width: WIDTH, height: HEIGHT }).textWidth

  const image = await decode(new Uint8Array(await readFile(shot)))
  return socialCardMetrics({
    width: WIDTH,
    height: HEIGHT,
    foreground: { aspect: image.width / image.height, scale: config.social?.device?.scale },
  }).textWidth
}

function lines(text: string, box: number, options: { font: ReturnType<typeof loadFont>, size: number, tracking?: number }): string[] {
  return layoutText({
    text,
    font: options.font,
    size: options.size,
    maxWidth: box,
    lineHeight: 1.14,
    letterSpacing: options.tracking,
    // Deliberately unbounded: the question is how many lines the string wants,
    // not how many it is allowed, and asking for the cap would hide the answer.
    maxLines: 99,
  }).lines
}

const failures: string[] = []

let narrowest = Number.POSITIVE_INFINITY

for (const page of config.social?.pages ?? []) {
  const box = await columnFor(page.foreground ?? config.social?.foreground)
  narrowest = Math.min(narrowest, box)

  const title = lines(page.title, box, { font: titleFont, size: TITLE_SIZE, tracking: -0.018 })
  if (title.length > TITLE_LINES)
    failures.push(`${page.path} title needs ${title.length} lines, ${TITLE_LINES} render: "${title.slice(0, TITLE_LINES).join(' ')}" (dropped "${title.slice(TITLE_LINES).join(' ')}")`)

  if (!page.subtitle)
    continue

  const subtitle = lines(page.subtitle, box, { font: bodyFont, size: SUBTITLE_SIZE })
  if (subtitle.length > SUBTITLE_LINES)
    failures.push(`${page.path} subtitle needs ${subtitle.length} lines, ${SUBTITLE_LINES} renders: "${subtitle.slice(0, SUBTITLE_LINES).join(' ')}" (dropped "${subtitle.slice(SUBTITLE_LINES).join(' ')}")`)
}

if (failures.length) {
  console.error('Social card copy overflows its column:\n')
  for (const failure of failures)
    console.error(`  ${failure}`)
  console.error('\nShorten the strings in config/images.ts.')
  process.exit(1)
}

const measured = config.social?.pages?.length ?? 0
console.log(`Social card copy fits: ${measured} page(s), narrowest column ${Number.isFinite(narrowest) ? Math.round(narrowest) : 0}px.`)
