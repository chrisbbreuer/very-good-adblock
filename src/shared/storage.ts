import { maxRecentEvents } from './constants'
import { hostnameFromUrl, isHttpUrl, normalizeHostname, siteMatches } from './domain'
import { compactBuckets, estimateBytesSaved, eventTotals, hourBucketKey, localDayKey } from './metrics'
import {
  baselineKey,
  buildDeviceShare,
  deviceShareKey,
  deviceShareKeyPrefix,
  isSiteStats,
  isStatBucket,
  maxShare,
  normalizeBaseline,
  normalizeDeviceShare,
  remoteShares,
  resetEpochKey,
  sumDaily,
  sumLifetime,
  sumSites,
} from './stats-sync'
import type { StatsShare } from './stats-sync'
import type { ActiveTabState, BlockEvent, CloudSyncState, ExtensionSettings, LifetimeStats, LocalStats, NoticeId, SiteStats, StatBucket } from './types'

const syncKeys = {
  settings: 'settings',
  statsVersion: 'statsVersion',
  // The pre-share layout: one shared lifetime and one shared snapshot, merged
  // by max. Read once, to migrate them into the baseline (see stats-sync.ts).
  legacyLifetime: 'lifetime',
  legacyCloudStats: 'cloudStats',
} as const

const localKeys = {
  // This device's own share: what it blocked, and nothing another device did.
  stats: 'stats',
  lifetime: 'lifetime',
  dismissedNotices: 'dismissedNotices',
  deviceId: 'deviceId',
  /** The reset epoch this device last applied to its share. */
  statsEpoch: 'statsEpoch',
  /** 2 once this device's stats moved to the per-device layout. */
  statsLayout: 'statsLayout',
  /**
   * This device's full copy of the pre-share history. The synced baseline is
   * one 8 KB item, so it only holds the top sites and recent days; this keeps
   * the rest, combined with the baseline by max (both are copies of the same
   * totals, so they never add).
   */
  legacy: 'legacyStats',
} as const

const statsLayoutVersion = 2
const legacyCloudStatsSchemaVersion = 1

// Per-site rollups are rewritten whole on every flush, so the map cannot grow
// with every hostname ever visited. The busiest and most recent sites stay.
const maxSiteRollups = 500

// chrome.storage.sync is write-quota limited (~120 writes/min). Block events flush
// every second, so this device's share is published at most once per window
// while the local write stays immediate. `ownStats` is the in-memory source of
// truth for the life of the worker; `syncDirty` says it has changes the
// published share has not caught up with.
const syncFlushIntervalMs = 15_000
let ownStats: { lifetime: LifetimeStats, local: LocalStats } | undefined
let syncDirty = false
let syncFlushTimer: ReturnType<typeof setTimeout> | undefined
let lastSyncFlushAt = 0
let identity: { deviceId: string, epoch: number } | undefined

// Every read-modify-write of the stats runs through this chain. Two flushes
// from different tabs, or a flush racing a reset, each read their own copy and
// the last write won, losing the other's events.
let statsQueue: Promise<unknown> = Promise.resolve()

function withStatsLock<T>(task: () => Promise<T>): Promise<T> {
  const run = statsQueue.catch(() => undefined).then(task)
  statsQueue = run
  return run
}

export const defaultSettings: ExtensionSettings = {
  enabled: true,
  badgeEnabled: true,
  cosmeticFiltering: true,
  aggressiveCosmetic: false,
  cookieConsentFiltering: false,
  popupBlocking: true,
  youtubeEnhancements: true,
  twitchEnhancements: true,
  allowedSites: [],
  blockedSites: [],
}

export function defaultLifetimeStats(now: Date = new Date()): LifetimeStats {
  const iso = now.toISOString()
  return {
    adsBlocked: 0,
    bytesSaved: 0,
    videoSecondsSaved: 0,
    since: iso,
    lastUpdated: iso,
  }
}

export function defaultLocalStats(): LocalStats {
  return {
    hourly: [],
    daily: [],
    sites: {},
    recentEvents: [],
  }
}

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.sync.get(syncKeys.settings)
  return normalizeSettings(result[syncKeys.settings])
}

export async function setSettings(settings: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const next = normalizeSettings({ ...(await getSettings()), ...settings })
  next.allowedSites = uniqueSites(next.allowedSites)
  next.blockedSites = uniqueSites(next.blockedSites)
  await chrome.storage.sync.set({ [syncKeys.settings]: next })
  return next
}

