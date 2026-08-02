/**
 * Screenshot the marketing pages at a few viewports, for looking at the design
 * work rather than for shipping. Writes into `tmp/shots/`.
 *
 * `bun --bun resources/scripts/shoot-site.ts [--pages=marketing,features] [--widths=430,1440]`
 *
 * `--slices` walks the page a viewport at a time; `--full` takes one tall shot;
 * `--theme=light|dark` pins the palette.
 *
 * CAVEAT — phone widths: the host window manager will not make a window
 * narrower than about 500px, so `--widths=390` silently renders at 500 and the
 * layout you get is the tablet one. Anything below ~520px has to be checked in
 * a real browser's device emulation instead; this script is for 520px and up.
 *
 * Run `bun run build` first — this serves `dist/`.
 */
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'

const dist = resolve('dist')
const outDir = resolve('tmp/shots')

function flag(name: string, fallback: string): string {
  const hit = process.argv.find(arg => arg.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const pages = flag('pages', 'marketing').split(',')
const widths = flag('widths', '390,1440').split(',').map(Number)
const theme = flag('theme', 'dark') as 'dark' | 'light'
const full = process.argv.includes('--full')
const slices = process.argv.includes('--slices')

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname === '/' ? '/marketing.html' : url.pathname
    const name = path.replace(/^\//, '')

    // Product screenshots live under docs/public until `build-site.ts` copies
    // them, so both roots are tried and the shots match the published page.
    for (const root of [dist, resolve('docs/public')]) {
      const local = Bun.file(join(root, name))
      if (!(await local.exists()))
        continue

      if (path.endsWith('.html')) {
        const markup = (await local.text()).replace(/<html(?=[\s>])/, `<html data-theme="${theme}"`)
        return new Response(markup, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      }
      return new Response(local)
    }

    return new Response('Not found', { status: 404 })
  },
})

const HIDE_SCROLLBARS = `(() => {
  const style = document.createElement('style')
  style.textContent = 'html{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}'
  document.head.appendChild(style)
  return true
})()`

try {
  for (const page of pages) {
    for (const width of widths)
      await shoot(page, width)
  }
}
finally {
  server.stop(true)
  Bun.WebView.closeAll()
}

async function shoot(page: string, width: number): Promise<void> {
  const chrome = 87
  const viewport = width < 500 ? 844 : 900
  const height = full ? await measure(page, width) : viewport

  const view = new Bun.WebView({
    width,
    height: height + chrome,
    backend: {
      type: 'chrome',
      url: false,
      argv: ['--proxy-server=direct://', '--proxy-bypass-list=*', '--force-device-scale-factor=2'],
    },
  })

  try {
    await view.navigate(`http://127.0.0.1:${server.port}/${page}.html`)
    await settle(view)
    await view.evaluate(HIDE_SCROLLBARS)
    await Bun.sleep(400)

    if (slices) {
      const total = await view.evaluate<number>(`Math.ceil(document.documentElement.scrollHeight)`)
      const count = Math.ceil(total / height)
      for (let i = 0; i < count; i++) {
        await view.evaluate(`(() => { window.scrollTo(0, ${i * height}); return true })()`)
        await Bun.sleep(350)
        const path = join(outDir, `${page}-${width}-${String(i).padStart(2, '0')}.png`)
        await Bun.write(path, await view.screenshot({ encoding: 'buffer' }))
        console.log(`Wrote ${path} (${width}x${height} @ y=${i * height})`)
      }
      return
    }

    const path = join(outDir, `${page}-${width}${full ? '-full' : ''}.png`)
    await Bun.write(path, await view.screenshot({ encoding: 'buffer' }))
    console.log(`Wrote ${path} (${width}x${height})`)
  }
  finally {
    view.close()
  }
}

async function measure(page: string, width: number): Promise<number> {
  const view = new Bun.WebView({
    width,
    height: 400,
    backend: { type: 'chrome', url: false, argv: ['--proxy-server=direct://', '--force-device-scale-factor=1'] },
  })

  try {
    await view.navigate(`http://127.0.0.1:${server.port}/${page}.html`)
    await settle(view)
    const measured = await view.evaluate<number>(`Math.ceil(document.documentElement.scrollHeight)`).catch(() => 0)
    return Math.max(400, Math.min(measured || 0, 12000))
  }
  finally {
    view.close()
  }
}

async function settle(view: Bun.WebView): Promise<void> {
  await view.evaluate(`document.fonts.ready.then(() => true)`).catch(() => false)
  await Bun.sleep(600)
}
