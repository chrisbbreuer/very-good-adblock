import generatedNetworkHosts from './generated/network-hosts.json'
import { normalizeHostname } from '../shared/domain'
import { isProtectedSearchHost } from '../shared/search-navigation'
import { curatedRuleSeeds } from './static-rules'

/**
 * Lookup set of every host our network rules block, used where rule matches are
 * not directly observable. declarativeNetRequest reports matches only through
 * onRuleMatchedDebug (unpacked installs) and the quota-limited getMatchedRules,
 * so the background falls back to this set when deciding whether a failed
 * request failed because of us (see the webRequest error listener).
 *
 * Hosts are stored as registered domains; a lookup walks parent domains, so a
 * rule for `ads.example.com` also matches `cdn.ads.example.com` — mirroring the
 * `||host^` urlFilter semantics of the rules themselves.
 */
const blockedHosts = new Set<string>()

for (const host of generatedNetworkHosts.hosts) {
  if (host) blockedHosts.add(host)
}

for (const seed of curatedRuleSeeds) {
  const host = hostOfUrlFilter(seed.urlFilter)
  if (host) blockedHosts.add(host)
}

/** Extract the host from a `||host^` filter; path/URL filters yield ''. */
function hostOfUrlFilter(urlFilter: string): string {
  if (!urlFilter.startsWith('||')) return ''
  const caret = urlFilter.indexOf('^')
  return urlFilter.slice(2, caret < 0 ? undefined : caret).toLowerCase()
}

/** Whether our network rules block this hostname (or one of its parents). */
export function isBlockedHost(hostname: string): boolean {
  let current = normalizeHostname(hostname)
  if (isProtectedSearchHost(current)) return false

  while (current) {
    if (blockedHosts.has(current)) return true
    const dot = current.indexOf('.')
    if (dot < 0) return false
    current = current.slice(dot + 1)
  }
  return false
}

/**
 * Merge extra hosts (e.g. the scheduled filter refresh, which lands as dynamic
 * rules after the shipped set was built) into the lookup.
 */
export function addBlockedHosts(hosts: readonly string[]): void {
  for (const host of hosts) {
    if (host && !isProtectedSearchHost(host)) blockedHosts.add(host.trim().toLowerCase())
  }
}
