/**
 * Capture the extension's surfaces raw: no frame, no caption, no bezel.
 *
 * This used to be fused with the store-screenshot composition — one headless
 * render produced the marketing frame, the copy, and the device shot in a
 * single HTML page, which meant every store size needed its own CSS block and
 * `sips` afterwards to force Apple's exact dimensions.
 *
 * Splitting it leaves this script one job: get honest pixels of each surface.
 * Framing them is `ts-images`' job, via `buddy generate:app-store`, which can
 * hit any device's dimensions from the same capture.
 *
 * Run `bun run build` first — this reads `dist/`.
 */
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { crop, decode, encode } from 'ts-images'
import { startPreviewServer } from './lib/preview-server'

const dist = resolve('dist')
const outDir = join(dist, 'captures')

if (!existsSync(join(dist, 'popup.html')))
  throw new Error('dist/popup.html is missing. Run `bun run build` first.')

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

interface Surface {
  name: string
  path: string
  width: number
  /** Viewport height. Omit to size the window to the page's own content. */
  height?: number
  /**
   * Element to crop the shot down to. The window cannot be made narrower than
   * about 500px, so a 390px popup is captured with 110px of empty page beside
   * it; every consumer then draws that dead band as part of the product. The
   * crop is measured from the element rather than assumed, so it stays correct
   * whatever the window ends up being.
   */
  crop?: string
  /** Runs in the page before the shot; used to put a surface into a state. */
  prepare?: string
}

const surfaces: Surface[] = [
  // The popup has no intrinsic height — it is as tall as its content — so the
  // window is sized to the document rather than cropped to an arbitrary box.
  { name: 'popup', path: '/popup.html', width: 390, crop: '.popup-shell' },
  // Mid-pause: the same popup making a different point, for a second slide.
  {
    name: 'popup-paused',
    path: '/popup.html',
    width: 390,
    crop: '.popup-shell',
    prepare: `document.querySelector('[data-pause="30"], .pause-options button:nth-child(2)')?.click()`,
  },
  // The dashboard is a page, and a page's full height makes a very tall, very
  // thin store slide. A window-shaped viewport is what it looks like in use.
  { name: 'dashboard', path: '/options.html', width: 1180, height: 820 },
  // The protection panel on its own. The whole dashboard is 1180px of UI, and
  // a social card draws it about 440px wide, at which size every label is
  // sub-pixel mush — a blurry rectangle that says nothing. One panel at that
  // width is still readable, and the switches are the privacy claim itself.
  {
    name: 'dashboard-protection',
    path: '/options.html',
    width: 1180,
    height: 820,
    crop: '.dashboard-grid > .dashboard-panel:not(.history-panel)',
  },
]

/**
 * Chrome flags shared by every capture.
 *
 * `Bun.WebView` uses WKWebView on macOS and drives an installed Chrome
 * everywhere else; the GitHub runner images ship Chrome, so this runs on the
 * deploy runner as well as a laptop. The sandbox and /dev/shm flags are the
 * two that a headless Linux CI reliably needs and that cost nothing on macOS,
 * where they are simply not passed.
 *
 * A device scale factor of 2 keeps the capture sharp when it is later drawn at
 * 780px wide on a 1290px phone frame: downsampling is free, and there is no
 * way to recover detail that was never captured.
 *
 * Every pass asks for the same factor. It is a process-level flag, so it is
 * fixed by whichever view launches Chrome first: with the measuring pass at 1
 * the capture that followed inherited 1 and quietly produced half-resolution
 * shots, which the phone frames then upscaled.
 */
const SCALE_FACTOR = 2

function chromeArgv(): string[] {
  // The scale factor is always stated, never inherited: left to the display,
  // a measuring pass runs at the machine's own DPR and reports a different
  // content height on a Retina laptop than on a CI runner, which lands as a
  // differently-cropped capture.
  const argv = ['--proxy-server=direct://', '--proxy-bypass-list=*', `--force-device-scale-factor=${SCALE_FACTOR}`]
  if (process.platform === 'linux')
    argv.push('--no-sandbox', '--disable-dev-shm-usage')

  return argv
}

// Scrollbars are chrome, not product. A capture that carries one puts a grey
// gutter down the right of every store screenshot and social card.
//
// Wrapped in an IIFE: `evaluate` takes an expression, and a bare `const`
// declaration is a statement.
const HIDE_SCROLLBARS = `(() => {
  const style = document.createElement('style')
  style.textContent = 'html{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}'
  document.head.appendChild(style)
  return true
})()`

const server = startPreviewServer({ dist, theme: 'dark' })

