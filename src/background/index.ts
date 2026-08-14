import packageJson from '../../package.json'
import generatedNetworkHosts from '../rules/generated/network-hosts.json'
import { bypassSweepAlarm, filterRefreshAlarm, filterRefreshUrl, refreshRuleEndId, refreshRuleStartId, resumeAlarm } from '../shared/constants'
import { blockedPageFile, blockedPageQuery } from '../shared/blocked-page'
import type { BlockedReason } from '../shared/blocked-page'
import { grantBypass, pruneBypasses } from './bypass'
import { curatedRuleSeeds, redirectRuleSeeds } from '../rules/static-rules'
import { buildHostRefreshRules, syncDynamicRules } from '../rules/dynamic-rules'
import { addBlockedHosts, isBlockedHost, isBlockedRequest } from '../rules/blocked-hosts'
import { hostnameFromUrl, siteMatches } from '../shared/domain'
import { categoryForRequestType, estimateBytesSaved, formatBytes } from '../shared/metrics'
import { isSearchResultsUrl } from '../shared/search-navigation'
import { isOriginalPopupDestination, rememberInitialPopupUrl } from './popup-candidate'
import type { PopupCandidate } from './popup-candidate'
import { isNewBlockedHost } from './page-block-tally'
import {
  defaultSettings,
  getActiveTabState,
  getCloudStatsSnapshot,
  getLifetimeStats,
  getLocalStats,
  getSettings,
  hydrateSyncedStats,
  initializeStorage,
  migrateStatsSchema,
  recordBlockEvents,
  resetStats,
  setSettings,
} from '../shared/storage'
import type { ActivePageStats, BlockEvent, BlockSource, CosmeticTelemetry, DashboardState, DnrTelemetry, ExtensionSettings, PageBlockEntry, PageBlockKind, ResourceCategory, RuntimeMessage, RuntimeResponse } from '../shared/types'

const staticRuleCount = curatedRuleSeeds.length + redirectRuleSeeds.length + generatedNetworkHosts.hosts.length
const filterSources = generatedNetworkHosts.sources.map(source => ({
  name: source.name,
  revision: source.revision,
  hosts: source.hosts,
  sha256: source.sha256,
}))
/**
 * Per-tab counters for the current page visit (reset on navigation).
 * `content` is fed by the content script (cosmetic hides, video skips, pop-up
 * blocks); `network` counts the distinct ad/tracker HOSTS blocked on this load,
 * kept live by the debug listener (unpacked) or the webRequest error listener
 * (packed), and reconciled against getMatchedRules. Every network increment
 * flows through addNetworkBlocks, which also feeds the lifetime/site stats.
 * `loadedAt` bounds the getMatchedRules lookup to the current visit.
 *
 * `networkRaw` counts every blocked REQUEST, repeats included. The two differ
 * by a lot and both are needed. A blocked tracker does not give up: its script
 * retries the beacon, so one endpoint can be refused hundreds of times while
 * the page sits open — a Shopify product page with the usual analytics stack
 * reports ~30 distinct hosts and, after a few minutes, several hundred refused
 * requests. Showing the request count as "blocked on this page" read as an
 * absurd ad count; the distinct-host count is what a person means. The raw
 * count still drives the getMatchedRules reconciliation (which counts
 * requests) and the bytes-saved estimate (every refused request saves its
 * bytes), and the popup's per-row `×N` keeps the repeats visible.
 */
interface PageVisitState {
  content: number
  network: number
  networkRaw: number
  url?: string
  loadedAt: number
  networkCheckedAt: number
}

