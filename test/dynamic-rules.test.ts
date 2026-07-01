import { describe, expect, it } from 'bun:test'
import { buildHostRefreshRules } from '../src/rules/dynamic-rules'
import { refreshRuleStartId } from '../src/shared/constants'

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
