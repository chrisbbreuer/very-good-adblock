/**
 * Render the real extension popup (against the seeded dashboard fixture) to
 * `public/marketing/popup-preview.png`, a committed 2x asset the marketing hero
 * embeds. Regenerate after popup UI changes:  `bun run build && bun --bun
 * scripts/generate-marketing-preview.ts`.
 *
 * This is a REAL screenshot of the shipping popup, not a hand-built div mockup.
 */
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { dashboardState, injectShim, shimScript } from './lib/preview-fixture'

const dist = resolve('dist')
const outPath = resolve('public/marketing/popup-preview.png')

// Render just the top of the popup: header, pause controls, the three metric
// cards, the 24h chart, and the current-site card — the same crop the store
// composite shows. 390 matches `.popup-shell` width; 2x for retina.
const WIDTH = 390
const HEIGHT = 682

if (!existsSync(join(dist, 'popup.html')))
  throw new Error('dist/popup.html is missing. Run `bun run build` first.')

await mkdir(resolve('public/marketing'), { recursive: true })

const shim = shimScript(dashboardState())

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/popup.html')
      return new Response(injectShim(await Bun.file(join(dist, 'popup.html')).text(), shim), { headers: { 'content-type': 'text/html; charset=utf-8' } })
    const asset = join(dist, url.pathname.replace(/^\//, ''))
    if (existsSync(asset))
      return new Response(Bun.file(asset))
    return new Response('Not found', { status: 404 })
  },
})

const view = new Bun.WebView({
  width: WIDTH,
  height: HEIGHT,
  backend: { type: 'chrome', url: false, argv: ['--proxy-server=direct://', '--proxy-bypass-list=*', '--force-device-scale-factor=2', '--hide-scrollbars'] },
})

try {
  await view.navigate(`http://127.0.0.1:${server.port}/popup.html`)
  const start = Date.now()
  while (Date.now() - start < 4000) {
    const ready = await view.evaluate<boolean>(`Boolean(document.querySelector('.popup-frame[data-view="ready"]'))`).catch(() => false)
    if (ready)
      break
    await Bun.sleep(120)
  }
  await Bun.sleep(500)
  const png = await view.screenshot({ encoding: 'buffer' })
  await Bun.write(outPath, png)
  console.log(`Wrote ${outPath} (${WIDTH}x${HEIGHT} @2x)`)
}
finally {
  view.close()
  server.stop(true)
  Bun.WebView.closeAll()
}
