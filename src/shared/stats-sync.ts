import { normalizeHostname } from './domain'
import type { LifetimeStats, LocalStats, SiteStats, StatBucket } from './types'

/**
 * Cross-device stats, one share per device.
 *
 * Every device publishes only what IT blocked, under its own sync key, and the
 * totals shown anywhere are the sum of all shares. The old layout kept a single
 * shared `lifetime` and merged copies by taking the larger value: two devices
 * blocking at once each wrote "my total", the higher one won and the other's
 * blocks vanished, and an idle device kept repeating whatever another device
 * last wrote. Summing disjoint shares has neither problem, because no device
 * ever writes another device's numbers.
 *
 * Resetting is an epoch, not a deletion. A reset stamps `statsResetAt`; every
 * device that sees a newer epoch than the one it last applied clears its own
 * share, and shares stamped with an older epoch are left out of the sum until
 * their device catches up. Under max-merge a reset never stuck: the next
 * snapshot from any other device brought the old totals straight back.
 */
export const deviceShareKeyPrefix = 'statsDevice:'
/** Totals from before shares existed, kept as one share that no device owns. */
export const baselineKey = 'statsBaseline'
export const resetEpochKey = 'statsResetAt'

const shareSchemaVersion = 2
// chrome.storage.sync caps an item at 8 KB, and every device's share is one
// item; ~2.5 KB each leaves room for a household of devices in the 100 KB total.
const shareDailyLimit = 30
const shareSiteLimit = 15
const shareMaxBytes = 8_000
/** Days of history the merged dashboard chart keeps. */
export const mergedDailyLimit = 60

export interface StatsShare {
  lifetime: LifetimeStats
  daily: StatBucket[]
  sites: SiteStats[]
}

export interface DeviceStatsShare extends StatsShare {
  schemaVersion: 2
  deviceId: string
  /** The reset epoch this share was counted under. */
  epoch: number
  syncedAt: string
}

export interface StatsBaseline extends StatsShare {
  schemaVersion: 2
  epoch: number
}

export function deviceShareKey(deviceId: string): string {
  return `${deviceShareKeyPrefix}${deviceId}`
}

export function buildDeviceShare(deviceId: string, epoch: number, lifetime: LifetimeStats, local: LocalStats, now: Date = new Date()): DeviceStatsShare {
  const share: DeviceStatsShare = {
    schemaVersion: shareSchemaVersion,
    deviceId,
    epoch,
    lifetime,
    daily: sortedBuckets(local.daily).slice(-shareDailyLimit),
    sites: topSites(Object.values(local.sites), shareSiteLimit),
    syncedAt: now.toISOString(),
  }

  // Stay under the per-item quota whatever the history holds: oldest days go
  // first, then the smallest site rollups.
  while (shareBytes(share) > shareMaxBytes) {
    if (share.daily.length > 1) share.daily = share.daily.slice(1)
    else if (share.sites.length > 0) share.sites = share.sites.slice(0, -1)
    else break
  }

  return share
}

export function shareBytes(share: StatsShare): number {
  return new TextEncoder().encode(JSON.stringify(share)).byteLength
}

export function normalizeDeviceShare(value: unknown): DeviceStatsShare | undefined {
  const share = normalizeShare(value)
  const candidate = value as Partial<DeviceStatsShare> | undefined
  if (!share || typeof candidate?.deviceId !== 'string' || !candidate.deviceId) return undefined
  return {
    ...share,
    schemaVersion: shareSchemaVersion,
    deviceId: candidate.deviceId,
    epoch: typeof candidate.epoch === 'number' ? candidate.epoch : 0,
    syncedAt: typeof candidate.syncedAt === 'string' ? candidate.syncedAt : '',
  }
}

export function normalizeBaseline(value: unknown): StatsBaseline | undefined {
  const share = normalizeShare(value)
  if (!share) return undefined
  const epoch = (value as Partial<StatsBaseline>).epoch
  return { ...share, schemaVersion: shareSchemaVersion, epoch: typeof epoch === 'number' ? epoch : 0 }
}

