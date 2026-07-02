import packageJson from '../../package.json'
import generatedNetworkHosts from '../../rules/generated/network-hosts.json'
import { filterRefreshAlarm, filterRefreshUrl, refreshRuleEndId, refreshRuleStartId } from '../shared/constants'
import { curatedRuleSeeds, redirectRuleSeeds } from '../rules/static-rules'
import { buildHostRefreshRules, syncDynamicRules } from '../rules/dynamic-rules'
import { hostnameFromUrl } from '../shared/domain'
import { formatBytes } from '../shared/metrics'
import {
  getActiveTabState,
  getCloudStatsSnapshot,
  getLifetimeStats,
  getLocalStats,
  getSettings,
  hydrateSyncedStats,
  initializeStorage,
  recordBlockEvents,
  resetStats,
  setSettings,
} from '../shared/storage'
import type { ActivePageStats, CosmeticTelemetry, DashboardState, DnrTelemetry, ExtensionSettings, RuntimeMessage, RuntimeResponse } from '../shared/types'

const staticRuleCount = curatedRuleSeeds.length + redirectRuleSeeds.length + generatedNetworkHosts.hosts.length
const filterSources = generatedNetworkHosts.sources.map(source => ({
  name: source.name,
  revision: source.revision,
  hosts: source.hosts,
  sha256: source.sha256,
}))
/**
 * Per-tab counters for the current page visit (reset on navigation).
 * `content` is fed by the content script (cosmetic hides, video skips);
 * `network` is the declarativeNetRequest match count for this load, kept live by
 * the debug listener and reconciled against getMatchedRules. `loadedAt` bounds
 * the getMatchedRules lookup to the current visit.
 */
interface PageVisitState {
  content: number
  network: number
  url?: string
  loadedAt: number
  networkCheckedAt: number
}

const pageBadgeStats = new Map<number, PageVisitState>()
const cosmeticActivity = new Map<number, Map<string, number>>()
const maxCosmeticSelectors = 24
const badgeRefreshTabs = new Set<number>()
const badgeRefreshDelayMs = 400
let badgeRefreshTimer: ReturnType<typeof setTimeout> | undefined
const badgePollIntervalMs = 2_000
const badgePollMaxTicks = 8
const networkRefreshMinIntervalMs = 1_500
let badgePollTimer: ReturnType<typeof setTimeout> | undefined
let badgePollTabId: number | undefined
let badgePollTicksLeft = 0

chrome.runtime.onInstalled.addListener(() => {
  void setup()
})

chrome.runtime.onStartup.addListener(() => {
  void setup()
})

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  void handleMessage(message, sender)
    .then(data => sendResponse({ ok: true, data } satisfies RuntimeResponse))
    .catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)
      sendResponse({ ok: false, error: reason } satisfies RuntimeResponse)
    })

  return true
})

chrome.tabs.onActivated.addListener(({ tabId }) => {
  // A one-shot refresh only. Polling is started on navigation-complete, not on
  // every activation, so rapid tab switching can't perpetually reset the poll
  // budget and keep the service worker awake.
  void updateBadge(tabId)
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' || changeInfo.url) {
    pageBadgeStats.set(tabId, { content: 0, network: 0, url: changeInfo.url ?? tab.url, loadedAt: Date.now(), networkCheckedAt: 0 })
    cosmeticActivity.delete(tabId)
    void updateBadge(tabId)
  }

  if (changeInfo.status === 'complete') {
    void updateBadge(tabId)
    startBadgePolling(tabId)
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  pageBadgeStats.delete(tabId)
  cosmeticActivity.delete(tabId)
  if (badgePollTabId === tabId) {
    badgePollTabId = undefined
    badgePollTicksLeft = 0
  }
})

