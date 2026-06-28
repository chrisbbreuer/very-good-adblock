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
const minimumStatsEvents = 15

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
      `--host-resolver-rules=MAP example.test 127.0.0.1,MAP www.youtube.com 127.0.0.1,MAP x.com 127.0.0.1`,
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
  await fixture.goto(`https://example.test:${server.port}/`, { waitUntil: 'domcontentloaded' })
  await fixture.waitForFunction(() => document.querySelectorAll('[data-adblock-hidden="true"]').length >= 2, undefined, { timeout: 10_000 })
  const hiddenCount = await fixture.locator('[data-adblock-hidden="true"]').count()
  assert(hiddenCount >= 2, `Expected cosmetic filtering to hide at least 2 elements, saw ${hiddenCount}`)

  const youtube = await context.newPage()
  await youtube.goto(`https://www.youtube.com:${server.port}/watch?v=smoke`, { waitUntil: 'domcontentloaded' })
  await youtube.waitForFunction(() => document.querySelectorAll('[data-adblock-hidden="true"]').length >= 3, undefined, { timeout: 10_000 })
  await youtube.waitForFunction(() => document.body.dataset.skipped === 'true', undefined, { timeout: 10_000 })
  const youtubeHidden = await youtube.locator('[data-adblock-hidden="true"]').count()
  assert(youtubeHidden >= 3, `Expected YouTube cleanup to hide at least 3 elements, saw ${youtubeHidden}`)

  const shorts = await context.newPage()
  await shorts.goto(`https://www.youtube.com:${server.port}/shorts/smoke`, { waitUntil: 'domcontentloaded' })
  await shorts.waitForFunction(() => document.querySelectorAll('[data-adblock-hidden="true"]').length >= 3, undefined, { timeout: 10_000 })
  const shortsHidden = await shorts.locator('[data-adblock-hidden="true"]').count()
  assert(shortsHidden >= 3, `Expected YouTube Shorts cleanup to hide at least 3 elements, saw ${shortsHidden}`)

  const xHiddenCounts = await Promise.all(['/home', '/search?q=ads', '/profile/adblock'].map(async (path) => {
    const x = await context.newPage()
    await x.goto(`https://x.com:${server.port}${path}`, { waitUntil: 'domcontentloaded' })
    await x.waitForFunction(() => document.querySelectorAll('[data-adblock-hidden="true"]').length >= 2, undefined, { timeout: 10_000 })
    return x.locator('[data-adblock-hidden="true"]').count()
  }))
  const xHidden = xHiddenCounts.reduce((total, count) => total + count, 0)
  assert(xHidden >= 6, `Expected X cleanup to hide at least 6 elements across home/search/profile, saw ${xHidden}`)

  const control = await context.newPage()
  await control.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' })
  await control.waitForFunction(() => document.querySelector('#options-status')?.textContent !== 'Loading dashboard...')
  await sendRuntimeMessage(control, { type: 'toggle-site', hostname: 'example.test', allowed: true })

  const allowedFixture = await context.newPage()
  await allowedFixture.goto(`https://example.test:${server.port}/allowed`, { waitUntil: 'domcontentloaded' })
  await allowedFixture.waitForTimeout(700)
  const allowedHidden = await allowedFixture.locator('[data-adblock-hidden="true"]').count()
  assert(allowedHidden === 0, `Expected allowed site to remain visible, saw ${allowedHidden} hidden elements`)

  await sendRuntimeMessage(control, { type: 'toggle-site', hostname: 'example.test', allowed: false })
  const resumedFixture = await context.newPage()
  await resumedFixture.goto(`https://example.test:${server.port}/resumed`, { waitUntil: 'domcontentloaded' })
  await resumedFixture.waitForFunction(() => document.querySelectorAll('[data-adblock-hidden="true"]').length >= 2, undefined, { timeout: 10_000 })
  const resumedHidden = await resumedFixture.locator('[data-adblock-hidden="true"]').count()
  assert(resumedHidden >= 2, `Expected resumed site protection to hide at least 2 elements, saw ${resumedHidden}`)

  const popup = await context.newPage()
  await popup.setViewportSize({ width: 390, height: 620 })
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' })
  await popup.waitForSelector('#today-blocked', { timeout: 10_000 })
  await popup.waitForFunction(() => document.querySelector('#status-message')?.textContent !== 'Loading protection state...')
  await assertNoHorizontalOverflow(popup, 'popup')
  const todayBlocked = Number.parseInt((await popup.locator('#today-blocked').textContent())?.replace(/\D/g, '') || '0', 10)
  assert(todayBlocked >= minimumStatsEvents, `Expected popup blocked count to include generic, YouTube, Shorts, X, and resumed fixture events, saw ${todayBlocked}`)
  assert(await popup.locator('#top-categories .site-row').count() > 0, 'Expected popup top categories to render')

  const options = await context.newPage()
  await options.setViewportSize({ width: 1180, height: 900 })
  await options.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' })
  await options.waitForSelector('#dashboard-blocked', { timeout: 10_000 })
  await options.waitForFunction(() => document.querySelector('#options-status')?.textContent !== 'Loading dashboard...')
  await assertNoHorizontalOverflow(options, 'options desktop')
  assert((await options.locator('#rules-status').textContent())?.includes('static rules'), 'Expected filter rules status')
  const dashboardBlocked = Number.parseInt((await options.locator('#dashboard-blocked').textContent())?.replace(/\D/g, '') || '0', 10)
  assert(dashboardBlocked >= minimumStatsEvents, `Expected dashboard blocked count to include generic, YouTube, Shorts, X, and resumed fixture events, saw ${dashboardBlocked}`)

  await options.locator('#block-host').fill('ads.blocked.test')
  await options.locator('#block-form button').click()
  await options.waitForFunction(() => document.querySelector('#blocked-count')?.textContent === '1')
  await options.locator('#blocked-sites .pill', { hasText: 'ads.blocked.test' }).click()
  await options.waitForFunction(() => document.querySelector('#blocked-count')?.textContent === '0')

  await options.setViewportSize({ width: 430, height: 900 })
  await assertNoHorizontalOverflow(options, 'options mobile')

  const exported = await sendRuntimeMessage(options, { type: 'export-data' })
  assert(Boolean(exported?.lifetime), 'Expected export-data to return dashboard state')

  const reset = await sendRuntimeMessage(options, { type: 'reset-stats' })
  assert(reset?.lifetime?.adsBlocked === 0, 'Expected reset-stats to reset lifetime blocked count')

  if (errors.length) throw new Error(`Browser console/page errors:\n${errors.join('\n')}`)

  await context.close()
  console.log(`Smoke tested extension ${extensionId}: generic=${hiddenCount}, youtube=${youtubeHidden}, shorts=${shortsHidden}, x=${xHidden}, allowed=${allowedHidden}, resumed=${resumedHidden}, popup=${todayBlocked}, dashboard=${dashboardBlocked}`)
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

async function sendRuntimeMessage(page: import('playwright').Page, message: unknown): Promise<any> {
  return page.evaluate(async (payload) => {
    const response = await chrome.runtime.sendMessage(payload)
    if (!response.ok) throw new Error(response.error ?? 'Runtime message failed')
    return response.data
  }, message)
}

async function assertNoHorizontalOverflow(page: import('playwright').Page, label: string): Promise<void> {
  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  assert(sizes.scrollWidth <= sizes.clientWidth + 1, `${label} has horizontal overflow: ${sizes.scrollWidth} > ${sizes.clientWidth}`)
}
