import { describe, expect, it } from 'bun:test'
import { isYouTubeAdResponseUrl, pruneYouTubeAds } from '../src/shared/yt-prune'

describe('isYouTubeAdResponseUrl', () => {
  it('matches the innertube endpoints that carry ads', () => {
    expect(isYouTubeAdResponseUrl('https://www.youtube.com/youtubei/v1/player?prettyPrint=false')).toBe(true)
    expect(isYouTubeAdResponseUrl('https://www.youtube.com/youtubei/v1/browse?key=x')).toBe(true)
    expect(isYouTubeAdResponseUrl('https://www.youtube.com/youtubei/v1/search?key=x')).toBe(true)
    expect(isYouTubeAdResponseUrl('https://www.youtube.com/youtubei/v1/reel_watch_sequence?x=1')).toBe(true)
  })

  it('ignores unrelated URLs, including the large /next payload', () => {
    expect(isYouTubeAdResponseUrl('https://www.youtube.com/youtubei/v1/next?key=x')).toBe(false)
    expect(isYouTubeAdResponseUrl('https://www.youtube.com/watch?v=abc')).toBe(false)
    expect(isYouTubeAdResponseUrl('https://i.ytimg.com/vi/abc/hq.jpg')).toBe(false)
  })
})

describe('pruneYouTubeAds', () => {
  it('removes ad instructions but preserves playback data', () => {
    const response = playerResponse()
    const removed = pruneYouTubeAds(response)

    // Two ad breaks (pre-roll + mid-roll) reported once, not tripled across the
    // mirrored ad keys.
    expect(removed).toBe(2)

    expect(response.adPlacements).toBeUndefined()
    expect(response.adSlots).toBeUndefined()
    expect(response.playerAds).toBeUndefined()

    // Everything needed to actually play the video is left intact.
    expect(response.streamingData.formats).toHaveLength(1)
    expect(response.videoDetails.videoId).toBe('abc123')
    expect(response.captions).toBeDefined()
  })

  it('prunes ads nested under playerResponse (e.g. /next responses)', () => {
    const data = {
      playerResponse: { adPlacements: [{ x: 1 }], streamingData: { formats: [1] } },
      contents: {},
    }
    expect(pruneYouTubeAds(data)).toBe(1)
    expect(data.playerResponse.adPlacements).toBeUndefined()
    expect(data.playerResponse.streamingData).toBeDefined()
  })

  it('returns 0 and mutates nothing when there are no ads', () => {
    const data = { streamingData: { formats: [1, 2] }, videoDetails: { videoId: 'z' } }
    expect(pruneYouTubeAds(data)).toBe(0)
    expect(data.streamingData.formats).toHaveLength(2)
  })

  it('does not throw on empty or malformed input', () => {
    expect(pruneYouTubeAds(null)).toBe(0)
    expect(pruneYouTubeAds({})).toBe(0)
    expect(pruneYouTubeAds({ adPlacements: 'not-an-array' })).toBe(1)
  })

  it('removes Shorts reel ad entries and keeps real reels', () => {
    const data = {
      reelWatchSequenceResponse: {
        entries: [
          { command: { reelWatchEndpoint: { videoId: 'real1', adClientParams: { isAd: false } } } },
          { command: { reelWatchEndpoint: { videoId: 'ad1', adClientParams: { isAd: true } } } },
          { command: { reelWatchEndpoint: { videoId: 'real2' } } },
        ],
      },
    }
    expect(pruneYouTubeAds(data)).toBe(1)
    const ids = data.reelWatchSequenceResponse.entries.map(e => e.command.reelWatchEndpoint.videoId)
    expect(ids).toEqual(['real1', 'real2'])
  })

  it('removes feed ad cells from browse contents and keeps real videos', () => {
    const data = {
      contents: {
        richGridRenderer: {
          contents: [
            { richItemRenderer: { content: { videoRenderer: { videoId: 'v1' } } } },
            { richItemRenderer: { content: { adSlotRenderer: { adSlotMetadata: {} } } } },
            { richSectionRenderer: { content: { inFeedAdLayoutRenderer: {} } } },
            { richItemRenderer: { content: { videoRenderer: { videoId: 'v2' } } } },
          ],
          continuationItems: [
            { adSlotRenderer: {} },
            { continuationItemRenderer: {} },
          ],
        },
      },
    }
    expect(pruneYouTubeAds(data)).toBe(3)
    const grid = data.contents.richGridRenderer
    expect(grid.contents).toHaveLength(2)
    expect(grid.continuationItems).toHaveLength(1)
  })
})

function playerResponse() {
  return {
    responseContext: {},
    playabilityStatus: { status: 'OK' },
    streamingData: { formats: [{ itag: 18, url: 'https://example/video' }], adaptiveFormats: [] },
    videoDetails: { videoId: 'abc123', title: 'Test', lengthSeconds: '212' },
    captions: { playerCaptionsTracklistRenderer: {} },
    adPlacements: [{ adPlacementRenderer: { config: {} } }, { adPlacementRenderer: { config: {} } }],
    adSlots: [{ adSlotRenderer: {} }, { adSlotRenderer: {} }],
    playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
  }
}
