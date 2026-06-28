import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const extensionPath = resolve('dist')
const userDataDir = await mkdtemp(join(tmpdir(), 'adblock-smoke-'))
const certDir = await mkdtemp(join(tmpdir(), 'adblock-smoke-cert-'))
const keyPath = join(certDir, 'key.pem')
const certPath = join(certDir, 'cert.pem')
const errors: string[] = []

await Bun.$`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${keyPath} -out ${certPath} -subj /CN=localhost -days 1`.quiet()

const server = Bun.serve({
  port: 0,
  tls: {
    key: await Bun.file(keyPath).text(),
    cert: await Bun.file(certPath).text(),
  },
  fetch(request) {
    const host = request.headers.get('host') ?? ''

    if (host.startsWith('www.youtube.com')) {
      return html(`<!doctype html>
<html>
  <body>
    <h1>YouTube fixture</h1>
    <div class="ytp-ad-module">video ad module</div>
    <div class="video-ads">video ad</div>
    <ytd-display-ad-renderer>display ad</ytd-display-ad-renderer>
    <button class="ytp-ad-skip-button" onclick="document.body.dataset.skipped = 'true'">Skip ad</button>
  </body>
</html>`)
    }

    if (host.startsWith('x.com')) {
      return html(`<!doctype html>
<html>
  <body>
    <h1>X fixture</h1>
    <article><div>Promoted</div><p>paid placement</p></article>
    <div data-testid="placementTracking">tracked placement</div>
  </body>
</html>`)
    }

    return html(`<!doctype html>
<html>
  <head>
    <title>Adblock smoke fixture</title>
    <script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>
  </head>
  <body>
    <h1>Fixture</h1>
    <div id="google_ads_iframe_1">network ad</div>
    <div class="ad-container">cosmetic ad</div>
    <div data-ad-slot="fixture">slot ad</div>
  </body>
</html>`)
  },
})

try {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--disable-features=DialMediaRouteProvider',
      '--ignore-certificate-errors',
      `--host-resolver-rules=MAP www.youtube.com 127.0.0.1,MAP x.com 127.0.0.1`,
    ],
  })

  context.on('page', (page) => {
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('net::ERR_BLOCKED_BY_CLIENT')) {
        errors.push(message.text())
      }
    })
  })

  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15_000 })
  const extensionId = new URL(worker.url()).host
  assert(extensionId.length > 10, 'Extension id was not discovered from service worker')

  const fixture = await context.newPage()
  await fixture.goto(`https://127.0.0.1:${server.port}/`, { waitUntil: 'domcontentloaded' })
  await fixture.waitForFunction(() => document.querySelectorAll('[data-adblock-hidden="true"]').length >= 2, undefined, { timeout: 10_000 })
  const hiddenCount = await fixture.locator('[data-adblock-hidden="true"]').count()
  assert(hiddenCount >= 2, `Expected cosmetic filtering to hide at least 2 elements, saw ${hiddenCount}`)

  const youtube = await context.newPage()
  await youtube.goto(`https://www.youtube.com:${server.port}/watch?v=smoke`, { waitUntil: 'domcontentloaded' })
  await youtube.waitForFunction(() => document.querySelectorAll('[data-adblock-hidden="true"]').length >= 3, undefined, { timeout: 10_000 })
  await youtube.waitForFunction(() => document.body.dataset.skipped === 'true', undefined, { timeout: 10_000 })
  const youtubeHidden = await youtube.locator('[data-adblock-hidden="true"]').count()
  assert(youtubeHidden >= 3, `Expected YouTube cleanup to hide at least 3 elements, saw ${youtubeHidden}`)

  const x = await context.newPage()
  await x.goto(`https://x.com:${server.port}/home`, { waitUntil: 'domcontentloaded' })
  await x.waitForFunction(() => document.querySelectorAll('[data-adblock-hidden="true"]').length >= 2, undefined, { timeout: 10_000 })
  const xHidden = await x.locator('[data-adblock-hidden="true"]').count()
  assert(xHidden >= 2, `Expected X cleanup to hide at least 2 elements, saw ${xHidden}`)

  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' })
  await popup.waitForSelector('#today-blocked', { timeout: 10_000 })
  await popup.waitForFunction(() => document.querySelector('#status-message')?.textContent !== 'Loading protection state...')
  const todayBlocked = Number.parseInt((await popup.locator('#today-blocked').textContent())?.replace(/\D/g, '') || '0', 10)
  assert(todayBlocked >= 7, `Expected popup blocked count to include generic, YouTube, and X fixture events, saw ${todayBlocked}`)

  const options = await context.newPage()
  await options.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' })
  await options.waitForSelector('#dashboard-blocked', { timeout: 10_000 })
  await options.waitForFunction(() => document.querySelector('#options-status')?.textContent !== 'Loading dashboard...')
  const dashboardBlocked = Number.parseInt((await options.locator('#dashboard-blocked').textContent())?.replace(/\D/g, '') || '0', 10)
  assert(dashboardBlocked >= 7, `Expected dashboard blocked count to include generic, YouTube, and X fixture events, saw ${dashboardBlocked}`)

  if (errors.length) throw new Error(`Browser console/page errors:\n${errors.join('\n')}`)

  await context.close()
  console.log(`Smoke tested extension ${extensionId}: generic=${hiddenCount}, youtube=${youtubeHidden}, x=${xHidden}, popup=${todayBlocked}, dashboard=${dashboardBlocked}`)
}
finally {
  server.stop(true)
  await rm(userDataDir, { recursive: true, force: true })
  await rm(certDir, { recursive: true, force: true })
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function html(markup: string): Response {
  return new Response(markup, {
    headers: { 'content-type': 'text/html' },
  })
}
