/**
 * Render store-ready 1280x800 screenshots into dist/store/. The popup is
 * composited onto a branded frame with a caption; the dashboard is shot at its
 * native width. Both surfaces run against a mock `chrome.runtime` that returns a
 * seeded dashboard, so no real extension install is needed.
 *
 * Run `bun run build` first (the `screenshots` script does this for you).
 */
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { dashboardState, shimScript } from './lib/preview-fixture'

const dist = resolve('dist')
const outDir = join(dist, 'store')

if (!existsSync(join(dist, 'popup.html'))) {
  throw new Error('dist/popup.html is missing. Run `bun run build` first.')
}

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

const shim = shimScript(dashboardState())

const shots: Array<{ name: string, url: string }> = [
  { name: 'popup', url: `/frame?surface=popup&i=0` },
  { name: 'dashboard', url: `/options.html` },
  { name: 'controls', url: `/frame?surface=popup&i=1` },
]

const captions = [
  { title: 'Ads gone before the page loads.', sub: 'Blocks ads, pop-ups, and trackers at the source, before the page can show them.' },
  { title: 'Pause per site. No telemetry, ever.', sub: 'One-click allow or pause, cookie-banner hiding, and nothing ever leaves your machine.' },
]

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/popup.html') return htmlResponse(inject(await Bun.file(join(dist, 'popup.html')).text()))
    if (url.pathname === '/options.html') return htmlResponse(inject(await Bun.file(join(dist, 'options.html')).text()))
    if (url.pathname === '/frame') return htmlResponse(framePage(Number(url.searchParams.get('i') ?? '0')))

    const asset = join(dist, url.pathname.replace(/^\//, ''))
    if (existsSync(asset)) return new Response(Bun.file(asset))
    return new Response('Not found', { status: 404 })
  },
})

const view = new Bun.WebView({
  width: 1280,
  height: 800,
  backend: { type: 'chrome', url: false, argv: ['--proxy-server=direct://', '--proxy-bypass-list=*', '--force-device-scale-factor=1'] },
})

try {
  for (const shot of shots) {
    await view.navigate(`http://127.0.0.1:${server.port}${shot.url}`)
    await settle(view)
    const png = await view.screenshot({ encoding: 'buffer' })
    await Bun.write(join(outDir, `${shot.name}.png`), png)
    console.log(`Wrote dist/store/${shot.name}.png`)
  }
}
finally {
  view.close()
  server.stop(true)
  Bun.WebView.closeAll()
}

function inject(markup: string): string {
  return markup.replace('</head>', `${shim}</head>`)
}

function htmlResponse(body: string): Response {
  return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}

async function settle(view: Bun.WebView): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < 4000) {
    const ready = await view.evaluate<boolean>(`Boolean(document.querySelector('.popup-frame[data-view="ready"], .dashboard-layout, .store-frame'))`).catch(() => false)
    if (ready) break
    await Bun.sleep(120)
  }
  await Bun.sleep(500)
}

function framePage(index: number): string {
  const caption = captions[index] ?? captions[0]
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><style>${frameCss()}</style></head>
  <body class="store-frame">
    <div class="frame-copy">
      <svg class="frame-logo" viewBox="0 0 128 128" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="s" x1="20" y1="12" x2="104" y2="118" gradientUnits="userSpaceOnUse"><stop stop-color="#7dffb4"/><stop offset=".52" stop-color="#1ed878"/><stop offset="1" stop-color="#33c6ff"/></linearGradient>
        </defs>
        <path fill="url(#s)" d="M64 13c17 10 32 13 47 15v31c0 31-18 52-47 62-29-10-47-31-47-62V28c15-2 30-5 47-15Z"/>
        <path fill="none" stroke="#053b28" stroke-opacity=".22" stroke-linecap="round" stroke-linejoin="round" stroke-width="13" d="m43 66 14 15 31-36"/>
        <path fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="12" d="m43 63 14 15 31-36"/>
      </svg>
      <h1>${caption.title}</h1>
      <p>${caption.sub}</p>
      <div class="frame-wordmark">Very Good AdBlock</div>
    </div>
    <div class="frame-stage">
      <iframe class="frame-device" src="/popup.html" scrolling="no"></iframe>
    </div>
  </body>
</html>`
}

function frameCss(): string {
  return `
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    .store-frame {
      width: 1280px; height: 800px; display: flex; align-items: center; overflow: hidden;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      color: #f3fbf8;
      background:
        radial-gradient(circle at 84% 8%, rgba(23,201,100,.22), transparent 46%),
        radial-gradient(circle at 6% 96%, rgba(23,201,100,.12), transparent 44%),
        linear-gradient(165deg, #060f0d 0%, #08130f 58%, #0a1613 100%);
    }
    .frame-copy { flex: 0 0 46%; padding: 0 40px 0 88px; }
    .frame-logo { width: 56px; height: 56px; margin-bottom: 28px; filter: drop-shadow(0 14px 30px rgba(23,201,100,.32)); }
    .frame-copy h1 { margin: 0; font-size: 56px; line-height: 1.03; letter-spacing: -.02em; font-weight: 800; max-width: 12ch; }
    .frame-copy p { margin: 22px 0 0; font-size: 21px; line-height: 1.5; color: rgba(243,251,248,.72); max-width: 34ch; }
    .frame-wordmark { margin-top: 40px; font-size: 13px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: rgba(243,251,248,.5); }
    .frame-stage { flex: 1; height: 100%; display: grid; place-items: center; position: relative; }
    .frame-device {
      width: 390px; height: 620px; border: 0; border-radius: 18px;
      box-shadow: 0 40px 90px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.06);
    }
  `
}
