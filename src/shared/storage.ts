import { maxRecentEvents } from './constants'
import { hostnameFromUrl, isHttpUrl, normalizeHostname, siteMatches } from './domain'
import { compactBuckets, eventTotals } from './metrics'
import type { ActiveTabState, BlockEvent, CloudStatsSnapshot, ExtensionSettings, LifetimeStats, LocalStats, SiteStats, StatBucket } from './types'

const syncKeys = {
  settings: 'settings',
  lifetime: 'lifetime',
  cloudStats: 'cloudStats',
} as const

const localKeys = {
  stats: 'stats',
} as const

const cloudStatsSchemaVersion = 1
const cloudDailyBucketLimit = 60
const cloudSiteRollupLimit = 20

export const defaultSettings: ExtensionSettings = {
  enabled: true,
  badgeEnabled: true,
  cosmeticFiltering: true,
  youtubeEnhancements: true,
  xEnhancements: true,
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

export function buildCloudStatsSnapshot(lifetime: LifetimeStats, local: LocalStats, now: Date = new Date()): CloudStatsSnapshot {
  return {
    schemaVersion: cloudStatsSchemaVersion,
    lifetime,
    daily: compactBuckets(local.daily, cloudDailyBucketLimit),
    sites: Object.values(local.sites)
      .sort((a, b) => b.adsBlocked - a.adsBlocked || b.lastBlockedAt.localeCompare(a.lastBlockedAt))
      .slice(0, cloudSiteRollupLimit),
    syncedAt: now.toISOString(),
  }
}

export function cloudStatsSnapshotBytes(snapshot: CloudStatsSnapshot): number {
  return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength
}

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.sync.get(syncKeys.settings)
  return { ...defaultSettings, ...(result[syncKeys.settings] as Partial<ExtensionSettings> | undefined) }
}

export async function setSettings(settings: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const next = { ...(await getSettings()), ...settings }
  next.allowedSites = uniqueSites(next.allowedSites)
  next.blockedSites = uniqueSites(next.blockedSites)
  await chrome.storage.sync.set({ [syncKeys.settings]: next })
  return next
}

export async function getLifetimeStats(): Promise<LifetimeStats> {
  const result = await chrome.storage.sync.get(syncKeys.lifetime)
  return { ...defaultLifetimeStats(), ...(result[syncKeys.lifetime] as Partial<LifetimeStats> | undefined) }
}

export async function setLifetimeStats(stats: LifetimeStats): Promise<void> {
  await chrome.storage.sync.set({ [syncKeys.lifetime]: stats })
}

export async function getCloudStatsSnapshot(): Promise<CloudStatsSnapshot | undefined> {
  const result = await chrome.storage.sync.get(syncKeys.cloudStats)
  return normalizeCloudStatsSnapshot(result[syncKeys.cloudStats])
}

export async function getLocalStats(): Promise<LocalStats> {
  const result = await chrome.storage.local.get(localKeys.stats)
  return { ...defaultLocalStats(), ...(result[localKeys.stats] as Partial<LocalStats> | undefined) }
}

export async function setLocalStats(stats: LocalStats): Promise<void> {
  await chrome.storage.local.set({ [localKeys.stats]: stats })
}

export async function initializeStorage(): Promise<void> {
  const sync = await chrome.storage.sync.get([syncKeys.settings, syncKeys.lifetime, syncKeys.cloudStats])
  const local = await chrome.storage.local.get(localKeys.stats)
  const cloudStats = normalizeCloudStatsSnapshot(sync[syncKeys.cloudStats])
  const syncLifetime = sync[syncKeys.lifetime] as Partial<LifetimeStats> | undefined
  const lifetime = mergeLifetimeStats(syncLifetime, cloudStats?.lifetime)
  const localStats = hydrateLocalStatsFromCloud(
    { ...defaultLocalStats(), ...(local[localKeys.stats] as Partial<LocalStats> | undefined) },
    cloudStats,
  )

  if (!sync[syncKeys.settings]) await chrome.storage.sync.set({ [syncKeys.settings]: defaultSettings })
  await Promise.all([
    lifetimeMatches(syncLifetime, lifetime) ? undefined : setLifetimeStats(lifetime),
    setLocalStats(localStats),
    cloudStats ? undefined : chrome.storage.sync.set({ [syncKeys.cloudStats]: buildCloudStatsSnapshot(lifetime, localStats) }),
  ])
}

