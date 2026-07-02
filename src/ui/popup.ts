import { siteMatches } from '../shared/domain'
import { formatBytes, formatMinutes } from '../shared/metrics'
import type { DashboardState } from '../shared/types'
import { byId, renderBars, sendMessage } from './dom'

const elements = {
  root: document.querySelector<HTMLElement>('.popup-frame')!,
  siteTitle: byId('site-title'),
  protectionToggle: byId<HTMLButtonElement>('protection-toggle'),
  dataSaved: byId('data-saved'),
  videoTime: byId('video-time'),
  lifetimeBlocked: byId('lifetime-blocked'),
  chartPeak: byId('chart-peak'),
  hourlyChart: byId('hourly-chart'),
  currentSite: byId('current-site'),
  siteToggle: byId<HTMLButtonElement>('site-toggle'),
  pageBlocked: byId('page-blocked'),
  pageBreakdown: byId('page-breakdown'),
  siteBlocked: byId('site-blocked'),
  siteData: byId('site-data'),
  siteVideo: byId('site-video'),
  siteLastActivity: byId('site-last-activity'),
  topCategories: byId('top-categories'),
  status: byId('status-message'),
  openOptions: byId<HTMLButtonElement>('open-options'),
}

let state: DashboardState | undefined

void refresh()

// Keep the live counts (blocked-on-this-page, running totals) ticking while the
// popup is open. This refreshes text only — the 24h chart and category list are
// left in place so they don't rebuild (and drop hover/focus) every few seconds.
const liveRefreshMs = 2_000
let liveTickPending = false
const livePoll = setInterval(() => void liveTick(), liveRefreshMs)
window.addEventListener('pagehide', () => clearInterval(livePoll), { once: true })

async function liveTick(): Promise<void> {
  if (liveTickPending) return
  liveTickPending = true
  try {
    state = await sendMessage<DashboardState>({ type: 'get-dashboard' })
    if (elements.root.dataset.view === 'ready') renderLive(state)
    else render(state)
  }
  catch {
    // Transient messaging failure; the next tick retries.
  }
  finally {
    liveTickPending = false
  }
}

elements.protectionToggle.addEventListener('click', async () => {
  if (!state) return
  state = await sendMessage<DashboardState>({ type: 'set-settings', settings: { enabled: !state.settings.enabled } })
  render(state)
})

elements.siteToggle.addEventListener('click', async () => {
  if (!state?.activeTab) return
  const shouldAllow = !siteMatches(state.activeTab.hostname, state.settings.allowedSites)
  state = await sendMessage<DashboardState>({ type: 'toggle-site', hostname: state.activeTab.hostname, allowed: shouldAllow })
  render(state)
})

elements.openOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage()
})

async function refresh(): Promise<void> {
  try {
    state = await sendMessage<DashboardState>({ type: 'get-dashboard' })
    render(state)
  }
  catch (error) {
    elements.status.textContent = error instanceof Error ? error.message : String(error)
    elements.root.dataset.view = 'error'
  }
}

function render(next: DashboardState): void {
  renderLive(next)

  renderBars(elements.hourlyChart, next.local.hourly.map(bucket => bucket.adsBlocked), 24, {
    interactive: true,
    valueLabel: (value, index) => `${hourLabel(index)}: ${value.toLocaleString()} blocked`,
  })
  renderTopCategories(next)
}

/** Text-only updates cheap enough to run on every live tick. */
function renderLive(next: DashboardState): void {
  const active = next.activeTab
  const enabled = next.settings.enabled
  const allowed = active ? siteMatches(active.hostname, next.settings.allowedSites) : false
  const hourlyValues = next.local.hourly.map(bucket => bucket.adsBlocked)

  elements.root.dataset.view = 'ready'
  elements.root.dataset.enabled = String(enabled && !allowed)
  elements.siteTitle.textContent = enabled && !allowed ? 'Protection active' : 'Protection paused'
  renderPageVisit(next)
  elements.dataSaved.textContent = formatBytes(next.lifetime.bytesSaved)
  elements.videoTime.textContent = formatMinutes(next.lifetime.videoSecondsSaved)
  elements.lifetimeBlocked.textContent = `${next.lifetime.adsBlocked.toLocaleString()} lifetime`
  elements.chartPeak.textContent = `${Math.max(0, ...hourlyValues).toLocaleString()} peak`
  elements.currentSite.textContent = active?.hostname || 'No active tab'
  elements.siteToggle.textContent = allowed ? 'Protect' : 'Allow'
  elements.siteToggle.disabled = !active
  elements.protectionToggle.classList.toggle('off', !enabled)
  elements.protectionToggle.setAttribute('aria-pressed', String(enabled))
  elements.status.textContent = allowed ? 'This site is allowed. Global protection remains available elsewhere.' : 'Network blocking is active. Estimates are computed locally.'

  renderCurrentSiteStats(next)
}

