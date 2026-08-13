import { describe, expect, it } from 'bun:test'
import { dynamicRuleEndId, dynamicRuleStartId } from '../src/shared/constants'
import { buildDynamicRules } from '../src/rules/dynamic-rules'
import { buildStaticRuleset, buildStaticRules, curatedRuleSeeds, redirectRuleSeeds, staticRulesetCount } from '../src/rules/static-rules'
import extensionConfig from '../config/extension'
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

  it('covers the programmatic ad stack across the whole alphabet', () => {
    // The generated list is budget-capped, and it used to be capped by slicing
    // a *sorted* list — which silently dropped every ad network from the cut
    // letter onward. These are real hosts observed serving ads on European
    // publishers, spread past the old cut point, so an alphabetical truncation
    // regression fails here instead of shipping.
    const hosts = new Set(generatedNetworkHosts.hosts)
    const covered = (host: string): boolean => {
      const parts = host.split('.')
      for (let index = 0; index < parts.length - 1; index++) {
        if (hosts.has(parts.slice(index).join('.'))) return true
      }
      return false
    }

    for (const host of [
      'ap.lijit.com',
      'btlr.sharethrough.com',
      'cdn-a.yieldlove.com',
      'g2.gumgum.com',
      'hbx.media.net',
      'ih.adscale.de',
      'prebid.smilewanted.com',
      's.seedtag.com',
      's2s.yieldlove-ad-serving.net',
      'sync.smartadserver.com',
      'sync.srv.stackadapt.com',
      't.visx.net',
      'a.teads.tv',
      'x.bidswitch.net',
    ]) {
      expect(covered(host)).toBe(true)
    }
  })

  it('keeps a curated floor under the European ad stack', () => {
    const filters = curatedRuleSeeds.map(seed => seed.urlFilter)

    // Not in any upstream list we ship, but the head of the chain on German
    // publishers — losing these means every downstream SSP gets called.
    expect(filters).toContain('||stroeerdigitalgroup.de/metatag/')
    expect(filters).toContain('||nativendo.de^')
    expect(filters).toContain('||notifpush.com^')
  })

  it('blocks first-party ad-creative proxying without touching page images', () => {
    const proxy = curatedRuleSeeds.find(seed => seed.urlFilter === '||transfermarkt.de/image/')

    // Only images: the same origin serves the documents and APIs of the site
    // itself, so a broader rule here would take the page down with the ads.
    expect(proxy).toBeDefined()
    expect(proxy?.resourceTypes?.map(String)).toEqual(['image'])
  })

  it('splits the ruleset into files that cover every rule exactly once', () => {
    const all = buildStaticRules()
    const chunks = Array.from({ length: staticRulesetCount() }, (_, index) => buildStaticRuleset(index))
    const rejoined = chunks.flat()

    // A dropped or double-counted chunk is invisible at runtime until a rule
    // silently stops blocking, so assert the split is lossless.
    expect(rejoined).toHaveLength(all.length)
    expect(rejoined.map(rule => rule.id)).toEqual(all.map(rule => rule.id))
    expect(new Set(rejoined.map(rule => rule.id)).size).toBe(all.length)

    // Every chunk must have a ruleset entry in the manifest config, or its
    // rules never ship.
    expect(extensionConfig.rules).toHaveLength(chunks.length)
  })

  it('keeps every ruleset file under the size addons.mozilla.org will parse', () => {
    // AMO rejects the whole submission with "File is too large to parse" over
    // 5 MB, which is how v0.2.7 failed to reach Firefox.
    for (let index = 0; index < staticRulesetCount(); index++) {
      const bytes = Buffer.byteLength(`${JSON.stringify(buildStaticRuleset(index), null, 2)}\n`)
      expect(bytes).toBeLessThan(5 * 1024 * 1024)
    }
  })

  it('builds bounded dynamic rules for allowed and blocked sites', () => {
    const rules = buildDynamicRules({
      ...defaultSettings,
      allowedSites: ['example.com'],
      blockedSites: ['ads.example.com'],
    })

    // Per allowed site: one initiator-scoped allowAllRequests plus the
    // navigation allow that makes the host itself reachable. Per blocked site:
    // one block rule.
    expect(rules).toHaveLength(3)
    expect(rules.every(rule => rule.id >= dynamicRuleStartId && rule.id <= dynamicRuleEndId)).toBe(true)
  })
})
