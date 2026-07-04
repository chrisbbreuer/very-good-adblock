import { buildStaticRules } from '../src/rules/static-rules'
import generatedNetworkHosts from '../rules/generated/network-hosts.json'

// Chrome MV3 only guarantees this many *enabled* static declarativeNetRequest
// rules will load (chrome.declarativeNetRequest.GUARANTEED_MINIMUM_STATIC_RULES).
// Ship more and the browser may silently drop the overflow — the "native
// blocking" guarantee quietly stops holding for whatever falls off the end.
const GUARANTEED_MINIMUM_STATIC_RULES = 30_000

const rules = buildStaticRules()
const ids = new Set<number>()

if (generatedNetworkHosts.totalHosts < 1000) {
  throw new Error(`Generated host ruleset is too small: ${generatedNetworkHosts.totalHosts}`)
}

if (rules.length > GUARANTEED_MINIMUM_STATIC_RULES) {
  throw new Error(
    `Static ruleset has ${rules.length} rules, over Chrome's guaranteed static-rule limit of ${GUARANTEED_MINIMUM_STATIC_RULES}; the overflow may not load. `
    + 'Lower maxHostsPerSource in rules/filter-sources.json or split into additional rulesets.',
  )
}

if (rules.length > GUARANTEED_MINIMUM_STATIC_RULES * 0.9) {
  console.warn(`Warning: static ruleset is at ${rules.length}/${GUARANTEED_MINIMUM_STATIC_RULES} rules — approaching Chrome's guaranteed limit.`)
}

for (const rule of rules) {
  if (!Number.isInteger(rule.id) || rule.id < 1) throw new Error(`Invalid rule id: ${rule.id}`)
  if (ids.has(rule.id)) throw new Error(`Duplicate rule id: ${rule.id}`)
  ids.add(rule.id)
  if (!rule.condition.resourceTypes?.length) throw new Error(`Rule ${rule.id} has no resource types`)
  if (!rule.condition.urlFilter && !rule.condition.regexFilter) throw new Error(`Rule ${rule.id} has no URL matcher`)
}

console.log(`Validated ${rules.length} static DNR rules from ${generatedNetworkHosts.totalHosts} generated hosts`)