export async function hydrateSyncedStats(value: unknown): Promise<void> {
  const cloudStats = normalizeCloudStatsSnapshot(value)
  if (!cloudStats) return

  const lifetime = mergeLifetimeStats(await getLifetimeStats(), cloudStats.lifetime)
  const local = hydrateLocalStatsFromCloud(await getLocalStats(), cloudStats)
  await Promise.all([setLifetimeStats(lifetime), setLocalStats(local)])
}

export async function resetStats(): Promise<void> {
  await persistStats(defaultLifetimeStats(), defaultLocalStats())
}

export async function recordBlockEvents(events: BlockEvent[]): Promise<void> {
  if (!events.length) return

  const now = new Date()
  const totals = eventTotals(events)
  const lifetime = await getLifetimeStats()
  const local = await getLocalStats()

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
    const existing: SiteStats = local.sites[hostname] ?? {
      hostname,
      adsBlocked: 0,
      bytesSaved: 0,
      videoSecondsSaved: 0,
      lastBlockedAt: event.occurredAt,
    }
    const eventBytes = event.bytesSaved ?? 0
    existing.adsBlocked += event.count
    existing.bytesSaved += eventBytes
    existing.videoSecondsSaved += event.videoSecondsSaved ?? 0
    existing.lastBlockedAt = event.occurredAt
    local.sites[hostname] = existing
  }

  local.hourly = compactBuckets(local.hourly, 72)
  local.daily = compactBuckets(local.daily, 60)
  local.recentEvents = [...local.recentEvents, ...events].slice(-maxRecentEvents)

  await persistStats(lifetime, local)
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
    allowed: siteMatches(hostname, settings.allowedSites),
    blocked: siteMatches(hostname, settings.blockedSites),
  }
}

function uniqueSites(sites: string[]): string[] {
  return [...new Set(sites.map(normalizeHostname).filter(Boolean))].sort()
}

export function mergeLifetimeStats(local?: Partial<LifetimeStats>, cloud?: Partial<LifetimeStats>): LifetimeStats {
  const fallback = defaultLifetimeStats()
  const next = { ...fallback, ...local }
  if (!cloud) return next

  return {
    adsBlocked: Math.max(next.adsBlocked, cloud.adsBlocked ?? 0),
    bytesSaved: Math.max(next.bytesSaved, cloud.bytesSaved ?? 0),
    videoSecondsSaved: Math.max(next.videoSecondsSaved, cloud.videoSecondsSaved ?? 0),
    since: earlierDate(next.since, cloud.since ?? next.since),
    lastUpdated: laterDate(next.lastUpdated, cloud.lastUpdated ?? next.lastUpdated),
  }
}

export function hydrateLocalStatsFromCloud(local: LocalStats, cloud?: CloudStatsSnapshot): LocalStats {
  if (!cloud) return local

  return {
    hourly: compactBuckets(local.hourly, 72),
    daily: compactBuckets(mergeBucketsByMax(local.daily, cloud.daily), 60),
    sites: mergeSitesByMax(local.sites, cloud.sites),
    recentEvents: local.recentEvents.slice(-maxRecentEvents),
  }
}

async function persistStats(lifetime: LifetimeStats, local: LocalStats): Promise<void> {
  await Promise.all([
    chrome.storage.sync.set({
      [syncKeys.lifetime]: lifetime,
      [syncKeys.cloudStats]: buildCloudStatsSnapshot(lifetime, local),
    }),
    setLocalStats(local),
  ])
}

