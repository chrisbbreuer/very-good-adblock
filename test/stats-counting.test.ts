import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { capSiteRollups, getLifetimeStats, getLocalStats, recordBlockEvents, resetStats } from '../src/shared/storage'
import type { BlockEvent, SiteStats } from '../src/shared/types'

const originalChrome = globalThis.chrome
let syncStore: Record<string, unknown>
let localStore: Record<string, unknown>

/** Storage that yields between read and write, so unserialized updates would race. */
function area(store: () => Record<string, unknown>) {
  return {
    async get(keys: string | string[] | null) {
      await new Promise(resolve => setTimeout(resolve, 0))
      if (keys === null) return structuredClone(store())
      const list = Array.isArray(keys) ? keys : [keys]
      return Object.fromEntries(list.map(key => [key, structuredClone(store()[key])]))
    },
    async set(values: Record<string, unknown>) {
      await new Promise(resolve => setTimeout(resolve, 0))
      Object.assign(store(), structuredClone(values))
    },
    async remove(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete store()[key]
    },
  }
}

beforeEach(async () => {
  syncStore = {}
  localStore = {}
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { storage: { sync: area(() => syncStore), local: area(() => localStore) } } as unknown as typeof chrome,
  })
  await resetStats()
})

afterEach(() => {
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: originalChrome })
})

function event(partial: Partial<BlockEvent>): BlockEvent {
  return { hostname: 'news.example', source: 'dnr', category: 'script', count: 1, occurredAt: new Date().toISOString(), ...partial }
}

describe('stats bookkeeping', () => {
  it('loses nothing when several flushes land at once', async () => {
    await Promise.all(Array.from({ length: 20 }, () => recordBlockEvents([event({ bytesSaved: 1_000 })])))

    expect((await getLifetimeStats()).adsBlocked).toBe(20)
    const local = await getLocalStats()
    expect(local.sites['news.example'].adsBlocked).toBe(20)
    expect(local.daily.reduce((total, bucket) => total + bucket.adsBlocked, 0)).toBe(20)
  })

  it('mirrors lifetime totals to local storage on every write', async () => {
    await recordBlockEvents([event({ count: 3, bytesSaved: 9_000 })])
    expect((localStore.lifetime as { adsBlocked: number }).adsBlocked).toBe(3)
  })

  it('keeps retry-only events out of the site list and the recent log', async () => {
    await recordBlockEvents([event({ hostname: 'fresh.example', count: 0, bytesSaved: 4_000 })])

    const local = await getLocalStats()
    expect(local.sites['fresh.example']).toBeUndefined()
    expect(local.recentEvents).toEqual([])
    const lifetime = await getLifetimeStats()
    expect(lifetime.adsBlocked).toBe(0)
    expect(lifetime.bytesSaved).toBe(4_000)
  })

  it('credits a retry\'s bytes to a site already counted, without moving its last block', async () => {
    const first = event({ count: 1, bytesSaved: 1_000, occurredAt: '2026-11-16T10:00:00.000Z' })
    await recordBlockEvents([first])
    await recordBlockEvents([event({ count: 0, bytesSaved: 500, occurredAt: '2026-11-16T10:05:00.000Z' })])

    const site = (await getLocalStats()).sites['news.example']
    expect(site.bytesSaved).toBe(1_500)
    expect(site.lastBlockedAt).toBe('2026-11-16T10:00:00.000Z')
  })

  it('uses the same byte estimate for a site as for the lifetime total', async () => {
    await recordBlockEvents([event({ source: 'popup', category: 'document', bytesSaved: undefined })])

    const site = (await getLocalStats()).sites['news.example']
    expect(site.bytesSaved).toBeGreaterThan(0)
    expect(site.bytesSaved).toBe((await getLifetimeStats()).bytesSaved)
  })

  it('caps the per-site rollups, keeping the busiest', () => {
    const sites: Record<string, SiteStats> = {}
    for (let index = 0; index < 10; index++) {
      sites[`site-${index}.example`] = { hostname: `site-${index}.example`, adsBlocked: index, bytesSaved: 0, videoSecondsSaved: 0, lastBlockedAt: '2026-11-16T00:00:00.000Z' }
    }
    expect(Object.keys(capSiteRollups(sites, 3)).sort()).toEqual(['site-7.example', 'site-8.example', 'site-9.example'])
    expect(capSiteRollups(sites, 50)).toBe(sites)
  })
})
