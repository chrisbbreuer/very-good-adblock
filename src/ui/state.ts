import type { DashboardState } from '../shared/types'

/**
 * Fill every collection the popup/dashboard reads with a fallback. Extension
 * pages are loaded fresh from disk while the background worker keeps running
 * whatever code it started with — during development (or right after an
 * update) a new page can talk to an older worker that doesn't send fields
 * added later, and a single `undefined.length` would otherwise surface as a
 * raw error in the status line. Normalizing at the boundary keeps the UI
 * rendering no matter which side is ahead.
 */
export function normalizeDashboardState(state: DashboardState): DashboardState {
  const local = state.local
  const cosmetic = state.cosmetic
  const filters = state.filters
  const settings = state.settings

  return {
    ...state,
    settings: {
      ...settings,
      allowedSites: settings?.allowedSites ?? [],
      blockedSites: settings?.blockedSites ?? [],
    },
    lifetime: {
      adsBlocked: state.lifetime?.adsBlocked ?? 0,
      bytesSaved: state.lifetime?.bytesSaved ?? 0,
      videoSecondsSaved: state.lifetime?.videoSecondsSaved ?? 0,
      since: state.lifetime?.since ?? '',
      lastUpdated: state.lifetime?.lastUpdated ?? '',
    },
    local: {
      hourly: local?.hourly ?? [],
      daily: local?.daily ?? [],
      sites: local?.sites ?? {},
      recentEvents: local?.recentEvents ?? [],
    },
    cloudSync: {
      available: state.cloudSync?.available ?? false,
      syncedAt: state.cloudSync?.syncedAt,
      dailyBuckets: state.cloudSync?.dailyBuckets ?? 0,
      siteRollups: state.cloudSync?.siteRollups ?? 0,
    },
    activePage: state.activePage ?? { blocked: 0, network: 0, content: 0 },
    activePageBlocks: state.activePageBlocks ?? [],
    dnr: state.dnr ?? { available: false, recentMatchedRules: 0, activeTabMatchedRules: 0, rulesetHits: {}, checkedAt: '' },
    cosmetic: {
      enabled: cosmetic?.enabled ?? false,
      aggressive: cosmetic?.aggressive ?? false,
      activeTabHidden: cosmetic?.activeTabHidden ?? 0,
      activeTabSelectors: cosmetic?.activeTabSelectors ?? [],
    },
    filters: {
      staticRuleCount: filters?.staticRuleCount ?? 0,
      generatedHostRules: filters?.generatedHostRules ?? 0,
      sources: filters?.sources ?? [],
    },
    manifestVersion: state.manifestVersion ?? '',
  }
}
