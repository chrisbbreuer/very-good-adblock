import { describe, expect, it } from 'bun:test'
import {
  dismissNotice,
  getLifetimeStats,
  getLocalStats,
  getSettings,
  initializeStorage,
  isNoticeDismissed,
  migrateStatsSchema,
  setSettings,
} from '../src/shared/storage'

describe('storage', () => {
  it('keeps cosmetic settings but drops legacy X settings from sync storage', async () => {
    const originalChrome = globalThis.chrome
    const store: Record<string, unknown> = {
      settings: {
        enabled: true,
        badgeEnabled: true,
        cosmeticFiltering: false,
        aggressiveCosmetic: true,
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
      expect(settings.cosmeticFiltering).toBe(false)
      expect(settings.aggressiveCosmetic).toBe(true)
      expect('xEnhancements' in settings).toBe(false)

      await setSettings({ youtubeEnhancements: false })
      const persisted = store.settings as Record<string, unknown>
      expect(persisted.cosmeticFiltering).toBe(false)
      expect(persisted.aggressiveCosmetic).toBe(true)
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

  it('recalibrates stored estimates once on the v2 stats schema', async () => {
    const originalChrome = globalThis.chrome
    const syncStore: Record<string, unknown> = {
      lifetime: {
        adsBlocked: 1_000,
        bytesSaved: 10_000_000,
        videoSecondsSaved: 10_000,
        since: '2026-06-01T00:00:00.000Z',
        lastUpdated: '2026-07-01T00:00:00.000Z',
      },
    }
    const localStore: Record<string, unknown> = {
      stats: {
        hourly: [{ key: '2026-07-01T10', adsBlocked: 10, bytesSaved: 100_000, videoSecondsSaved: 600 }],
        daily: [{ key: '2026-07-01', adsBlocked: 10, bytesSaved: 100_000, videoSecondsSaved: 600 }],
        sites: {
          'example.com': { hostname: 'example.com', adsBlocked: 10, bytesSaved: 100_000, videoSecondsSaved: 600, lastBlockedAt: '2026-07-01T00:00:00.000Z' },
        },
        recentEvents: [],
      },
    }

    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        storage: {
          sync: memoryArea(syncStore),
          local: memoryArea(localStore),
        },
      } as unknown as typeof chrome,
    })

    try {
      // Upgrading moves the shared totals into the baseline first; the v2
      // rescale then applies to it, exactly once.
      await initializeStorage()
      await migrateStatsSchema()

      // Estimates rescale by the recalibration factor; counts stay untouched.
      const lifetime = await getLifetimeStats()
      expect(lifetime.bytesSaved).toBe(2_000_000)
      expect(lifetime.videoSecondsSaved).toBe(2_000)
      expect(lifetime.adsBlocked).toBe(1_000)

      const local = await getLocalStats()
      expect(local.daily[0].bytesSaved).toBe(20_000)
      expect(local.daily[0].videoSecondsSaved).toBe(120)
      expect(local.sites['example.com'].bytesSaved).toBe(20_000)
      expect(local.sites['example.com'].adsBlocked).toBe(10)
      expect(syncStore.statsVersion).toBe(2)

      // A second run is a no-op — the version flag prevents double rescaling.
      await migrateStatsSchema()
      const again = await getLifetimeStats()
      expect(again.bytesSaved).toBe(2_000_000)
      expect(again.videoSecondsSaved).toBe(2_000)
    }
    finally {
      Object.defineProperty(globalThis, 'chrome', {
        configurable: true,
        value: originalChrome,
      })
    }
  })
})

describe('one-time notices', () => {
  it('records a dismissal without disturbing other notices', async () => {
    const originalChrome = globalThis.chrome
    const store: Record<string, unknown> = {}

    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        storage: {
          local: {
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
      expect(await isNoticeDismissed('safari-site-access')).toBe(false)

      await dismissNotice('safari-site-access')
      expect(await isNoticeDismissed('safari-site-access')).toBe(true)
      expect(store.dismissedNotices).toEqual(['safari-site-access'])

      // Dismissing twice must not duplicate the id.
      await dismissNotice('safari-site-access')
      expect(store.dismissedNotices).toEqual(['safari-site-access'])
    }
    finally {
      Object.defineProperty(globalThis, 'chrome', {
        configurable: true,
        value: originalChrome,
      })
    }
  })

  it('treats a corrupt dismissal list as nothing dismissed', async () => {
    const originalChrome = globalThis.chrome
    const store: Record<string, unknown> = { dismissedNotices: 'safari-site-access' }

    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        storage: {
          local: {
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
      // A bare string is not a list; reading it as one would make `includes`
      // match on substrings and silently swallow the notice.
      expect(await isNoticeDismissed('safari-site-access')).toBe(false)
      await dismissNotice('safari-site-access')
      expect(store.dismissedNotices).toEqual(['safari-site-access'])
    }
    finally {
      Object.defineProperty(globalThis, 'chrome', {
        configurable: true,
        value: originalChrome,
      })
    }
  })
})

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
