import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import packageJson from '../package.json'
import type { BlockEvent, DashboardState, ExtensionSettings, LocalStats } from '../src/shared/types'

const extensionPath = resolve('dist')
const screenshotDir = resolve('temp/smoke-screenshots')
const certDir = await mkdtemp(join(tmpdir(), 'adblock-smoke-cert-'))
const keyPath = join(certDir, 'key.pem')
const certPath = join(certDir, 'cert.pem')
const errors: string[] = []
const minimumStatsEvents = 15
const hostResolverRules = [
  'MAP example.test 127.0.0.1',
  'MAP www.youtube.com 127.0.0.1',
  'MAP www.twitch.tv 127.0.0.1',
].join(',')

const webViewBackend: Bun.WebView.Backend = {
  type: 'chrome',
  url: false,
  argv: [
    `--host-resolver-rules=${hostResolverRules}`,
    '--proxy-server=direct://',
    '--proxy-bypass-list=*',
    '--ignore-certificate-errors',
    '--allow-insecure-localhost',
    '--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable,HttpsFirstModeV2ForEngagedSites',
  ],
}

await rm(screenshotDir, { recursive: true, force: true })
await mkdir(screenshotDir, { recursive: true })
await Bun.$`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${keyPath} -out ${certPath} -subj /CN=localhost -days 1`.quiet()

const server = Bun.serve({
  port: 0,
  tls: {
    key: await Bun.file(keyPath).text(),
    cert: await Bun.file(certPath).text(),
  },
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === '/popup.html') {
      return html(injectSmokeShim(await Bun.file(join(extensionPath, 'popup.html')).text()))
    }

    if (url.pathname === '/options.html') {
      return html(injectSmokeShim(await Bun.file(join(extensionPath, 'options.html')).text()))
    }

    if (url.pathname === '/watch') return html(contentFixture(youtubeFixture()))
    if (url.pathname === '/shorts/smoke') return html(contentFixture(youtubeFixture()))
    if (url.pathname === '/directory/category/smoke' || url.pathname === '/streamer') return html(contentFixture(twitchFixture()))

    const asset = await assetResponse(url.pathname)
    if (asset) return asset

    return new Response('Not found', { status: 404 })
  },
})

