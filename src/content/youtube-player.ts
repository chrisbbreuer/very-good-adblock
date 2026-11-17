/**
 * The YouTube player's safety net for ads that survive the source pruning
 * (`yt-inpage.ts`): click Skip, close banner overlays, and end the rest.
 *
 * It lives apart from the page content script because it is about the player,
 * not the page around it. youtube.com pages and YouTube players embedded in
 * other sites (`yt-embed.ts`) run the same player, so they share this one
 * implementation and its counting rules.
 */
const adFastForwardRate = 16
const skipSelectors = '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-container button, button[class*="ytp-ad-skip"]'

export interface YouTubePlayerReports {
  /** One video ad ended early (skipped or fast-forwarded), at most once per ad. */
  videoAd: () => void
  /** One banner overlay closed. */
  overlay: () => void
}

export interface YouTubePlayerDefense {
  /** Run one pass; called on a short poll and after DOM changes. */
  tick: () => void
}

export function createYouTubePlayerDefense(reports: YouTubePlayerReports, root: Document = document): YouTubePlayerDefense {
  const handled = new WeakSet<Element>()
  let adCredited = false
  let restoreRate: number | undefined
  let restoreMuted: boolean | undefined

  /**
   * Credit one video-ad block per ad period. Both defenses fire for the same
   * ad (the poll fast-forwards it AND clicks its Skip button), so without this
   * gate a single ad counted twice. The flag re-arms when the player leaves the
   * ad state, so each new ad in a pod is credited again.
   */
  function creditVideoAd(): void {
    if (adCredited) return
    adCredited = true
    reports.videoAd()
  }

  /**
   * Skip only while the player is in an ad state; a stale button left in the
   * DOM that still passes the visibility check would otherwise be re-clicked
   * forever, poking the player every tick.
   */
  function clickSkip(): void {
    if (!root.querySelector('.html5-video-player.ad-showing, .html5-video-player.ad-interrupting')) return

    for (const button of root.querySelectorAll(skipSelectors)) {
      if (!(button instanceof HTMLElement) || !isVisible(button)) continue
      button.click()
      if (!handled.has(button)) {
        handled.add(button)
        creditVideoAd()
      }
    }
  }

  /** Dismiss the small banner ad overlaid on the video. */
  function closeOverlay(): void {
    for (const button of root.querySelectorAll('.ytp-ad-overlay-close-button, .ytp-ad-overlay-close-container button')) {
      if (button instanceof HTMLElement && isVisible(button) && !handled.has(button)) {
        handled.add(button)
        button.click()
        reports.overlay()
      }
    }
  }

  /**
   * Ads that survive the source pruning (server-decided pods, stitched streams)
   * are ended instantly: seek the ad video to its end, which completes the ad
   * and advances the pod — verified against live ad pods, where fast-forwarding
   * alone crawls because the stream cannot buffer at 16x for a 90s+ ad. Until
   * the ad's duration is known (metadata still loading) the video is muted and
   * sped to 16x so not even a moment of the ad is heard. The viewer's rate and
   * mute state are captured and restored once the ad ends, and playback is
   * resumed: ending an ad abnormally (seek-to-end, programmatic skip click) can
   * leave YouTube's player parked on pause where a normal ad completion would
   * have rolled straight into the video.
   */
  function fastForward(): void {
    const player = root.querySelector('.html5-video-player')
    const video = player?.querySelector('video')
    if (!(video instanceof HTMLVideoElement)) return

    // Same states the skip click accepts: YouTube marks some ad periods with
    // `ad-interrupting` alone, and the fast-forward must engage for those too.
    const adShowing = (player?.classList.contains('ad-showing') ?? false)
      || (player?.classList.contains('ad-interrupting') ?? false)

    if (adShowing) {
      if (restoreRate === undefined) {
        restoreRate = video.playbackRate
        restoreMuted = video.muted
      }
      creditVideoAd()
      try {
        video.muted = true
        if (video.playbackRate < adFastForwardRate) video.playbackRate = adFastForwardRate
        if (Number.isFinite(video.duration) && video.duration > 0 && video.duration - video.currentTime > 0.3) {
          video.currentTime = video.duration
        }
      }
      catch {
        // Player rejected the change; leave the ad to the Skip button.
      }
      return
    }

    // Out of the ad state: re-arm the per-ad credit and hand the player back.
    adCredited = false
    if (restoreRate === undefined) return
    try {
      video.playbackRate = restoreRate
      if (restoreMuted !== undefined) video.muted = restoreMuted
    }
    catch {
      // Ignore; YouTube manages the player state from here.
    }
    // Resume once, right as the ad period ends, so the video starts on its own
    // after a skipped pre-roll instead of sitting paused.
    if (video.paused) void video.play().catch(() => {})
    restoreRate = undefined
    restoreMuted = undefined
  }

  return {
    tick() {
      clickSkip()
      closeOverlay()
      fastForward()
    },
  }
}

function isVisible(element: HTMLElement): boolean {
  return element.offsetParent !== null || element.getClientRects().length > 0
}
