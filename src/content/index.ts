import { popupBlockMessageSource, popupConfigMessageSource, twitchVideoAdMarkers, xConfigMessageSource, xPromotedLabels, xPruneMessageSource, ytConfigMessageSource, ytPruneMessageSource } from '../shared/constants'
import { activeCosmeticGroups } from '../shared/cosmetic'
import type { ActiveCosmeticGroup, CosmeticContext } from '../shared/cosmetic'
import { hostnameFromUrl, siteMatches } from '../shared/domain'
import { estimateBytesSaved, estimateVideoAdBytes, estimateVideoSecondsSaved } from '../shared/metrics'
import { defaultSettings } from '../shared/storage'
import type { BlockEvent, BlockSource, ExtensionSettings, ResourceCategory, RuntimeResponse } from '../shared/types'

const hostname = hostnameFromUrl(location.href)
const seen = new WeakSet<Element>()
const videoMarkersSeen = new WeakSet<Element>()
const antiAdblockSeen = new WeakSet<Element>()
const pending = new Map<string, BlockEvent>()
const selectorHits = new Map<string, number>()
const pendingRoots = new Set<Element>()
const styleId = 'very-good-adblock-cosmetics'
const mutationSweepDelayMs = 150
const eventFlushDelayMs = 1_000
const maxPruneEventCount = 200
const maxPendingRoots = 80
const adFastForwardRate = 16
const youtubeAdPollMs = 300
const youtubeSkipSelectors = '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-container button, button[class*="ytp-ad-skip"]'
let cosmeticGroups: ActiveCosmeticGroup[] = []
let observer: MutationObserver | undefined
let sweepTimer: number | undefined
let eventFlushTimer: number | undefined
let youtubeAdTimer: number | undefined
let adRestoreRate: number | undefined
let adRestoreMuted: boolean | undefined
let scanDocumentOnNextSweep = false
let xPruneActive = false
let ytPruneActive = false
let popupBlockActive = false
// Settings load asynchronously, but the MAIN-world pop-up guard defaults to
// blocking the moment it installs. Pop-ups defused in that gap would be lost to
// stats, so buffer their count until start() settles the real toggle state.
let settingsResolved = false
let earlyPopupBlocks = 0

boot()

function boot(): void {
  // Kill the ad flash: at document_start, synchronously hide the default
  // placements before settings load. start() reconciles once settings arrive
  // (removing the style if the extension is off, the site is allowlisted, or
  // cosmetic filtering is disabled; adding aggressive selectors if enabled).
  injectCosmeticStyle(provisionalGroups())

  // Count what the MAIN-world scripts block (ad pruners on X/YouTube, the pop-up
  // guard everywhere). Attached early so stats capture blocks that happen before
  // settings finish loading.
  window.addEventListener('message', onPruneMessage)

  void start()
}

/**
 * Stats bridge for the MAIN-world pruners (`content/x-inpage.ts`,
 * `content/yt-inpage.ts`). The pruning itself happens there; here we only record
 * the counts they report back, attributed to the right source.
 */
function onPruneMessage(event: MessageEvent): void {
  const data = event.data as { source?: string, count?: unknown } | null
  if (!data) return

  // The MAIN world is shared with the page, so treat counts as untrusted: cap
  // them (no real response carries hundreds of ads) and only record when the
  // feature is actually active, so allowlisted/disabled sites never accrue stats.
  const count = Math.min(Number(data.count), maxPruneEventCount)
  if (!Number.isFinite(count) || count <= 0) return

  // Pop-up blocks are reported from the guard in every frame — including the
  // player iframe, which posts up to this top window — so they are not required
  // to be same-window/same-origin. (Capped stats only.)
  if (data.source === popupBlockMessageSource) {
    if (popupBlockActive) {
      queueEvent('popup', 'other', count)
      scheduleEventFlush()
    }
    else if (!settingsResolved) {
      // Guard already blocked it but the toggle state is still loading — hold
      // the count and flush it in start() if pop-up blocking ends up enabled.
      earlyPopupBlocks = Math.min(earlyPopupBlocks + count, maxPruneEventCount)
    }
    return
  }

  // Ad-prune reports come only from the same-window MAIN pruner.
  if (event.source !== window || event.origin !== location.origin) return

  if (data.source === xPruneMessageSource && xPruneActive) {
    queueEvent('x', 'other', count)
    scheduleEventFlush()
  }
  else if (data.source === ytPruneMessageSource && ytPruneActive) {
    // Pruned JSON entries are placements (feed cells, shelves, ad pods) that
    // never rendered — credit them as placements, not as watched video ads.
    queueEvent('youtube', 'other', count)
    scheduleEventFlush()
  }
}