const pageBadgeStats = new Map<number, PageVisitState>()
// Hosts already counted on the current visit, so a retrying beacon moves the
// raw counter and the row's ×N without moving the headline number again.
// Mirrored to session storage with the counters: a worker restart that lost it
// would count every still-retrying tracker a second time, which is the inflation
// this set exists to prevent.
const pageBlockedHosts = new Map<number, Set<string>>()
const pageBlockedHostsStorageKey = 'pageBlockedHosts'
// A page whose trackers randomise their subdomain could grow this without
// bound; past the cap the counter simply stops rising, which is the right
// failure for a number that means "how many trackers are on this page".
const maxBlockedHostsPerPage = 500
const cosmeticActivity = new Map<number, Map<string, number>>()
// pageBadgeStats is mirrored to chrome.storage.session (debounced) so the
// per-page counts survive service-worker restarts: MV3 workers are killed
// after ~30s idle, and without the mirror the badge and popup reset to zero
// mid-visit on exactly the long-lived pages (streams, videos) that rack up
// the most blocks. Session storage dies with the browser session, matching
// the per-visit lifetime of these counters.
const pageStatsStorageKey = 'pageBadgeStats'
const pageStatsPersistDelayMs = 500
let pageStatsPersistTimer: ReturnType<typeof setTimeout> | undefined
// Tabs opened by another tab (target=_blank clicks, scripted window.open that
// the page-level guard let through), remembered briefly so a network-blocked
// pop-under can be attributed to the page that spawned it and closed.
const popupCandidates = new Map<number, PopupCandidate>()
const popupCandidateMaxAgeMs = 30_000
const maxCosmeticSelectors = 24
// Per-tab log of what was blocked on the current page visit, powering the
// popup's "what's blocked" list. Entries merge when kind+label+detail match
// (a burst of script blocks to the same host becomes one row with a count),
// and the log is capped so a runaway page can't grow it without bound.
// Mirrored to session storage alongside pageBadgeStats.
const pageBlockLog = new Map<number, PageBlockEntry[]>()
const maxPageBlockEntries = 60
const pageBlockLogStorageKey = 'pageBlockLog'
const badgeRefreshTabs = new Set<number>()
const badgeRefreshDelayMs = 400
let badgeRefreshTimer: ReturnType<typeof setTimeout> | undefined
const badgePollIntervalMs = 2_000
// getMatchedRules is quota-limited (~20 calls/10min) and now only reconciles
// what the live listeners miss, so the poll stays short: 5 ticks × 2s after
// load catches stragglers without exhausting the quota during normal browsing.
const badgePollMaxTicks = 5
// webRequest/onRuleMatchedDebug move the network counter live; getMatchedRules
// only backstops them, so the throttle can be generous — every spared call is
// quota left for the pages that actually need reconciliation.
const networkRefreshMinIntervalMs = 10_000
let badgePollTimer: ReturnType<typeof setTimeout> | undefined
let badgePollTabId: number | undefined
let badgePollTicksLeft = 0
// Hot-path copy of the settings for the webRequest listener, which fires far
// too often to await chrome.storage on every event. Kept in sync through the
// storage.onChanged listener below; undefined until setup() loads them.
let cachedSettings: ExtensionSettings | undefined

// Kick off the restore immediately so counts from before a worker restart are
// back before the first events land. Listeners merge rather than overwrite.
const pageStatsHydration = hydratePageBadgeStats()

async function hydratePageBadgeStats(): Promise<void> {
  const session = chrome.storage.session as chrome.storage.StorageArea | undefined
  if (!session) return

  try {
    const stored = await session.get([pageStatsStorageKey, pageBlockLogStorageKey, pageBlockedHostsStorageKey])
    const entries = stored[pageStatsStorageKey] as Record<string, PageVisitState> | undefined
    const storedLogs = stored[pageBlockLogStorageKey] as Record<string, PageBlockEntry[]> | undefined
    const storedHosts = stored[pageBlockedHostsStorageKey] as Record<string, string[]> | undefined

    for (const [key, state] of Object.entries(entries ?? {})) {
      const tabId = Number(key)
      if (!Number.isInteger(tabId) || !state || typeof state !== 'object') continue

      // Live events can land before hydration finishes; keep whichever side is
      // ahead per field rather than letting the older snapshot erase them.
      const existing = pageBadgeStats.get(tabId)
      pageBadgeStats.set(tabId, {
        content: Math.max(existing?.content ?? 0, state.content ?? 0),
        network: Math.max(existing?.network ?? 0, state.network ?? 0),
        networkRaw: Math.max(existing?.networkRaw ?? 0, state.networkRaw ?? 0),
        url: existing?.url ?? state.url,
        loadedAt: Math.min(existing?.loadedAt ?? Number.POSITIVE_INFINITY, state.loadedAt ?? Number.POSITIVE_INFINITY),
        networkCheckedAt: Math.max(existing?.networkCheckedAt ?? 0, state.networkCheckedAt ?? 0),
      })
    }

    for (const [key, hosts] of Object.entries(storedHosts ?? {})) {
      const tabId = Number(key)
      if (!Number.isInteger(tabId) || !Array.isArray(hosts)) continue

      // Union, not replace: a host counted since the worker came back is as
      // real as one from the snapshot, and either way it must not count twice.
      const existing = pageBlockedHosts.get(tabId) ?? new Set<string>()
      for (const host of hosts) existing.add(host)
      pageBlockedHosts.set(tabId, existing)
    }

    for (const [key, log] of Object.entries(storedLogs ?? {})) {
      const tabId = Number(key)
      if (!Number.isInteger(tabId) || !Array.isArray(log)) continue

      // Same merge rule as the counters: live entries that already landed win,
      // stored ones (older) slot in before them, capped to the newest.
      const existing = pageBlockLog.get(tabId) ?? []
      pageBlockLog.set(tabId, [...log, ...existing].slice(-maxPageBlockEntries))
    }
  }
  catch {
    // Session storage unavailable or unreadable; counts stay memory-only.
  }
}