try {
  for (const surface of surfaces) {
    await capture(surface)
  }
}
finally {
  server.stop(true)
  Bun.WebView.closeAll()
}

async function capture(surface: Surface): Promise<void> {
  // The window's title bar eats part of the web viewport, so the window is
  // taller than the region wanted and the shot is taken from the page itself.
  const chrome = 87
  const height = surface.height ?? await measure(surface)

  const view = new Bun.WebView({
    width: surface.width,
    height: height + chrome,
    backend: {
      type: 'chrome',
      url: false,
      argv: chromeArgv(),
    },
  })

  try {
    await view.navigate(`http://127.0.0.1:${server.port}${surface.path}`)
    await settle(view)
    await view.evaluate(HIDE_SCROLLBARS)
    if (surface.prepare) {
      await view.evaluate(surface.prepare).catch(() => {})
      await Bun.sleep(400)
    }
    await Bun.sleep(300)

    const shot = await view.screenshot({ encoding: 'buffer' })
    const framed = surface.crop ? await cropToElement(view, shot, surface.crop) : shot
    const size = await pngSize(framed)

    const path = join(outDir, `${surface.name}.png`)
    await Bun.write(path, framed)
    console.log(`Wrote ${path} (${size.width}x${size.height})`)
  }
  finally {
    view.close()
  }
}

/**
 * Trim the shot to one element's box.
 *
 * The rect and the device pixel ratio are both read out of the page: the shot
 * is in device pixels and `getBoundingClientRect` is in CSS pixels, and the
 * ratio between them is the thing that differs between a laptop and a runner.
 * Reading both from the same page keeps the crop right on either.
 */
async function cropToElement(view: Bun.WebView, shot: Uint8Array, selector: string): Promise<Uint8Array> {
  const measured = await view.evaluate<string>(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return ''
    const r = el.getBoundingClientRect()
    return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height, dpr: devicePixelRatio })
  })()`).catch(() => '')

  if (!measured)
    throw new Error(`Nothing matched ${selector}; the capture would ship the whole window.`)

  const box = JSON.parse(measured) as { x: number, y: number, width: number, height: number, dpr: number }
  const image = await decode(shot)
  const region = {
    left: Math.max(0, Math.round(box.x * box.dpr)),
    top: Math.max(0, Math.round(box.y * box.dpr)),
    width: Math.round(box.width * box.dpr),
    height: Math.round(box.height * box.dpr),
  }

  return encode(crop(image, region), 'png')
}

async function pngSize(png: Uint8Array): Promise<{ width: number, height: number }> {
  const { width, height } = await decode(png)

  return { width, height }
}

/**
 * Load the surface once just to read how tall it wants to be.
 *
 * Measures the popup's own root element, not `documentElement.scrollHeight`:
 * scrollHeight is the greater of the content and the viewport, so a short page
 * in a tall window reports the window's height and the capture comes back with
 * a band of empty background under it.
 *
 * `prepare` runs first, because the state a slide shows is not always the
 * state the page loads in, and the two are not the same height.
 */
async function measure(surface: Surface): Promise<number> {
  // Deliberately short: `scrollHeight` is the greater of the content and the
  // viewport, and the popup's frame stretches to fill its window, so both
  // measures report the window's height in a tall one. In a short window the
  // content is what overflows, and overflow is what we are asking about.
  const view = new Bun.WebView({
    width: surface.width,
    height: 200,
    backend: { type: 'chrome', url: false, argv: chromeArgv() },
  })

  try {
    await view.navigate(`http://127.0.0.1:${server.port}${surface.path}`)
    await settle(view)
    if (surface.prepare) {
      await view.evaluate(surface.prepare).catch(() => {})
      await Bun.sleep(400)
    }

    const measured = await view.evaluate<number>(`Math.ceil(document.documentElement.scrollHeight)`).catch(() => 0)

    return Math.max(320, Math.min(measured || 0, 2400))
  }
  finally {
    view.close()
  }
}

async function settle(view: Bun.WebView): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < 5000) {
    const ready = await view
      .evaluate<boolean>(`Boolean(document.querySelector('.popup-frame[data-view="ready"], .dashboard-layout'))`)
      .catch(() => false)
    if (ready)
      break
    await Bun.sleep(120)
  }

  // The stylesheet loads Inter with `font-display: swap`, so the surface paints
  // in the fallback face first and reflows when the real one arrives. Shooting
  // on DOM-ready alone catches whichever of the two won the race — which is the
  // machine-dependent typography this was meant to remove.
  await view.evaluate(`document.fonts.ready.then(() => true)`).catch(() => false)
  await Bun.sleep(500)
}
