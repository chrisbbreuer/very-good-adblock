/**
 * Source-level removal of YouTube video ads.
 *
 * YouTube's player responses (`ytInitialPlayerResponse` inline, and the
 * `/youtubei/v1/player` API for subsequent videos) carry ad instructions in
 * `adPlacements`, `adSlots`, and `playerAds`. uBlock Origin deletes exactly those
 * keys so the player has no ads to schedule — the video plays immediately while
 * `streamingData`, `videoDetails`, and captions are left untouched. We reimplement
 * that idea here (the walk is ours; the key names are facts about YouTube's API).
 *
 * Pure so it can be unit-tested without a browser; the MAIN-world content script
 * (`content/yt-inpage.ts`) applies it to inline data and live fetch responses.
 */

/** Ad-carrying keys removed from any player-response object. */
const adKeys = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'] as const

/**
 * Innertube endpoints whose responses schedule video ads. Scoped to the player
 * and Shorts sequence — `/next` (comments, recommendations) does not carry the
 * ad placements and is large, so it is left alone to avoid needless reserializing.
 */
export function isYouTubePlayerUrl(url: string): boolean {
  return url.includes('/youtubei/v1/player')
    || url.includes('/youtubei/v1/reel_watch_sequence')
}

/**
 * Delete ad instructions from a parsed player response, in place, wherever they
 * appear (including nested `playerResponse.*` and arrays of them). Returns the
 * number of ad breaks removed — the max array length among the ad keys in each
 * container, so mirrored `adPlacements`/`adSlots`/`playerAds` are not triple-counted.
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

    let breaks = 0
    for (const key of adKeys) {
      if (!(key in record)) continue
      const value = record[key]
      if (Array.isArray(value)) breaks = Math.max(breaks, value.length)
      else if (value) breaks = Math.max(breaks, 1)
      delete record[key]
    }
    removed += breaks

    for (const key of Object.keys(record)) walk(record[key])
  }

  walk(data)
  return removed
}
