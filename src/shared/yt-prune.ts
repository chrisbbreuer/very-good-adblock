/**
 * Source-level removal of YouTube ads.
 *
 * YouTube ships ads inside its Innertube JSON:
 * - video ads as `adPlacements` / `adSlots` / `playerAds` in player responses,
 * - Shorts ads as reel entries with `command.reelWatchEndpoint.adClientParams.isAd`,
 * - feed ads as `adSlotRenderer` / `inFeedAdLayoutRenderer` cells in browse
 *   `contents` / `continuationItems`.
 *
 * uBlock Origin deletes exactly these so nothing schedules or renders — the video
 * plays immediately and feed/Shorts ads never appear, while everything the client
 * needs (`streamingData`, real feed items) is left intact. We reimplement the idea
 * here (the walk is ours; the key names are facts about YouTube's API).
 *
 * Pure so it can be unit-tested without a browser; the MAIN-world content script
 * (`content/yt-inpage.ts`) applies it to inline data and live fetch responses.
 */

/** Ad-carrying keys removed from any player-response object. */
const adKeys = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'] as const

/** Innertube endpoints whose responses carry ads worth pruning. */
export function isYouTubeAdResponseUrl(url: string): boolean {
  return url.includes('/youtubei/v1/player')
    || url.includes('/youtubei/v1/browse')
    || url.includes('/youtubei/v1/search')
    || url.includes('/youtubei/v1/reel_watch_sequence')
}

/** A Shorts reel entry flagged as an ad. */
function isReelAd(entry: unknown): boolean {
  const command = (entry as { command?: { reelWatchEndpoint?: { adClientParams?: { isAd?: unknown } } } })?.command
  return command?.reelWatchEndpoint?.adClientParams?.isAd === true
}

/** A feed cell that is an ad slot (rich grid item or shelf section). */
function isFeedAd(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false
  const record = item as Record<string, unknown>
  const wrappers = [
    record,
    (record.richItemRenderer as { content?: unknown })?.content,
    (record.richSectionRenderer as { content?: unknown })?.content,
  ]
  return wrappers.some((wrapper) => {
    if (!wrapper || typeof wrapper !== 'object') return false
    const inner = wrapper as Record<string, unknown>
    return Boolean(inner.adSlotRenderer || inner.inFeedAdLayoutRenderer)
  })
}

/**
 * Delete ads from a parsed Innertube response, in place, wherever they appear.
 * Returns the total number of ads removed (video breaks + Shorts + feed cells) so
 * the caller can attribute the block for stats. Non-ad data is never touched:
 * array filters only drop elements that positively match an ad shape.
 */
export function pruneYouTubeAds(data: unknown): number {
  let removed = 0
  const visited = new WeakSet<object>()

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (visited.has(node)) return
    visited.add(node)

    if (Array.isArray(node)) {
      for (const element of node) walk(element)
      return
    }

    const record = node as Record<string, unknown>

    // Player ad instructions: max array length among the mirrored ad keys, so a
    // response is not triple-counted across adPlacements/adSlots/playerAds.
    let breaks = 0
    for (const key of adKeys) {
      if (!(key in record)) continue
      const value = record[key]
      if (Array.isArray(value)) breaks = Math.max(breaks, value.length)
      else if (value) breaks = Math.max(breaks, 1)
      delete record[key]
    }
    removed += breaks

    for (const key of Object.keys(record)) {
      const value = record[key]

      if (Array.isArray(value) && (key === 'entries' || key === 'contents' || key === 'continuationItems')) {
        const predicate = key === 'entries' ? isReelAd : isFeedAd
        const kept = value.filter(element => !predicate(element))
        removed += value.length - kept.length
        record[key] = kept
        for (const element of kept) walk(element)
        continue
      }

      walk(value)
    }
  }

  walk(data)
  return removed
}
