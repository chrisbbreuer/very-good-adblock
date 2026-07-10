import { describe, expect, it } from 'bun:test'
import { newIssueUrl } from '../src/shared/constants'
import { buildAdReport, issueUrl, sanitizeUrl } from '../src/shared/report'
import type { DashboardState } from '../src/shared/types'

function dashboardState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    settings: {
      enabled: true,
      badgeEnabled: true,
      cosmeticFiltering: true,
      aggressiveCosmetic: false,
      cookieConsentFiltering: true,
      popupBlocking: true,
      youtubeEnhancements: true,
      twitchEnhancements: false,
      allowedSites: [],
      blockedSites: [],
    },
    lifetime: { adsBlocked: 4210, bytesSaved: 1024 * 1024, videoSecondsSaved: 600, since: '', lastUpdated: '' },
    local: { hourly: [], daily: [], sites: {}, recentEvents: [] },
    cloudSync: { available: false, dailyBuckets: 0, siteRollups: 0 },
    activeTab: { tabId: 7, hostname: 'youtube.com', url: 'https://youtube.com/watch?v=secret&t=42#frag', allowed: false, blocked: false },
    activePage: { blocked: 3, network: 2, content: 1 },
    dnr: { available: true, recentMatchedRules: 9, activeTabMatchedRules: 2, rulesetHits: {}, checkedAt: '' },
    cosmetic: { enabled: true, aggressive: false, activeTabHidden: 5, activeTabSelectors: [] },
    filters: {
      staticRuleCount: 12000,
      generatedHostRules: 90000,
      sources: [{ name: 'EasyList', revision: '2026.07.01', hosts: 50000, sha256: 'abc' }],
    },
    manifestVersion: '0.1.0',
    ...overrides,
  }
}

describe('report', () => {
  it('titles the issue after the active host', () => {
    expect(buildAdReport(dashboardState()).title).toBe('Ad got through on youtube.com')
  })

  it('falls back to a generic title with no active tab', () => {
    expect(buildAdReport(dashboardState({ activeTab: undefined })).title).toBe('Ad got through')
  })

  it('builds a GitHub new-issue URL with title, labels and body pre-filled', () => {
    const report = buildAdReport(dashboardState())
    expect(report.url.startsWith(`${newIssueUrl}?`)).toBe(true)

    const params = new URL(report.url).searchParams
    expect(params.get('title')).toBe('Ad got through on youtube.com')
    expect(params.get('labels')).toBe('ad-reached-user')
    expect(params.get('body')).toBe(report.body)
  })

  it('strips query strings and fragments from the reported page URL', () => {
    expect(sanitizeUrl('https://youtube.com/watch?v=secret&t=42#frag')).toBe('https://youtube.com/watch')
    const body = buildAdReport(dashboardState()).body
    expect(body).toContain('https://youtube.com/watch')
    expect(body).not.toContain('secret')
  })

  it('includes auto-collected diagnostics and the pasted-screenshot hint', () => {
    const body = buildAdReport(dashboardState(), { browser: 'Chrome 126 on macOS', screenshotCopied: true }).body
    expect(body).toContain('Very Good AdBlock v0.1.0')
    expect(body).toContain('Chrome 126 on macOS')
    expect(body).toContain('3 (2 network, 1 hidden)')
    expect(body).toContain('EasyList')
    expect(body).toContain('clipboard')
  })

  it('reports paused protection distinctly from off', () => {
    const paused = dashboardState({ settings: { ...dashboardState().settings, enabled: false, resumeAt: Date.now() + 60_000 } })
    expect(buildAdReport(paused).body).toContain('| Protection | Paused |')

    const off = dashboardState({ settings: { ...dashboardState().settings, enabled: false } })
    expect(buildAdReport(off).body).toContain('| Protection | Off |')
  })

  it('keeps the issue URL within GitHub limits even with many filter sources', () => {
    const sources = Array.from({ length: 200 }, (_, i) => ({ name: `List ${i} ${'x'.repeat(60)}`, revision: '2026.07.01', hosts: 1000, sha256: 'abc' }))
    const report = buildAdReport(dashboardState({ filters: { staticRuleCount: 1, generatedHostRules: 1, sources } }))
    expect(report.url.length).toBeLessThan(7000)
  })

  it('escapes pipes so a URL cannot break the diagnostics table', () => {
    const state = dashboardState({ activeTab: { hostname: 'a|b.com', url: 'https://a.com/x|y', allowed: false, blocked: false } })
    const body = buildAdReport(state).body
    expect(body).toContain('https://a.com/x\\|y')
  })

  it('exposes issueUrl for direct composition', () => {
    const url = issueUrl('Hi there', 'body & stuff', ['bug', 'ad-reached-user'])
    const params = new URL(url).searchParams
    expect(params.get('title')).toBe('Hi there')
    expect(params.get('body')).toBe('body & stuff')
    expect(params.get('labels')).toBe('bug,ad-reached-user')
  })
})