// Live network-block feedback. Only fires for unpacked/dev installs; packed
// installs rely on getMatchedRules in refreshTabNetworkCount instead. Increments
// are reconciled (via Math.max) against getMatchedRules so the two never sum.
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener((info) => {
  const tabId = info.request.tabId
  if (tabId < 0) return
  const details = pageBadgeStats.get(tabId)
  if (details) details.network += 1
  scheduleBadgeRefresh(tabId)
})

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === filterRefreshAlarm) void refreshFilters()
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') return

  if (changes.settings?.newValue) {
    void syncDynamicRules(changes.settings.newValue as ExtensionSettings)
    void updateBadge()
  }

  if (changes.cloudStats?.newValue) {
    void hydrateSyncedStats(changes.cloudStats.newValue)
    void updateBadge()
  }
})

async function setup(): Promise<void> {
  await initializeStorage()
  await syncDynamicRules(await getSettings())
  await updateBadge()
  chrome.alarms?.create(filterRefreshAlarm, { periodInMinutes: 24 * 60 })
  void refreshFilters()
}

/**
 * Fetch the maintained host list and load any hosts newer than the shipped
 * static ruleset as dynamic rules. MV3 static rules can only change with an
 * extension update, so this keeps network blocking fresh between releases.
 * Any failure is non-fatal — the shipped ruleset stays active.
 */
async function refreshFilters(): Promise<void> {
  try {
    const response = await fetch(filterRefreshUrl, { cache: 'no-cache' })
    if (!response.ok) return

    const data = await response.json() as { hosts?: unknown }
    const hosts = Array.isArray(data.hosts) ? data.hosts.filter((host): host is string => typeof host === 'string') : []
    if (!hosts.length) return

    const shipped = new Set(generatedNetworkHosts.hosts)
    const addRules = buildHostRefreshRules(hosts, { exclude: shipped })

    const existing = await chrome.declarativeNetRequest.getDynamicRules()
    const removeRuleIds = existing
      .map(rule => rule.id)
      .filter(id => id >= refreshRuleStartId && id <= refreshRuleEndId)

    if (!addRules.length && !removeRuleIds.length) return
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules })
  }
  catch {
    // Ignore refresh failures; static and dynamic rules already loaded stay active.
  }
}

async function handleMessage(message: RuntimeMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (message.type) {
    case 'get-dashboard':
      return getDashboard()
    case 'set-settings': {
      const settings = await setSettings(message.settings)
      await syncDynamicRules(settings)
      await updateBadge()
      return getDashboard()
    }
    case 'toggle-site': {
      const settings = await toggleSite(message.hostname, message.allowed)
      await syncDynamicRules(settings)
      await updateBadge()
      return getDashboard()
    }
    case 'record-blocks': {
      // Don't accrue stats while protection is off, so the numbers match reality.
      if (!(await getSettings()).enabled) return true
      await recordBlockEvents(message.events)
      if (sender.tab?.id !== undefined) {
        incrementPageContent(sender.tab.id, message.events.reduce((total, event) => total + event.count, 0), sender.tab.url)
      }
      await updateBadge(sender.tab?.id)
      return true
    }
    case 'record-cosmetic': {
      if (!(await getSettings()).enabled) return true
      if (sender.tab?.id !== undefined) recordCosmeticActivity(sender.tab.id, message.hits)
      return true
    }
    case 'reset-stats':
      await resetStats()
      await updateBadge()
      return getDashboard()
    case 'export-data':
      return getDashboard()
    default:
      throw new Error('Unknown runtime message')
  }
}

async function getDashboard(): Promise<DashboardState> {
  const settings = await getSettings()
  const activeTab = await getActiveTabState(settings)
  const cloudStats = await getCloudStatsSnapshot()

  if (activeTab?.tabId !== undefined) await refreshTabNetworkCount(activeTab.tabId)

  return {
    settings,
    lifetime: await getLifetimeStats(),
    local: await getLocalStats(),
    cloudSync: {
      available: Boolean(cloudStats),
      syncedAt: cloudStats?.syncedAt,
      dailyBuckets: cloudStats?.daily.length ?? 0,
      siteRollups: cloudStats?.sites.length ?? 0,
    },
    activeTab,
    activePage: pageVisitStats(activeTab?.tabId),
    dnr: await getDnrTelemetry(activeTab?.tabId),
    cosmetic: getCosmeticTelemetry(settings, activeTab?.tabId),
    filters: {
      staticRuleCount,
      generatedHostRules: generatedNetworkHosts.totalHosts,
      sources: filterSources,
    },
    manifestVersion: packageJson.version,
  }
}

