import { describe, expect, it } from 'bun:test'
import { dynamicRuleEndId, dynamicRuleStartId } from '../src/shared/constants'
import { buildDynamicRules } from '../src/rules/dynamic-rules'
import { buildStaticRules, curatedRuleSeeds, redirectRuleSeeds } from '../src/rules/static-rules'
import { defaultSettings } from '../src/shared/storage'
import generatedNetworkHosts from '../src/rules/generated/network-hosts.json'

describe('rules', () => {
  it('builds unique static DNR rules from curated seeds', () => {
    const rules = buildStaticRules()
    const ids = new Set(rules.map(rule => rule.id))

    expect(generatedNetworkHosts.totalHosts).toBeGreaterThan(1000)
    expect(rules).toHaveLength(curatedRuleSeeds.length + redirectRuleSeeds.length + generatedNetworkHosts.totalHosts)
    expect(ids.size).toBe(rules.length)
    expect(rules.every(rule => rule.action.type === 'block' || rule.action.type === 'redirect')).toBe(true)
    expect(rules.every(rule => rule.condition.resourceTypes?.length)).toBe(true)
  })

  it('redirects ad SDK loaders to inert stubs at higher priority than blocks', () => {
    const rules = buildStaticRules()
    const redirects = rules.filter(rule => rule.action.type === 'redirect')

    expect(redirects).toHaveLength(redirectRuleSeeds.length)
    expect(redirects.every(rule => (rule.priority ?? 0) >= 2)).toBe(true)
    expect(redirects.every(rule => rule.action.redirect?.extensionPath?.startsWith('/stubs/'))).toBe(true)
  })

  it('builds bounded dynamic rules for allowed and blocked sites', () => {
    const rules = buildDynamicRules({
      ...defaultSettings,
      allowedSites: ['example.com'],
      blockedSites: ['ads.example.com'],
    })

    expect(rules).toHaveLength(2)
    expect(rules.every(rule => rule.id >= dynamicRuleStartId && rule.id <= dynamicRuleEndId)).toBe(true)
  })
})
