import { normalizeHostname } from '../shared/domain'
import { formatBytes, formatMinutes } from '../shared/metrics'
import type { DashboardState, RuntimeMessage } from '../shared/types'
import { byId, downloadJson, renderBars, sendMessage } from './dom'
import { sourceLabel } from './labels'
import { reportAdThatGotThrough } from './report'
import { normalizeDashboardState } from './state'

/** Every worker response passes through the normalizer (see state.ts). */
async function request(message: RuntimeMessage): Promise<DashboardState> {
  return normalizeDashboardState(await sendMessage<DashboardState>(message))
}

const elements = {
  blocked: byId('dashboard-blocked'),
  data: byId('dashboard-data'),
  video: byId('dashboard-video'),
  today: byId('dashboard-today'),
  dailyChart: byId('daily-chart'),
  dailyTotal: byId('daily-total'),
  enabled: byId<HTMLInputElement>('setting-enabled'),
  cosmetic: byId<HTMLInputElement>('setting-cosmetic'),
  aggressive: byId<HTMLInputElement>('setting-aggressive'),
  consent: byId<HTMLInputElement>('setting-consent'),
  popup: byId<HTMLInputElement>('setting-popup'),
  youtube: byId<HTMLInputElement>('setting-youtube'),
  twitch: byId<HTMLInputElement>('setting-twitch'),
  badge: byId<HTMLInputElement>('setting-badge'),
  cosmeticStatus: byId('cosmetic-status'),
  cosmeticSelectors: byId('cosmetic-selectors'),
  recentCount: byId('recent-count'),
  recentBlocks: byId('recent-blocks'),
  rulesStatus: byId('rules-status'),
  allowedCount: byId('allowed-count'),
  allowForm: byId<HTMLFormElement>('allow-form'),
  allowHost: byId<HTMLInputElement>('allow-host'),
  allowedSites: byId('allowed-sites'),
  blockedCount: byId('blocked-count'),
  blockForm: byId<HTMLFormElement>('block-form'),
  blockHost: byId<HTMLInputElement>('block-host'),
  blockedSites: byId('blocked-sites'),
  diagnostics: byId('diagnostics'),
  status: byId('options-status'),
  reportAd: byId<HTMLButtonElement>('report-ad'),
  updateFilters: byId<HTMLButtonElement>('update-filters'),
  exportData: byId<HTMLButtonElement>('export-data'),
  resetStats: byId<HTMLButtonElement>('reset-stats'),
  exportAllow: byId<HTMLButtonElement>('export-allow'),
  importAllow: byId<HTMLButtonElement>('import-allow'),
  importAllowFile: byId<HTMLInputElement>('import-allow-file'),
}

let state: DashboardState | undefined

void refresh()

for (const [key, input] of Object.entries({
  enabled: elements.enabled,
  cosmeticFiltering: elements.cosmetic,
  aggressiveCosmetic: elements.aggressive,
  cookieConsentFiltering: elements.consent,
  popupBlocking: elements.popup,
  youtubeEnhancements: elements.youtube,
  twitchEnhancements: elements.twitch,
  badgeEnabled: elements.badge,
})) {
  input.addEventListener('change', async () => {
    state = await request({ type: 'set-settings', settings: { [key]: input.checked } })
    render(state)
  })
}

elements.allowForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!state) return
  const hostname = normalizeHostname(elements.allowHost.value)
  if (!hostname) return
  const allowedSites = [...new Set([...state.settings.allowedSites, hostname])]
  state = await request({ type: 'set-settings', settings: { allowedSites } })
  elements.allowHost.value = ''
  render(state)
})

elements.blockForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!state) return
  const hostname = normalizeHostname(elements.blockHost.value)
  if (!hostname) return
  const blockedSites = [...new Set([...state.settings.blockedSites, hostname])]
  state = await request({ type: 'set-settings', settings: { blockedSites } })
  elements.blockHost.value = ''
  render(state)
})

elements.reportAd.addEventListener('click', async () => {
  if (!state || elements.reportAd.disabled) return
  elements.reportAd.disabled = true
  const original = elements.reportAd.textContent
  elements.reportAd.textContent = 'Opening…'
  try {
    await reportAdThatGotThrough(state)
    elements.status.textContent = 'Opened a pre-filled GitHub issue in a new tab. A page screenshot was copied to your clipboard — paste it into the issue if it helps.'
  }
  catch (error) {
    elements.status.textContent = error instanceof Error ? error.message : 'Could not open the report.'
  }
  finally {
    elements.reportAd.textContent = original
    elements.reportAd.disabled = false
  }
})

elements.exportData.addEventListener('click', async () => {
  const data = await request({ type: 'export-data' })
  downloadJson(`very-good-adblock-export-${new Date().toISOString().slice(0, 10)}.json`, data)
})

elements.resetStats.addEventListener('click', async () => {
  state = await request({ type: 'reset-stats' })
  render(state)
})