async function start(): Promise<void> {
  const settings = await loadSettings()
  const allowed = siteMatches(hostname, settings.allowedSites)
  const cosmeticOn = settings.enabled && !allowed && settings.cosmeticFiltering

  if (cosmeticOn) {
    cosmeticGroups = activeCosmeticGroups(cosmeticContext(settings))
    injectCosmeticStyle(cosmeticGroups)
  }
  else {
    removeCosmeticStyle()
  }

  // Tell the MAIN-world pruners whether to run, so they honor the global off
  // switch, the allowlist, and the relevant per-feature toggle.
  if (isX()) {
    xPruneActive = cosmeticOn
    window.postMessage({ source: xConfigMessageSource, enabled: cosmeticOn }, location.origin)
  }
  if (isYouTube()) {
    ytPruneActive = settings.enabled && !allowed && settings.youtubeEnhancements
    window.postMessage({ source: ytConfigMessageSource, enabled: ytPruneActive }, location.origin)
  }
  // The pop-up guard runs on every site, so always tell it whether to act.
  popupBlockActive = settings.enabled && !allowed && settings.popupBlocking
  window.postMessage({ source: popupConfigMessageSource, enabled: popupBlockActive }, location.origin)

  // Flush pop-up blocks the guard reported while settings were loading. When
  // pop-up blocking ended up disabled they are discarded, matching the toggles.
  settingsResolved = true
  if (popupBlockActive && earlyPopupBlocks > 0) {
    queueEvent('popup', 'other', earlyPopupBlocks)
    scheduleEventFlush()
  }
  earlyPopupBlocks = 0

  if (!settings.enabled || allowed) return

  sweep(settings, [document])
  observer = new MutationObserver(mutations => scheduleSweep(settings, mutations))
  observer.observe(document.documentElement, { childList: true, subtree: true })

  // YouTube toggles the skip button's visibility via class/attribute changes that
  // don't fire our childList observer, so poll the ad state directly. This makes
  // auto-skip reliable instead of depending on an unrelated mutation.
  if (settings.youtubeEnhancements && isYouTube()) {
    youtubeAdTimer = window.setInterval(() => handleYouTubeAds(), youtubeAdPollMs)
  }

  window.addEventListener('pagehide', () => {
    observer?.disconnect()
    if (youtubeAdTimer) window.clearInterval(youtubeAdTimer)
    flushEvents()
  }, { once: true })
}

/** Default-tier groups assuming enhancements on, for the pre-settings inject. */
function provisionalGroups(): ActiveCosmeticGroup[] {
  return activeCosmeticGroups({
    isYouTube: isYouTube(),
    isTwitch: isTwitch(),
    isX: isX(),
    youtubeEnhancements: true,
    twitchEnhancements: true,
    cookieConsent: false,
    aggressive: false,
  })
}

async function loadSettings(): Promise<ExtensionSettings> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get-dashboard' }) as RuntimeResponse<{ settings: ExtensionSettings }>
    return response.ok && response.data ? { ...defaultSettings, ...response.data.settings } : defaultSettings
  }
  catch {
    return defaultSettings
  }
}

