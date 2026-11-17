import generatedNetworkHosts from './generated/network-hosts.json'
import { dynamicRuleStartId, refreshRuleEndId, refreshRuleStartId } from '../shared/constants'
import { curatedRuleSeeds } from './static-rules'

/** The id Chrome reports for matches against rules added at runtime. */
const dynamicRulesetId = '_dynamic'
const staticRulesetPrefix = 'very_good_adblock_static_rules'
/** Offset of the user's block-list rules inside the dynamic range (see dynamic-rules.ts). */
const blockedSiteRuleOffset = 300
const maxBlockedSiteRules = 200

export interface RuleAttributionContext {
  /** settings.blockedSites, in the order buildDynamicRules numbered them. */
  blockedSites: readonly string[]
  /** Refreshed host rules by id, from getDynamicRules() or the last refresh. */
  refreshHosts: ReadonlyMap<number, string>
}

/**
 * What a getMatchedRules entry blocked, or undefined when the match was not a
 * block at all.
 *
 * getMatchedRules reports every rule that matched, and most of ours that are
 * not blocks match constantly: allowAllRequests for allow-listed sites and for
 * pause, the document allows that accompany them, the SMS navigation allows,
 * "Continue anyway" bypasses and the script redirects. Counting those as
 * blocked requests inflated the reconciliation, so only block-action ranges
 * qualify. The entry carries no request URL, so the host comes from the rule
 * itself: every block rule we write is a single `||host^` filter.
 */
export function attributeBlockRule(ruleId: number, rulesetId: string, context: RuleAttributionContext): { host?: string } | undefined {
  if (rulesetId.startsWith(staticRulesetPrefix)) {
    if (ruleId >= 1 && ruleId <= curatedRuleSeeds.length) {
      const seed = curatedRuleSeeds.find(candidate => candidate.id === ruleId)
      return { host: seed ? hostOfUrlFilter(seed.urlFilter) || undefined : undefined }
    }

    const generatedIndex = ruleId - curatedRuleSeeds.length - 1
    if (generatedIndex >= 0 && generatedIndex < generatedNetworkHosts.hosts.length)
      return { host: generatedNetworkHosts.hosts[generatedIndex] }

    // Redirect stubs and navigation allows live above the generated range.
    return undefined
  }

  if (rulesetId === dynamicRulesetId) {
    const blockedIndex = ruleId - dynamicRuleStartId - blockedSiteRuleOffset
    if (blockedIndex >= 0 && blockedIndex < maxBlockedSiteRules)
      return { host: context.blockedSites[blockedIndex] }

    if (ruleId >= refreshRuleStartId && ruleId <= refreshRuleEndId)
      return { host: context.refreshHosts.get(ruleId) }
  }

  return undefined
}

/** Extract the host from a `||host^` filter; path and URL filters yield ''. */
export function hostOfUrlFilter(urlFilter: string): string {
  if (!urlFilter.startsWith('||')) return ''
  const caret = urlFilter.indexOf('^')
  const value = urlFilter.slice(2, caret < 0 ? undefined : caret).toLowerCase()
  return value.includes('/') ? '' : value
}