function schedulePageStatsPersist(): void {
  const session = chrome.storage.session as chrome.storage.StorageArea | undefined
  if (!session || pageStatsPersistTimer) return

  pageStatsPersistTimer = setTimeout(() => {
    pageStatsPersistTimer = undefined
    const snapshot: Record<string, PageVisitState> = {}
    for (const [tabId, state] of pageBadgeStats) snapshot[String(tabId)] = state
    const logSnapshot: Record<string, PageBlockEntry[]> = {}
    for (const [tabId, log] of pageBlockLog) logSnapshot[String(tabId)] = log
    const hostSnapshot: Record<string, string[]> = {}
    for (const [tabId, hosts] of pageBlockedHosts) hostSnapshot[String(tabId)] = [...hosts]
    void session.set({
      [pageStatsStorageKey]: snapshot,
      [pageBlockLogStorageKey]: logSnapshot,
      [pageBlockedHostsStorageKey]: hostSnapshot,
    }).catch(() => {})
  }, pageStatsPersistDelayMs)
}

// Lifetime/site rollups for network blocks. The per-page counter moves
// instantly, but a busy page can block hundreds of requests a minute — far too
// many for one storage write each — so events accumulate per site+category and
// flush on a short timer. Up to one flush window of events is lost if the
// worker dies first; the page counters themselves are session-persisted.
const pendingNetworkStats = new Map<string, BlockEvent>()
const networkStatsFlushDelayMs = 5_000
let networkStatsFlushTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Append to the per-tab "what's blocked" log. Bursts of the same item (a host
 * hammering scripts, one selector hiding many nodes) collapse into a single
 * entry whose count grows, so the popup list stays readable.
 */
function logPageBlock(tabId: number, entry: PageBlockEntry): void {
  const log = pageBlockLog.get(tabId) ?? []
  const previous = log[log.length - 1]
  if (previous && previous.kind === entry.kind && previous.label === entry.label && previous.detail === entry.detail) {
    previous.count += entry.count
    previous.at = entry.at
  }
  else {
    log.push(entry)
    if (log.length > maxPageBlockEntries) log.splice(0, log.length - maxPageBlockEntries)
  }
  pageBlockLog.set(tabId, log)
  schedulePageStatsPersist()
}

/**
 * Human-facing row for a content-script block event in the "what's blocked"
 * list. 'cosmetic' and 'dnr' return undefined: their items already arrive with
 * better labels via record-cosmetic (selectors) and addNetworkBlocks (hosts).
 */
function pageBlockRowForSource(source: BlockSource): { kind: PageBlockKind, label: string } | undefined {
  switch (source) {
    case 'popup': return { kind: 'popup', label: 'Pop-up window' }
    case 'video': return { kind: 'video', label: 'Video ad' }
    case 'twitch': return { kind: 'video', label: 'Twitch ad' }
    case 'youtube': return { kind: 'video', label: 'YouTube placement' }
    case 'x': return { kind: 'x', label: 'Promoted post' }
    case 'consent': return { kind: 'consent', label: 'Cookie banner' }
    case 'manual': return { kind: 'other', label: 'Manual rule' }
    default: return undefined
  }
}