try {
  const youtube = openView(900, 700)
  await youtube.navigate(origin('www.youtube.com', '/watch?v=smoke'))
  await waitFor(youtube, `document.body.dataset.skipped === 'true'`, 'YouTube skip automation')
  await waitFor(youtube, `window.__adblockContentEvents?.length > 0`, 'YouTube metrics flush')
  await waitFor(youtube, `getComputedStyle(document.querySelector('#feed-ad')).display === 'none'`, 'YouTube feed ad hidden')
  const youtubeHidden = await countHidden(youtube)
  const youtubeEvents = await contentEvents(youtube)
  const youtubeFeedVideoVisible = await isVisible(youtube, '#feed-video')
  assert(youtubeHidden >= 3, `Expected YouTube cosmetic filtering to hide feed and display ads, saw ${youtubeHidden} hidden nodes`)
  assert(youtubeFeedVideoVisible, 'Expected the real YouTube feed video to stay visible')
  assert(youtubeEvents >= 1, `Expected YouTube protection to report events, saw ${youtubeEvents}`)
  closeView(youtube)

  const shorts = openView(900, 700)
  await shorts.navigate(origin('www.youtube.com', '/shorts/smoke'))
  await waitFor(shorts, `document.body.dataset.skipped === 'true'`, 'YouTube Shorts skip automation')
  const shortsFeedVideoVisible = await isVisible(shorts, '#feed-video')
  assert(shortsFeedVideoVisible, 'Expected the real YouTube Shorts feed video to stay visible')
  closeView(shorts)

  const twitch = openView(900, 700)
  await twitch.navigate(origin('www.twitch.tv', '/streamer'))
  await waitFor(twitch, `window.__adblockContentEvents?.length > 0`, 'Twitch metrics flush')
  const twitchHidden = await countHidden(twitch)
  const twitchEvents = await contentEvents(twitch)
  const twitchVideoSeconds = await twitch.evaluate<number>(`window.__adblockContentEvents?.reduce((total, event) => total + (event.videoSecondsSaved ?? 0), 0) ?? 0`)
  const twitchMarkerVisible = await isVisible(twitch, '.player-ad-notice')
  assert(twitchHidden >= 1, `Expected Twitch cosmetic filtering to hide the display banner, saw ${twitchHidden} hidden nodes`)
  assert(twitchMarkerVisible, 'Expected Twitch video-ad markers to stay visible for detection')
  assert(twitchEvents >= 2, `Expected Twitch video detection to report video events, saw ${twitchEvents}`)
  assert(twitchVideoSeconds >= 15, `Expected Twitch video detection to estimate saved video time, saw ${twitchVideoSeconds}`)
  closeView(twitch)

  const popup = openView(390, 620)
  await popup.navigate(origin('example.test', '/popup.html'))
  await waitFor(popup, `document.querySelector('#status-message')?.textContent !== 'Loading protection state...'`, 'popup ready state')
  await assertNoHorizontalOverflow(popup, 'popup')
  const pageBlocked = await numberText(popup, '#page-blocked')
  assert(pageBlocked >= minimumStatsEvents, `Expected popup blocked count to render seeded events, saw ${pageBlocked}`)
  await waitFor(popup, `document.querySelector('#site-blocked')?.textContent === '41'`, 'current-site blocked stats')
  await waitFor(popup, `document.querySelector('#site-data')?.textContent === '2.0 MB'`, 'current-site data stats')
  await waitFor(popup, `document.querySelector('#hourly-chart span:last-child')?.getAttribute('data-tooltip')?.includes('blocked')`, 'popup chart hover values')
  await popup.click('#protection-toggle')
  await waitFor(popup, `document.querySelector('#site-title')?.textContent === 'Protection paused'`, 'popup protection toggle')
  await popup.click('#site-toggle')
  await waitFor(popup, `document.querySelector('#site-toggle')?.textContent === 'Protect'`, 'popup site allow toggle')
  await screenshot(popup, 'popup.png')
  await assertPageClean(popup, 'popup')
  closeView(popup)

  const options = openView(1180, 900)
  await options.navigate(origin('example.test', '/options.html'))
  await waitFor(options, `document.querySelector('#options-status')?.textContent !== 'Loading dashboard...'`, 'options ready state')
  await assertNoHorizontalOverflow(options, 'options desktop')
  const dashboardBlocked = await numberText(options, '#dashboard-blocked')
  assert(dashboardBlocked >= minimumStatsEvents, `Expected dashboard blocked count to render seeded events, saw ${dashboardBlocked}`)
  await waitFor(options, `document.querySelector('#rules-status')?.textContent?.includes('static rules')`, 'rules status')
  await options.click('#block-host')
  await options.type('ads.blocked.test')
  await options.click('#block-form button')
  await waitFor(options, `document.querySelector('#blocked-count')?.textContent === '1'`, 'blocked-site add')
  await options.click('#blocked-sites .pill')
  await waitFor(options, `document.querySelector('#blocked-count')?.textContent === '0'`, 'blocked-site remove')
  await options.click('#export-data')
  await waitFor(options, `Boolean(window.__adblockSmokeExported?.lifetime)`, 'dashboard export')
  await options.click('#reset-stats')
  await waitFor(options, `document.querySelector('#dashboard-blocked')?.textContent === '0'`, 'dashboard reset')
  await options.resize(430, 900)
  await assertNoHorizontalOverflow(options, 'options mobile')
  await screenshot(options, 'options-mobile.png')
  await assertPageClean(options, 'options')
  closeView(options)

  const marketing = openView(1280, 900)
  await marketing.navigate(origin('example.test', '/marketing.html'))
  await waitFor(marketing, `document.querySelector('.marketing-hero h1')?.textContent === 'Very Good AdBlock'`, 'marketing ready state')
  await assertNoHorizontalOverflow(marketing, 'marketing desktop')
  await screenshot(marketing, 'marketing-desktop.png')
  await marketing.resize(430, 900)
  await assertNoHorizontalOverflow(marketing, 'marketing mobile')
  await screenshot(marketing, 'marketing-mobile.png')
  await assertPageClean(marketing, 'marketing')
  closeView(marketing)

  if (errors.length) throw new Error(`WebView console errors:\n${errors.join('\n')}`)

  console.log([
    'Bun WebView smoke tested Very Good AdBlock:',
    `youtube=${youtubeHidden}`,
    `twitch=${twitchHidden}`,
    `popup=${pageBlocked}`,
    `dashboard=${dashboardBlocked}`,
    'marketing=ok',
    `screenshots=${screenshotDir}`,
  ].join(' '))
}
finally {
  server.stop(true)
  await rm(certDir, { recursive: true, force: true })
  Bun.WebView.closeAll()
}

