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
  /** Runs in the page before the shot; used to put a surface into a state. */
  prepare?: string
}

const surfaces: Surface[] = [
  // The popup has no intrinsic height — it is as tall as its content — so the
  // window is sized to the document rather than cropped to an arbitrary box.
  { name: 'popup', path: '/popup.html', width: 390 },
  // Mid-pause: the same popup making a different point, for a second slide.
  {
    name: 'popup-paused',
    path: '/popup.html',
    width: 390,
    prepare: `document.querySelector('[data-pause="30"], .pause-options button:nth-child(2)')?.click()`,
  },
  // The dashboard is a page, and a page's full height makes a very tall, very
  // thin store slide. A window-shaped viewport is what it looks like in use.
  { name: 'dashboard', path: '/options.html', width: 1180, height: 820 },
]

// Scrollbars are chrome, not product. A capture that carries one puts a grey
// gutter down the right of every store screenshot and social card.
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
      // A device scale factor of 2 keeps the capture sharp when it is drawn at
      // 780px wide on a 1290px phone frame; downsampling is free, and there is
      // no way to recover detail that was never captured.
      argv: ['--proxy-server=direct://', '--proxy-bypass-list=*', '--force-device-scale-factor=2'],
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

    const path = join(outDir, `${surface.name}.png`)
    await Bun.write(path, await view.screenshot({ encoding: 'buffer' }))
    console.log(`Wrote ${path} (${surface.width}x${height} @2x)`)
  }
  finally {
    view.close()
  }
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
    backend: { type: 'chrome', url: false, argv: ['--proxy-server=direct://', '--proxy-bypass-list=*', '--force-device-scale-factor=1'] },
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
  await Bun.sleep(500)
}
