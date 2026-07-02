/**
 * MAIN-world content script for YouTube.
 *
 * Runs in the page's own JavaScript context (manifest `world: "MAIN"`) at
 * document_start, before YouTube's app, and strips ads out of its Innertube JSON
 * so nothing schedules or renders: video ads (`adPlacements`/`adSlots`/`playerAds`)
 * from player responses, Shorts ads from reel sequences, and feed ad cells from
 * browse/search responses — while `streamingData` and real content are untouched.
 * This is uBlock Origin's source-level approach; it replaces guessing in the DOM
 * and only supplements the existing skip/fast-forward and cosmetic safety nets.
 *
 * Two entry points cover both loads:
 * - the inline `ytInitialPlayerResponse` used for the first video, and
 * - the `/youtubei/v1/{player,browse,search,reel_watch_sequence}` fetches used
 *   for every subsequent video, feed page, and Shorts sequence.
 */
import { ytConfigMessageSource, ytPruneMessageSource } from '../shared/constants'
import { isYouTubeAdResponseUrl, pruneYouTubeAds } from '../shared/yt-prune'
import { createPruneBridge, requestUrl } from './inpage-bridge'

const bridge = createPruneBridge(ytConfigMessageSource, ytPruneMessageSource)
// Captured before interceptJsonParse patches JSON.parse, so the fetch hook can
// parse without the hook pre-pruning (and zeroing) its result.
const nativeJsonParse = JSON.parse

defuseAdPeriod()
interceptJsonParse()
interceptInlinePlayerResponse()
installFetchPruner()

/**
 * Prune ads from anything parsed via `JSON.parse` — uBlock Origin's `json-prune`.
 * YouTube parses player/browse responses through `JSON.parse` in code paths the
 * `fetch` wrap and the inline accessor can miss (module-scoped vars, workers'
 * results serialized back, prefetch). A cheap string test on the raw text keeps
 * this from walking every unrelated parse.
 */
function interceptJsonParse(): void {
  const original = JSON.parse
  if (typeof original !== 'function' || (original as { __vgaPatched?: boolean }).__vgaPatched) return

  const patched = function patchedParse(this: unknown, text: string, reviver?: (key: string, value: unknown) => unknown): unknown {
    const result = (original as (t: string, r?: (key: string, value: unknown) => unknown) => unknown).call(this, text, reviver)
    try {
      if (bridge.isEnabled() && typeof text === 'string' && looksAdShaped(text) && result && typeof result === 'object') {
        const removed = pruneYouTubeAds(result)
        if (removed > 0) bridge.report(removed)
      }
    }
    catch {
      // Never let ad pruning break a parse — return the untouched result.
    }
    return result
  }

  ;(patched as { __vgaPatched?: boolean }).__vgaPatched = true
  JSON.parse = patched as typeof JSON.parse
}

/** Fast pre-check so JSON.parse only walks payloads that could carry ads. */
function looksAdShaped(text: string): boolean {
  return text.includes('adPlacements')
    || text.includes('playerAds')
    || text.includes('adSlotRenderer')
    || text.includes('adClientParams')
    || text.includes('inFeedAdLayoutRenderer')
}

/**
 * Force YouTube's client-side ad-period gate (`isAdPeriod`) to false — uBlock
 * Origin's `set-constant Object.prototype.isAdPeriod false`. This defuses one
 * class of ad scheduling/anti-adblock that can survive response pruning. Gated on
 * the enable flag so an allowlisted or disabled page keeps its normal behavior.
 */
function defuseAdPeriod(): void {
  try {
    Object.defineProperty(Object.prototype, 'isAdPeriod', {
      configurable: true,
      get() {
        return bridge.isEnabled() ? false : undefined
      },
      set() {
        // Swallow assignments so the forced value stands while enabled.
      },
    })
  }
  catch {
    // Property already locked down elsewhere; the response pruning still applies.
  }
}

/**
 * The first watch page ships its player response as `window.ytInitialPlayerResponse`.
 * Install an accessor before that assignment so we can prune ads out of it as it
 * is written; the getter hands back the cleaned object the app then reads.
 */
function interceptInlinePlayerResponse(): void {
  let current: unknown
  try {
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      enumerable: true,
      get() {
        return current
      },
      set(value: unknown) {
        try {
          if (bridge.isEnabled()) bridge.report(pruneYouTubeAds(value))
        }
        catch {
          // Leave the value as-is if pruning throws; never block playback.
        }
        current = value
      },
    })
  }
  catch {
    // A non-configurable definition already exists; the fetch path still applies.
  }
}

function installFetchPruner(): void {
  const original = window.fetch
  if (typeof original !== 'function') return
  if ((original as { __vgaPatched?: boolean }).__vgaPatched) return

  const patched = async function patchedFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const response = await original.call(this as typeof globalThis, input, init)
    if (!bridge.isEnabled()) return response

    try {
      if (!isYouTubeAdResponseUrl(requestUrl(input))) return response
      if (!(response.headers.get('content-type') ?? '').includes('json')) return response

      const data = nativeJsonParse(await response.clone().text()) as unknown
      const removed = pruneYouTubeAds(data)
      if (removed <= 0) return response

      bridge.report(removed)
      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }
    catch {
      // Never break a response over ad pruning — hand back the untouched original.
      return response
    }
  }

  const merged = Object.assign(patched, original)
  ;(merged as { __vgaPatched?: boolean }).__vgaPatched = true
  window.fetch = merged as typeof window.fetch
}