function renderCurrentSiteStats(next: DashboardState): void {
  const active = next.activeTab
  const site = active ? siteStatsFor(next, active.hostname) : undefined

  elements.siteBlocked.textContent = (site?.adsBlocked ?? 0).toLocaleString()
  elements.siteData.textContent = formatBytes(site?.bytesSaved ?? 0)
  elements.siteVideo.textContent = formatMinutes(site?.videoSecondsSaved ?? 0)

  const title = active
    ? `${active.hostname}: ${(site?.adsBlocked ?? 0).toLocaleString()} blocked, ${formatBytes(site?.bytesSaved ?? 0)} saved, ${formatMinutes(site?.videoSecondsSaved ?? 0)} video time`
    : 'No active tab'

  for (const element of [elements.siteBlocked, elements.siteData, elements.siteVideo]) {
    element.title = title
  }

  elements.siteLastActivity.textContent = site?.lastBlockedAt
    ? `Last blocked here ${relativeTime(site.lastBlockedAt)}`
    : active ? 'No blocked events recorded for this site yet.' : 'Open a site to see per-site stats.'
}

function renderPageVisit(next: DashboardState): void {
  const page = next.activePage

  elements.pageBlocked.textContent = page.blocked.toLocaleString()
  elements.pageBreakdown.textContent = next.activeTab ? 'on this page' : 'no active tab'

  const title = next.activeTab
    ? `${page.blocked.toLocaleString()} blocked on this page — ${page.network.toLocaleString()} network requests, ${page.content.toLocaleString()} placements hidden`
    : 'No active tab'
  elements.pageBlocked.title = title
  elements.pageBreakdown.title = title
}

function renderTopCategories(next: DashboardState): void {
  const categories = Object.entries(next.local.recentEvents.reduce<Record<string, number>>((totals, event) => {
    const key = sourceLabel(String(event.source))
    if (!key) return totals
    totals[key] = (totals[key] ?? 0) + event.count
    return totals
  }, {}))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)

  if (!categories.length) {
    elements.topCategories.replaceChildren(emptyRow('No blocked ads yet'))
    return
  }

  elements.topCategories.replaceChildren(
    ...categories.map(([category, count]) => {
      const row = document.createElement('div')
      row.className = 'site-row'
      row.replaceChildren(label(category), strong(count.toLocaleString()))
      return row
    }),
  )
}

function siteStatsFor(next: DashboardState, hostname: string): DashboardState['local']['sites'][string] | undefined {
  return next.local.sites[hostname]
    ?? Object.values(next.local.sites).find(site => siteMatches(hostname, [site.hostname]))
}

function sourceLabel(source: string): string | undefined {
  if (source === 'dnr') return 'Network rules'
  if (source === 'video') return 'Video skips'
  if (source === 'twitch') return 'Twitch banners'
  if (source === 'youtube') return 'YouTube placements'
  if (source === 'cosmetic') return 'Hidden placements'
  if (source === 'x') return 'X promoted'
  if (source === 'manual') return 'Manual rules'
  return undefined
}

function hourLabel(index: number): string {
  const hoursAgo = 23 - index
  if (hoursAgo <= 0) return 'This hour'
  if (hoursAgo === 1) return '1 hour ago'
  return `${hoursAgo} hours ago`
}

function relativeTime(value: string): string {
  const date = new Date(value)
  const diffMs = Date.now() - date.getTime()
  if (!Number.isFinite(diffMs)) return 'recently'
  const minutes = Math.max(0, Math.round(diffMs / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function emptyRow(text: string): HTMLElement {
  const row = document.createElement('div')
  row.className = 'muted site-row'
  row.textContent = text
  return row
}

function label(text: string): HTMLElement {
  const element = document.createElement('span')
  element.textContent = text
  return element
}

function strong(text: string): HTMLElement {
  const element = document.createElement('strong')
  element.textContent = text
  return element
}
