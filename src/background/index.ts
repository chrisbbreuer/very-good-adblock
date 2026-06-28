import packageJson from '../../package.json'
import generatedNetworkHosts from '../../rules/generated/network-hosts.json'
import { curatedRuleSeeds } from '../rules/static-rules'
import { syncDynamicRules } from '../rules/dynamic-rules'
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
import type { DashboardState, DnrTelemetry, ExtensionSettings, RuntimeMessage, RuntimeResponse } from '../shared/types'

const staticRuleCount = curatedRuleSeeds.length + generatedNetworkHosts.hosts.length
const filterSources = generatedNetworkHosts.sources.map(source => ({
  name: source.name,
  revision: source.revision,
  hosts: source.hosts,
  sha256: source.sha256,
}))

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
      await recordBlockEvents(message.events)
      await updateBadge(sender.tab?.url)
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
    dnr: await getDnrTelemetry(activeTab?.tabId),
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

async function updateBadge(tabUrl?: string): Promise<void> {
  const settings = await getSettings()
  if (!settings.badgeEnabled) {
    await chrome.action.setBadgeText({ text: '' })
    return
  }

  const hostname = tabUrl ? hostnameFromUrl(tabUrl) : (await getActiveTabState(settings))?.hostname
  const local = await getLocalStats()
  const site = hostname ? local.sites[hostname] : undefined

  await chrome.action.setBadgeBackgroundColor({ color: '#17c964' })
  await chrome.action.setBadgeText({ text: site?.adsBlocked ? compactBadge(site.adsBlocked) : '' })
  await chrome.action.setTitle({
    title: site ? `Adblock blocked ${site.adsBlocked} ads and saved about ${formatBytes(site.bytesSaved)} here.` : 'Adblock',
  })
}

function compactBadge(value: number): string {
  if (value > 9999) return '9k+'
  if (value > 999) return `${Math.floor(value / 1000)}k`
  return String(value)
}
