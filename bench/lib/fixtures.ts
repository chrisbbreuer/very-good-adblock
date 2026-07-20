/**
 * Benchmark fixtures: the filter lists every engine is fed, the host set our
 * declarativeNetRequest rules enforce, and a representative request corpus.
 *
 * The filter lists are the *same* sources the extension pins in
 * `src/rules/filter-sources.json`, fetched at their pinned revisions and cached in
 * `bench/fixtures/` (git-ignored — EasyList/AdGuard are GPL, so we don't vendor
 * them into this MIT repo). This keeps the comparison honest: our host set is
 * derived from exactly these lists, so the competitor engines match the same
 * ad/tracker domains rather than a hand-picked corpus.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { curatedRuleSeeds } from '../../src/rules/static-rules'
import { hostnameFromUrl } from '../../src/shared/domain'
import type { BenchRequest, BenchResourceType } from './harness'
import generatedNetworkHosts from '../../src/rules/generated/network-hosts.json'

const here = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(here, '..', 'fixtures')
const sourcesFile = join(here, '..', '..', 'rules', 'filter-sources.json')

interface FilterSource {
  name: string
  repository: string
  revision: string
  path: string
}

interface FilterSourcesFile {
  sources: FilterSource[]
}

function rawUrl(source: FilterSource): string {
  return `https://raw.githubusercontent.com/${source.repository}/${source.revision}/${source.path}`
}

function cacheName(source: FilterSource): string {
  // Pin the cache file to the revision so a source bump re-downloads instead of
  // silently reusing stale text.
  return `${source.repository.replace(/\//g, '_')}@${source.revision.slice(0, 12)}__${source.path.replace(/[/]/g, '_')}`
}

async function fetchSource(source: FilterSource): Promise<string> {
  const cachePath = join(fixturesDir, cacheName(source))
  if (existsSync(cachePath)) return readFile(cachePath, 'utf8')

  const url = rawUrl(source)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${source.name} (${res.status}) from ${url}`)
  const text = await res.text()
  await mkdir(fixturesDir, { recursive: true })
  await writeFile(cachePath, text)
  return text
}

export interface FilterListBundle {
  /** The concatenated raw filter text fed to every competitor engine. */
  raw: string
  /** Per-source sizes, for reporting what the engines actually ingested. */
  sources: { name: string, bytes: number, lines: number }[]
  totalLines: number
}

/**
 * Load the pinned filter lists, downloading and caching any that are missing.
 * Returns the concatenated raw text plus a manifest of what was included.
 */
export async function loadFilterLists(): Promise<FilterListBundle> {
  const file: FilterSourcesFile = JSON.parse(await readFile(sourcesFile, 'utf8'))
  const parts: string[] = []
  const sources: FilterListBundle['sources'] = []
  for (const source of file.sources) {
    const text = await fetchSource(source)
    parts.push(text)
    sources.push({ name: source.name, bytes: text.length, lines: text.split('\n').length })
  }
  const raw = parts.join('\n')
  return { raw, sources, totalLines: raw.split('\n').length }
}

/**
 * The set of hostnames the extension blocks *by hostname* via
 * declarativeNetRequest: the generated host list plus the host-only curated
 * seeds. This is what our JS reference matcher walks, so it must mirror the
 * hostname-blocking subset exactly — only pure `||host^` seeds count. Curated
 * seeds that are path-scoped (`||youtube.com/api/stats/ads^`,
 * `|https://www.youtube.com/pagead/`, `twitch.tv/ads`) block a specific path,
 * not the whole host, so folding their hostname in would over-block domains
 * like youtube.com/twitter.com/twitch.tv that DNR (and the competitor engines)
 * leave alone. Those path rules aren't hostname blocking and are left out.
 */
export function loadBlockedHostSet(): Set<string> {
  const set = new Set<string>(generatedNetworkHosts.hosts.map(h => h.toLowerCase()))
  for (const seed of curatedRuleSeeds) {
    // Only pure host blocks: `||host^` with nothing after the separator.
    const m = seed.urlFilter.match(/^\|\|([a-z0-9.-]+)\^$/i)
    if (m) set.add(m[1].toLowerCase())
  }
  return set
}

// --- request corpus ----------------------------------------------------------

const benignPages = [
  'https://www.theverge.com/', 'https://en.wikipedia.org/', 'https://www.nytimes.com/',
  'https://www.reddit.com/', 'https://news.ycombinator.com/', 'https://www.cnn.com/',
  'https://www.espn.com/', 'https://www.bbc.com/', 'https://weather.com/',
  'https://www.shopify.com/', 'https://www.etsy.com/', 'https://medium.com/',
]

const benignThirdParty = [
  ['https://fonts.gstatic.com/s/roboto/v30/font.woff2', 'font'],
  ['https://cdn.jsdelivr.net/npm/lib/dist.js', 'script'],
  ['https://images.unsplash.com/photo-1234.jpg', 'image'],
  ['https://i.imgur.com/abc123.png', 'image'],
  ['https://player.vimeo.com/video/1.m3u8', 'media'],
  ['https://unpkg.com/react/umd/react.js', 'script'],
  ['https://cdnjs.cloudflare.com/ajax/libs/x/x.css', 'stylesheet'],
] as const

const adPaths = [
  ['/gpt/pubads_impl.js', 'script'],
  ['/ads/beacon.js', 'script'],
  ['/pixel.gif?ev=view', 'image'],
  ['/rtb/bid?slot=1', 'xmlhttprequest'],
  ['/tag.min.js', 'script'],
  ['/prebid/auction', 'xmlhttprequest'],
  ['/sync?uid=abc', 'image'],
  ['/creative/banner.html', 'sub_frame'],
] as const

/**
 * Build a deterministic, representative request corpus: a realistic mix of
 * first-party subresources, benign third parties (CDNs, fonts, images), and
 * third-party requests to real ad/tracker hosts drawn from the blocked set —
 * so every engine, all fed the same lists, has genuine matching work to do.
 * Deterministic (index-derived, no RNG) so runs are comparable.
 */
export function buildRequestCorpus(hostSet: Set<string>, target = 12_000): BenchRequest[] {
  // Sample ad hosts evenly across the (sorted) blocked set for variety.
  const adHosts = [...hostSet].filter(h => h.includes('.') && !h.startsWith('.'))
  const requests: BenchRequest[] = []
  let i = 0
  while (requests.length < target) {
    const page = benignPages[i % benignPages.length]
    const pageHost = hostnameFromUrl(page) || 'example.com'

    // 1 first-party document subresource (never blocked)
    requests.push({ url: `https://${pageHost}/assets/app.${i}.js`, sourceUrl: page, type: 'script' })

    // 2 benign third parties (mostly not blocked)
    const b1 = benignThirdParty[i % benignThirdParty.length]
    const b2 = benignThirdParty[(i + 3) % benignThirdParty.length]
    requests.push({ url: b1[0], sourceUrl: page, type: b1[1] as BenchResourceType })
    requests.push({ url: b2[0], sourceUrl: page, type: b2[1] as BenchResourceType })

    // 2 ad/tracker requests to real blocked hosts (should match)
    for (let k = 0; k < 2 && adHosts.length > 0; k++) {
      const host = adHosts[(i * 2 + k) % adHosts.length]
      const [path, type] = adPaths[(i + k) % adPaths.length]
      requests.push({ url: `https://${host}${path}`, sourceUrl: page, type: type as BenchResourceType })
    }
    i++
  }
  return requests.slice(0, target)
}
