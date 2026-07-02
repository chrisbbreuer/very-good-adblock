import { describe, expect, it } from 'bun:test'
import { buildDynamicRules, buildHostRefreshRules } from '../src/rules/dynamic-rules'
import { refreshRuleStartId } from '../src/shared/constants'
import { defaultSettings } from '../src/shared/storage'

describe('buildDynamicRules', () => {
  it('emits per-site allow/block rules when protection is enabled', () => {
    const rules = buildDynamicRules({ ...defaultSettings, enabled: true, allowedSites: ['example.com'], blockedSites: ['ads.test'] })

    expect(rules.some(rule => rule.action.type === 'allowAllRequests' && rule.condition?.initiatorDomains?.includes('example.com'))).toBe(true)
    expect(rules.some(rule => rule.action.type === 'block' && rule.condition?.requestDomains?.includes('ads.test'))).toBe(true)
    // No global bypass while enabled.
    expect(rules.some(rule => rule.action.type === 'allowAllRequests' && !rule.condition?.initiatorDomains)).toBe(false)
  })

  it('replaces all rules with a single global allow bypass when protection is off', () => {
    const rules = buildDynamicRules({ ...defaultSettings, enabled: false, allowedSites: ['example.com'], blockedSites: ['ads.test'] })

    expect(rules).toHaveLength(1)
    expect(rules[0].action.type).toBe('allowAllRequests')
    expect(rules[0].priority).toBeGreaterThan(20)
    expect(rules[0].condition?.resourceTypes).toEqual(['main_frame', 'sub_frame'])
    expect(rules[0].condition?.initiatorDomains).toBeUndefined()
  })
})

describe('buildHostRefreshRules', () => {
  it('builds block rules for clean hosts starting at the reserved id', () => {
    const rules = buildHostRefreshRules(['ads.example.com', 'track.example.net'])

    expect(rules).toHaveLength(2)
    expect(rules[0].id).toBe(refreshRuleStartId)
    expect(rules[1].id).toBe(refreshRuleStartId + 1)
    expect(rules[0].action.type).toBe('block')
    expect(rules[0].condition?.urlFilter).toBe('||ads.example.com^')
    expect(rules[0].condition?.resourceTypes).toContain('script')
  })

  it('dedupes, lowercases, and drops invalid host entries', () => {
    const rules = buildHostRefreshRules([
      'Ads.Example.com',
      'ads.example.com',
      '',
      '# comment',
      'localhost',
      'has space.com',
      'good.example.org',
    ])

    expect(rules.map(rule => rule.condition?.urlFilter)).toEqual([
      '||ads.example.com^',
      '||good.example.org^',
    ])
  })

  it('excludes hosts already shipped in the static ruleset', () => {
    const rules = buildHostRefreshRules(['already.shipped.com', 'fresh.example.com'], {
      exclude: new Set(['already.shipped.com']),
    })

    expect(rules).toHaveLength(1)
    expect(rules[0].condition?.urlFilter).toBe('||fresh.example.com^')
  })

  it('caps the number of rules to stay within the dynamic budget', () => {
    const hosts = Array.from({ length: 50 }, (_, index) => `host-${index}.example.com`)
    const rules = buildHostRefreshRules(hosts, { max: 10, startId: 60000 })

    expect(rules).toHaveLength(10)
    expect(rules.at(-1)?.id).toBe(60009)
  })
})