function cosmeticContext(settings: ExtensionSettings): CosmeticContext {
  return {
    isYouTube: isYouTube(),
    isTwitch: isTwitch(),
    isX: isX(),
    youtubeEnhancements: settings.youtubeEnhancements,
    twitchEnhancements: settings.twitchEnhancements,
    cookieConsent: settings.cookieConsentFiltering,
    aggressive: settings.aggressiveCosmetic,
  }
}

/**
 * Hide matched placements up front with a stylesheet. CSS applies to elements
 * added later by YouTube's SPA without waiting for a mutation sweep, so feed ads
 * never flash in. The sweep below only counts what the CSS hides.
 *
 * Each selector gets its own rule on purpose: in a comma-joined selector list a
 * single invalid or unsupported selector (e.g. `:has()` on an old engine) makes
 * the browser discard the ENTIRE rule. Per-selector rules fail in isolation, so
 * one bad selector never disables the rest of the hiding.
 */
function injectCosmeticStyle(groups: readonly ActiveCosmeticGroup[]): void {
  const selectors = [...new Set(groups.flatMap(group => group.selectors))]
  if (!selectors.length) return

  let style = document.getElementById(styleId)
  if (!style) {
    style = document.createElement('style')
    style.id = styleId
    ;(document.head ?? document.documentElement).append(style)
  }

  style.textContent = selectors.map(selector => `${selector} { display: none !important; }`).join('\n')
}

function removeCosmeticStyle(): void {
  document.getElementById(styleId)?.remove()
}

function scheduleSweep(settings: ExtensionSettings, mutations: MutationRecord[]): void {
  if (!collectMutationRoots(mutations)) return
  if (sweepTimer) return

  sweepTimer = window.setTimeout(() => {
    sweepTimer = undefined
    sweep(settings, drainScanRoots())
  }, mutationSweepDelayMs)
}

function sweep(settings: ExtensionSettings, roots: readonly SelectorRoot[]): void {
  if (!roots.length) return

  if (settings.cosmeticFiltering && cosmeticGroups.length) countHiddenPlacements(roots)

  if (settings.cosmeticFiltering && isX()) hideXPromotedTweets(roots)

  if (settings.youtubeEnhancements && isYouTube()) handleYouTubeAds()

  if (settings.twitchEnhancements && isTwitch()) {
    recordTwitchVideoAds(roots)
  }

  scheduleEventFlush()
}

/** Runs every poll tick and on each sweep: click Skip, close overlays, speed ads. */
function handleYouTubeAds(): void {
  clickYouTubeSkip()
  closeYouTubeOverlayAd()
  fastForwardYouTubeAd()
  dismissYouTubeAntiAdblock()
}

/**
 * Ads that survive the source pruning (server-decided pods, stitched streams)
 * are ended instantly: seek the ad video to its end, which completes the ad
 * and advances the pod — verified against live ad pods, where fast-forwarding
 * alone crawls because the stream cannot buffer at 16x for a 90s+ ad. Until
 * the ad's duration is known (metadata still loading) the video is muted and
 * sped to 16x so not even a moment of the ad is heard. The viewer's rate and
 * mute state are captured and restored once the ad ends. Runs on every poll
 * tick, so each new ad in a pod is seeked as soon as it becomes seekable.
 */
function fastForwardYouTubeAd(): void {
  const player = document.querySelector('.html5-video-player')
  const video = player?.querySelector('video')
  if (!(video instanceof HTMLVideoElement)) return

  const adShowing = player?.classList.contains('ad-showing') ?? false

  if (adShowing) {
    if (adRestoreRate === undefined) {
      adRestoreRate = video.playbackRate
      adRestoreMuted = video.muted
      queueEvent('video', 'media', 1, estimateVideoAdBytes(), estimateVideoSecondsSaved())
    }
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
  }
  else if (adRestoreRate !== undefined) {
    // Ad ended — restore the viewer's chosen speed and sound for the real video.
    try {
      video.playbackRate = adRestoreRate
      if (adRestoreMuted !== undefined) video.muted = adRestoreMuted
    }
    catch {
      // Ignore; YouTube manages the player state from here.
    }
    adRestoreRate = undefined
    adRestoreMuted = undefined
  }
}