async function getDnrTelemetry(activeTabId?: number): Promise<DnrTelemetry> {
  const checkedAt = new Date().toISOString()

  try {
    const minTimeStamp = Date.now() - 5 * 60 * 1000
    const recent = await chrome.declarativeNetRequest.getMatchedRules({ minTimeStamp })
    const active = activeTabId !== undefined
      ? await chrome.declarativeNetRequest.getMatchedRules({ minTimeStamp, tabId: activeTabId })
      : { rulesMatchedInfo: [] }

    const rulesetHits: Record<string, number> = {}
    for (const match of recent.rulesMatchedInfo) {
      rulesetHits[match.rule.rulesetId] = (rulesetHits[match.rule.rulesetId] ?? 0) + 1
    }

    return {
      available: true,
      recentMatchedRules: recent.rulesMatchedInfo.length,
      activeTabMatchedRules: active.rulesMatchedInfo.length,
      rulesetHits,
      checkedAt,
    }
  }
  catch (error) {
    return {
      available: false,
      recentMatchedRules: 0,
      activeTabMatchedRules: 0,
      rulesetHits: {},
      checkedAt,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

async function toggleSite(hostname: string, allowed: boolean): Promise<ExtensionSettings> {
  const settings = await getSettings()
  const normalized = hostnameFromUrl(`https://${hostname}`)
  const allowedSites = new Set(settings.allowedSites)
  const blockedSites = new Set(settings.blockedSites)

  if (allowed) {
    allowedSites.add(normalized)
    blockedSites.delete(normalized)
  }
  else {
    allowedSites.delete(normalized)
  }

  return setSettings({
    allowedSites: [...allowedSites],
    blockedSites: [...blockedSites],
  })
}

async function updateBadge(tabId?: number): Promise<void> {
  const settings = await getSettings()
  const activeTab = await getActiveTabState(settings)
  tabId ??= activeTab?.tabId

  if (!settings.badgeEnabled) {
    await chrome.action.setBadgeText(tabId === undefined ? { text: '' } : { tabId, text: '' })
    return
  }

  if (tabId !== undefined) await refreshTabNetworkCount(tabId)
  const tabDetails = tabId === undefined ? undefined : pageBadgeStats.get(tabId)
  const pageBlocked = pageVisitStats(tabId).blocked
  const hostname = tabDetails?.url ? hostnameFromUrl(tabDetails.url) : activeTab?.hostname
  const local = await getLocalStats()
  const site = hostname ? local.sites[hostname] : undefined
  const badgeTarget = tabId === undefined ? {} : { tabId }

  await chrome.action.setBadgeBackgroundColor({ ...badgeTarget, color: pageBlocked ? '#17c964' : '#51615c' })
  await chrome.action.setBadgeText({ ...badgeTarget, text: pageBlocked ? compactBadge(pageBlocked) : '' })
  await chrome.action.setTitle({
    ...badgeTarget,
    title: [
      `Very Good AdBlock blocked ${pageBlocked.toLocaleString()} item${pageBlocked === 1 ? '' : 's'} on this page.`,
      site ? `${site.adsBlocked.toLocaleString()} total for ${hostname}, about ${formatBytes(site.bytesSaved)} saved.` : undefined,
    ].filter(Boolean).join(' '),
  })
}

function recordCosmeticActivity(tabId: number, hits: Array<{ selector: string, count: number }>): void {
  if (!hits.length) return
  const perTab = cosmeticActivity.get(tabId) ?? new Map<string, number>()
  for (const hit of hits) {
    if (!hit.selector || hit.count <= 0) continue
    perTab.set(hit.selector, (perTab.get(hit.selector) ?? 0) + hit.count)
  }
  cosmeticActivity.set(tabId, perTab)
}

function getCosmeticTelemetry(settings: ExtensionSettings, activeTabId?: number): CosmeticTelemetry {
  const perTab = activeTabId === undefined ? undefined : cosmeticActivity.get(activeTabId)
  const selectors = [...(perTab?.entries() ?? [])]
    .map(([selector, count]) => ({ selector, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, maxCosmeticSelectors)

  return {
    enabled: settings.cosmeticFiltering,
    aggressive: settings.aggressiveCosmetic,
    activeTabHidden: selectors.reduce((total, hit) => total + hit.count, 0),
    activeTabSelectors: selectors,
  }
}

function incrementPageContent(tabId: number, count: number, url?: string): void {
  if (count <= 0) return
  const existing = pageBadgeStats.get(tabId)
  pageBadgeStats.set(tabId, {
    content: (existing?.content ?? 0) + count,
    network: existing?.network ?? 0,
    url: url ?? existing?.url,
    loadedAt: existing?.loadedAt ?? Date.now(),
    networkCheckedAt: existing?.networkCheckedAt ?? 0,
  })
}

/**
 * Pull the authoritative network-block count for this page visit from
 * getMatchedRules (works for packed installs, unlike onRuleMatchedDebug) and
 * fold it into the live counter. Math.max keeps whichever source is ahead, so
 * debug increments and matched-rule reads never double-count.
 */
async function refreshTabNetworkCount(tabId: number): Promise<void> {
  const details = pageBadgeStats.get(tabId)
  if (!details) return

  // getMatchedRules is quota-limited (~20/10min without extra allowance). updateBadge
  // fires from many events, so throttle real calls per tab and reuse the last count
  // in between — otherwise a burst exhausts the quota and the badge freezes.
  const now = Date.now()
  if (now - details.networkCheckedAt < networkRefreshMinIntervalMs) return
  details.networkCheckedAt = now

  try {
    const matched = await chrome.declarativeNetRequest.getMatchedRules({ tabId, minTimeStamp: details.loadedAt })
    details.network = Math.max(details.network, matched.rulesMatchedInfo.length)
  }
  catch {
    // getMatchedRules can throw without the feedback permission or when quota is
    // exceeded; keep the live counter so the badge still reflects what we have.
  }
}

function pageVisitStats(tabId?: number): ActivePageStats {
  const details = tabId === undefined ? undefined : pageBadgeStats.get(tabId)
  const network = details?.network ?? 0
  const content = details?.content ?? 0
  return { blocked: network + content, network, content }
}

/** Coalesce the frequent debug-listener updates into one badge refresh. */
function scheduleBadgeRefresh(tabId: number): void {
  badgeRefreshTabs.add(tabId)
  if (badgeRefreshTimer) return
  badgeRefreshTimer = setTimeout(() => {
    badgeRefreshTimer = undefined
    const tabs = [...badgeRefreshTabs]
    badgeRefreshTabs.clear()
    for (const id of tabs) void updateBadge(id)
  }, badgeRefreshDelayMs)
}

/**
 * Poll the active tab's network-block count for a bounded window after a load or
 * tab switch. onRuleMatchedDebug does not fire for packed installs, so without
 * this the badge would only move on tab/content events; polling getMatchedRules
 * a few times catches ads that finish loading shortly after the page does. The
 * tick budget is bounded so this never keeps the service worker awake for long.
 */
function startBadgePolling(tabId: number): void {
  badgePollTabId = tabId
  badgePollTicksLeft = badgePollMaxTicks
  if (badgePollTimer) return
  scheduleBadgePoll()
}

function scheduleBadgePoll(): void {
  badgePollTimer = setTimeout(async () => {
    badgePollTimer = undefined
    const tabId = badgePollTabId
    if (tabId === undefined || badgePollTicksLeft <= 0) return

    badgePollTicksLeft -= 1
    try {
      await updateBadge(tabId)
    }
    catch {
      return // Tab likely closed; stop chasing it.
    }

    if (badgePollTicksLeft > 0) scheduleBadgePoll()
  }, badgePollIntervalMs)
}

function compactBadge(value: number): string {
  if (value > 9999) return '9k+'
  if (value > 999) return `${Math.floor(value / 1000)}k`
  return String(value)
}