/**
 * The single funnel for network-block increments: page counter plus stats.
 *
 * `count` is a number of blocked requests. What it adds to the headline counter
 * is the number of blocked hosts not seen yet on this visit — one, for a host
 * appearing the first time, and zero for every retry after that. Bytes and the
 * row's `×N` take the full count either way. A caller with no URL to attribute
 * (the getMatchedRules fallback below) passes no `label` and only moves the raw
 * side, since an unattributable block cannot be told apart from a repeat.
 */
function addNetworkBlocks(tabId: number, count: number, category: ResourceCategory, label?: string): void {
  if (count <= 0) return
  const page = pageBadgeStats.get(tabId)
  const hostname = page?.url ? hostnameFromUrl(page.url) : ''
  if (!page || !hostname) return

  page.networkRaw += count

  const seenHosts = pageBlockedHosts.get(tabId) ?? new Set<string>()
  const firstSighting = isNewBlockedHost(seenHosts, label, maxBlockedHostsPerPage)
  if (firstSighting) {
    pageBlockedHosts.set(tabId, seenHosts)
    page.network += 1
  }

  logPageBlock(tabId, { kind: 'network', label: label ?? 'blocked request', detail: category, count, at: new Date().toISOString() })
  schedulePageStatsPersist()

  const key = `${hostname}:${category}`
  const existing = pendingNetworkStats.get(key)
  if (existing) {
    if (firstSighting) existing.count += 1
    existing.bytesSaved = (existing.bytesSaved ?? 0) + estimateBytesSaved(category, count)
    existing.occurredAt = new Date().toISOString()
  }
  else {
    pendingNetworkStats.set(key, {
      hostname,
      source: 'dnr',
      category,
      count: firstSighting ? 1 : 0,
      bytesSaved: estimateBytesSaved(category, count),
      occurredAt: new Date().toISOString(),
    })
  }

  if (networkStatsFlushTimer) return
  networkStatsFlushTimer = setTimeout(() => {
    networkStatsFlushTimer = undefined
    void flushNetworkStats()
  }, networkStatsFlushDelayMs)
}

async function flushNetworkStats(): Promise<void> {
  if (!pendingNetworkStats.size) return
  // Match the content-side rule: no stats accrue while protection is off.
  if (!(await getSettings()).enabled) {
    pendingNetworkStats.clear()
    return
  }

  const events = [...pendingNetworkStats.values()]
  pendingNetworkStats.clear()
  await recordBlockEvents(events)
}

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
  const popupCandidate = popupCandidates.get(tabId)
  if (popupCandidate) rememberInitialPopupUrl(popupCandidate, changeInfo.url ?? tab.pendingUrl ?? tab.url)

  if (changeInfo.status === 'loading' || changeInfo.url) {
    pageBadgeStats.set(tabId, { content: 0, network: 0, networkRaw: 0, url: changeInfo.url ?? tab.url, loadedAt: Date.now(), networkCheckedAt: 0 })
    cosmeticActivity.delete(tabId)
    pageBlockLog.delete(tabId)
    pageBlockedHosts.delete(tabId)
    schedulePageStatsPersist()
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
  pageBlockLog.delete(tabId)
  pageBlockedHosts.delete(tabId)
  popupCandidates.delete(tabId)
  blockedNoticeShownAt.delete(tabId)
  schedulePageStatsPersist()
  if (badgePollTabId === tabId) {
    badgePollTabId = undefined
    badgePollTicksLeft = 0
  }
})

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id === undefined || tab.openerTabId === undefined) return
  const candidate: PopupCandidate = { openerTabId: tab.openerTabId, openedAt: Date.now() }
  rememberInitialPopupUrl(candidate, tab.pendingUrl ?? tab.url)
  popupCandidates.set(tab.id, candidate)
})

// Live network-block feedback in unpacked/dev installs. Packed installs count
// through the webRequest error listener below; both reconcile against
// getMatchedRules via Math.max-style deltas so sources never double count.
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener((info) => {
  const tabId = info.request.tabId
  if (tabId < 0) return
  addNetworkBlocks(tabId, 1, categoryForRequestType(info.request.type), hostnameFromUrl(info.request.url))
  scheduleBadgeRefresh(tabId)
})

/**
 * Live network-block counting for packed installs. declarativeNetRequest raises
 * no event when it blocks a request, but the failed request still surfaces here
 * (and wakes the worker). Chrome reports every extension's cancellations as
 * ERR_BLOCKED_BY_CLIENT, and Firefox's NS_ERROR_ABORT also covers ordinary page
 * aborts, so an error only counts when its URL and resource type match one of
 * our own host, curated-path, or user block-list rules. Where
 * onRuleMatchedDebug exists (unpacked installs) it stays the counter and this
 * listener stands down, so the two never double count.
 */
