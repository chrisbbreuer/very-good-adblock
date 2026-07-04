/**
 * The competitive benchmark: how Very Good AdBlock's blocking model compares to
 * the JavaScript engines shipped by uBlock Origin, Adblock Plus, and Ghostery,
 * all fed the exact filter lists this extension pins.
 *
 * Two things are measured, because they are genuinely different costs:
 *
 *   1. Per-request matching — the JavaScript spent to decide "block this?" for
 *      every network request the page makes. This is the number that runs
 *      millions of times as you browse. Very Good AdBlock spends ZERO here: MV3
 *      declarativeNetRequest matches in the browser's native C++ network stack,
 *      so no extension JavaScript runs per request at all. For an apples-to-
 *      apples reference we also time a JS matcher over our host set — what it
 *      *would* cost if we matched in JavaScript the way MV2 blockers must.
 *
 *   2. List ingest — the one-time cost to turn filter lists into a ready-to-
 *      block state at startup. The engines parse the raw list into in-memory
 *      match structures; Very Good AdBlock compiles its (offline-reduced) host
 *      list into declarativeNetRequest rules the browser then enforces.
 */
import { buildHostRefreshRules } from '../../src/rules/dynamic-rules'
import { buildStaticRules } from '../../src/rules/static-rules'
import { hostnameFromUrl } from '../../src/shared/domain'
import { availableEngines } from './engines'
import { buildRequestCorpus, loadBlockedHostSet, loadFilterLists } from './fixtures'
import { benchBuild, benchSweep, fmtOps, fmtTime } from './harness'
import type { BenchRequest } from './harness'

/**
 * Our JS reference matcher: replicate declarativeNetRequest's `||host^`
 * semantics in JavaScript — a request is blocked if its hostname, or any parent
 * domain of it, is in the blocked host set. This is exactly what the browser's
 * native matcher decides; here we just pay for it in JS so it can be timed
 * against the competitor engines.
 */
export function createHostSetMatcher(hostSet: Set<string>): (r: BenchRequest) => boolean {
  return (r) => {
    let host = hostnameFromUrl(r.url)
    if (!host) return false
    if (hostSet.has(host)) return true
    let dot = host.indexOf('.')
    // Walk parent domains: sub.a.example.com -> a.example.com -> example.com
    while (dot !== -1) {
      host = host.slice(dot + 1)
      if (host.indexOf('.') === -1) break // stop at the bare TLD
      if (hostSet.has(host)) return true
      dot = host.indexOf('.')
    }
    return false
  }
}

interface Row {
  name: string
  matchNs: number | null // null => not matched in JS at all (native)
  matchOps: number | null
  blocked: number | null
  buildMs: number | null
  detail: string
}