/** Lifetime totals across every device: this one's share plus all the others. */
export async function getLifetimeStats(): Promise<LifetimeStats> {
  const own = await readOwnStats()
  const { shares } = await readSummableShares()
  return sumLifetime(own.lifetime, shares)
}

/**
 * The dashboard's view of the stats. Daily history and per-site totals are
 * summed across devices; the hourly chart and the recent-event log are this
 * device's own, since they are never synced.
 */
export async function getLocalStats(): Promise<LocalStats> {
  const own = await readOwnStats()
  const { shares } = await readSummableShares()
  return {
    hourly: own.local.hourly,
    daily: sumDaily(own.local.daily, shares),
    sites: sumSites(own.local.sites, shares),
    recentEvents: own.local.recentEvents,
  }
}

export async function getCloudSyncState(): Promise<CloudSyncState> {
  const { deviceId } = await readIdentity()
  const items = await chrome.storage.sync.get(null)
  const share = normalizeDeviceShare(items[deviceShareKey(deviceId)])
  const { devices } = remoteShares(items, deviceId, readResetEpoch(items))
  return {
    available: Boolean(share),
    syncedAt: share?.syncedAt,
    dailyBuckets: share?.daily.length ?? 0,
    siteRollups: share?.sites.length ?? 0,
    devices,
  }
}

/**
 * One-time popup notices, stored as a list of ids so a second notice needs no
 * schema change. Local rather than synced on purpose: every notice so far
 * explains a per-device browser permission, and a dismissal on the Mac says
 * nothing about the iPhone.
 */
export async function isNoticeDismissed(id: NoticeId): Promise<boolean> {
  return (await readDismissedNotices()).includes(id)
}

export async function dismissNotice(id: NoticeId): Promise<void> {
  const dismissed = await readDismissedNotices()
  if (dismissed.includes(id)) return
  await chrome.storage.local.set({ [localKeys.dismissedNotices]: [...dismissed, id] })
}

async function readDismissedNotices(): Promise<NoticeId[]> {
  const result = await chrome.storage.local.get(localKeys.dismissedNotices)
  const dismissed = result[localKeys.dismissedNotices]
  return Array.isArray(dismissed) ? dismissed.filter((id): id is NoticeId => typeof id === 'string') : []
}

export async function initializeStorage(): Promise<void> {
  const sync = await chrome.storage.sync.get([syncKeys.settings, syncKeys.legacyLifetime, syncKeys.legacyCloudStats, baselineKey, resetEpochKey])
  if (!sync[syncKeys.settings]) await chrome.storage.sync.set({ [syncKeys.settings]: defaultSettings })

  await withStatsLock(async () => {
    const local = await chrome.storage.local.get([localKeys.statsLayout])
    if (local[localKeys.statsLayout] !== statsLayoutVersion) await migrateToShares(sync)
  })

  // A reset made on another device while this one was off.
  const resetAt = readResetEpoch(sync)
  if (resetAt > (await readIdentity()).epoch) await applyReset(resetAt)

  // Publish this device's share now, so the others count it from the start.
  await withStatsLock(async () => {
    await readOwnStats()
    syncDirty = true
  })
  await flushSyncStats()
}

/**
 * Move a pre-share install's totals into the baseline.
 *
 * Under the old layout every device held the same max-merged totals, so none
 * of it can be claimed as one device's own share without counting it once per
 * device. It becomes the baseline instead (the larger of what this device and
 * any device that migrated first saw), and this device starts its own share at
 * zero. Its hourly chart and recent-event log stay: they were never synced.
 * After a reset nothing pre-share should come back, so then it is dropped.
 */