elements.updateFilters.addEventListener('click', async () => {
  elements.updateFilters.disabled = true
  const original = elements.updateFilters.textContent
  elements.updateFilters.textContent = 'Updating...'
  try {
    state = await request({ type: 'refresh-filters' })
    render(state)
    elements.status.textContent = 'Filters refreshed from the maintained host list.'
  }
  catch (error) {
    elements.status.textContent = error instanceof Error ? error.message : String(error)
  }
  finally {
    elements.updateFilters.textContent = original
    elements.updateFilters.disabled = false
  }
})

elements.exportAllow.addEventListener('click', () => {
  if (!state) return
  downloadJson(`very-good-adblock-allowlist-${new Date().toISOString().slice(0, 10)}.json`, {
    allowedSites: state.settings.allowedSites,
  })
})

elements.importAllow.addEventListener('click', () => elements.importAllowFile.click())

elements.importAllowFile.addEventListener('change', async () => {
  const file = elements.importAllowFile.files?.[0]
  elements.importAllowFile.value = ''
  if (!file || !state) return

  try {
    const parsed = JSON.parse(await file.text()) as { allowedSites?: unknown }
    const incoming = Array.isArray(parsed.allowedSites) ? parsed.allowedSites : parsed
    const hosts = (Array.isArray(incoming) ? incoming : [])
      .filter((host): host is string => typeof host === 'string')
      .map(normalizeHostname)
      .filter(Boolean)
    if (!hosts.length) {
      elements.status.textContent = 'No valid hostnames found in that file.'
      return
    }
    const allowedSites = [...new Set([...state.settings.allowedSites, ...hosts])]
    state = await request({ type: 'set-settings', settings: { allowedSites } })
    render(state)
    elements.status.textContent = `Imported ${hosts.length} site${hosts.length === 1 ? '' : 's'} into the allowlist.`
  }
  catch {
    elements.status.textContent = 'Could not read that allowlist file (expected JSON).'
  }
})

async function refresh(): Promise<void> {
  try {
    state = await request({ type: 'get-dashboard' })
    render(state)
  }
  catch (error) {
    elements.status.textContent = error instanceof Error ? error.message : String(error)
  }
}

function render(next: DashboardState): void {
  elements.blocked.textContent = next.lifetime.adsBlocked.toLocaleString()
  elements.data.textContent = formatBytes(next.lifetime.bytesSaved)
  elements.video.textContent = formatMinutes(next.lifetime.videoSecondsSaved)
  const todayKey = new Date().toISOString().slice(0, 10)
  const today = next.local.daily.find(bucket => bucket.key === todayKey)
  elements.today.textContent = (today?.adsBlocked ?? 0).toLocaleString()
  elements.enabled.checked = next.settings.enabled
  elements.cosmetic.checked = next.settings.cosmeticFiltering
  elements.aggressive.checked = next.settings.aggressiveCosmetic
  elements.aggressive.disabled = !next.settings.cosmeticFiltering
  elements.consent.checked = next.settings.cookieConsentFiltering
  elements.popup.checked = next.settings.popupBlocking
  elements.youtube.checked = next.settings.youtubeEnhancements
  elements.twitch.checked = next.settings.twitchEnhancements
  elements.badge.checked = next.settings.badgeEnabled
  elements.rulesStatus.textContent = `${next.filters.staticRuleCount.toLocaleString()} static rules`
  elements.allowedCount.textContent = String(next.settings.allowedSites.length)
  elements.blockedCount.textContent = String(next.settings.blockedSites.length)
  elements.status.textContent = 'Lifetime stats and compact history sync through Chrome; detailed history stays local.'

  renderDailyChart(next)
  renderAllowedSites(next)
  renderBlockedSites(next)
  renderDiagnostics(next)
  renderCosmeticActivity(next)
  renderRecentBlocks(next)
}

const dailyWindow = 60

/**
 * The 60-day history, scaled to the visible window (see renderBars) with each
 * bar dated in its tooltip and the window total in the footer. Leading padding
 * slots (fewer than 60 buckets) get no date — there is no day to label.
 */
function renderDailyChart(next: DashboardState): void {
  const buckets = next.local.daily.slice(-dailyWindow)
  const pad = Math.max(0, dailyWindow - buckets.length)
  const total = buckets.reduce((sum, bucket) => sum + bucket.adsBlocked, 0)

  elements.dailyTotal.textContent = `${total.toLocaleString()} in window`
  renderBars(elements.dailyChart, buckets.map(bucket => bucket.adsBlocked), dailyWindow, {
    valueLabel: (value, index) => {
      const bucket = buckets[index - pad]
      const prefix = bucket ? `${shortDate(bucket.key)}: ` : ''
      return `${prefix}${value.toLocaleString()} blocked`
    },
  })
}