const hasRuleMatchDebug = typeof chrome.declarativeNetRequest.onRuleMatchedDebug !== 'undefined'
chrome.webRequest?.onErrorOccurred.addListener(onRequestError, { urls: ['http://*/*', 'https://*/*'] })
const manuallyBlockedRequestTypes = new Set([
  'main_frame',
  'sub_frame',
  'script',
  'image',
  'xmlhttprequest',
  'media',
])

function onRequestError(details: chrome.webRequest.OnErrorOccurredDetails): void {
  if (details.tabId < 0) return
  if (!isOurBlock(details)) return

  // A blocked top-level document in a freshly opened tab is a pop-under that
  // escaped the page-level guard (an anchor target=_blank click, which the
  // window.open wrapper cannot see). This also runs where the debug listener
  // counts subresource blocks — the paths never overlap.
  if (details.frameId === 0 && handleBlockedPopupTab(details)) return

  // Anything else that dies at the top level is a page the user asked for, so
  // the browser's bare ERR_BLOCKED_BY_CLIENT ("try disabling your extensions")
  // gets replaced with our own page: who blocked it, what was blocked, and a
  // way through. The block itself is still counted below.
  if (details.frameId === 0 && details.type === 'main_frame') showBlockedNotice(details)

  if (hasRuleMatchDebug) return

  const settings = cachedSettings ?? defaultSettings
  if (!settings.enabled) return

  const page = pageBadgeStats.get(details.tabId)
  if (!page) return

  const pageHostname = (page.url ? hostnameFromUrl(page.url) : '') || hostnameFromUrl(details.initiator ?? '')
  if (pageHostname && siteMatches(pageHostname, settings.allowedSites)) return

  addNetworkBlocks(details.tabId, 1, categoryForRequestType(details.type), hostnameFromUrl(details.url))
  scheduleBadgeRefresh(details.tabId)
}

/**
 * Handle a blocked document load in a popup tab: count it as a blocked pop-up
 * on the opener and close the ad tab, so pop-unders vanish instead of leaving
 * a browser error page behind. Returns false when the tab is not a recent
 * popup (a direct navigation), letting the caller count it as a page block.
 */
function handleBlockedPopupTab(details: chrome.webRequest.OnErrorOccurredDetails): boolean {
  const candidate = popupCandidates.get(details.tabId)
  if (!candidate) return false
  popupCandidates.delete(details.tabId)
  if (Date.now() - candidate.openedAt > popupCandidateMaxAgeMs) return false

  const settings = cachedSettings ?? defaultSettings
  if (!settings.enabled || !settings.popupBlocking) return false

  // Chromium-family browsers can assign an opener to a new window created by
  // an address-bar search. That is browser navigation, never a pop-under: keep
  // the results window even if stale rules or another blocker report a failed
  // top-level request during startup.
  if (isSearchResultsUrl(candidate.initialUrl) || isSearchResultsUrl(details.url)) return false

  // ERR_BLOCKED_BY_CLIENT is shared by every blocker in the browser. Some
  // browsers also give searches opened from their command bar an opener tab,
  // so treating every such error as ours can close a legitimate search window
  // immediately. Only remove the tab when its destination is covered by one of
  // our shipped/refreshed host rules or by the user's explicit block list.
  const targetHostname = hostnameFromUrl(details.url)
  const blockedByUs = isBlockedHost(targetHostname) || siteMatches(targetHostname, settings.blockedSites)
  if (!blockedByUs) return false

  // An opener relationship alone does not prove this is a pop-under. Keep a
  // legitimate tab (for example, a user-opened YouTube link) alive if a later
  // top-level redirect happens to touch a blocked advertising host.
  if (!isOriginalPopupDestination(candidate, details.url)) return false

  const opener = pageBadgeStats.get(candidate.openerTabId)
  const openerHostname = opener?.url ? hostnameFromUrl(opener.url) : ''
  if (!openerHostname || siteMatches(openerHostname, settings.allowedSites)) return false

  incrementPageContent(candidate.openerTabId, 1, opener?.url)
  logPageBlock(candidate.openerTabId, {
    kind: 'popup',
    label: targetHostname || 'pop-up window',
    count: 1,
    at: new Date().toISOString(),
  })
  void recordBlockEvents([{
    hostname: openerHostname,
    source: 'popup',
    category: 'document',
    count: 1,
    occurredAt: new Date().toISOString(),
  }])
  void updateBadge(candidate.openerTabId)
  void chrome.tabs.remove(details.tabId).catch(() => {})
  return true
}

