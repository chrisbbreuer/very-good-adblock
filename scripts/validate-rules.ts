import { buildStaticRules } from '../src/rules/static-rules'
import generatedNetworkHosts from '../rules/generated/network-hosts.json'

const rules = buildStaticRules()
const ids = new Set<number>()

if (generatedNetworkHosts.totalHosts < 1000) {
  throw new Error(`Generated host ruleset is too small: ${generatedNetworkHosts.totalHosts}`)
}

for (const rule of rules) {
  if (!Number.isInteger(rule.id) || rule.id < 1) throw new Error(`Invalid rule id: ${rule.id}`)
  if (ids.has(rule.id)) throw new Error(`Duplicate rule id: ${rule.id}`)
  ids.add(rule.id)
  if (!rule.condition.resourceTypes?.length) throw new Error(`Rule ${rule.id} has no resource types`)
  if (!rule.condition.urlFilter && !rule.condition.regexFilter) throw new Error(`Rule ${rule.id} has no URL matcher`)
}

console.log(`Validated ${rules.length} static DNR rules from ${generatedNetworkHosts.totalHosts} generated hosts`)