function shortDate(key: string): string {
  const date = new Date(`${key}T00:00:00`)
  return Number.isNaN(date.getTime()) ? key : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function renderCosmeticActivity(next: DashboardState): void {
  const cosmetic = next.cosmetic
  if (!cosmetic?.enabled) {
    elements.cosmeticStatus.textContent = 'Disabled'
    elements.cosmeticSelectors.replaceChildren(diagnosticRow('Cosmetic filtering', 'Off'))
    return
  }

  elements.cosmeticStatus.textContent = cosmetic.aggressive ? 'Aggressive' : 'Active tab'

  if (!cosmetic.activeTabSelectors.length) {
    elements.cosmeticSelectors.replaceChildren(diagnosticRow('Hidden here', String(cosmetic.activeTabHidden)))
    return
  }

  elements.cosmeticSelectors.replaceChildren(
    diagnosticRow('Hidden here', String(cosmetic.activeTabHidden)),
    ...cosmetic.activeTabSelectors.map(hit => diagnosticRow(hit.selector, String(hit.count))),
  )
}

/** The newest blocked events across all sites, most recent first. */
function renderRecentBlocks(next: DashboardState): void {
  const events = next.local.recentEvents.slice(-12).reverse()
  elements.recentCount.textContent = next.local.recentEvents.length.toLocaleString()

  if (!events.length) {
    elements.recentBlocks.replaceChildren(diagnosticRow('No blocked events yet', ''))
    return
  }

  elements.recentBlocks.replaceChildren(
    ...events.map(event => diagnosticRow(
      event.hostname,
      `${sourceLabel(event.source) ?? event.source} ×${event.count.toLocaleString()}`,
    )),
  )
}

function diagnosticRow(label: string, value: string): HTMLElement {
  const row = document.createElement('div')
  row.className = 'diagnostic-row'
  const labelElement = document.createElement('span')
  const valueElement = document.createElement('strong')
  labelElement.textContent = label
  valueElement.textContent = value
  row.replaceChildren(labelElement, valueElement)
  return row
}

function renderAllowedSites(next: DashboardState): void {
  if (!next.settings.allowedSites.length) {
    elements.allowedSites.replaceChildren(pill('No allowed sites'))
    return
  }

  elements.allowedSites.replaceChildren(
    ...next.settings.allowedSites.map((hostname) => {
      const button = pill(hostname)
      button.classList.add('pill-removable')
      button.title = `Remove ${hostname} from the allowlist`
      button.addEventListener('click', async () => {
        const allowedSites = next.settings.allowedSites.filter(site => site !== hostname)
        state = await request({ type: 'set-settings', settings: { allowedSites } })
        render(state)
      })
      return button
    }),
  )
}

function renderBlockedSites(next: DashboardState): void {
  if (!next.settings.blockedSites.length) {
    elements.blockedSites.replaceChildren(pill('No blocked sites'))
    return
  }

  elements.blockedSites.replaceChildren(
    ...next.settings.blockedSites.map((hostname) => {
      const button = pill(hostname)
      button.classList.add('pill-removable')
      button.title = `Remove ${hostname} from the blocklist`
      button.addEventListener('click', async () => {
        const blockedSites = next.settings.blockedSites.filter(site => site !== hostname)
        state = await request({ type: 'set-settings', settings: { blockedSites } })
        render(state)
      })
      return button
    }),
  )
}

function renderDiagnostics(next: DashboardState): void {
  const rows = [
    ['Hourly buckets', next.local.hourly.length],
    ['Daily buckets', next.local.daily.length],
    ['Tracked sites', Object.keys(next.local.sites).length],
    ['Recent events', next.local.recentEvents.length],
    ['Cloud sync', next.cloudSync.available ? cloudSyncLabel(next.cloudSync.syncedAt) : 'Pending'],
    ['Cloud daily history', next.cloudSync.dailyBuckets],
    ['Cloud site rollups', next.cloudSync.siteRollups],
    ['Static rules', next.filters.staticRuleCount],
    ['Generated hosts', next.filters.generatedHostRules],
    ['Filter sources', next.filters.sources.length],
    ['Version', next.manifestVersion],
    ['DNR telemetry', next.dnr.available ? `${next.dnr.recentMatchedRules} recent` : 'Unavailable'],
    ['Active-tab DNR', next.dnr.available ? next.dnr.activeTabMatchedRules : 0],
    ['Blocked on this page', `${next.activePage.blocked} (${next.activePage.network} network, ${next.activePage.content} hidden)`],
    ['Privacy', 'No telemetry'],
  ]

  elements.diagnostics.replaceChildren(
    ...rows.map(([label, value]) => {
      const row = document.createElement('div')
      row.className = 'diagnostic-row'
      const labelElement = document.createElement('span')
      const valueElement = document.createElement('strong')
      labelElement.textContent = String(label)
      valueElement.textContent = String(value)
      row.replaceChildren(labelElement, valueElement)
      return row
    }),
  )
}

function pill(text: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = 'pill'
  button.type = 'button'
  button.textContent = text
  return button
}

function cloudSyncLabel(syncedAt?: string): string {
  if (!syncedAt) return 'Ready'
  return `Synced ${new Date(syncedAt).toLocaleDateString()}`
}