/**
 * When YouTube shows its "ad blockers violate Terms" enforcement modal it also
 * dims the page, pauses the video, and engages its overlay scroll lock. The
 * cosmetic stylesheet hides the modal card, but hiding is not enough: while the
 * dialog is still OPEN, YouTube's overlay manager keeps fighting the user's
 * scrolling (the page snaps back on every attempt, so it judders up and down
 * and cannot be scrolled), and the dialog's own Dismiss button is invisible so
 * the user cannot end it either. So close the dialog for real and drop it from
 * the DOM — which releases the scroll lock and lets the `:has()` rule stop
 * hiding `ytd-popup-container`, where every ordinary YouTube menu renders —
 * then clear the backdrop, restore scrolling, and resume playback. All of it
 * only when the enforcement message is actually present, so ordinary dialogs
 * and menus are untouched.
 */
function dismissYouTubeAntiAdblock(): void {
  const message = document.querySelector('ytd-enforcement-message-view-model, ytd-enforcement-message-renderer')
  if (!message) return

  if (!antiAdblockSeen.has(message)) {
    antiAdblockSeen.add(message)
    queueEvent('youtube', 'other')
  }

  const dialog = message.closest('tp-yt-paper-dialog')
  if (dialog) {
    const close = (dialog as Element & { close?: unknown }).close
    if (typeof close === 'function') {
      try {
        (close as (this: Element) => void).call(dialog)
      }
      catch {
        // The detach below still forces the overlay manager to let go.
      }
    }
    dialog.remove()
  }
  else {
    message.remove()
  }

  for (const backdrop of document.querySelectorAll('tp-yt-iron-overlay-backdrop')) backdrop.remove()

  document.documentElement.style.setProperty('overflow', 'auto', 'important')
  document.body?.style.setProperty('overflow', 'auto', 'important')

  const video = document.querySelector('.html5-video-player video')
  if (video instanceof HTMLVideoElement && video.paused) void video.play().catch(() => {})
}

type SelectorRoot = Document | Element

/**
 * Tag and count elements the cosmetic stylesheet is hiding. Hiding already
 * happened via CSS; this only attributes each newly-matched node to its
 * selector for per-page diagnostics and the blocked-count metric.
 */
function countHiddenPlacements(roots: readonly SelectorRoot[]): void {
  let hidConsent = false
  for (const group of cosmeticGroups) {
    for (const selector of group.selectors) {
      for (const root of roots) {
        for (const element of queryAllSafe(root, selector)) {
          if (seen.has(element)) continue
          seen.add(element)
          element.setAttribute('data-adblock-hidden', 'true')
          selectorHits.set(selector, (selectorHits.get(selector) ?? 0) + 1)
          queueEvent(group.source, group.category)
          if (group.source === 'consent') hidConsent = true
        }
      }
    }
  }

  // Consent overlays usually scroll-lock the page; once we hide one, undo the lock
  // so the page stays usable.
  if (hidConsent) restoreConsentScroll()
}

const consentScrollLockClasses = ['ot-lock', 'modal-open', 'didomi-popup-open', 'cmplz-blocked', 'sp-message-open', 'no-scroll', 'cky-consent', 'cookiebot-scroll-lock']

function restoreConsentScroll(): void {
  document.documentElement.style.setProperty('overflow', 'auto', 'important')
  document.body?.style.setProperty('overflow', 'auto', 'important')
  for (const className of consentScrollLockClasses) {
    document.documentElement.classList.remove(className)
    document.body?.classList.remove(className)
  }
}