/**
 * The shares other than this device's own that count under `epoch`, read from
 * a full `chrome.storage.sync.get(null)`. This device's share is skipped on
 * purpose: its local copy is always at least as fresh.
 */
export function remoteShares(items: Record<string, unknown>, ownDeviceId: string, epoch: number): { shares: StatsShare[], baseline?: StatsBaseline, devices: number } {
  const shares: StatsShare[] = []
  let devices = 1

  for (const [key, value] of Object.entries(items)) {
    if (!key.startsWith(deviceShareKeyPrefix)) continue
    const share = normalizeDeviceShare(value)
    if (!share || share.deviceId === ownDeviceId || share.epoch < epoch) continue
    shares.push(share)
    devices += 1
  }

  const baseline = normalizeBaseline(items[baselineKey])
  return { shares, baseline: baseline && baseline.epoch >= epoch ? baseline : undefined, devices }
}

export function sumLifetime(own: LifetimeStats, shares: readonly StatsShare[]): LifetimeStats {
  return shares.reduce<LifetimeStats>((total, share) => ({
    adsBlocked: total.adsBlocked + share.lifetime.adsBlocked,
    bytesSaved: total.bytesSaved + share.lifetime.bytesSaved,
    videoSecondsSaved: total.videoSecondsSaved + share.lifetime.videoSecondsSaved,
    since: share.lifetime.since && share.lifetime.since < total.since ? share.lifetime.since : total.since,
    lastUpdated: share.lifetime.lastUpdated > total.lastUpdated ? share.lifetime.lastUpdated : total.lastUpdated,
  }), { ...own })
}

export function sumDaily(own: readonly StatBucket[], shares: readonly StatsShare[], limit: number = mergedDailyLimit): StatBucket[] {
  const byKey = new Map<string, StatBucket>()
  for (const bucket of [...own, ...shares.flatMap(share => share.daily)]) {
    const existing = byKey.get(bucket.key)
    if (existing) {
      existing.adsBlocked += bucket.adsBlocked
      existing.bytesSaved += bucket.bytesSaved
      existing.videoSecondsSaved += bucket.videoSecondsSaved
    }
    else {
      byKey.set(bucket.key, { ...bucket })
    }
  }
  return sortedBuckets([...byKey.values()]).slice(-limit)
}

export function sumSites(own: Record<string, SiteStats>, shares: readonly StatsShare[]): Record<string, SiteStats> {
  const merged: Record<string, SiteStats> = {}
  for (const site of [...Object.values(own), ...shares.flatMap(share => share.sites)]) {
    const hostname = normalizeHostname(site.hostname)
    if (!hostname) continue
    const existing = merged[hostname]
    merged[hostname] = existing
      ? {
          hostname,
          adsBlocked: existing.adsBlocked + site.adsBlocked,
          bytesSaved: existing.bytesSaved + site.bytesSaved,
          videoSecondsSaved: existing.videoSecondsSaved + site.videoSecondsSaved,
          lastBlockedAt: site.lastBlockedAt > existing.lastBlockedAt ? site.lastBlockedAt : existing.lastBlockedAt,
        }
      : { ...site, hostname }
  }
  return merged
}

/**
 * Combine two views of the same totals (copies of the pre-share history) by
 * keeping the larger of each figure. `capped` trims to what one sync item can
 * hold; a device's local copy is kept whole.
 */
