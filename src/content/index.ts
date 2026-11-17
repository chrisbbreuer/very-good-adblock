import { isClickCatcherElement } from '../shared/click-catcher'
import { popupBlockMessageSource, popupConfigMessageSource, twitchVideoAdMarkers, xConfigMessageSource, xPromotedLabels, xPruneMessageSource, ytConfigMessageSource, ytPruneMessageSource } from '../shared/constants'
import { activeCosmeticGroups } from '../shared/cosmetic'
import type { ActiveCosmeticGroup, CosmeticContext } from '../shared/cosmetic'
import { hostnameFromUrl, siteMatches } from '../shared/domain'
import { estimateBytesSaved, estimateVideoAdBytes, estimateVideoSecondsSaved } from '../shared/metrics'
import { defaultSettings } from '../shared/storage'
import type { BlockEvent, BlockSource, ExtensionSettings, ResourceCategory, RuntimeResponse } from '../shared/types'
import { createTwitchAdSuppressor } from './twitch-ads'
import { createYouTubePlayerDefense } from './youtube-player'

const hostname = hostnameFromUrl(location.href)
const seen = new WeakSet<Element>()
const videoMarkersSeen = new WeakSet<Element>()
const antiAdblockSeen = new WeakSet<Element>()
const clickCatchersSeen = new WeakSet<Element>()
const clickCatchersWatched = new WeakSet<Element>()
const pending = new Map<string, BlockEvent>()
const selectorHits = new Map<string, number>()
const pendingRoots = new Set<Element>()
const styleId = 'very-good-adblock-cosmetics'
const clickThroughStyleId = 'very-good-adblock-click-through'
const clickCatcherClass = 'very-good-adblock-click-through'
const mutationSweepDelayMs = 150
const eventFlushDelayMs = 1_000
const maxPruneEventCount = 200
const maxPendingRoots = 80
const youtubeAdPollMs = 300
const twitchAdPollMs = 500
let cosmeticGroups: ActiveCosmeticGroup[] = []
let observer: MutationObserver | undefined
let sweepTimer: number | undefined
let eventFlushTimer: number | undefined
let youtubeAdTimer: number | undefined
let twitchAdTimer: number | undefined
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
    // Any frame can post this, ad iframes included, so the count is a claim,
    // not a fact. Beyond the per-message cap, a page gets a small budget per
    // second; a real pop-up storm is a handful of windows, not hundreds.
    const allowed = takePopupReportBudget(count)
    if (allowed <= 0) return
    if (popupBlockActive) {
      queueEvent('popup', 'other', allowed)
      scheduleEventFlush()
    }
    else if (!settingsResolved) {
      // Guard already blocked it but the toggle state is still loading — hold
      // the count and flush it in start() if pop-up blocking ends up enabled.
      earlyPopupBlocks = Math.min(earlyPopupBlocks + allowed, maxPruneEventCount)
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

const popupReportBudgetPerSecond = 10
let popupReportWindowStart = 0
let popupReportsInWindow = 0

/** How much of a reported count fits this second's budget (0 when spent). */
function takePopupReportBudget(count: number): number {
  const now = Date.now()
  if (now - popupReportWindowStart >= 1_000) {
    popupReportWindowStart = now
    popupReportsInWindow = 0
  }
  const allowed = Math.max(0, Math.min(count, popupReportBudgetPerSecond - popupReportsInWindow))
  popupReportsInWindow += allowed
  return allowed
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
  armPageWatchers(settings)

  window.addEventListener('pagehide', disarmPageWatchers)
  // A page restored from the back/forward cache keeps this script alive, but
  // pagehide tore its watchers down: without re-arming, cosmetic counting and
  // YouTube auto-skip silently stopped on every back-navigation.
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return
    sweep(settings, [document])
    armPageWatchers(settings)
  })
}

function armPageWatchers(settings: ExtensionSettings): void {
  disarmPageWatchers()
  observer = new MutationObserver(mutations => scheduleSweep(settings, mutations))
  observer.observe(document.documentElement, { childList: true, subtree: true })

  // YouTube toggles the skip button's visibility via class/attribute changes that
  // don't fire our childList observer, so poll the ad state directly. This makes
  // auto-skip reliable instead of depending on an unrelated mutation.
  if (settings.youtubeEnhancements && isYouTube()) {
    youtubeAdTimer = window.setInterval(() => handleYouTubeAds(), youtubeAdPollMs)
  }

  // Same reason as YouTube's poll: a break ends when Twitch removes its markers,
  // and a stream that is otherwise still can leave the cover up waiting for a
  // mutation that never comes. The poll takes it off on its own.
  if (settings.twitchEnhancements && isTwitch()) {
    twitchAdTimer = window.setInterval(() => twitchAds.update(), twitchAdPollMs)
  }
}

