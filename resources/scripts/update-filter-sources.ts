import { createHash } from 'node:crypto'
import sourceConfig from '../../src/rules/filter-sources.json'

interface FilterSource {
  name: string
  repository: string
  revision: string
  path: string
  license: string
  homepage: string
  /**
   * Marks a source whose bulk is disposable throwaway domains (EasyList's
   * ad-servers section is ~49k entries, most of them single-use scam/pop-up
   * hosts). Entries from these sources are the first to be dropped when the
   * host budget runs out — see `rankOf`.
   */
  longTail?: boolean
}

interface GeneratedSource extends FilterSource {
  url: string
  sha256: string
  /** Hosts parsed out of the source text. */
  hosts: number
  /** How many of those actually made it into the shipped set. */
  kept: number
}

const hostPattern = /^\|\|([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(?:[\^/]|$)(?:\$([a-z0-9,~_-]+))?$/i
const ignoredOptions = ['badfilter', 'csp', 'document', 'elemhide', 'generichide', 'genericblock', 'popup', 'redirect', 'replace']

/**
 * Ranking exists because the ad-servers section is ~49k hosts and the DNR
 * budget is ~29k: something has to give. What must NOT decide it is the sort
 * order — truncating an alphabetical list silently drops every ad network from
 * the cut letter onward (that is how `smartadserver`, `teads`, `yieldlove` and
 * the rest of the s–z programmatic stack once fell off the end).
 *
 * So entries are ranked by how much blocking value a rule buys:
 *   0  curated/tracker lists — small, hand-maintained, all high value
 *   1  ad-servers entries that look like real infrastructure
 *   2  ad-servers entries whose name looks machine-generated
 *   3  ad-servers entries on registration-churn TLDs
 * and only the bottom ranks are exposed to the budget cut.
 */
const rankCurated = 0
const rankInfrastructure = 1
const rankGenerated = 2
const rankChurn = 3

/**
 * Registration-churn TLDs. Ad-server lists carry thousands of one-shot domains
 * on these (`vqxkzm.cfd`, `zzzmjfixezere.site`) that are dead within weeks,
 * while the ad networks that actually serve the web sit on .com/.net/.io/ccTLDs.
 * Both classes cost one DNR rule each, so under a fixed budget the churn TLDs
 * are what we give up first.
 */
const churnTlds = new Set([
  'autos', 'bar', 'beauty', 'bond', 'boats', 'buzz', 'cam', 'cfd', 'cf', 'christmas', 'click', 'cyou',
  'fun', 'ga', 'gdn', 'gq', 'hair', 'homes', 'icu', 'lat', 'live', 'lol', 'makeup', 'ml', 'mom',
  'monster', 'motorcycles', 'one', 'online', 'pro', 'pw', 'quest', 'racing', 'rest', 'sbs', 'shop',
  'site', 'skin', 'space', 'store', 'tk', 'top', 'uno', 'website', 'work', 'ws', 'xyz', 'yachts',
])

const maxHosts = sourceConfig.maxHosts
const ranked = new Map<string, number>()
const generatedSources: GeneratedSource[] = []
const hostsBySource = new Map<string, string[]>()

for (const source of sourceConfig.sources as FilterSource[]) {
  const url = `https://raw.githubusercontent.com/${source.repository}/${source.revision}/${source.path}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${source.name}: ${response.status} ${response.statusText}`)

  const text = await response.text()
  const sourceHosts = extractHosts(text)
  hostsBySource.set(source.name, sourceHosts)
  for (const host of sourceHosts) {
    const rank = rankOf(source, host)
    const current = ranked.get(host)
    if (current === undefined || rank < current) ranked.set(host, rank)
  }

  generatedSources.push({
    ...source,
    url,
    sha256: createHash('sha256').update(text).digest('hex'),
    hosts: sourceHosts.length,
    kept: 0,
  })
}

// `||example.com^` already matches every subdomain, so a listed host whose
// parent is listed too is a rule that can never fire on its own.
const listed = new Set(ranked.keys())
for (const host of listed) {
  if (parentOf(host, listed)) ranked.delete(host)
}
const redundant = listed.size - ranked.size

// Rank first (that decides what survives the budget), then emit alphabetically
// so the committed file diffs cleanly between runs.
const selected = [...ranked]
  .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
  .slice(0, maxHosts)
  .map(([host]) => host)
const dropped = ranked.size - selected.length
const hosts = selected.sort()
const kept = new Set(hosts)

for (const source of generatedSources)
  source.kept = (hostsBySource.get(source.name) ?? []).filter(host => kept.has(host)).length

await Bun.write('src/rules/generated/network-hosts.json', `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  totalHosts: hosts.length,
  hosts,
  sources: generatedSources,
}, null, 2)}\n`)

console.log(`Generated ${hosts.length} pinned network hosts from ${generatedSources.length} sources`)
console.log(`  ${redundant} host(s) dropped as already covered by a listed parent domain`)
// Never let the budget truncate silently: a quiet cut is how the shipped list
// ends up alphabetically clipped without anyone noticing.
if (dropped > 0) console.warn(`  ${dropped} host(s) dropped by the ${maxHosts}-host budget (lowest-ranked first)`)

function rankOf(source: FilterSource, host: string): number {
  if (!source.longTail) return rankCurated
  if (churnTlds.has(host.slice(host.lastIndexOf('.') + 1))) return rankChurn
  return looksGenerated(host) ? rankGenerated : rankInfrastructure
}

/**
 * Throwaway ad hosts are minted in bulk from random strings (`000491b06a.com`,
 * `dsbsmooohjuon.online`); the networks worth spending a rule on are named
 * things a human typed (`smartadserver.com`, `yieldlove.com`). Judge only the
 * leftmost label: mixed letters-and-digits, no vowels, or a long consonant run
 * are all things generators produce and brand names do not.
 */
function looksGenerated(host: string): boolean {
  const label = host.slice(0, host.indexOf('.'))
  if (label.length < 6 || !/^[a-z0-9]+$/.test(label)) return false
  const mixesDigits = /\d/.test(label) && /[a-z]/.test(label)
  return mixesDigits || !/[aeiou]/.test(label) || /[bcdfghjklmnpqrstvwxz]{5,}/.test(label)
}

function parentOf(host: string, listed: Set<string>): string | undefined {
  const parts = host.split('.')
  for (let index = 1; index < parts.length - 1; index++) {
    const parent = parts.slice(index).join('.')
    if (listed.has(parent)) return parent
  }
  return undefined
}

function extractHosts(text: string): string[] {
  const hosts = new Set<string>()

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('!') || line.startsWith('@@') || line.includes('*')) continue
    if (line.includes('##') || line.includes('#@#') || line.includes('#?#')) continue

    const match = line.match(hostPattern)
    if (!match) continue

    const options = match[2]?.split(',') ?? []
    if (options.some(option => ignoredOptions.includes(option.replace(/^~/, '')))) continue

    const host = match[1].toLowerCase()
    if (host.includes('..') || host.startsWith('.') || host.endsWith('.')) continue
    hosts.add(host)
  }

  return [...hosts].sort()
}
