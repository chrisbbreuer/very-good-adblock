import { describe, expect, it } from 'bun:test'
import generatedNetworkHosts from '../src/rules/generated/network-hosts.json'
import { navigationRuleStartId } from '../src/rules/navigation'
import { attributeBlockRule, hostOfUrlFilter } from '../src/rules/rule-attribution'
import { curatedRuleSeeds } from '../src/rules/static-rules'
import { bypassRuleStartId, dynamicRuleStartId, refreshRuleStartId } from '../src/shared/constants'

const context = {
  blockedSites: ['annoying.example', 'second.example'],
  refreshHosts: new Map([[refreshRuleStartId + 5, 'fresh-tracker.example']]),
}
const staticRuleset = 'very_good_adblock_static_rules'

describe('getMatchedRules attribution', () => {
  it('names the host a curated block rule covers', () => {
    expect(attributeBlockRule(1, staticRuleset, context)).toEqual({ host: 'doubleclick.net' })
  })

  it('keeps a curated path rule as a block without inventing a host', () => {
    const pathSeed = curatedRuleSeeds.find(seed => !hostOfUrlFilter(seed.urlFilter))!
    expect(attributeBlockRule(pathSeed.id, staticRuleset, context)).toEqual({ host: undefined })
  })

  it('maps a generated rule id back to its host, in any ruleset chunk', () => {
    const id = curatedRuleSeeds.length + 1
    expect(attributeBlockRule(id, staticRuleset, context)).toEqual({ host: generatedNetworkHosts.hosts[0] })
    expect(attributeBlockRule(id + 12_000, `${staticRuleset}_2`, context)).toEqual({ host: generatedNetworkHosts.hosts[12_000] })
  })

  it('ignores the navigation allows and script redirects in the static rulesets', () => {
    expect(attributeBlockRule(navigationRuleStartId, `${staticRuleset}_3`, context)).toBeUndefined()
    expect(attributeBlockRule(90_000, staticRuleset, context)).toBeUndefined()
  })

  it('counts the user block list and refreshed hosts among dynamic rules', () => {
    expect(attributeBlockRule(dynamicRuleStartId + 300, '_dynamic', context)).toEqual({ host: 'annoying.example' })
    expect(attributeBlockRule(dynamicRuleStartId + 301, '_dynamic', context)).toEqual({ host: 'second.example' })
    expect(attributeBlockRule(refreshRuleStartId + 5, '_dynamic', context)).toEqual({ host: 'fresh-tracker.example' })
  })

  it('ignores allowlist, pause, document-allow and bypass rules', () => {
    expect(attributeBlockRule(dynamicRuleStartId, '_dynamic', context)).toBeUndefined()
    expect(attributeBlockRule(dynamicRuleStartId + 250, '_dynamic', context)).toBeUndefined()
    expect(attributeBlockRule(dynamicRuleStartId + 500, '_dynamic', context)).toBeUndefined()
    expect(attributeBlockRule(bypassRuleStartId, '_dynamic', context)).toBeUndefined()
  })
})