async function migrateToShares(sync: Record<string, unknown>): Promise<void> {
  const local = await chrome.storage.local.get([localKeys.stats, localKeys.lifetime])
  const ownLocal: LocalStats = { ...defaultLocalStats(), ...(local[localKeys.stats] as Partial<LocalStats> | undefined) }
  const resetAt = readResetEpoch(sync)

  if (resetAt === 0) {
    const legacyCloud = normalizeLegacyCloudStats(sync[syncKeys.legacyCloudStats])
    const legacyLifetime = mergeLifetimeStats(
      mergeLifetimeStats(local[localKeys.lifetime] as Partial<LifetimeStats> | undefined, sync[syncKeys.legacyLifetime] as Partial<LifetimeStats> | undefined),
      legacyCloud?.lifetime,
    )
    let legacy: StatsShare = { lifetime: legacyLifetime, daily: ownLocal.daily, sites: Object.values(ownLocal.sites) }
    if (legacyCloud) legacy = maxShare(legacy, legacyCloud, false)

    if (legacy.lifetime.adsBlocked > 0 || legacy.daily.length > 0 || legacy.sites.length > 0) {
      const baseline = maxShare(normalizeBaseline(sync[baselineKey]), legacy)
      await chrome.storage.sync.set({ [baselineKey]: { ...baseline, schemaVersion: 2, epoch: 0 } })
      await chrome.storage.local.set({ [localKeys.legacy]: legacy })
    }
  }

  const own = {
    lifetime: defaultLifetimeStats(),
    local: { ...defaultLocalStats(), hourly: ownLocal.hourly, recentEvents: ownLocal.recentEvents },
  }
  ownStats = own
  syncDirty = true
  const id = await readIdentity()
  id.epoch = resetAt
  await chrome.storage.local.set({
    [localKeys.stats]: own.local,
    [localKeys.lifetime]: own.lifetime,
    [localKeys.statsEpoch]: resetAt,
    [localKeys.statsLayout]: statsLayoutVersion,
  })
  await chrome.storage.sync.remove([syncKeys.legacyLifetime, syncKeys.legacyCloudStats]).catch(() => {})
}

// v1 → v2 recalibration: the old estimator ran high on the categories that
// dominate blocked traffic (34 KB per tracker ping, 2.8 MB per media request,
// a whole video ad per re-rendered Twitch marker or pruned feed placement).
// Stored aggregates carry no per-source breakdown to recompute from, so they
// are rescaled once by the ratio of the recalibrated per-unit averages. The
// blocked COUNTS are accurate and stay untouched.
const statsSchemaVersion = 2
const statsRecalibrationFactor = 0.2

export async function migrateStatsSchema(): Promise<void> {
  const result = await chrome.storage.sync.get(syncKeys.statsVersion)
  const version = (result[syncKeys.statsVersion] as number | undefined) ?? 1
  if (version >= statsSchemaVersion) return

  // Mark first: if the rescale is interrupted, leaving the old totals in place
  // is safer than rescaling a second time on the next start. The flag is
  // shared, so the baseline (also shared) is rescaled by one device only.
  await chrome.storage.sync.set({ [syncKeys.statsVersion]: statsSchemaVersion })

  await withStatsLock(async () => {
    const { lifetime, local } = await readOwnStats()
    rescaleEstimates(lifetime, local.hourly, local.daily, Object.values(local.sites))
    await persistStats(lifetime, local)

    const stored = await chrome.storage.sync.get(baselineKey)
    const baseline = normalizeBaseline(stored[baselineKey])
    if (baseline) {
      rescaleEstimates(baseline.lifetime, [], baseline.daily, baseline.sites)
      await chrome.storage.sync.set({ [baselineKey]: baseline })
    }
    const legacyStored = await chrome.storage.local.get(localKeys.legacy)
    const legacy = legacyStored[localKeys.legacy] as StatsShare | undefined
    if (legacy?.lifetime) {
      rescaleEstimates(legacy.lifetime, [], legacy.daily, legacy.sites)
      await chrome.storage.local.set({ [localKeys.legacy]: legacy })
    }
  })
  // Publish now, so the rescaled share reaches sync before the worker can die.
  await flushSyncStats()
}

function rescaleEstimates(lifetime: LifetimeStats, hourly: StatBucket[], daily: StatBucket[], sites: SiteStats[]): void {
  lifetime.bytesSaved = Math.round(lifetime.bytesSaved * statsRecalibrationFactor)
  lifetime.videoSecondsSaved = Math.round(lifetime.videoSecondsSaved * statsRecalibrationFactor)
  for (const bucket of [...hourly, ...daily]) {
    bucket.bytesSaved = Math.round(bucket.bytesSaved * statsRecalibrationFactor)
    bucket.videoSecondsSaved = Math.round(bucket.videoSecondsSaved * statsRecalibrationFactor)
  }
  for (const site of sites) {
    site.bytesSaved = Math.round(site.bytesSaved * statsRecalibrationFactor)
    site.videoSecondsSaved = Math.round(site.videoSecondsSaved * statsRecalibrationFactor)
  }
}