function isOurBlock(details: chrome.webRequest.OnErrorOccurredDetails): boolean {
  if (details.error !== 'net::ERR_BLOCKED_BY_CLIENT' && details.error !== 'NS_ERROR_ABORT') return false

  if (isBlockedRequest(details.url, details.type)) return true

  const settings = cachedSettings ?? defaultSettings
  return manuallyBlockedRequestTypes.has(details.type)
    && siteMatches(hostnameFromUrl(details.url), settings.blockedSites)
}

// Redirect chains can raise more than one top-level error for what the user
// experienced as a single click; the interstitial is shown once per tab per
// short window so the second hop cannot overwrite the page mid-render.
const blockedNoticeShownAt = new Map<number, number>()
const blockedNoticeMinIntervalMs = 1_000

/**
 * Replace the browser's blocked-page error with ours. The failed navigation is
 * already over by the time this runs (declarativeNetRequest cancels it without
 * telling us in advance), so this is a navigation, not a redirect: the error
 * page flashes and is replaced.
 */
function showBlockedNotice(details: chrome.webRequest.OnErrorOccurredDetails): void {
  const settings = cachedSettings ?? defaultSettings
  if (!settings.enabled) return

  // A speculative prerender of a blocked URL fails in a hidden frame tree of a
  // tab the user is still reading. Navigating that tab would yank the page out
  // from under them for a click they never made.
  const lifecycle = (details as { documentLifecycle?: string }).documentLifecycle
  if (lifecycle && lifecycle !== 'active') return

  const now = Date.now()
  const shownAt = blockedNoticeShownAt.get(details.tabId) ?? 0
  if (now - shownAt < blockedNoticeMinIntervalMs) return
  blockedNoticeShownAt.set(details.tabId, now)

  const reason: BlockedReason = siteMatches(hostnameFromUrl(details.url), settings.blockedSites) ? 'user' : 'filter'
  const target = chrome.runtime.getURL(blockedPageFile) + blockedPageQuery(details.url, reason)
  void chrome.tabs.update(details.tabId, { url: target }).catch(() => {})
}

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === filterRefreshAlarm) void refreshFilters()
  if (alarm.name === resumeAlarm) void resumeProtection()
  if (alarm.name === bypassSweepAlarm) void sweepBypasses()
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') return

  if (changes.settings?.newValue) {
    cachedSettings = changes.settings.newValue as ExtensionSettings
    void syncDynamicRules(cachedSettings)
    void updateBadge()
  }

  if (changes.cloudStats?.newValue) {
    void hydrateSyncedStats(changes.cloudStats.newValue)
    void updateBadge()
  }
})

async function setup(): Promise<void> {
  await pageStatsHydration
  await initializeStorage()
  try {
    await migrateStatsSchema()
  }
  catch {
    // A stats-migration failure must never take down the rest of setup —
    // blocking and the badge matter more than recalibrated estimates.
  }
  const settings = await getSettings()
  cachedSettings = settings
  await syncDynamicRules(settings)
  await reconcilePause(settings.resumeAt)
  await updateBadge()
  chrome.alarms?.create(filterRefreshAlarm, { periodInMinutes: 24 * 60 })
  void sweepBypasses()
  void refreshFilters()
}

/**
 * Expire "Continue anyway" grants. Dynamic rules outlive the browser session,
 * so this also runs at startup: a grant made minutes before the browser closed
 * must not still be open the next morning. The sweep alarm retires itself once
 * nothing is left to expire.
 */
async function sweepBypasses(): Promise<void> {
  const remaining = await pruneBypasses()
  if (remaining.length) chrome.alarms?.create(bypassSweepAlarm, { periodInMinutes: 1 })
  else chrome.alarms?.clear(bypassSweepAlarm)
}