function disarmPageWatchers(): void {
  observer?.disconnect()
  observer = undefined
  if (youtubeAdTimer) window.clearInterval(youtubeAdTimer)
  if (twitchAdTimer) window.clearInterval(twitchAdTimer)
  youtubeAdTimer = undefined
  twitchAdTimer = undefined
  twitchAds.restore()
  flushEvents()
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

/**
 * Settings from whoever answers the message: the extension's worker, or the
 * app embedding this script through the WebKit library. `get-settings` is the
 * lean request (no dashboard work behind it); `get-dashboard` is the original
 * one, which WebKit apps built against the published contract answer, so it
 * is asked second when the first gets no answer.
 */
async function loadSettings(): Promise<ExtensionSettings> {
  for (const type of ['get-settings', 'get-dashboard'] as const) {
    try {
      const response = await chrome.runtime.sendMessage({ type }) as RuntimeResponse<{ settings: ExtensionSettings }> | undefined
      if (response?.ok && response.data?.settings) return { ...defaultSettings, ...response.data.settings }
    }
    catch {
      // No handler for this one; try the next, then fall back to the defaults.
    }
  }
  return defaultSettings
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

  if (settings.popupBlocking) neutralizeClickCatchers()

  if (settings.cosmeticFiltering && isX()) hideXPromotedTweets(roots)

  if (settings.youtubeEnhancements && isYouTube()) handleYouTubeAds()

  if (settings.twitchEnhancements && isTwitch()) handleTwitchVideoAds(roots)
  else twitchAds.restore()

  scheduleEventFlush()
}

/**
 * Let clicks through the invisible lid pop-under networks lay over the page.
 *
 * Making the lid click-through rather than removing it is deliberate: the
 * user's click lands on what they were aiming at (the player's play button),
 * while the ad script's own element stays where it left it, so nothing it does
 * later depends on a node that vanished underneath it.
 *
 * The rule is a class plus a stylesheet, not an inline style, because the
 * script rewrites its element's `style` attribute and would wipe an inline
 * `pointer-events` straight back off. An `!important` declaration in our own
 * stylesheet outranks the page's inline style, so the lid stays inert as long
 * as the class does — and `watchClickCatcher` puts the class back if it goes.
 *
 * Only top-level children are measured. A lid has to sit above unrelated
 * content to work, which in practice puts it at the end of `<body>`, and
 * limiting the scan keeps the cost at a handful of `getComputedStyle` calls per
 * sweep instead of one per element on the page.
 */
function neutralizeClickCatchers(): void {
  const candidates = [
    ...(document.body?.children ?? []),
    ...(document.documentElement?.children ?? []),
  ]

  let neutralized = 0
  for (const element of candidates) {
    // A lid we already defused reports `pointer-events: none` and no longer
    // matches, so this only ever sees live ones — including a lid the page
    // rebuilt after we defused the last.
    if (!isClickCatcherElement(element)) continue

    injectClickThroughStyle()
    element.classList.add(clickCatcherClass)
    watchClickCatcher(element)

    // Count each element once, however many times the page revives it.
    if (clickCatchersSeen.has(element)) continue
    clickCatchersSeen.add(element)
    neutralized++
  }

  if (neutralized > 0) queueEvent('popup', 'other', neutralized)
}

/** The one rule that makes a defused lid click-through, injected on first use. */
function injectClickThroughStyle(): void {
  if (document.getElementById(clickThroughStyleId)) return

  const style = document.createElement('style')
  style.id = clickThroughStyleId
  style.textContent = `.${clickCatcherClass} { pointer-events: none !important; }`
  ;(document.head ?? document.documentElement).append(style)
}

/**
 * Put the class back if the page strips it.
 *
 * These scripts rewrite their overlay's attributes to keep it on top, which can
 * take our class with it. The sweep alone would not notice: rewriting an
 * attribute fires no `childList` mutation, so nothing would re-run until some
 * unrelated part of the page changed.
 */
function watchClickCatcher(element: Element): void {
  if (clickCatchersWatched.has(element)) return
  clickCatchersWatched.add(element)

  const observer = new MutationObserver(() => {
    if (!element.classList.contains(clickCatcherClass)) element.classList.add(clickCatcherClass)
  })
  observer.observe(element, { attributes: true, attributeFilter: ['class', 'style'] })
}

/** Runs every poll tick and on each sweep: click Skip, close overlays, speed ads. */
function handleYouTubeAds(): void {
  youtubePlayer.tick()
  dismissYouTubeAntiAdblock()
}

// Skip, overlay close and fast-forward are the player's, shared with players
// embedded in other sites (see youtube-player.ts and yt-embed.ts).
const youtubePlayer = createYouTubePlayerDefense({
  videoAd: () => queueEvent('video', 'media', 1, estimateVideoAdBytes(), estimateVideoSecondsSaved()),
  overlay: () => queueEvent('youtube', 'other'),
})

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

  // Count the modal once: when the cosmetic pass already hid (and counted) it,
  // dismissing it is the same block, not a second one.
  if (!antiAdblockSeen.has(message)) {
    antiAdblockSeen.add(message)
    if (!message.closest('[data-adblock-hidden]') && !message.querySelector('[data-adblock-hidden]')) {
      message.setAttribute('data-adblock-hidden', 'true')
      queueEvent('youtube', 'other')
    }
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
          // One ad, one count. Ad markup nests (a GPT slot wraps a container
          // wrapping an iframe; an AdSense <ins> wraps its iframe; a YouTube
          // feed cell wraps its ad renderer), and several selectors match the
          // layers, so each layer used to count as another ad. Whichever layer
          // is reached first counts; the others are tagged and skipped,
          // whatever order the selectors run in.
          const nested = isInsideHiddenPlacement(element)
          element.setAttribute('data-adblock-hidden', 'true')
          if (nested) continue
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

/** Whether an ancestor or descendant was already counted as a hidden placement. */
function isInsideHiddenPlacement(element: Element): boolean {
  return Boolean(element.parentElement?.closest('[data-adblock-hidden]') || element.querySelector('[data-adblock-hidden]'))
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
const twitchAds = createTwitchAdSuppressor()

function handleTwitchVideoAds(roots: readonly SelectorRoot[]): void {
  // Mute and cover the player for the length of the break. The stitched ad is
  // the stream itself, so this is suppression, not removal — see twitch-ads.ts.
  twitchAds.update()

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

  // Counted, but credited nothing. Twitch stitches the ad into the stream
  // itself, so muting and covering it saves no bandwidth and no time (the
  // break still runs its length; see twitch-ads.ts). It used to claim 2.5 MB
  // and 15 s of "video time saved" per window, under "Video skips".
  const now = Date.now()
  if (freshMarker && now - lastTwitchVideoCreditAt >= twitchVideoCreditWindowMs) {
    lastTwitchVideoCreditAt = now
    queueEvent('twitch', 'media', 1, 0, 0)
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
    // Swallowed on purpose: once the extension reloads or updates, every open
    // page's sendMessage rejects with "Extension context invalidated". The
    // stats for that page are gone either way — the rejection must not become
    // an unhandled one the page logs over and over.
    void chrome.runtime.sendMessage({ type: 'record-blocks', events })?.catch(() => {})
  }

  if (selectorHits.size) {
    const hits = [...selectorHits.entries()].map(([selector, count]) => ({ selector, count }))
    selectorHits.clear()
    void chrome.runtime.sendMessage({ type: 'record-cosmetic', hostname, hits })?.catch(() => {})
  }
}

function isYouTube(): boolean {
  return hostname === 'youtube.com' || hostname.endsWith('.youtube.com')
    // Privacy-enhanced embeds run the same player on their own host.
    || hostname === 'youtube-nocookie.com' || hostname.endsWith('.youtube-nocookie.com')
}

function isTwitch(): boolean {
  return hostname === 'twitch.tv' || hostname.endsWith('.twitch.tv')
}

function isX(): boolean {
  return hostname === 'x.com' || hostname.endsWith('.x.com') || hostname === 'twitter.com' || hostname.endsWith('.twitter.com')
}