function openView(width: number, height: number): Bun.WebView {
  return new Bun.WebView({
    width,
    height,
    backend: webViewBackend,
    console: (type, ...args) => {
      if (type === 'error') errors.push(args.map(String).join(' '))
    },
  })
}

function closeView(view: Bun.WebView): void {
  view.close()
}

function origin(hostname: string, pathname: string): string {
  return `https://${hostname}:${server.port}${pathname}`
}

async function assetResponse(pathname: string): Promise<Response | undefined> {
  const relative = decodeURIComponent(pathname.replace(/^\/+/, ''))
  if (!relative || relative.includes('..')) return undefined

  const assetPath = resolve(extensionPath, relative)
  if (!assetPath.startsWith(`${extensionPath}/`)) return undefined

  const file = Bun.file(assetPath)
  if (!await file.exists()) return undefined

  return new Response(file, {
    headers: {
      'content-type': contentType(assetPath),
    },
  })
}

function contentType(pathname: string): string {
  if (pathname.endsWith('.html')) return 'text/html; charset=utf-8'
  if (pathname.endsWith('.css')) return 'text/css; charset=utf-8'
  if (pathname.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (pathname.endsWith('.json')) return 'application/json; charset=utf-8'
  if (pathname.endsWith('.png')) return 'image/png'
  if (pathname.endsWith('.svg')) return 'image/svg+xml'
  return 'application/octet-stream'
}

function html(markup: string): Response {
  return new Response(markup, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

function injectSmokeShim(markup: string): string {
  return markup.replace('</head>', `<script>${uiShimScript()}</script></head>`)
}

function uiShimScript(): string {
  return `
    window.__adblockSmokeErrors = [];
    window.__adblockSmokeExported = null;
    window.addEventListener('error', event => window.__adblockSmokeErrors.push(event.message));
    window.addEventListener('unhandledrejection', event => window.__adblockSmokeErrors.push(String(event.reason)));
    const state = ${JSON.stringify(makeDashboardState())};
    const clone = value => JSON.parse(JSON.stringify(value));
    const normalize = value => String(value || '').trim().toLowerCase().replace(/^https?:\\/\\//, '').replace(/^www\\./, '').split('/')[0];
    const uniqueSites = sites => [...new Set(sites.map(normalize).filter(Boolean))].sort();
    window.chrome = {
      runtime: {
        openOptionsPage: () => {
          window.__adblockOptionsOpened = true;
        },
        sendMessage: async message => {
          if (message.type === 'get-dashboard') return { ok: true, data: clone(state) };
          if (message.type === 'set-settings') {
            state.settings = { ...state.settings, ...message.settings };
            state.settings.allowedSites = uniqueSites(state.settings.allowedSites);
            state.settings.blockedSites = uniqueSites(state.settings.blockedSites);
            state.activeTab.allowed = state.settings.allowedSites.includes(state.activeTab.hostname);
            return { ok: true, data: clone(state) };
          }
          if (message.type === 'toggle-site') {
            const hostname = normalize(message.hostname);
            const allowed = new Set(state.settings.allowedSites);
            if (message.allowed) allowed.add(hostname);
            else allowed.delete(hostname);
            state.settings.allowedSites = uniqueSites([...allowed]);
            state.activeTab.allowed = state.settings.allowedSites.includes(state.activeTab.hostname);
            return { ok: true, data: clone(state) };
          }
          if (message.type === 'export-data') {
            window.__adblockSmokeExported = clone(state);
            return { ok: true, data: clone(state) };
          }
          if (message.type === 'reset-stats') {
            state.lifetime.adsBlocked = 0;
            state.lifetime.bytesSaved = 0;
            state.lifetime.videoSecondsSaved = 0;
            state.local.hourly = [];
            state.local.daily = [{ key: new Date().toISOString().slice(0, 10), adsBlocked: 0, bytesSaved: 0, videoSecondsSaved: 0 }];
            state.local.sites = {};
            state.local.recentEvents = [];
            return { ok: true, data: clone(state) };
          }
          return { ok: true, data: true };
        },
      },
    };
  `
}

function contentFixture(body: string): string {
  return `<!doctype html>
<html>
  <head>
    <title>Adblock smoke fixture</title>
    <script>
      window.__adblockSmokeErrors = [];
      window.__adblockContentEvents = [];
      window.addEventListener('error', event => window.__adblockSmokeErrors.push(event.message));
      window.addEventListener('unhandledrejection', event => window.__adblockSmokeErrors.push(String(event.reason)));
      window.chrome = {
        runtime: {
          sendMessage: async message => {
            if (message.type === 'get-dashboard') {
              return { ok: true, data: { settings: ${JSON.stringify(defaultSmokeSettings())} } };
            }
            if (message.type === 'record-blocks') {
              window.__adblockContentEvents.push(...message.events);
              return { ok: true, data: true };
            }
            return { ok: true, data: true };
          },
        },
      };
    </script>
  </head>
  <body>
    ${body}
    <script src="/content.js"></script>
  </body>
</html>`
}

function youtubeFixture(): string {
  return `
    <h1>YouTube fixture</h1>
    <div id="masthead-ad">masthead ad</div>
    <div class="ytp-ad-module">video ad module</div>
    <div class="video-ads">video ad</div>
    <ytd-display-ad-renderer>display ad</ytd-display-ad-renderer>
    <button class="ytp-ad-skip-button" onclick="document.body.dataset.skipped = 'true'">Skip ad</button>
    <ytd-rich-grid-renderer>
      <ytd-rich-item-renderer id="feed-ad"><ytd-ad-slot-renderer>in-feed ad</ytd-ad-slot-renderer></ytd-rich-item-renderer>
      <ytd-rich-item-renderer id="feed-video"><ytd-rich-grid-media>real recommended video</ytd-rich-grid-media></ytd-rich-item-renderer>
    </ytd-rich-grid-renderer>
  `
}

function twitchFixture(): string {
  return `
    <h1>Twitch fixture</h1>
    <div class="player-ad-notice">Commercial break in progress</div>
    <div class="commercial-break-in-progress">Ad 1 of 2</div>
    <div data-a-target="video-ad-label">Advertisement</div>
    <div data-a-target="video-ad-countdown">0:24</div>
    <button aria-label="Leave feedback for this Ad">Feedback</button>
  `
}

async function waitFor(view: Bun.WebView, expression: string, label: string, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await view.evaluate<boolean>(`Boolean(${expression})`)) return
    await Bun.sleep(100)
  }

  throw new Error(`Timed out waiting for ${label}`)
}

async function countHidden(view: Bun.WebView): Promise<number> {
  return view.evaluate<number>(`document.querySelectorAll('[data-adblock-hidden="true"]').length`)
}

async function isVisible(view: Bun.WebView, selector: string): Promise<boolean> {
  return view.evaluate<boolean>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return Boolean(el) && getComputedStyle(el).display !== 'none' })()`)
}

async function contentEvents(view: Bun.WebView): Promise<number> {
  return view.evaluate<number>(`window.__adblockContentEvents?.reduce((total, event) => total + event.count, 0) ?? 0`)
}

async function numberText(view: Bun.WebView, selector: string): Promise<number> {
  return view.evaluate<number>(`Number.parseInt((document.querySelector(${JSON.stringify(selector)})?.textContent || '0').replace(/\\D/g, ''), 10) || 0`)
}

async function assertNoHorizontalOverflow(view: Bun.WebView, label: string): Promise<void> {
  const sizes = await view.evaluate<{ scrollWidth: number, clientWidth: number }>(`({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  })`)
  assert(sizes.scrollWidth <= sizes.clientWidth + 1, `${label} has horizontal overflow: ${sizes.scrollWidth} > ${sizes.clientWidth}`)
}

async function assertPageClean(view: Bun.WebView, label: string): Promise<void> {
  const pageErrors = await view.evaluate<string[]>(`window.__adblockSmokeErrors ?? []`)
  assert(pageErrors.length === 0, `${label} emitted page errors: ${pageErrors.join('\n')}`)
}

async function screenshot(view: Bun.WebView, filename: string): Promise<void> {
  const shot = await view.screenshot({ encoding: 'buffer' })
  assert(shot.length > 5_000, `${filename} screenshot was unexpectedly small`)
  await Bun.write(join(screenshotDir, filename), shot)
}

function makeDashboardState(): DashboardState {
  const now = new Date()
  const hourly = Array.from({ length: 24 }, (_, index) => bucket(now, index - 23, 'hour', index + 2))
  const daily = Array.from({ length: 14 }, (_, index) => bucket(now, index - 13, 'day', 8 + index))
  const recentEvents: BlockEvent[] = [
    event('example.test', 'dnr', 'script', 18),
    event('youtube.com', 'video', 'media', 3, 8_400_000, 45),
    event('twitch.tv', 'twitch', 'media', 6, 16_800_000, 90),
    event('x.com', 'dnr', 'xhr', 7),
    event('news.example', 'dnr', 'other', 5),
  ]
  const local: LocalStats = {
    hourly,
    daily,
    recentEvents,
    sites: {
      'example.test': { hostname: 'example.test', adsBlocked: 41, bytesSaved: 2_100_000, videoSecondsSaved: 0, lastBlockedAt: now.toISOString() },
      'youtube.com': { hostname: 'youtube.com', adsBlocked: 12, bytesSaved: 33_600_000, videoSecondsSaved: 180, lastBlockedAt: now.toISOString() },
      'twitch.tv': { hostname: 'twitch.tv', adsBlocked: 6, bytesSaved: 16_800_000, videoSecondsSaved: 90, lastBlockedAt: now.toISOString() },
      'x.com': { hostname: 'x.com', adsBlocked: 7, bytesSaved: 238_000, videoSecondsSaved: 0, lastBlockedAt: now.toISOString() },
    },
  }

  return {
    settings: defaultSmokeSettings(),
    lifetime: {
      adsBlocked: 1_287,
      bytesSaved: 74_400_000,
      videoSecondsSaved: 1_680,
      since: new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000).toISOString(),
      lastUpdated: now.toISOString(),
    },
    local,
    cloudSync: {
      available: true,
      syncedAt: now.toISOString(),
      dailyBuckets: daily.length,
      siteRollups: Object.keys(local.sites).length,
    },
    activeTab: {
      hostname: 'example.test',
      url: 'https://example.test/',
      allowed: false,
      blocked: false,
    },
    activePage: {
      blocked: 18,
      network: 11,
      content: 7,
    },
    dnr: {
      available: true,
      recentMatchedRules: 16,
      activeTabMatchedRules: 4,
      rulesetHits: { static_rules: 16 },
      checkedAt: now.toISOString(),
    },
    cosmetic: {
      enabled: true,
      aggressive: false,
      activeTabHidden: 3,
      activeTabSelectors: [
        { selector: 'ytd-ad-slot-renderer', count: 2 },
        { selector: '#masthead-ad', count: 1 },
      ],
    },
    filters: {
      staticRuleCount: 3_932,
      generatedHostRules: 3_912,
      sources: [
        { name: 'EasyList', revision: 'pinned', hosts: 1_996, sha256: 'smoke' },
        { name: 'AdGuard DNS filter', revision: 'pinned', hosts: 1_916, sha256: 'smoke' },
      ],
    },
    manifestVersion: packageJson.version,
  }
}

function defaultSmokeSettings(): ExtensionSettings {
  return {
    enabled: true,
    badgeEnabled: true,
    cosmeticFiltering: true,
    aggressiveCosmetic: false,
    cookieConsentFiltering: false,
    youtubeEnhancements: true,
    twitchEnhancements: true,
    allowedSites: [],
    blockedSites: [],
  }
}

function bucket(now: Date, offset: number, type: 'hour' | 'day', adsBlocked: number): LocalStats['hourly'][number] {
  const unit = type === 'hour' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000
  const date = new Date(now.getTime() + offset * unit)
  return {
    key: type === 'hour' ? date.toISOString().slice(0, 13) : date.toISOString().slice(0, 10),
    adsBlocked,
    bytesSaved: adsBlocked * 52_000,
    videoSecondsSaved: type === 'day' ? adsBlocked * 6 : 0,
  }
}

function event(hostname: string, source: BlockEvent['source'], category: BlockEvent['category'], count: number, bytesSaved = count * 52_000, videoSecondsSaved = 0): BlockEvent {
  return {
    hostname,
    source,
    category,
    count,
    bytesSaved,
    videoSecondsSaved,
    occurredAt: new Date().toISOString(),
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