/** Pause protection for a bounded number of minutes; a resume alarm re-enables it. */
async function pauseProtection(minutes: number): Promise<void> {
  const clamped = Math.min(Math.max(Math.round(minutes), 1), 24 * 60)
  const resumeAt = Date.now() + clamped * 60_000
  const settings = await setSettings({ enabled: false, resumeAt })
  await syncDynamicRules(settings)
  chrome.alarms?.create(resumeAlarm, { when: resumeAt })
  await updateBadge()
}

async function resumeProtection(): Promise<void> {
  chrome.alarms?.clear(resumeAlarm)
  const settings = await setSettings({ enabled: true, resumeAt: undefined })
  await syncDynamicRules(settings)
  await updateBadge()
}

/** On startup, resume if the pause elapsed while closed, else re-arm the alarm. */
async function reconcilePause(resumeAt?: number): Promise<void> {
  if (resumeAt === undefined) return
  if (Date.now() >= resumeAt) await resumeProtection()
  else chrome.alarms?.create(resumeAlarm, { when: resumeAt })
}

/**
 * Fetch the maintained host list and load any hosts newer than the shipped
 * static ruleset as dynamic rules. MV3 static rules can only change with an
 * extension update, so this keeps network blocking fresh between releases.
 * Any failure is non-fatal — the shipped ruleset stays active.
 */
const filterRefreshedAtKey = 'filterRefreshedAt'
const filterRefreshMinIntervalMs = 12 * 60 * 60 * 1000