export function maxShare(left: StatsShare | undefined, right: StatsShare, capped = true): StatsShare {
  if (!left) return capped ? maxShare(right, { lifetime: right.lifetime, daily: [], sites: [] }) : right
  const daily = new Map<string, StatBucket>()
  for (const bucket of [...left.daily, ...right.daily]) {
    const existing = daily.get(bucket.key)
    daily.set(bucket.key, existing
      ? {
          key: bucket.key,
          adsBlocked: Math.max(existing.adsBlocked, bucket.adsBlocked),
          bytesSaved: Math.max(existing.bytesSaved, bucket.bytesSaved),
          videoSecondsSaved: Math.max(existing.videoSecondsSaved, bucket.videoSecondsSaved),
        }
      : { ...bucket })
  }
  const sites = new Map<string, SiteStats>()
  for (const site of [...left.sites, ...right.sites]) {
    const existing = sites.get(site.hostname)
    sites.set(site.hostname, existing
      ? {
          hostname: site.hostname,
          adsBlocked: Math.max(existing.adsBlocked, site.adsBlocked),
          bytesSaved: Math.max(existing.bytesSaved, site.bytesSaved),
          videoSecondsSaved: Math.max(existing.videoSecondsSaved, site.videoSecondsSaved),
          lastBlockedAt: site.lastBlockedAt > existing.lastBlockedAt ? site.lastBlockedAt : existing.lastBlockedAt,
        }
      : { ...site })
  }
  return {
    lifetime: {
      adsBlocked: Math.max(left.lifetime.adsBlocked, right.lifetime.adsBlocked),
      bytesSaved: Math.max(left.lifetime.bytesSaved, right.lifetime.bytesSaved),
      videoSecondsSaved: Math.max(left.lifetime.videoSecondsSaved, right.lifetime.videoSecondsSaved),
      since: left.lifetime.since < right.lifetime.since ? left.lifetime.since : right.lifetime.since,
      lastUpdated: left.lifetime.lastUpdated > right.lifetime.lastUpdated ? left.lifetime.lastUpdated : right.lifetime.lastUpdated,
    },
    daily: capped ? sortedBuckets([...daily.values()]).slice(-shareDailyLimit) : sortedBuckets([...daily.values()]),
    sites: capped ? topSites([...sites.values()], shareSiteLimit) : [...sites.values()],
  }
}

function normalizeShare(value: unknown): StatsShare | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<StatsShare> & { schemaVersion?: unknown }
  if (candidate.schemaVersion !== shareSchemaVersion || !candidate.lifetime || typeof candidate.lifetime !== 'object') return undefined
  const lifetime = candidate.lifetime as Partial<LifetimeStats>
  return {
    lifetime: {
      adsBlocked: finite(lifetime.adsBlocked),
      bytesSaved: finite(lifetime.bytesSaved),
      videoSecondsSaved: finite(lifetime.videoSecondsSaved),
      since: typeof lifetime.since === 'string' ? lifetime.since : '',
      lastUpdated: typeof lifetime.lastUpdated === 'string' ? lifetime.lastUpdated : '',
    },
    daily: Array.isArray(candidate.daily) ? candidate.daily.filter(isStatBucket) : [],
    sites: Array.isArray(candidate.sites) ? candidate.sites.filter(isSiteStats) : [],
  }
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function sortedBuckets(buckets: readonly StatBucket[]): StatBucket[] {
  return [...buckets].sort((a, b) => a.key.localeCompare(b.key))
}

function topSites(sites: readonly SiteStats[], limit: number): SiteStats[] {
  return [...sites]
    .sort((a, b) => b.adsBlocked - a.adsBlocked || b.lastBlockedAt.localeCompare(a.lastBlockedAt))
    .slice(0, limit)
}

export function isStatBucket(value: unknown): value is StatBucket {
  const bucket = value as Partial<StatBucket> | undefined
  return typeof bucket?.key === 'string'
    && typeof bucket.adsBlocked === 'number'
    && typeof bucket.bytesSaved === 'number'
    && typeof bucket.videoSecondsSaved === 'number'
}

export function isSiteStats(value: unknown): value is SiteStats {
  const site = value as Partial<SiteStats> | undefined
  return typeof site?.hostname === 'string'
    && typeof site.adsBlocked === 'number'
    && typeof site.bytesSaved === 'number'
    && typeof site.videoSecondsSaved === 'number'
    && typeof site.lastBlockedAt === 'string'
}