/** Whether a storage.onChanged batch touches the cross-device stats. */
export function isSyncedStatsChange(changes: Record<string, chrome.storage.StorageChange>): boolean {
  return Object.keys(changes).some(key => key.startsWith(deviceShareKeyPrefix) || key === baselineKey || key === resetEpochKey)
}

/**
 * React to another device's sync write. Shares need nothing (totals are summed
 * on read); a newer reset epoch clears this device's share.
 */
export async function applySyncedStatsChange(changes: Record<string, chrome.storage.StorageChange>): Promise<void> {
  const epoch = changes[resetEpochKey]?.newValue
  if (typeof epoch === 'number' && epoch > (await readIdentity()).epoch) await applyReset(epoch)
}

/**
 * Reset every device's stats. The epoch is what makes it stick: shares counted
 * before it stop counting at once, and each device clears its own share when
 * it sees the new epoch (now, or the next time it starts).
 */
export async function resetStats(): Promise<void> {
  const id = await readIdentity()
  const epoch = Math.max(Date.now(), id.epoch + 1)
  await withStatsLock(async () => {
    const own = await clearOwnShare(epoch)
    await chrome.storage.sync.set({
      [resetEpochKey]: epoch,
      [deviceShareKey(id.deviceId)]: buildDeviceShare(id.deviceId, epoch, own.lifetime, own.local),
    })
    await chrome.storage.sync.remove(baselineKey).catch(() => {})
    syncDirty = false
    lastSyncFlushAt = Date.now()
  })
}

async function applyReset(epoch: number): Promise<void> {
  await withStatsLock(() => clearOwnShare(epoch))
  await flushSyncStats()
}

async function clearOwnShare(epoch: number): Promise<{ lifetime: LifetimeStats, local: LocalStats }> {
  if (syncFlushTimer) {
    clearTimeout(syncFlushTimer)
    syncFlushTimer = undefined
  }
  const id = await readIdentity()
  id.epoch = epoch
  const own = { lifetime: defaultLifetimeStats(), local: defaultLocalStats() }
  ownStats = own
  syncDirty = true
  await chrome.storage.local.set({
    [localKeys.stats]: own.local,
    [localKeys.lifetime]: own.lifetime,
    [localKeys.statsEpoch]: epoch,
  })
  // The pre-share history is cleared by a reset too.
  await chrome.storage.local.remove(localKeys.legacy)
  return own
}

export function recordBlockEvents(events: BlockEvent[]): Promise<void> {
  if (!events.length) return Promise.resolve()
  return withStatsLock(() => applyBlockEvents(events))
}

async function applyBlockEvents(events: BlockEvent[]): Promise<void> {
  const now = new Date()
  const totals = eventTotals(events)
  const { lifetime, local } = await readOwnStats()

  lifetime.adsBlocked += totals.adsBlocked
  lifetime.bytesSaved += totals.bytesSaved
  lifetime.videoSecondsSaved += totals.videoSecondsSaved
  lifetime.lastUpdated = now.toISOString()

  const hourKey = bucketKey(now, 'hour')
  const dayKey = bucketKey(now, 'day')
  mergeBucket(local.hourly, hourKey, totals)
  mergeBucket(local.daily, dayKey, totals)

  for (const event of events) {
    const hostname = normalizeHostname(event.hostname)
    if (!hostname) continue
    // The same per-event figure lifetime used (eventTotals estimates when the
    // event carries none), so a site's bytes can never disagree with the total.
    const eventBytes = event.bytesSaved ?? estimateBytesSaved(event.category, event.count)
    // A zero-count event is a retry of a host already counted on the page: its
    // bytes are real, but it is not a new block, so it neither creates a site
    // row nor moves "last blocked here".
    if (event.count <= 0) {
      const site = local.sites[hostname]
      if (site) site.bytesSaved += eventBytes
      continue
    }
    const existing: SiteStats = local.sites[hostname] ?? {
      hostname,
      adsBlocked: 0,
      bytesSaved: 0,
      videoSecondsSaved: 0,
      lastBlockedAt: event.occurredAt,
    }
    existing.adsBlocked += event.count
    existing.bytesSaved += eventBytes
    existing.videoSecondsSaved += event.videoSecondsSaved ?? 0
    existing.lastBlockedAt = event.occurredAt
    local.sites[hostname] = existing
  }

  local.hourly = compactBuckets(local.hourly, 72)
  local.daily = compactBuckets(local.daily, 60)
  local.sites = capSiteRollups(local.sites, maxSiteRollups)
  // Retry-only events (count 0) used to fill the 240-slot list and show up as
  // "Network rules ×0" rows; only real blocks are kept.
  local.recentEvents = [...local.recentEvents, ...events.filter(event => event.count > 0)].slice(-maxRecentEvents)

  await persistStats(lifetime, local)
}