async function refreshFilters(force = false): Promise<void> {
  try {
    if (!force) {
      const stored = await chrome.storage.local.get(filterRefreshedAtKey)
      const last = stored[filterRefreshedAtKey]
      if (typeof last === 'number' && Date.now() - last < filterRefreshMinIntervalMs) return
    }

    const response = await fetch(filterRefreshUrl, { cache: 'no-cache' })
    if (!response.ok) return
    await chrome.storage.local.set({ [filterRefreshedAtKey]: Date.now() })

    const data = await response.json() as { hosts?: unknown }
    const hosts = Array.isArray(data.hosts) ? data.hosts.filter((host): host is string => typeof host === 'string') : []
    if (!hosts.length) return

    const shipped = new Set(generatedNetworkHosts.hosts)
    const addRules = buildHostRefreshRules(hosts, { exclude: shipped })
    addBlockedHosts(hosts)

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
      let settings = await setSettings(message.settings)
      // Manually turning protection back on cancels any active pause.
      if (message.settings.enabled === true && settings.resumeAt !== undefined) {
        chrome.alarms?.clear(resumeAlarm)
        settings = await setSettings({ resumeAt: undefined })
      }
      await syncDynamicRules(settings)
      await updateBadge()
      return getDashboard()
    }
    case 'pause-protection': {
      await pauseProtection(message.minutes)
      return getDashboard()
    }
    case 'toggle-site': {
      const settings = await toggleSite(message.hostname, message.allowed)
      await syncDynamicRules(settings)
      await updateBadge()
      return getDashboard()
    }
    case 'record-blocks': {
      // Don't accrue stats while protection is off or on allow-listed sites,
      // so the numbers match reality. The allowlist check also keeps a page
      // from inflating its own stats with forged postMessage reports.
      const settings = await getSettings()
      if (!settings.enabled) return true
      const senderHostname = hostnameFromUrl(sender.tab?.url ?? '')
      if (senderHostname && siteMatches(senderHostname, settings.allowedSites)) return true
      await recordBlockEvents(message.events)
      if (sender.tab?.id !== undefined) {
        incrementPageContent(sender.tab.id, message.events.reduce((total, event) => total + event.count, 0), sender.tab.url)
        for (const event of message.events) {
          const row = pageBlockRowForSource(event.source)
          if (row && event.count > 0) {
            logPageBlock(sender.tab.id, { ...row, count: event.count, at: event.occurredAt })
          }
        }
      }
      await updateBadge(sender.tab?.id)
      return true
    }
    case 'record-cosmetic': {
      const settings = await getSettings()
      if (!settings.enabled) return true
      const senderHostname = hostnameFromUrl(sender.tab?.url ?? '')
      if (senderHostname && siteMatches(senderHostname, settings.allowedSites)) return true
      if (sender.tab?.id !== undefined) recordCosmeticActivity(sender.tab.id, message.hits)
      return true
    }
    case 'reset-stats':
      await resetStats()
      await updateBadge()
      return getDashboard()
    case 'refresh-filters':
      await refreshFilters(true)
      return getDashboard()
    case 'export-data':
      return getDashboard()
    case 'bypass-block': {
      const url = await grantBypass(message.url)
      chrome.alarms?.create(bypassSweepAlarm, { periodInMinutes: 1 })
      return { url }
    }
    case 'close-tab': {
      if (sender.tab?.id !== undefined) await chrome.tabs.remove(sender.tab.id)
      return true
    }
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
    activePageBlocks: pageBlocksForTab(activeTab?.tabId),
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

  await chrome.action.setBadgeBackgroundColor({ ...badgeTarget, color: pageBlocked ? '#ef4444' : '#51615c' })
  // Force white badge text so the count stays legible on the red/grey fill —
  // Chrome's auto-contrast otherwise picks a dark colour on the bright red.
  await chrome.action.setBadgeTextColor?.({ ...badgeTarget, color: '#ffffff' })
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
  const at = new Date().toISOString()
  for (const hit of hits) {
    if (!hit.selector || hit.count <= 0) continue
    perTab.set(hit.selector, (perTab.get(hit.selector) ?? 0) + hit.count)
    logPageBlock(tabId, { kind: 'cosmetic', label: hit.selector, count: hit.count, at })
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
  // Mutate the state in place rather than replacing it. refreshTabNetworkCount
  // holds a reference across its await and compares the counter it finds there
  // against getMatchedRules; a swapped-out object would leave it reconciling
  // against a snapshot the live listeners had already moved past, and folding
  // in a delta that was never missing.
  const existing = pageBadgeStats.get(tabId)
  if (!existing) {
    pageBadgeStats.set(tabId, { content: count, network: 0, networkRaw: 0, url, loadedAt: Date.now(), networkCheckedAt: 0 })
  }
  else {
    existing.content += count
    if (url) existing.url = url
  }
  schedulePageStatsPersist()
}

/**
 * Backstop the live network counter with getMatchedRules (which reports our
 * own rules exactly, unlike the webRequest listener). Only the delta beyond
 * what the listeners already counted is folded in, so sources never sum.
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
    // Against the RAW count: getMatchedRules reports requests, and the headline
    // counter no longer does. Comparing it to the deduplicated number would
    // read every retry the listeners already saw as a block they had missed.
    const delta = Math.max(0, matched.rulesMatchedInfo.length - details.networkRaw)
    if (delta > 0) {
      // Matches the live listeners missed (e.g. while the worker was down):
      // fold them through the same funnel so lifetime stats stay in lockstep.
      // The newest entries sit at the tail — categorize the delta from their
      // request types, falling back to 'other' when the list is truncated.
      const entries = matched.rulesMatchedInfo.slice(-delta)
      for (const entry of entries) {
        const request = (entry as { request?: { type?: string, url?: string } }).request
        addNetworkBlocks(tabId, 1, categoryForRequestType(request?.type ?? 'other'), request?.url ? hostnameFromUrl(request.url) : undefined)
      }
      if (entries.length < delta) addNetworkBlocks(tabId, delta - entries.length, 'other')
    }
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

/**
 * The tab's "what's blocked" list for the popup: log entries grouped by
 * kind+label+detail with counts summed, most-blocked first, capped so the
 * popup stays scannable.
 */
function pageBlocksForTab(tabId?: number): PageBlockEntry[] {
  const log = tabId === undefined ? undefined : pageBlockLog.get(tabId)
  if (!log?.length) return []

  const grouped = new Map<string, PageBlockEntry>()
  for (const entry of log) {
    const key = `${entry.kind}|${entry.label}|${entry.detail ?? ''}`
    const existing = grouped.get(key)
    if (existing) {
      existing.count += entry.count
      if (entry.at > existing.at) existing.at = entry.at
    }
    else {
      grouped.set(key, { ...entry })
    }
  }

  return [...grouped.values()]
    .sort((a, b) => b.count - a.count || b.at.localeCompare(a.at))
    .slice(0, 12)
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
 * Poll the active tab's network-block count briefly after a load or tab
 * switch. The live listeners move the badge the moment a request dies; this
 * only reconciles against getMatchedRules a few times to catch matches the
 * listeners missed (e.g. while the worker was down), staying inside the
 * API's tight call quota. The tick budget is bounded so this never keeps
 * the service worker awake for long.
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
