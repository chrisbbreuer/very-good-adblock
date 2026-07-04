/**
 * Micro-benchmarks for Very Good AdBlock's hot paths — the work that actually
 * runs while you browse: pruning ads out of YouTube/X responses at the source,
 * compiling filter hosts into declarativeNetRequest rules, resolving cosmetic
 * selectors, aggregating local stats, and classifying request URLs.
 *
 * These measure OUR code on representative fixtures (built below). They are not a
 * comparison against other blockers — the architectural win is that MV3
 * declarativeNetRequest does the network blocking in the browser's native stack
 * with zero per-request JavaScript; these numbers show the extras stay cheap too.
 *
 * Run: `bun run bench`
 */
import { activeCosmeticGroups } from '../src/shared/cosmetic'
import { hostnameFromUrl, normalizeHostname, siteMatches } from '../src/shared/domain'
import { compactBuckets, eventTotals } from '../src/shared/metrics'
import { isXGraphqlUrl, prunePromotedFromTimeline } from '../src/shared/x-prune'
import { isYouTubeAdResponseUrl, pruneYouTubeAds } from '../src/shared/yt-prune'
import { buildHostRefreshRules } from '../src/rules/dynamic-rules'
import { buildStaticRules } from '../src/rules/static-rules'
import type { BlockEvent, StatBucket } from '../src/shared/types'

// --- fixtures (representative of the real Innertube / GraphQL shapes) ---------

function youtubeBrowseResponse(): unknown {
  const videoCell = (i: number) => ({
    richItemRenderer: {
      content: {
        videoRenderer: {
          videoId: `v_${i}_abcd`,
          title: { runs: [{ text: `A representative video title number ${i} with a realistic length` }] },
          thumbnail: { thumbnails: Array.from({ length: 4 }, (_, t) => ({ url: `https://i.ytimg.com/vi/v_${i}/hq${t}.jpg`, width: 120 * (t + 1), height: 90 * (t + 1) })) },
          viewCountText: { simpleText: `${(i + 1) * 1237} views` },
          publishedTimeText: { simpleText: `${(i % 12) + 1} days ago` },
          ownerText: { runs: [{ text: `Channel ${i}`, navigationEndpoint: { browseEndpoint: { browseId: `UC_${i}` } } }] },
          lengthText: { simpleText: `${10 + (i % 50)}:${(i % 60).toString().padStart(2, '0')}` },
        },
      },
    },
  })
  const adCell = (i: number) => ({ richItemRenderer: { content: { adSlotRenderer: { adSlotMetadata: { slotId: `slot_${i}` }, fulfillmentContent: { fulfilledLayout: { inFeedAdLayoutRenderer: { renderingContent: {} } } } } } } })

  const contents: unknown[] = []
  for (let i = 0; i < 120; i++) {
    contents.push(videoCell(i))
    if (i % 10 === 9) contents.push(adCell(i))
  }

  return {
    responseContext: { visitorData: 'abc', serviceTrackingParams: Array.from({ length: 6 }, (_, i) => ({ service: `svc${i}`, params: [{ key: 'k', value: 'v' }] })) },
    contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { richGridRenderer: { contents, continuations: [] } } } }] } },
    // Player ad instructions carried in the same document class.
    playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
    adPlacements: [{ adPlacementRenderer: { config: { adPlacementConfig: {} }, renderer: {} } }, { adPlacementRenderer: {} }],
    adSlots: [{ adSlotRenderer: {} }],
    adBreakHeartbeatParams: 'x',
    streamingData: {
      expiresInSeconds: '21540',
      formats: Array.from({ length: 6 }, (_, f) => ({ itag: 100 + f, url: `https://r.googlevideo.com/videoplayback?a=${f}`, mimeType: 'video/mp4; codecs="avc1"', bitrate: 1_000_000 * (f + 1), width: 640, height: 360 })),
      adaptiveFormats: Array.from({ length: 24 }, (_, f) => ({ itag: 200 + f, url: `https://r.googlevideo.com/videoplayback?b=${f}`, mimeType: 'video/webm', bitrate: 500_000 * (f + 1) })),
    },
  }
}

function xTimelineResponse(): unknown {
  const tweet = (i: number, promoted: boolean) => ({
    entryId: `${promoted ? 'promoted' : 'tweet'}-${1000 + i}`,
    sortIndex: `${1000 + i}`,
    content: {
      entryType: 'TimelineTimelineItem',
      itemContent: {
        itemType: 'TimelineTweet',
        ...(promoted ? { promotedMetadata: { advertiser_results: {}, disclosureType: 'NoDisclosure', experimentValues: [] } } : {}),
        tweet_results: {
          result: {
            rest_id: `${9000 + i}`,
            legacy: { full_text: `This is a representative tweet body number ${i} with a plausible amount of text in it.`, favorite_count: i * 3, retweet_count: i, reply_count: i % 7, created_at: 'Wed Jul 01 12:00:00 +0000 2026' },
            core: { user_results: { result: { legacy: { screen_name: `user_${i}`, name: `User ${i}`, followers_count: i * 100 } } } },
          },
        },
      },
    },
  })
  const entries: unknown[] = []
  for (let i = 0; i < 60; i++) {
    entries.push(tweet(i, false))
    if (i % 8 === 7) entries.push(tweet(i, true))
  }
  return { data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries }], responseObjects: {} } } } }
}

