import { siteMatches } from '../shared/domain'
import { formatBytes, formatMinutes } from '../shared/metrics'
import type { DashboardState, RuntimeMessage } from '../shared/types'
import { byId, renderBars, sendMessage } from './dom'
import { sourceLabel } from './labels'
import { reportAdThatGotThrough } from './report'
import { normalizeDashboardState } from './state'

/** Every worker response passes through the normalizer (see state.ts). */
async function request(message: RuntimeMessage): Promise<DashboardState> {
  return normalizeDashboardState(await sendMessage<DashboardState>(message))
}

const elements = {
  root: document.querySelector<HTMLElement>('.popup-frame')!,
  siteTitle: byId('site-title'),
  protectionToggle: byId<HTMLButtonElement>('protection-toggle'),
  pauseRow: byId('pause-row'),
  pauseLabel: byId('pause-label'),
  resumeBtn: byId<HTMLButtonElement>('resume-btn'),
  dataSaved: byId('data-saved'),
  videoTime: byId('video-time'),
  lifetimeBlocked: byId('lifetime-blocked'),
  chartPeak: byId('chart-peak'),
  hourlyChart: byId('hourly-chart'),
  currentSite: byId('current-site'),
  siteFavicon: byId<HTMLImageElement>('site-favicon'),
  siteToggle: byId<HTMLButtonElement>('site-toggle'),
  pageBlocked: byId('page-blocked'),
  pageBreakdown: byId('page-breakdown'),
  pageBlocksToggle: byId<HTMLButtonElement>('page-blocks-toggle'),
  pageBlocks: byId('page-blocks'),
  siteBlocked: byId('site-blocked'),
  siteData: byId('site-data'),
  siteVideo: byId('site-video'),
  siteLastActivity: byId('site-last-activity'),
  topCategories: byId('top-categories'),
  status: byId('status-message'),
  openOptions: byId<HTMLButtonElement>('open-options'),
  reportAd: byId<HTMLButtonElement>('report-ad'),
  reportHint: byId('report-hint'),
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
    state = await request({ type: 'get-dashboard' })
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
  state = await request({ type: 'set-settings', settings: { enabled: !state.settings.enabled } })
  render(state)
})

elements.siteToggle.addEventListener('click', async () => {
  if (!state?.activeTab) return
  const shouldAllow = !siteMatches(state.activeTab.hostname, state.settings.allowedSites)
  state = await request({ type: 'toggle-site', hostname: state.activeTab.hostname, allowed: shouldAllow })
  render(state)
})

elements.openOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage()
})

elements.pageBlocksToggle.addEventListener('click', () => {
  const expanded = elements.pageBlocksToggle.getAttribute('aria-expanded') === 'true'
  elements.pageBlocksToggle.setAttribute('aria-expanded', String(!expanded))
  elements.pageBlocks.hidden = expanded
})

elements.reportAd.addEventListener('click', async () => {
  if (!state || elements.reportAd.disabled) return
  elements.reportAd.disabled = true
  const original = elements.reportHint.textContent
  elements.reportHint.textContent = 'Opening a pre-filled report…'
  try {
    await reportAdThatGotThrough(state)
  }
  catch (error) {
    elements.reportHint.textContent = error instanceof Error ? error.message : 'Could not open the report.'
    elements.reportAd.disabled = false
    return
  }
  // The new tab takes focus and the popup closes; restore state in case it stays open.
  elements.reportHint.textContent = original
  elements.reportAd.disabled = false
})

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-pause]')) {
  button.addEventListener('click', async () => {
    const minutes = Number(button.dataset.pause)
    if (!Number.isFinite(minutes)) return
    state = await request({ type: 'pause-protection', minutes })
    render(state)
  })
}

elements.resumeBtn.addEventListener('click', async () => {
  state = await request({ type: 'set-settings', settings: { enabled: true } })
  render(state)
})