/** Keep the busiest sites, most recent first among ties, up to `limit`. */
export function capSiteRollups(sites: Record<string, SiteStats>, limit: number): Record<string, SiteStats> {
  const entries = Object.entries(sites)
  if (entries.length <= limit) return sites
  entries.sort(([, a], [, b]) => b.adsBlocked - a.adsBlocked || b.lastBlockedAt.localeCompare(a.lastBlockedAt))
  return Object.fromEntries(entries.slice(0, limit))
}

export async function getActiveTabState(settings?: ExtensionSettings): Promise<ActiveTabState | undefined> {
  settings ??= await getSettings()
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!isHttpUrl(tab?.url)) return undefined

  const hostname = hostnameFromUrl(tab.url)
  return {
    tabId: tab.id,
    hostname,
    url: tab.url,
    favIconUrl: isHttpUrl(tab.favIconUrl) ? tab.favIconUrl : undefined,
    allowed: siteMatches(hostname, settings.allowedSites),
    blocked: siteMatches(hostname, settings.blockedSites),
  }
}

function uniqueSites(sites: string[]): string[] {
  return [...new Set(sites.map(normalizeHostname).filter(Boolean))].sort()
}

function normalizeSettings(value: unknown): ExtensionSettings {
  const settings = value as Partial<ExtensionSettings> | undefined
  return {
    enabled: settings?.enabled ?? defaultSettings.enabled,
    badgeEnabled: settings?.badgeEnabled ?? defaultSettings.badgeEnabled,
    cosmeticFiltering: settings?.cosmeticFiltering ?? defaultSettings.cosmeticFiltering,
    aggressiveCosmetic: settings?.aggressiveCosmetic ?? defaultSettings.aggressiveCosmetic,
    cookieConsentFiltering: settings?.cookieConsentFiltering ?? defaultSettings.cookieConsentFiltering,
    popupBlocking: settings?.popupBlocking ?? defaultSettings.popupBlocking,
    youtubeEnhancements: settings?.youtubeEnhancements ?? defaultSettings.youtubeEnhancements,
    twitchEnhancements: settings?.twitchEnhancements ?? defaultSettings.twitchEnhancements,
    allowedSites: Array.isArray(settings?.allowedSites) ? settings.allowedSites : defaultSettings.allowedSites,
    blockedSites: Array.isArray(settings?.blockedSites) ? settings.blockedSites : defaultSettings.blockedSites,
    resumeAt: typeof settings?.resumeAt === 'number' ? settings.resumeAt : undefined,
  }
}

/** Two copies of the same legacy totals: keep the larger of each. Migration only. */
function mergeLifetimeStats(local?: Partial<LifetimeStats>, cloud?: Partial<LifetimeStats>): LifetimeStats {
  const next = { ...defaultLifetimeStats(), ...local }
  if (!cloud) return next

  return {
    adsBlocked: Math.max(next.adsBlocked, cloud.adsBlocked ?? 0),
    bytesSaved: Math.max(next.bytesSaved, cloud.bytesSaved ?? 0),
    videoSecondsSaved: Math.max(next.videoSecondsSaved, cloud.videoSecondsSaved ?? 0),
    since: earlierDate(next.since, cloud.since ?? next.since),
    lastUpdated: laterDate(next.lastUpdated, cloud.lastUpdated ?? next.lastUpdated),
  }
}

async function readIdentity(): Promise<{ deviceId: string, epoch: number }> {
  if (identity) return identity
  const stored = await chrome.storage.local.get([localKeys.deviceId, localKeys.statsEpoch])
  let deviceId = stored[localKeys.deviceId]
  if (typeof deviceId !== 'string' || !deviceId) {
    deviceId = crypto.randomUUID()
    await chrome.storage.local.set({ [localKeys.deviceId]: deviceId })
  }
  const epoch = stored[localKeys.statsEpoch]
  identity = { deviceId: deviceId as string, epoch: typeof epoch === 'number' ? epoch : 0 }
  return identity
}

/**
 * Every share that adds to this device's own: the other devices' shares, plus
 * one for the pre-share history (the synced baseline and this device's full
 * local copy of it, combined by max).
 */
