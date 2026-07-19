import { describe, expect, it } from 'bun:test'
import type { DashboardState } from '../src/shared/types'
import { normalizeDashboardState } from '../src/ui/state'

describe('normalizeDashboardState', () => {
  it('fills fields missing from an older worker’s response', () => {
    // A state as sent by a background worker that predates activePageBlocks
    // and the cosmetic/dnr/filter fields — every collection is absent.
    const partial = {
      settings: { enabled: true },
      lifetime: {},
      local: {},
      manifestVersion: '0.1.1',
    } as unknown as DashboardState

    const state = normalizeDashboardState(partial)

    expect(state.activePageBlocks).toEqual([])
    expect(state.local.hourly).toEqual([])
    expect(state.local.daily).toEqual([])
    expect(state.local.sites).toEqual({})
    expect(state.local.recentEvents).toEqual([])
    expect(state.settings.allowedSites).toEqual([])
    expect(state.settings.blockedSites).toEqual([])
    expect(state.cosmetic.activeTabSelectors).toEqual([])
    expect(state.filters.sources).toEqual([])
    expect(state.activePage).toEqual({ blocked: 0, network: 0, content: 0 })
    expect(state.dnr.available).toBe(false)
    expect(state.cloudSync.dailyBuckets).toBe(0)
    expect(state.lifetime.adsBlocked).toBe(0)
  })

  it('keeps the values a current worker sends', () => {
    const full = {
      local: { hourly: [{ key: 'h', adsBlocked: 1, bytesSaved: 1, videoSecondsSaved: 0 }] },
      activePageBlocks: [{ kind: 'network', label: 'ads.example', count: 2, at: 'now' }],
      cosmetic: { activeTabSelectors: [{ selector: '.ad', count: 1 }] },
    } as unknown as DashboardState

    const state = normalizeDashboardState(full)

    expect(state.local.hourly).toHaveLength(1)
    expect(state.activePageBlocks).toHaveLength(1)
    expect(state.cosmetic.activeTabSelectors).toHaveLength(1)
  })
})
