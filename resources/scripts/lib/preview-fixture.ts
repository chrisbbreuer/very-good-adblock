/**
 * Shared seeded dashboard fixture for the headless-render scripts (store
 * screenshots and the marketing popup preview). One source of truth so both
 * surfaces show the same believable numbers, and a product-formatting change
 * (e.g. video time in hours) shows up everywhere at once.
 */
import type { DashboardState } from '../../../src/shared/types'

/** A chrome.runtime mock that answers the popup/options message calls. */
export function shimScript(state: DashboardState): string {
  return `<script>(function(){
  var state = ${JSON.stringify(state)};
  var clone = function(v){ return JSON.parse(JSON.stringify(v)); };
  window.chrome = { runtime: {
    openOptionsPage: function(){},
    sendMessage: async function(m){
      if (m.type === 'get-dashboard') return { ok: true, data: clone(state) };
      if (m.type === 'set-settings') { state.settings = Object.assign({}, state.settings, m.settings); return { ok: true, data: clone(state) }; }
      return { ok: true, data: true };
    }
  } };
}());</script>`
}

/** Inject the shim just before </head> so it runs before the page scripts. */
export function injectShim(markup: string, shim: string): string {
  return markup.replace('</head>', `${shim}</head>`)
}

export function dashboardState(): DashboardState {
  const now = new Date('2026-07-02T18:24:00.000Z')
  const iso = now.toISOString()
  const bucket = (offsetHours: number, value: number) => ({ key: new Date(now.getTime() - offsetHours * 3600_000).toISOString().slice(0, 13), adsBlocked: value, bytesSaved: value * 240_000, videoSecondsSaved: 0 })
  const hourly = [4, 9, 6, 12, 8, 14, 7, 18, 11, 22, 16, 27, 19, 31, 24, 38, 29, 44, 33, 52, 41, 63, 47, 76].map((v, i) => bucket(23 - i, v))
  const daily = Array.from({ length: 60 }, (_, i) => ({ key: new Date(now.getTime() - (59 - i) * 86_400_000).toISOString().slice(0, 10), adsBlocked: 300 + Math.round(500 * Math.abs(Math.sin(i * 0.7))) + (i % 7 === 0 ? 260 : 0), bytesSaved: 0, videoSecondsSaved: 0 }))

  return {
    settings: { enabled: true, badgeEnabled: true, cosmeticFiltering: true, aggressiveCosmetic: false, cookieConsentFiltering: true, popupBlocking: true, youtubeEnhancements: true, twitchEnhancements: true, allowedSites: ['stripe.com'], blockedSites: [] },
    lifetime: { adsBlocked: 52_914, bytesSaved: 9_019_431_000, videoSecondsSaved: 70_560, since: new Date(now.getTime() - 96 * 86_400_000).toISOString(), lastUpdated: iso },
    local: {
      hourly,
      daily,
      recentEvents: [
        { hostname: 'youtube.com', source: 'video', category: 'media', count: 6, occurredAt: iso },
        { hostname: 'theverge.com', source: 'dnr', category: 'script', count: 21, occurredAt: iso },
        { hostname: 'x.com', source: 'x', category: 'other', count: 9, occurredAt: iso },
        { hostname: 'footybite.app', source: 'popup', category: 'other', count: 12, occurredAt: iso },
      ],
      sites: {
        'youtube.com': { hostname: 'youtube.com', adsBlocked: 4_812, bytesSaved: 3_400_000_000, videoSecondsSaved: 41_200, lastBlockedAt: iso },
        'theverge.com': { hostname: 'theverge.com', adsBlocked: 1_944, bytesSaved: 880_000_000, videoSecondsSaved: 0, lastBlockedAt: iso },
        'x.com': { hostname: 'x.com', adsBlocked: 1_207, bytesSaved: 120_000_000, videoSecondsSaved: 0, lastBlockedAt: iso },
      },
    },
    cloudSync: { available: true, syncedAt: iso, dailyBuckets: 60, siteRollups: 3 },
    activeTab: {
      hostname: 'theverge.com',
      url: 'https://www.theverge.com/',
      favIconUrl: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect width=%2232%22 height=%2232%22 rx=%227%22 fill=%22%23111%22/%3E%3Cpath d=%22M8 10h16v3H8zm0 6h11v3H8z%22 fill=%22%23e5ff4f%22/%3E%3C/svg%3E',
      allowed: false,
      blocked: false,
    },
    activePage: { blocked: 47, network: 39, content: 8 },
    activePageBlocks: [
      { kind: 'network', label: 'doubleclick.net', detail: 'script', count: 14, at: iso },
      { kind: 'network', label: 'googlesyndication.com', detail: 'script', count: 9, at: iso },
      { kind: 'cosmetic', label: 'ins.adsbygoogle', count: 4, at: iso },
      { kind: 'cosmetic', label: '[id^="div-gpt-ad"]', count: 4, at: iso },
      { kind: 'network', label: 'amazon-adsystem.com', detail: 'xhr', count: 6, at: iso },
      { kind: 'popup', label: 'tracking.example', count: 2, at: iso },
      { kind: 'network', label: 'taboola.com', detail: 'image', count: 5, at: iso },
    ],
    dnr: { available: true, recentMatchedRules: 47, activeTabMatchedRules: 39, rulesetHits: { very_good_adblock_static_rules: 47 }, checkedAt: iso },
    cosmetic: { enabled: true, aggressive: false, activeTabHidden: 8, activeTabSelectors: [{ selector: 'ins.adsbygoogle', count: 4 }, { selector: '[id^="div-gpt-ad"]', count: 4 }] },
    filters: { staticRuleCount: 14_421, generatedHostRules: 14_387, sources: [{ name: 'EasyList', revision: 'pinned', hosts: 12_000, sha256: 'preview' }, { name: 'AdGuard', revision: 'pinned', hosts: 2_387, sha256: 'preview' }] },
    manifestVersion: '0.1.0',
  }
}