async function readSummableShares(): Promise<{ shares: StatsShare[] }> {
  const { deviceId } = await readIdentity()
  const [items, local] = await Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get(localKeys.legacy)])
  const { shares, baseline } = remoteShares(items, deviceId, readResetEpoch(items))
  const legacyLocal = local[localKeys.legacy] as StatsShare | undefined
  let legacy: StatsShare | undefined = baseline
  if (legacyLocal?.lifetime) legacy = maxShare(baseline, legacyLocal, false)
  return { shares: legacy ? [...shares, legacy] : shares }
}

function readResetEpoch(items: Record<string, unknown>): number {
  const epoch = items[resetEpochKey]
  return typeof epoch === 'number' && Number.isFinite(epoch) ? epoch : 0
}

/** This device's share: the in-memory copy if loaded, else local storage. */
async function readOwnStats(): Promise<{ lifetime: LifetimeStats, local: LocalStats }> {
  if (ownStats) return ownStats
  const stored = await chrome.storage.local.get([localKeys.stats, localKeys.lifetime])
  ownStats = {
    lifetime: { ...defaultLifetimeStats(), ...(stored[localKeys.lifetime] as Partial<LifetimeStats> | undefined) },
    local: { ...defaultLocalStats(), ...(stored[localKeys.stats] as Partial<LocalStats> | undefined) },
  }
  return ownStats
}

async function persistStats(lifetime: LifetimeStats, local: LocalStats): Promise<void> {
  // Local is cheap and quota-generous: write it now so the dashboard is current.
  // The published share is coalesced behind a timer.
  ownStats = { lifetime, local }
  syncDirty = true
  await chrome.storage.local.set({ [localKeys.stats]: local, [localKeys.lifetime]: lifetime })
  scheduleSyncFlush()
}

function scheduleSyncFlush(): void {
  if (syncFlushTimer) return
  const delay = Math.max(0, syncFlushIntervalMs - (Date.now() - lastSyncFlushAt))
  syncFlushTimer = setTimeout(() => void flushSyncStats(), delay)
}

async function flushSyncStats(): Promise<void> {
  syncFlushTimer = undefined
  const own = ownStats
  if (!own || !syncDirty) return
  const id = await readIdentity()
  syncDirty = false
  lastSyncFlushAt = Date.now()
  try {
    await chrome.storage.sync.set({ [deviceShareKey(id.deviceId)]: buildDeviceShare(id.deviceId, id.epoch, own.lifetime, own.local) })
  }
  catch {
    // Quota exceeded or sync turned off: the share is safe in memory and in
    // local storage, so mark it unpublished and try again next window rather
    // than dropping it with an unhandled rejection.
    syncDirty = true
    scheduleSyncFlush()
  }
}

interface LegacyCloudStats {
  lifetime: LifetimeStats
  daily: StatBucket[]
  sites: SiteStats[]
}

function normalizeLegacyCloudStats(value: unknown): LegacyCloudStats | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<LegacyCloudStats> & { schemaVersion?: unknown }
  if (candidate.schemaVersion !== legacyCloudStatsSchemaVersion || !candidate.lifetime) return undefined

  return {
    lifetime: { ...defaultLifetimeStats(), ...candidate.lifetime },
    daily: Array.isArray(candidate.daily) ? candidate.daily.filter(isStatBucket) : [],
    sites: Array.isArray(candidate.sites) ? candidate.sites.filter(isSiteStats) : [],
  }
}

function earlierDate(left: string, right: string): string {
  return Date.parse(left) <= Date.parse(right) ? left : right
}

function laterDate(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right
}

function bucketKey(date: Date, type: 'hour' | 'day'): string {
  // Hours stay UTC (they're only ever shown relatively, "N hours ago"); days
  // follow the local calendar so "today" means the user's own day.
  return type === 'day' ? localDayKey(date) : hourBucketKey(date)
}

function mergeBucket(target: LocalStats['hourly'], key: string, totals: { adsBlocked: number, bytesSaved: number, videoSecondsSaved: number }): void {
  const existing = target.find(bucket => bucket.key === key)
  if (existing) {
    existing.adsBlocked += totals.adsBlocked
    existing.bytesSaved += totals.bytesSaved
    existing.videoSecondsSaved += totals.videoSecondsSaved
    return
  }

  target.push({ key, ...totals })
}
