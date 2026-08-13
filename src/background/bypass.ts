import { bypassRuleEndId, bypassRuleStartId, maxBypasses } from '../shared/constants'
import { bypassMinutes, safeNavigationUrl } from '../shared/blocked-page'
import { hostnameFromUrl, normalizeHostname } from '../shared/domain'

/**
 * One "Continue anyway" grant from the blocked-page interstitial: the user
 * asked for a page we stopped, so requests to that host are let through for a
 * short while instead of being permanently allow-listed. Kept in local storage
 * rather than only in dynamic rules because dynamic rules survive a browser
 * restart with no expiry of their own — the stored `expiresAt` is what makes
 * the grant temporary, and `pruneBypasses` enforces it.
 */
export interface BlockBypass {
  hostname: string
  expiresAt: number
}

export const bypassStorageKey = 'blockBypasses'

const bypassResourceTypes: chrome.declarativeNetRequest.ResourceType[] = [
  resourceType('main_frame'),
  resourceType('sub_frame'),
  resourceType('script'),
  resourceType('image'),
  resourceType('xmlhttprequest'),
  resourceType('media'),
  resourceType('font'),
  resourceType('stylesheet'),
]

/**
 * Allow requests *to* the bypassed host — not `allowAllRequests` on its frame
 * tree, which would also unblock every ad the page then asks for. The page and
 * its own assets load; third-party advertising on it stays blocked.
 *
 * Priority 30 clears the static/refresh host rules (1), the allow-list (10) and
 * the user's own block list (20), so an explicit "continue" wins over all of
 * them for as long as it lasts.
 */
export function buildBypassRules(entries: BlockBypass[]): chrome.declarativeNetRequest.Rule[] {
  return entries.slice(0, maxBypasses).map((entry, index) => ({
    id: bypassRuleStartId + index,
    priority: 30,
    action: { type: 'allow' as const },
    condition: {
      requestDomains: [normalizeHostname(entry.hostname)],
      resourceTypes: bypassResourceTypes,
    },
  }))
}

export function activeBypasses(entries: BlockBypass[], now: number): BlockBypass[] {
  return entries.filter(entry => entry.expiresAt > now)
}

/**
 * Let the user through to `url` for the next few minutes. Returns the URL to
 * navigate to, so the caller (and the interstitial) never has to re-derive it.
 */
export async function grantBypass(url: string, now: number = Date.now()): Promise<string> {
  const target = safeNavigationUrl(url)
  const hostname = target ? hostnameFromUrl(target) : ''
  if (!target || !hostname) throw new Error('Only http(s) pages can be unblocked')

  const stored = activeBypasses(await readBypasses(), now).filter(entry => entry.hostname !== hostname)
  // Newest last, and the oldest fall off the end: the rule range is bounded,
  // and a bypass nobody used in the last quarter hour is not worth keeping.
  const entries = [...stored, { hostname, expiresAt: now + bypassMinutes * 60_000 }].slice(-maxBypasses)

  await writeBypasses(entries)
  return target
}

/** Drop elapsed grants (and any rule left behind by a previous session). */
export async function pruneBypasses(now: number = Date.now()): Promise<BlockBypass[]> {
  const stored = await readBypasses()
  const entries = activeBypasses(stored, now)
  // Nothing granted and nothing stored: no rules of ours can exist either, so
  // skip the storage and rule writes entirely (this runs on every startup).
  if (!stored.length && !entries.length) return entries

  await writeBypasses(entries)
  return entries
}

export async function readBypasses(): Promise<BlockBypass[]> {
  try {
    const stored = await chrome.storage.local.get(bypassStorageKey)
    const entries = stored[bypassStorageKey]
    if (!Array.isArray(entries)) return []

    return entries.filter((entry): entry is BlockBypass =>
      Boolean(entry)
      && typeof (entry as BlockBypass).hostname === 'string'
      && typeof (entry as BlockBypass).expiresAt === 'number')
  }
  catch {
    return []
  }
}

/**
 * Storage and rules move together, and the rule set is rebuilt from the stored
 * list every time rather than patched, so the two can never drift — a grant
 * that is gone from storage cannot survive as a live allow rule.
 */
async function writeBypasses(entries: BlockBypass[]): Promise<void> {
  await chrome.storage.local.set({ [bypassStorageKey]: entries })

  const existing = await chrome.declarativeNetRequest.getDynamicRules()
  const removeRuleIds = existing
    .map(rule => rule.id)
    .filter(id => id >= bypassRuleStartId && id <= bypassRuleEndId)

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules: buildBypassRules(entries),
  })
}

function resourceType(value: string): chrome.declarativeNetRequest.ResourceType {
  return value as chrome.declarativeNetRequest.ResourceType
}
