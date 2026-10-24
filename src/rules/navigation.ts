import { siteMatches } from '../shared/domain'

/**
 * These tracker hosts also carry links people explicitly open from messages.
 * Allow only the top-level document so the redirect can reach its destination;
 * embedded scripts, pixels and frames remain subject to the normal block list.
 */
export const navigationHosts: string[] = ['attn.tv']
export const navigationRuleStartId = 91_000

export function isNavigationHost(hostname: string): boolean {
  return siteMatches(hostname, navigationHosts)
}

export function isNavigationAllowRule(ruleId: number): boolean {
  return ruleId >= navigationRuleStartId && ruleId < navigationRuleStartId + navigationHosts.length
}