/**
 * Click the Skip button whenever it is visible in the player. We click on every
 * poll tick it is present so a click that lands before YouTube wires the
 * handler still gets retried, and count each button once. Scans the whole
 * document, not just mutation roots, since the button often becomes visible
 * without a childList mutation. Only while a player is actually in an ad:
 * YouTube keeps skip buttons in the DOM after the ad ends, and a leftover that
 * still passes the visibility check would otherwise be re-clicked forever,
 * poking the player every poll tick.
 */
function clickYouTubeSkip(): void {
  if (!document.querySelector('.html5-video-player.ad-showing, .html5-video-player.ad-interrupting')) return

  for (const button of document.querySelectorAll(youtubeSkipSelectors)) {
    if (!(button instanceof HTMLElement) || !isVisible(button)) continue
    button.click()
    if (!seen.has(button)) {
      seen.add(button)
      queueEvent('video', 'media', 1, estimateVideoAdBytes(), estimateVideoSecondsSaved())
    }
  }
}

/** Dismiss the small banner ad overlaid on the video. */
function closeYouTubeOverlayAd(): void {
  for (const button of document.querySelectorAll('.ytp-ad-overlay-close-button, .ytp-ad-overlay-close-container button')) {
    if (button instanceof HTMLElement && isVisible(button) && !seen.has(button)) {
      seen.add(button)
      button.click()
      queueEvent('youtube', 'other')
    }
  }
}

function isVisible(element: HTMLElement): boolean {
  return element.offsetParent !== null || element.getClientRects().length > 0
}

/**
 * Hide promoted tweets in the X timeline — the DOM fallback behind the MAIN-world
 * network pruner (`content/x-inpage.ts`). The pruner removes promoted entries
 * from GraphQL responses so they never render; this catches any stragglers
 * (e.g. an endpoint the pruner missed, or when it is unavailable). We cannot use
 * a CSS selector because the only reliable DOM marker is the "Ad" / "Promoted"
 * label — and X reuses its media-container test ids on ordinary tweets, so
 * matching those would hide real posts. Instead we walk each timeline cell,
 * confirm the label, and hide the whole cell while counting it for stats.
 */
function hideXPromotedTweets(roots: readonly SelectorRoot[]): void {
  for (const root of roots) {
    for (const cell of queryAllSafe(root, 'div[data-testid="cellInnerDiv"]')) {
      if (seen.has(cell)) continue

      // Skip until the tweet has actually rendered so we don't mark an empty cell
      // seen and miss the label that appears a tick later.
      const article = cell.querySelector('article')
      if (!article) continue

      // Mark every rendered cell seen — promoted status is fixed at render, so a
      // non-promoted cell never needs re-checking on later sweeps.
      seen.add(cell)
      if (!isPromotedTweet(article)) continue

      cell.setAttribute('data-adblock-hidden', 'true')
      if (cell instanceof HTMLElement) cell.style.setProperty('display', 'none', 'important')
      selectorHits.set('x:promoted-tweet', (selectorHits.get('x:promoted-tweet') ?? 0) + 1)
      queueEvent('x', 'other')
    }
  }
}

/**
 * A tweet is promoted when it carries a standalone "Ad" / "Promoted" label. We
 * only accept leaf spans outside the tweet body and author name so a post that
 * merely contains the word "Ad" in its text is never mistaken for one.
 */
function isPromotedTweet(article: Element): boolean {
  for (const span of article.querySelectorAll('span')) {
    if (span.childElementCount > 0) continue
    const text = span.textContent?.trim()
    if (!text || !xPromotedLabels.has(text)) continue
    if (span.closest('[data-testid="tweetText"], [data-testid="User-Name"]')) continue
    return true
  }

  return false
}

/**
 * Twitch re-renders its ad markers constantly during a break (the countdown
 * ticks every second) and each re-render is a NEW element, so element identity
 * alone can't dedupe them. Credit at most one video ad per window while fresh
 * markers keep appearing — roughly one 15–30 s ad per half minute of break.
 */