const YT_JSON = JSON.stringify(youtubeBrowseResponse())
const X_JSON = JSON.stringify(xTimelineResponse())

const hosts = Array.from({ length: 15_000 }, (_, i) => `ads${i}.tracker-${i % 500}.example.com`)

const allowlist = ['stripe.com', 'github.com', 'my-bank.example', 'internal.corp', 'localhost']
const urls = [
  'https://www.youtube.com/youtubei/v1/player?key=x',
  'https://x.com/i/api/graphql/abc/HomeTimeline',
  'https://www.theverge.com/2026/7/1/some-article-slug',
  'https://doubleclick.net/pagead/ads?foo=bar',
  'https://mail.google.com/mail/u/0/',
]

const events: BlockEvent[] = Array.from({ length: 240 }, (_, i) => ({
  hostname: `host${i % 40}.example.com`,
  source: (['dnr', 'video', 'x', 'popup', 'cosmetic'] as const)[i % 5],
  category: (['script', 'image', 'media', 'xhr', 'other'] as const)[i % 5],
  count: (i % 9) + 1,
  bytesSaved: i % 3 === 0 ? undefined : (i + 1) * 40_000,
  videoSecondsSaved: i % 4 === 0 ? 15 : undefined,
  occurredAt: new Date(1_770_000_000_000 + i * 60_000).toISOString(),
}))

const buckets: StatBucket[] = Array.from({ length: 90 }, (_, i) => ({ key: `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`, adsBlocked: 300 + i * 7, bytesSaved: (i + 1) * 240_000, videoSecondsSaved: i * 15 }))

const cosmeticContext = { isYouTube: true, isTwitch: false, isX: false, youtubeEnhancements: true, twitchEnhancements: true, cookieConsent: true, aggressive: true }

// --- harness -----------------------------------------------------------------

interface Result { name: string, note: string, nsPerOp: number, opsPerSec: number }

function bench(name: string, note: string, fn: () => void, minMs = 500): Result {
  for (let i = 0; i < 64; i++) fn() // warmup
  const batch = 16
  let iters = 0
  const start = performance.now()
  let elapsed = 0
  do {
    for (let i = 0; i < batch; i++) fn()
    iters += batch
    elapsed = performance.now() - start
  } while (elapsed < minMs)
  const nsPerOp = (elapsed * 1e6) / iters
  return { name, note, nsPerOp, opsPerSec: 1e9 / nsPerOp }
}

function fmtTime(ns: number): string {
  if (ns < 1_000) return `${ns.toFixed(0)} ns`
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)} µs`
  return `${(ns / 1_000_000).toFixed(2)} ms`
}

function fmtOps(ops: number): string {
  if (ops >= 1e6) return `${(ops / 1e6).toFixed(1)}M/s`
  if (ops >= 1e3) return `${(ops / 1e3).toFixed(0)}K/s`
  return `${ops.toFixed(0)}/s`
}

const staticRuleCount = buildStaticRules().length

const results: Result[] = [
  bench('pruneYouTubeAds', `parse + prune a browse response (${Math.round(YT_JSON.length / 1024)} KB)`, () => pruneYouTubeAds(JSON.parse(YT_JSON))),
  bench('prunePromotedFromTimeline', `parse + prune an X timeline (${Math.round(X_JSON.length / 1024)} KB)`, () => prunePromotedFromTimeline(JSON.parse(X_JSON))),
  bench('buildStaticRules', `compile the ${staticRuleCount.toLocaleString()}-rule static ruleset`, () => buildStaticRules()),
  bench('buildHostRefreshRules', 'compile 15,000 filter hosts into DNR rules', () => buildHostRefreshRules(hosts)),
  bench('activeCosmeticGroups', 'resolve cosmetic selector groups for a page', () => activeCosmeticGroups(cosmeticContext)),
  bench('eventTotals', 'aggregate 240 block events', () => eventTotals(events)),
  bench('compactBuckets', 'compact 90 days of history', () => compactBuckets(buckets, 60)),
  bench('siteMatches', 'match a hostname against the allowlist', () => siteMatches('sub.github.com', allowlist)),
  bench('hostnameFromUrl', 'parse the hostname from a request URL', () => { for (const u of urls) hostnameFromUrl(u) }),
  bench('classify request URL', 'YouTube/X endpoint + http checks over 5 URLs', () => { for (const u of urls) { isYouTubeAdResponseUrl(u); isXGraphqlUrl(u); normalizeHostname(u) } }),
]

const nameW = Math.max(...results.map(r => r.name.length))
const noteW = Math.max(...results.map(r => r.note.length))
console.log(`\nVery Good AdBlock — hot-path benchmarks (Bun ${Bun.version})\n`)
console.log(`${'operation'.padEnd(nameW)}  ${'what it does'.padEnd(noteW)}  ${'time/op'.padStart(9)}  ${'throughput'.padStart(10)}`)
console.log('-'.repeat(nameW + noteW + 25))
for (const r of results)
  console.log(`${r.name.padEnd(nameW)}  ${r.note.padEnd(noteW)}  ${fmtTime(r.nsPerOp).padStart(9)}  ${fmtOps(r.opsPerSec).padStart(10)}`)
console.log('')
