import { dynamicRuleEndId, dynamicRuleStartId, maxRefreshRules, refreshRuleStartId } from '../shared/constants'
import { normalizeHostname } from '../shared/domain'
import { isProtectedSearchHost } from '../shared/search-navigation'
import type { ExtensionSettings } from '../shared/types'

let syncQueue = Promise.resolve()

// Kept in lockstep with the static host rules: subresources plus top-level
// documents, so refreshed pop-under hosts die as whole tabs too.
const refreshResourceTypes: chrome.declarativeNetRequest.ResourceType[] = [
  resourceType('main_frame'),
  resourceType('script'),
  resourceType('image'),
  resourceType('xmlhttprequest'),
  resourceType('sub_frame'),
  resourceType('media'),
  resourceType('font'),
  resourceType('stylesheet'),
]

export interface HostRefreshOptions {
  exclude?: Set<string>
  startId?: number
  max?: number
}

/**
 * Turn a fetched host list into block rules for the reserved refresh ID range.
 * Hosts already shipped in the static ruleset are excluded so the refresh only
 * adds what is genuinely new since the build, and the result is deduped, sanity
 * checked, and capped to stay inside the dynamic-rule budget.
 */
export function buildHostRefreshRules(hosts: string[], options: HostRefreshOptions = {}): chrome.declarativeNetRequest.Rule[] {
  const startId = options.startId ?? refreshRuleStartId
  const max = options.max ?? maxRefreshRules
  const exclude = options.exclude
  const seen = new Set<string>()
  const rules: chrome.declarativeNetRequest.Rule[] = []

  for (const raw of hosts) {
    const host = raw.trim().toLowerCase()
    if (!isBlockableHost(host) || isProtectedSearchHost(host) || seen.has(host) || exclude?.has(host)) continue
    seen.add(host)
    rules.push({
      id: startId + rules.length,
      priority: 1,
      action: { type: 'block' as const },
      condition: { urlFilter: `||${host}^`, resourceTypes: refreshResourceTypes },
    })
    if (rules.length >= max) break
  }

  return rules
}

function isBlockableHost(host: string): boolean {
  return host.length > 0 && host.length < 254 && host.includes('.') && /^[a-z0-9.-]+$/.test(host)
}

function ruleId(offset: number): number {
  return dynamicRuleStartId + offset
}

export function buildDynamicRules(settings: ExtensionSettings): chrome.declarativeNetRequest.Rule[] {
  // Protection off: a single high-priority allowAllRequests rule whitelists every
  // frame tree, so it overrides the static host ruleset, the block-site rules, and
  // the refresh rules without having to toggle each ruleset. Re-enabling rebuilds
  // the normal set below.
  if (!settings.enabled) {
    return [{
      id: ruleId(250),
      priority: 100,
      action: { type: 'allowAllRequests' as const },
      condition: {
        resourceTypes: [
          resourceType('main_frame'),
          resourceType('sub_frame'),
        ],
      },
    }]
  }

  const allowedRules = settings.allowedSites.slice(0, 200).map((hostname, index) => ({
    id: ruleId(index),
    priority: 10,
    action: { type: 'allowAllRequests' as const },
    condition: {
      initiatorDomains: [normalizeHostname(hostname)],
      resourceTypes: [
        resourceType('main_frame'),
        resourceType('sub_frame'),
      ],
    },
  }))

  const blockedRules = settings.blockedSites.slice(0, 200).map((hostname, index) => ({
    id: ruleId(300 + index),
    priority: 20,
    action: { type: 'block' as const },
    condition: {
      requestDomains: [normalizeHostname(hostname)],
      resourceTypes: [
        resourceType('main_frame'),
        resourceType('sub_frame'),
        resourceType('script'),
        resourceType('image'),
        resourceType('xmlhttprequest'),
        resourceType('media'),
      ],
    },
  }))

  return [...allowedRules, ...blockedRules]
}

function resourceType(value: string): chrome.declarativeNetRequest.ResourceType {
  return value as chrome.declarativeNetRequest.ResourceType
}

export async function syncDynamicRules(settings: ExtensionSettings): Promise<void> {
  syncQueue = syncQueue.catch(() => undefined).then(() => applyDynamicRules(settings))
  await syncQueue
}

async function applyDynamicRules(settings: ExtensionSettings): Promise<void> {
  const existing = await chrome.declarativeNetRequest.getDynamicRules()
  const removeRuleIds = existing
    .map(rule => rule.id)
    .filter(id => id >= dynamicRuleStartId && id <= dynamicRuleEndId)

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules: buildDynamicRules(settings),
  })
}