function normalizeCloudStatsSnapshot(value: unknown): CloudStatsSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<CloudStatsSnapshot>
  if (candidate.schemaVersion !== cloudStatsSchemaVersion || !candidate.lifetime) return undefined

  return {
    schemaVersion: cloudStatsSchemaVersion,
    lifetime: { ...defaultLifetimeStats(), ...candidate.lifetime },
    daily: Array.isArray(candidate.daily) ? candidate.daily.filter(isStatBucket).slice(-cloudDailyBucketLimit) : [],
    sites: Array.isArray(candidate.sites) ? candidate.sites.filter(isSiteStats).slice(0, cloudSiteRollupLimit) : [],
    syncedAt: typeof candidate.syncedAt === 'string' ? candidate.syncedAt : new Date().toISOString(),
  }
}

function isStatBucket(value: unknown): value is StatBucket {
  const bucket = value as Partial<StatBucket>
  return Boolean(value)
    && typeof bucket.key === 'string'
    && typeof bucket.adsBlocked === 'number'
    && typeof bucket.bytesSaved === 'number'
    && typeof bucket.videoSecondsSaved === 'number'
}

function isSiteStats(value: unknown): value is SiteStats {
  const site = value as Partial<SiteStats>
  return Boolean(value)
    && typeof site.hostname === 'string'
    && typeof site.adsBlocked === 'number'
    && typeof site.bytesSaved === 'number'
    && typeof site.videoSecondsSaved === 'number'
    && typeof site.lastBlockedAt === 'string'
}

function mergeBucketsByMax(local: StatBucket[], cloud: StatBucket[]): StatBucket[] {
  const merged = new Map<string, StatBucket>()
  for (const bucket of [...local, ...cloud]) {
    const existing = merged.get(bucket.key)
    if (!existing) {
      merged.set(bucket.key, { ...bucket })
      continue
    }

    existing.adsBlocked = Math.max(existing.adsBlocked, bucket.adsBlocked)
    existing.bytesSaved = Math.max(existing.bytesSaved, bucket.bytesSaved)
    existing.videoSecondsSaved = Math.max(existing.videoSecondsSaved, bucket.videoSecondsSaved)
  }

  return [...merged.values()]
}

function mergeSitesByMax(local: Record<string, SiteStats>, cloud: SiteStats[]): Record<string, SiteStats> {
  const merged: Record<string, SiteStats> = { ...local }
  for (const site of cloud) {
    const hostname = normalizeHostname(site.hostname)
    if (!hostname) continue

    const existing = merged[hostname]
    merged[hostname] = existing
      ? {
          hostname,
          adsBlocked: Math.max(existing.adsBlocked, site.adsBlocked),
          bytesSaved: Math.max(existing.bytesSaved, site.bytesSaved),
          videoSecondsSaved: Math.max(existing.videoSecondsSaved, site.videoSecondsSaved),
          lastBlockedAt: laterDate(existing.lastBlockedAt, site.lastBlockedAt),
        }
      : { ...site, hostname }
  }

  return merged
}

function earlierDate(left: string, right: string): string {
  return Date.parse(left) <= Date.parse(right) ? left : right
}

function laterDate(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right
}

function lifetimeMatches(left: Partial<LifetimeStats> | undefined, right: LifetimeStats): boolean {
  if (!left) return false

  return left.adsBlocked === right.adsBlocked
    && left.bytesSaved === right.bytesSaved
    && left.videoSecondsSaved === right.videoSecondsSaved
    && left.since === right.since
    && left.lastUpdated === right.lastUpdated
}

function bucketKey(date: Date, type: 'hour' | 'day'): string {
  const iso = date.toISOString()
  return type === 'hour' ? iso.slice(0, 13) : iso.slice(0, 10)
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
