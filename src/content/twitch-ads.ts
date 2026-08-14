/**
 * Twitch stream-ad suppression.
 *
 * Twitch stitches video ads into the HLS stream server-side, so the ad IS the
 * stream: the same segments, the same player, one continuous timeline. There is
 * no request to block and no button to click — network rules cannot touch it,
 * and neither can hiding a container, because the container is the video.
 *
 * What is left is the break itself. While Twitch's own ad markers are on screen
 * this mutes the player and covers it, so the ad plays out unseen and unheard
 * and the stream comes back on its own. It does not shorten the break; nothing
 * in an extension can, short of swapping the playlist for one fetched with a
 * different access token, which is an arms race against Twitch's backend and
 * takes the stream down with it when it loses.
 *
 * Everything here is reversible and self-limiting. The cover is removed when the
 * markers go, when the feature is switched off, and unconditionally after
 * {@link maxBreakMs} — a false positive costs the viewer a muted minute, never
 * a dead player.
 */

/** Twitch's own markers for a stitched commercial break. */
const adMarkers = [
  '.player-ad-notice',
  '.commercial-break-in-progress',
  '[data-a-target="video-ad-label"]',
  '[data-a-target="video-ad-countdown"]',
] as const

/** Where the countdown lives, when Twitch is showing one. */
const countdownSelector = '[data-a-target="video-ad-countdown"]'

/** Player containers, most specific first. */
const playerSelectors = [
  '[data-a-target="video-player"]',
  '.video-player__container',
  '.persistent-player',
  '.video-player',
] as const

export const coverClassName = 'vga-twitch-ad-cover'

/**
 * Markers flicker: Twitch re-renders the notice on every countdown tick, and
 * between renders none of them are in the DOM. Ending the break on the first
 * empty tick would unmute into the middle of the ad.
 */
const markerGraceMs = 2_000

/** No commercial break runs this long; past it the cover comes off regardless. */
const maxBreakMs = 210_000

export interface TwitchAdSuppressor {
  /**
   * Reconcile with the page. Returns true on the tick a break starts, which is
   * the only thing the caller counts — the break is one event no matter how
   * many times the markers re-render inside it.
   */
  update: () => boolean
  /** Undo everything: unmute, uncover, forget. Safe to call at any time. */
  restore: () => void
  /** Whether an ad break is currently being suppressed. */
  isSuppressing: () => boolean
}

interface Suppressed {
  video: HTMLVideoElement
  /** The player's mute state before the break, to hand back afterwards. */
  wasMuted: boolean
  /** Inline `position` we overwrote to anchor the cover, for exact restoration. */
  container: HTMLElement
  previousPosition: string
  cover: HTMLElement
  startedAt: number
}

export function createTwitchAdSuppressor(doc: Document = document, now: () => number = Date.now): TwitchAdSuppressor {
  let active: Suppressed | undefined
  let lastMarkerAt = 0

  function update(): boolean {
    const marker = findMarker()
    const at = now()
    if (marker) lastMarkerAt = at

    if (!active) {
      if (!marker) return false
      active = suppress()
      return Boolean(active)
    }

    if (at - active.startedAt > maxBreakMs) {
      restore()
      return false
    }

    if (!marker && at - lastMarkerAt > markerGraceMs) {
      restore()
      return false
    }

    updateCountdown(active.cover)
    return false
  }

  function findMarker(): Element | undefined {
    for (const selector of adMarkers) {
      const found = doc.querySelector(selector)
      if (found) return found
    }
    return undefined
  }

  function suppress(): Suppressed | undefined {
    const container = playerSelectors.reduce<HTMLElement | undefined>((found, selector) => found ?? (doc.querySelector(selector) as HTMLElement | null) ?? undefined, undefined)
    const video = container?.querySelector('video') ?? doc.querySelector('video')
    if (!container || !video) return undefined

    const wasMuted = video.muted
    video.muted = true

    // The cover is a child of the player so it tracks the player's size and
    // fullscreen state for free. That needs a positioned ancestor, and Twitch's
    // container is not always one.
    const previousPosition = container.style.position
    if (doc.defaultView?.getComputedStyle(container).position === 'static') container.style.position = 'relative'

    const cover = buildCover(doc)
    container.append(cover)
    updateCountdown(cover)

    return { video, wasMuted, container, previousPosition, cover, startedAt: now() }
  }

  function restore(): void {
    if (!active) return
    const { video, wasMuted, container, previousPosition, cover } = active
    active = undefined

    // Only hand back the mute state we took. A viewer who unmuted during the
    // break has said what they want; putting it back would be us overruling it.
    if (video.muted) video.muted = wasMuted
    container.style.position = previousPosition
    cover.remove()
  }

  function updateCountdown(cover: HTMLElement): void {
    const remaining = doc.querySelector(countdownSelector)?.textContent?.trim()
    const line = cover.querySelector(`.${coverClassName}__remaining`)
    if (!line) return
    line.textContent = remaining ? `Back in ${remaining}` : 'Back as soon as it ends'
  }

  return { update, restore, isSuppressing: () => Boolean(active) }
}

/**
 * Built with inline styles rather than a class: the cosmetic stylesheet is a
 * list of `display: none` rules, and this is the one thing we ADD to a page.
 */
function buildCover(doc: Document): HTMLElement {
  const cover = doc.createElement('div')
  cover.className = coverClassName
  cover.setAttribute('role', 'status')
  cover.style.cssText = [
    'position:absolute',
    'inset:0',
    'z-index:9998',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:6px',
    'background:#0e0e10',
    'color:#efeff1',
    'font:600 15px/1.4 Inter,Roobert,Helvetica,Arial,sans-serif',
    'text-align:center',
    // Clicks belong to the player underneath — the viewer can still hit pause,
    // fullscreen, or the volume slider through the cover.
    'pointer-events:none',
  ].join(';')

  const title = doc.createElement('div')
  title.textContent = 'Twitch ad — muted and hidden'

  const remaining = doc.createElement('div')
  remaining.className = `${coverClassName}__remaining`
  remaining.style.cssText = 'opacity:0.62;font-weight:500;font-size:13px'

  cover.append(title, remaining)
  return cover
}
