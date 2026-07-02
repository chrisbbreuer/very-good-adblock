import { normalizeHostname } from '../shared/domain'
import { formatBytes, formatMinutes } from '../shared/metrics'
import type { DashboardState } from '../shared/types'
import { byId, downloadJson, renderBars, sendMessage } from './dom'

const elements = {
  blocked: byId('dashboard-blocked'),
  data: byId('dashboard-data'),
  video: byId('dashboard-video'),
  version: byId('dashboard-version'),
  dailyChart: byId('daily-chart'),
  enabled: byId<HTMLInputElement>('setting-enabled'),
  cosmetic: byId<HTMLInputElement>('setting-cosmetic'),
  aggressive: byId<HTMLInputElement>('setting-aggressive'),
  youtube: byId<HTMLInputElement>('setting-youtube'),
  twitch: byId<HTMLInputElement>('setting-twitch'),
  badge: byId<HTMLInputElement>('setting-badge'),
  cosmeticStatus: byId('cosmetic-status'),
  cosmeticSelectors: byId('cosmetic-selectors'),
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
  exportData: byId<HTMLButtonElement>('export-data'),
  resetStats: byId<HTMLButtonElement>('reset-stats'),
}

let state: DashboardState | undefined

void refresh()

for (const [key, input] of Object.entries({
  enabled: elements.enabled,
  cosmeticFiltering: elements.cosmetic,
  aggressiveCosmetic: elements.aggressive,
  youtubeEnhancements: elements.youtube,
  twitchEnhancements: elements.twitch,
  badgeEnabled: elements.badge,
})) {
  input.addEventListener('change', async () => {
    state = await sendMessage<DashboardState>({ type: 'set-settings', settings: { [key]: input.checked } })
    render(state)
  })
}

elements.allowForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!state) return
  const hostname = normalizeHostname(elements.allowHost.value)
  if (!hostname) return
  const allowedSites = [...new Set([...state.settings.allowedSites, hostname])]
  state = await sendMessage<DashboardState>({ type: 'set-settings', settings: { allowedSites } })
  elements.allowHost.value = ''
  render(state)
})

elements.blockForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!state) return
  const hostname = normalizeHostname(elements.blockHost.value)
  if (!hostname) return
  const blockedSites = [...new Set([...state.settings.blockedSites, hostname])]
  state = await sendMessage<DashboardState>({ type: 'set-settings', settings: { blockedSites } })
  elements.blockHost.value = ''
  render(state)
})

elements.exportData.addEventListener('click', async () => {
  const data = await sendMessage<DashboardState>({ type: 'export-data' })
  downloadJson(`very-good-adblock-export-${new Date().toISOString().slice(0, 10)}.json`, data)
})

elements.resetStats.addEventListener('click', async () => {
  state = await sendMessage<DashboardState>({ type: 'reset-stats' })
  render(state)
})

async function refresh(): Promise<void> {
  try {
    state = await sendMessage<DashboardState>({ type: 'get-dashboard' })
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
  elements.version.textContent = next.manifestVersion
  elements.enabled.checked = next.settings.enabled
  elements.cosmetic.checked = next.settings.cosmeticFiltering
  elements.aggressive.checked = next.settings.aggressiveCosmetic
  elements.aggressive.disabled = !next.settings.cosmeticFiltering
  elements.youtube.checked = next.settings.youtubeEnhancements
  elements.twitch.checked = next.settings.twitchEnhancements
  elements.badge.checked = next.settings.badgeEnabled
  elements.rulesStatus.textContent = `${next.filters.staticRuleCount.toLocaleString()} static rules`
  elements.allowedCount.textContent = String(next.settings.allowedSites.length)
  elements.blockedCount.textContent = String(next.settings.blockedSites.length)
  elements.status.textContent = 'Lifetime stats and compact history sync through Chrome; detailed history stays local.'

  renderBars(elements.dailyChart, next.local.daily.map(bucket => bucket.adsBlocked), 60)
  renderAllowedSites(next)
  renderBlockedSites(next)
  renderDiagnostics(next)
  renderCosmeticActivity(next)
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
      button.addEventListener('click', async () => {
        const allowedSites = next.settings.allowedSites.filter(site => site !== hostname)
        state = await sendMessage<DashboardState>({ type: 'set-settings', settings: { allowedSites } })
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
      button.addEventListener('click', async () => {
        const blockedSites = next.settings.blockedSites.filter(site => site !== hostname)
        state = await sendMessage<DashboardState>({ type: 'set-settings', settings: { blockedSites } })
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
