import { createHash } from 'node:crypto'
import sourceConfig from '../../src/rules/filter-sources.json'

interface FilterSource {
  name: string
  repository: string
  revision: string
  path: string
  license: string
  homepage: string
}

interface GeneratedSource extends FilterSource {
  url: string
  sha256: string
  hosts: number
}

const hostPattern = /^\|\|([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(?:[\^/]|$)(?:\$([a-z0-9,~_-]+))?$/i
const ignoredOptions = ['badfilter', 'csp', 'document', 'elemhide', 'generichide', 'genericblock', 'popup', 'redirect', 'replace']
const maxHostsPerSource = sourceConfig.maxHostsPerSource
const allHosts = new Set<string>()
const generatedSources: GeneratedSource[] = []

for (const source of sourceConfig.sources as FilterSource[]) {
  const url = `https://raw.githubusercontent.com/${source.repository}/${source.revision}/${source.path}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${source.name}: ${response.status} ${response.statusText}`)

  const text = await response.text()
  const sourceHosts = extractHosts(text).slice(0, maxHostsPerSource)
  for (const host of sourceHosts) allHosts.add(host)

  generatedSources.push({
    ...source,
    url,
    sha256: createHash('sha256').update(text).digest('hex'),
    hosts: sourceHosts.length,
  })
}

const hosts = [...allHosts].sort()
await Bun.write('src/rules/generated/network-hosts.json', `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  totalHosts: hosts.length,
  hosts,
  sources: generatedSources,
}, null, 2)}\n`)

console.log(`Generated ${hosts.length} pinned network hosts from ${generatedSources.length} sources`)

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
