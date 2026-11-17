import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import {
  applySyncedStatsChange,
  getCloudSyncState,
  getLifetimeStats,
  getLocalStats,
  initializeStorage,
  recordBlockEvents,
  resetStats,
} from '../src/shared/storage'
import { buildDeviceShare, mergedDailyLimit, shareBytes, sumDaily, sumLifetime, sumSites } from '../src/shared/stats-sync'
import { localDayKey } from '../src/shared/metrics'
import type { BlockEvent, LifetimeStats, LocalStats, SiteStats } from '../src/shared/types'

// One module instance plays this device; other devices exist only as the
// shares they publish into the shared sync store, exactly as a real device
// sees them. The tests run in order and build on each other's state.
const originalChrome = globalThis.chrome
const syncStore: Record<string, unknown> = {}
const localStore: Record<string, unknown> = {}
const today = localDayKey()

function memoryArea(store: Record<string, unknown>) {
  return {
    async get(keys: string | string[] | null) {
      if (keys === null) return structuredClone(store)
      const list = Array.isArray(keys) ? keys : [keys]
      return Object.fromEntries(list.map(key => [key, structuredClone(store[key])]))
    },
    async set(values: Record<string, unknown>) {
      Object.assign(store, structuredClone(values))
    },
    async remove(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key]
    },
  }
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { storage: { sync: memoryArea(syncStore), local: memoryArea(localStore) } } as unknown as typeof chrome,
  })
})

afterAll(() => {
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: originalChrome })
})

function lifetime(adsBlocked: number): LifetimeStats {
  return { adsBlocked, bytesSaved: adsBlocked * 1_000, videoSecondsSaved: 0, since: '2026-01-01T00:00:00.000Z', lastUpdated: '2026-11-16T00:00:00.000Z' }
}

function site(hostname: string, adsBlocked: number): SiteStats {
  return { hostname, adsBlocked, bytesSaved: adsBlocked * 1_000, videoSecondsSaved: 0, lastBlockedAt: '2026-11-16T00:00:00.000Z' }
}

function otherDevice(deviceId: string, epoch: number, adsBlocked: number): void {
  const local: LocalStats = {
    hourly: [],
    daily: [{ key: today, adsBlocked, bytesSaved: adsBlocked * 1_000, videoSecondsSaved: 0 }],
    sites: { 'news.example': site('news.example', adsBlocked) },
    recentEvents: [],
  }
  syncStore[`statsDevice:${deviceId}`] = buildDeviceShare(deviceId, epoch, lifetime(adsBlocked), local)
}

function events(count: number): BlockEvent[] {
  return Array.from({ length: count }, () => ({ hostname: 'news.example', source: 'dnr' as const, category: 'script' as const, count: 1, bytesSaved: 1_000, occurredAt: new Date().toISOString() }))
}