const twitchVideoCreditWindowMs = 30_000
let lastTwitchVideoCreditAt = 0

function recordTwitchVideoAds(roots: readonly SelectorRoot[]): void {
  let freshMarker = false
  for (const selector of twitchVideoAdMarkers) {
    for (const root of roots) {
      for (const marker of queryAllSafe(root, selector)) {
        if (videoMarkersSeen.has(marker)) continue
        videoMarkersSeen.add(marker)
        freshMarker = true
      }
    }
  }

  const now = Date.now()
  if (freshMarker && now - lastTwitchVideoCreditAt >= twitchVideoCreditWindowMs) {
    lastTwitchVideoCreditAt = now
    queueEvent('video', 'media', 1, estimateVideoAdBytes(), estimateVideoSecondsSaved())
  }
}

function queryAllSafe(root: SelectorRoot, selector: string): Element[] {
  try {
    const matches: Element[] = []
    if (root instanceof Element && root.matches(selector)) matches.push(root)
    matches.push(...root.querySelectorAll(selector))
    return matches
  }
  catch {
    return []
  }
}

function queueEvent(source: BlockSource, category: ResourceCategory, count = 1, bytesSaved = estimateBytesSaved(category, count), videoSecondsSaved = 0): void {
  const key = `${source}:${category}`
  const existing = pending.get(key)
  if (existing) {
    existing.count += count
    existing.bytesSaved = (existing.bytesSaved ?? 0) + bytesSaved
    existing.videoSecondsSaved = (existing.videoSecondsSaved ?? 0) + videoSecondsSaved
    existing.occurredAt = new Date().toISOString()
    return
  }

  pending.set(key, {
    hostname,
    source,
    category,
    count,
    bytesSaved,
    videoSecondsSaved,
    occurredAt: new Date().toISOString(),
  })
}

function collectMutationRoots(mutations: MutationRecord[]): boolean {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element) || seen.has(node)) continue

      pendingRoots.add(node)
      if (pendingRoots.size > maxPendingRoots) {
        pendingRoots.clear()
        scanDocumentOnNextSweep = true
        return true
      }
    }
  }

  return scanDocumentOnNextSweep || pendingRoots.size > 0
}

function drainScanRoots(): SelectorRoot[] {
  if (scanDocumentOnNextSweep) {
    scanDocumentOnNextSweep = false
    pendingRoots.clear()
    return [document]
  }

  const roots = [...pendingRoots].filter(root => root.isConnected)
  pendingRoots.clear()
  return roots
}

function scheduleEventFlush(): void {
  if (eventFlushTimer) return
  if (!pending.size && !selectorHits.size) return
  eventFlushTimer = window.setTimeout(() => {
    eventFlushTimer = undefined
    flushEvents()
  }, eventFlushDelayMs)
}

function flushEvents(): void {
  if (eventFlushTimer) {
    window.clearTimeout(eventFlushTimer)
    eventFlushTimer = undefined
  }

  if (pending.size) {
    const events = [...pending.values()]
    pending.clear()
    void chrome.runtime.sendMessage({ type: 'record-blocks', events })
  }

  if (selectorHits.size) {
    const hits = [...selectorHits.entries()].map(([selector, count]) => ({ selector, count }))
    selectorHits.clear()
    void chrome.runtime.sendMessage({ type: 'record-cosmetic', hostname, hits })
  }
}

function isYouTube(): boolean {
  return hostname === 'youtube.com' || hostname.endsWith('.youtube.com')
}

function isTwitch(): boolean {
  return hostname === 'twitch.tv' || hostname.endsWith('.twitch.tv')
}

function isX(): boolean {
  return hostname === 'x.com' || hostname.endsWith('.x.com') || hostname === 'twitter.com' || hostname.endsWith('.twitter.com')
}