export async function runCompetitive(): Promise<void> {
  console.log('\nNative DNR vs. the JavaScript matching-engine model')
  console.log('(comparing blocking models, not products — every engine below also ships a native')
  console.log(' MV3/DNR build; uBO Lite, ABP MV3, Ghostery MV3, and Brave\'s in-core adblock-rust)')
  console.log('\nLoading pinned filter lists (EasyList + AdGuard, cached in bench/fixtures/)…')
  const lists = await loadFilterLists()
  const hostSet = loadBlockedHostSet()
  const corpus = buildRequestCorpus(hostSet)

  const listBytes = lists.sources.reduce((n, s) => n + s.bytes, 0)
  console.log(`  ${lists.sources.length} sources, ${(listBytes / 1024 / 1024).toFixed(1)} MB, ${lists.totalLines.toLocaleString()} lines`)
  console.log(`  request corpus: ${corpus.length.toLocaleString()} requests over ${new Set(corpus.map(r => hostnameFromUrl(r.sourceUrl))).size} pages`)

  const { factories, missing } = await availableEngines()
  const rows: Row[] = []

  for (const factory of factories) {
    const engine = await factory.prepare()
    // benchBuild runs ingest several times; the final run leaves the engine ready to match.
    const buildMs = await benchBuild(() => engine.ingest(lists.raw))
    const swept = benchSweep(factory.name, factory.note, corpus, engine.match)
    rows.push({ name: `JS engine — ${factory.name}`, matchNs: swept.nsPerOp, matchOps: swept.opsPerSec, blocked: swept.blocked, buildMs, detail: factory.note })
  }

  // Very Good AdBlock — native declarativeNetRequest: no JS per request.
  const nativeRow: Row = {
    name: 'Native DNR — Very Good AdBlock',
    matchNs: 0,
    matchOps: null,
    blocked: null,
    buildMs: null,
    detail: 'declarativeNetRequest — matched natively in the browser, 0 JS per request',
  }

  // Very Good AdBlock — JS host-set reference (what matching in JS would cost).
  const hostMatcher = createHostSetMatcher(hostSet)
  const refSwept = benchSweep('  └ JS host-set reference', '', corpus, hostMatcher)
  const refRow: Row = {
    name: '  └ JS host-set reference',
    matchNs: refSwept.nsPerOp,
    matchOps: refSwept.opsPerSec,
    blocked: refSwept.blocked,
    buildMs: null,
    detail: 'if Very Good AdBlock matched in JS instead of native DNR',
  }

  // Our compile cost: reduced host list -> declarativeNetRequest rules.
  const generatedHosts = [...hostSet]
  const vgaBuildMs = await benchBuild(() => {
    buildStaticRules()
    buildHostRefreshRules(generatedHosts)
  })
  nativeRow.buildMs = vgaBuildMs
  nativeRow.detail = 'compile the reduced host list into declarativeNetRequest rules'

  printMatchTable([...rows, nativeRow, refRow])
  printBuildTable([...rows, nativeRow])

  if (missing.length > 0) {
    console.log('Skipped (package not installed):')
    for (const m of missing) console.log(`  - ${m}`)
    console.log('  Install the competitors with: bun add -d @ghostery/adblocker @gorhill/ubo-core adblockpluscore\n')
  }
}

function printMatchTable(rows: Row[]): void {
  console.log('\n── Per-request matching cost ────────────────────────────────────────────')
  console.log('   JavaScript spent per request under each model. Under native DNR the browser')
  console.log('   matches in its own network stack, so the extension runs no JS per request.\n')
  const nameW = Math.max(...rows.map(r => r.name.length), 'model / engine'.length)
  console.log(`${'model / engine'.padEnd(nameW)}  ${'JS / request'.padStart(12)}  ${'throughput'.padStart(11)}  ${'blocked'.padStart(8)}`)
  console.log('-'.repeat(nameW + 38))
  for (const r of rows) {
    const time = r.matchNs === null ? '—' : r.matchNs === 0 ? '0 (in browser)' : fmtTime(r.matchNs)
    const ops = r.matchOps === null ? 'native' : fmtOps(r.matchOps)
    const blkCount = r.blocked === null ? '—' : r.blocked.toLocaleString()
    console.log(`${r.name.padEnd(nameW)}  ${time.padStart(12)}  ${ops.padStart(11)}  ${blkCount.padStart(8)}`)
  }
  console.log('\n   The "JS engine" rows are the MV2/webRequest matching path these libraries')
  console.log('   implement — the model Chrome is retiring. uBO Lite, ABP MV3, Ghostery MV3, and')
  console.log('   Brave\'s in-core adblock-rust all match natively too. The reference row shows what')
  console.log('   our host set would cost if matched in JS; in production it never runs.')
}

function printBuildTable(rows: Row[]): void {
  console.log('\n── List ingest / compile (startup, one-time) ────────────────────────────')
  console.log('   Turning filter lists into a ready-to-block state when the blocker starts.\n')
  const withBuild = rows.filter(r => r.buildMs !== null)
  const nameW = Math.max(...withBuild.map(r => r.name.length), 'model / engine'.length)
  console.log(`${'model / engine'.padEnd(nameW)}  ${'ingest time'.padStart(11)}  what it builds`)
  console.log('-'.repeat(nameW + 40))
  for (const r of withBuild) {
    console.log(`${r.name.padEnd(nameW)}  ${`${r.buildMs!.toFixed(1)} ms`.padStart(11)}  ${r.detail}`)
  }
  console.log('\n   The JS engines parse the full raw list into in-memory match structures in-')
  console.log('   process. Very Good AdBlock parses raw lists offline at build time (bun run')
  console.log('   update:filters) and at runtime only compiles the reduced host list into DNR')
  console.log('   rules the browser enforces — not identical work, and the same is true of the')
  console.log('   competitors\' own MV3/DNR builds.')
}