describe('cross-device stats', () => {
  it('moves the old shared totals into a baseline that counts once, not once per device', async () => {
    // The pre-share layout: every device held the same max-merged totals.
    syncStore.lifetime = lifetime(1_000)
    syncStore.cloudStats = { schemaVersion: 1, lifetime: lifetime(1_000), daily: [{ key: today, adsBlocked: 40, bytesSaved: 0, videoSecondsSaved: 0 }], sites: [site('news.example', 300)], syncedAt: '' }
    localStore.lifetime = lifetime(990)
    localStore.stats = { hourly: [], daily: [], sites: { 'news.example': site('news.example', 300), 'long-tail.example': site('long-tail.example', 2) }, recentEvents: [] }

    await initializeStorage()

    expect((await getLifetimeStats()).adsBlocked).toBe(1_000)
    expect(syncStore.lifetime).toBeUndefined()
    expect(syncStore.cloudStats).toBeUndefined()
    expect(syncStore.statsBaseline).toEqual(expect.objectContaining({ epoch: 0 }))
    // A site too small for the 8 KB synced baseline still shows here.
    expect((await getLocalStats()).sites['long-tail.example'].adsBlocked).toBe(2)
    // This device published its own (empty) share.
    expect(Object.keys(syncStore).filter(key => key.startsWith('statsDevice:'))).toHaveLength(1)
  })

  it('adds other devices\' blocks to this one\'s instead of keeping the larger', async () => {
    await recordBlockEvents(events(5))
    otherDevice('laptop', 0, 7)

    expect((await getLifetimeStats()).adsBlocked).toBe(1_000 + 5 + 7)
    const local = await getLocalStats()
    expect(local.sites['news.example'].adsBlocked).toBe(300 + 5 + 7)
    expect(local.daily.find(day => day.key === today)?.adsBlocked).toBe(40 + 5 + 7)
    expect((await getCloudSyncState()).devices).toBe(2)
  })

  it('makes a reset from another device stick on this one', async () => {
    const epoch = Date.now() + 1_000
    syncStore.statsResetAt = epoch
    await applySyncedStatsChange({ statsResetAt: { newValue: epoch } })

    // This device cleared its share, and the pre-reset share and baseline stop counting.
    expect((await getLifetimeStats()).adsBlocked).toBe(0)
    expect((await getLocalStats()).sites['long-tail.example']).toBeUndefined()

    // A device that has not seen the reset yet republishes its old totals: still ignored.
    otherDevice('laptop', 0, 7)
    expect((await getLifetimeStats()).adsBlocked).toBe(0)

    // Once it applies the reset, what it blocks afterwards counts again.
    otherDevice('laptop', epoch, 2)
    await recordBlockEvents(events(1))
    expect((await getLifetimeStats()).adsBlocked).toBe(3)
  })

  it('resets every device from here', async () => {
    await resetStats()

    expect((await getLifetimeStats()).adsBlocked).toBe(0)
    expect(syncStore.statsBaseline).toBeUndefined()
    expect(syncStore.statsResetAt as number).toBeGreaterThan(Date.now() - 5_000)
  })
})

describe('share arithmetic', () => {
  it('sums lifetimes, keeping the earliest start', () => {
    const total = sumLifetime({ ...lifetime(3), since: '2026-06-01T00:00:00.000Z' }, [{ lifetime: lifetime(4), daily: [], sites: [] }])
    expect(total.adsBlocked).toBe(7)
    expect(total.since).toBe('2026-01-01T00:00:00.000Z')
  })

  it('sums days and sites by key', () => {
    const share = { lifetime: lifetime(0), daily: [{ key: today, adsBlocked: 2, bytesSaved: 0, videoSecondsSaved: 0 }], sites: [site('a.example', 2)] }
    expect(sumDaily([{ key: today, adsBlocked: 1, bytesSaved: 0, videoSecondsSaved: 0 }], [share])).toEqual([{ key: today, adsBlocked: 3, bytesSaved: 0, videoSecondsSaved: 0 }])
    expect(sumSites({ 'a.example': site('a.example', 1) }, [share])['a.example'].adsBlocked).toBe(3)
  })

  it('keeps a device share under the 8 KB sync item limit', () => {
    const local: LocalStats = {
      hourly: [],
      daily: Array.from({ length: mergedDailyLimit }, (_, index) => ({ key: `2026-09-${String(index + 1).padStart(2, '0')}`, adsBlocked: index, bytesSaved: 0, videoSecondsSaved: 0 })),
      sites: Object.fromEntries(Array.from({ length: 400 }, (_, index) => [`site-${index}.example`, site(`site-${index}.example`, index)])),
      recentEvents: [],
    }
    const share = buildDeviceShare('device', 0, lifetime(10), local)
    expect(share.daily).toHaveLength(30)
    expect(share.sites).toHaveLength(15)
    expect(share.sites[0].adsBlocked).toBe(399)
    expect(shareBytes(share)).toBeLessThan(8_192)
  })
})
