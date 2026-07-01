import { describe, expect, it } from 'bun:test'
import {
  buildCloudStatsSnapshot,
  cloudStatsSnapshotBytes,
  defaultLifetimeStats,
  defaultLocalStats,
  getSettings,
  hydrateLocalStatsFromCloud,
  mergeLifetimeStats,
  setSettings,
} from '../src/shared/storage'
import type { LocalStats, SiteStats, StatBucket } from '../src/shared/types'

describe('cloud stats sync', () => {
  it('builds a compact sync snapshot with bounded dashboard history', () => {
    const lifetime = {
      ...defaultLifetimeStats(new Date('2026-06-01T00:00:00.000Z')),
      adsBlocked: 1234,
      bytesSaved: 5_000_000,
      videoSecondsSaved: 900,
    }
    const local: LocalStats = {
      ...defaultLocalStats(),
      daily: Array.from({ length: 90 }, (_, index) => bucket(`2026-05-${String(index + 1).padStart(2, '0')}`, index)),
      sites: Object.fromEntries(Array.from({ length: 30 }, (_, index) => {
        const hostname = `site-${index}.example`
        return [hostname, site(hostname, index)]
      })),
    }

    const snapshot = buildCloudStatsSnapshot(lifetime, local, new Date('2026-06-28T00:00:00.000Z'))

    expect(snapshot.lifetime.adsBlocked).toBe(1234)
    expect(snapshot.daily).toHaveLength(60)
    expect(snapshot.sites).toHaveLength(20)
    expect(snapshot.sites[0].adsBlocked).toBe(29)
    expect(cloudStatsSnapshotBytes(snapshot)).toBeLessThan(8192)
  })

  it('hydrates local dashboard stats from cloud without double-counting', () => {
    const cloud = buildCloudStatsSnapshot(
      {
        ...defaultLifetimeStats(new Date('2026-06-01T00:00:00.000Z')),
        adsBlocked: 500,
        bytesSaved: 1_000_000,
        videoSecondsSaved: 300,
      },
      {
        ...defaultLocalStats(),
        daily: [bucket('2026-06-28', 25)],
        sites: {
          'youtube.com': site('youtube.com', 42),
        },
      },
    )

    const hydrated = hydrateLocalStatsFromCloud({
      ...defaultLocalStats(),
      daily: [bucket('2026-06-28', 10)],
      sites: {
        'youtube.com': site('youtube.com', 12),
        'x.com': site('x.com', 8),
      },
    }, cloud)

    expect(hydrated.daily.find(day => day.key === '2026-06-28')?.adsBlocked).toBe(25)
    expect(hydrated.sites['youtube.com'].adsBlocked).toBe(42)
    expect(hydrated.sites['x.com'].adsBlocked).toBe(8)
  })

  it('merges lifetime cloud totals by preserving the highest counts', () => {
    const merged = mergeLifetimeStats(
      {
        adsBlocked: 12,
        bytesSaved: 100,
        videoSecondsSaved: 30,
        since: '2026-06-10T00:00:00.000Z',
        lastUpdated: '2026-06-20T00:00:00.000Z',
      },
      {
        adsBlocked: 100,
        bytesSaved: 50,
        videoSecondsSaved: 90,
        since: '2026-06-01T00:00:00.000Z',
        lastUpdated: '2026-06-18T00:00:00.000Z',
      },
    )

    expect(merged.adsBlocked).toBe(100)
    expect(merged.bytesSaved).toBe(100)
    expect(merged.videoSecondsSaved).toBe(90)
    expect(merged.since).toBe('2026-06-01T00:00:00.000Z')
    expect(merged.lastUpdated).toBe('2026-06-20T00:00:00.000Z')
  })

  it('drops legacy cosmetic and X settings from sync storage', async () => {
    const originalChrome = globalThis.chrome
    const store: Record<string, unknown> = {
      settings: {
        enabled: true,
        badgeEnabled: true,
        cosmeticFiltering: true,
        youtubeEnhancements: true,
        twitchEnhancements: true,
        xEnhancements: true,
        allowedSites: ['example.com'],
        blockedSites: [],
      },
    }

    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        storage: {
          sync: {
            async get(key: string) {
              return { [key]: store[key] }
            },
            async set(values: Record<string, unknown>) {
              Object.assign(store, values)
            },
          },
        },
      } as unknown as typeof chrome,
    })

    try {
      const settings = await getSettings()
      expect('cosmeticFiltering' in settings).toBe(false)
      expect('xEnhancements' in settings).toBe(false)

      await setSettings({ youtubeEnhancements: false })
      const persisted = store.settings as Record<string, unknown>
      expect(persisted.cosmeticFiltering).toBeUndefined()
      expect(persisted.xEnhancements).toBeUndefined()
      expect(persisted.youtubeEnhancements).toBe(false)
    }
    finally {
      Object.defineProperty(globalThis, 'chrome', {
        configurable: true,
        value: originalChrome,
      })
    }
  })
})

function bucket(key: string, adsBlocked: number): StatBucket {
  return {
    key,
    adsBlocked,
    bytesSaved: adsBlocked * 1000,
    videoSecondsSaved: adsBlocked * 5,
  }
}

function site(hostname: string, adsBlocked: number): SiteStats {
  return {
    hostname,
    adsBlocked,
    bytesSaved: adsBlocked * 1000,
    videoSecondsSaved: adsBlocked * 5,
    lastBlockedAt: '2026-06-28T00:00:00.000Z',
  }
}