async function refresh(): Promise<void> {
  try {
    state = await request({ type: 'get-dashboard' })
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
  // An allow-listed site reads as "paused" everywhere else; say which it is.
  elements.siteTitle.textContent = !enabled ? 'Protection paused' : allowed ? 'Site allowed' : 'Protection active'
  renderPageVisit(next)
  renderPageBlocks(next)
  elements.dataSaved.textContent = formatBytes(next.lifetime.bytesSaved)
  elements.videoTime.textContent = formatMinutes(next.lifetime.videoSecondsSaved)
  elements.lifetimeBlocked.textContent = `${next.lifetime.adsBlocked.toLocaleString()} lifetime`
  // Peak of the same 24-hour window the chart renders (see renderBars).
  elements.chartPeak.textContent = `${Math.max(0, ...hourlyValues.slice(-24)).toLocaleString()} peak`
  elements.currentSite.textContent = active?.hostname || 'No active tab'
  elements.siteToggle.textContent = allowed ? 'Protect' : 'Allow'
  elements.siteToggle.disabled = !active
  elements.protectionToggle.classList.toggle('off', !enabled)
  elements.protectionToggle.setAttribute('aria-pressed', String(enabled))
  renderPause(next)
  elements.status.textContent = allowed ? 'This site is allowed. Global protection remains available elsewhere.' : 'Network blocking is active. Estimates are computed locally.'

  renderCurrentSiteStats(next)
}

function renderCurrentSiteStats(next: DashboardState): void {
  const active = next.activeTab
  const site = active ? siteStatsFor(next, active.hostname) : undefined

  renderFavicon(active?.favIconUrl)

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

function renderFavicon(url: string | undefined): void {
  const favicon = elements.siteFavicon
  if (url && favicon.src !== url) favicon.src = url
  favicon.hidden = !url
  // Hide the image if it fails to load so no broken-image glyph shows.
  favicon.onerror = () => { favicon.hidden = true }
}

function renderPause(next: DashboardState): void {
  const enabled = next.settings.enabled
  const resumeAt = next.settings.resumeAt
  const paused = !enabled && typeof resumeAt === 'number' && resumeAt > Date.now()
  const pauseButtons = elements.pauseRow.querySelectorAll<HTMLButtonElement>('[data-pause]')

  if (enabled) {
    elements.pauseRow.hidden = false
    elements.pauseLabel.textContent = 'Pause protection'
    elements.resumeBtn.hidden = true
    for (const button of pauseButtons) button.hidden = false
  }
  else if (paused) {
    elements.pauseRow.hidden = false
    elements.pauseLabel.textContent = `Paused · resumes in ${formatCountdown(resumeAt - Date.now())}`
    elements.resumeBtn.hidden = false
    for (const button of pauseButtons) button.hidden = true
  }
  else {
    // Disabled manually (not paused) — the power toggle handles resuming.
    elements.pauseRow.hidden = true
  }
}

function formatCountdown(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}

function renderPageVisit(next: DashboardState): void {
  const page = next.activePage

  elements.pageBlocked.textContent = page.blocked.toLocaleString()
  elements.pageBreakdown.textContent = next.activeTab ? 'on this page' : 'no active tab'

  const title = next.activeTab
    ? `${page.blocked.toLocaleString()} blocked on this page — ${page.network.toLocaleString()} network requests, ${page.content.toLocaleString()} pop-ups and placements. Click for the list.`
    : 'No active tab'
  elements.pageBlocksToggle.title = title
}

/** The expandable "what's blocked" list under the page counter. */
function renderPageBlocks(next: DashboardState): void {
  const entries = next.activePageBlocks

  if (!entries.length) {
    elements.pageBlocks.replaceChildren(emptyRow(
      next.activeTab ? 'Nothing blocked on this page yet.' : 'Open a site to see what gets blocked.',
    ))
    return
  }

  elements.pageBlocks.replaceChildren(
    ...entries.map((entry) => {
      const row = document.createElement('div')
      row.className = 'page-block-row'

      const kind = document.createElement('span')
      kind.className = 'page-block-kind'
      kind.textContent = pageBlockKindLabel(entry.kind)

      const labelEl = document.createElement('span')
      labelEl.className = 'page-block-label'
      labelEl.textContent = entry.detail ? `${entry.label} · ${entry.detail}` : entry.label
      labelEl.title = labelEl.textContent

      const count = document.createElement('strong')
      count.textContent = `×${entry.count.toLocaleString()}`

      row.replaceChildren(kind, labelEl, count)
      return row
    }),
  )
}

function pageBlockKindLabel(kind: DashboardState['activePageBlocks'][number]['kind']): string {
  switch (kind) {
    case 'network': return 'Network'
    case 'popup': return 'Pop-up'
    case 'cosmetic': return 'Hidden'
    case 'video': return 'Video'
    case 'consent': return 'Consent'
    case 'x': return 'Promoted'
    default: return 'Other'
  }
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
