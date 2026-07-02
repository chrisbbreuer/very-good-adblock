import { twitchVideoAdMarkers, xConfigMessageSource, xPromotedLabels, xPruneMessageSource, ytConfigMessageSource, ytPruneMessageSource } from '../shared/constants'
import { activeCosmeticGroups } from '../shared/cosmetic'
import type { ActiveCosmeticGroup, CosmeticContext } from '../shared/cosmetic'
import { hostnameFromUrl, siteMatches } from '../shared/domain'
import { estimateBytesSaved, estimateVideoSecondsSaved } from '../shared/metrics'
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
let cosmeticGroups: ActiveCosmeticGroup[] = []
let observer: MutationObserver | undefined
let sweepTimer: number | undefined
let eventFlushTimer: number | undefined
let scanDocumentOnNextSweep = false
let xPruneActive = false
let ytPruneActive = false

boot()

function boot(): void {
  // Kill the ad flash: at document_start, synchronously hide the default
  // placements before settings load. start() reconciles once settings arrive
  // (removing the style if the extension is off, the site is allowlisted, or
  // cosmetic filtering is disabled; adding aggressive selectors if enabled).
  injectCosmeticStyle(provisionalGroups())

  // Count ads the MAIN-world pruners remove at the network layer. Attached early
  // so stats capture ads pruned before settings finish loading.
  if (isX() || isYouTube()) window.addEventListener('message', onPruneMessage)

  void start()
}

/**
 * Stats bridge for the MAIN-world pruners (`content/x-inpage.ts`,
 * `content/yt-inpage.ts`). The pruning itself happens there; here we only record
 * the counts they report back, attributed to the right source.
 */
function onPruneMessage(event: MessageEvent): void {
  if (event.source !== window || event.origin !== location.origin) return
  const data = event.data as { source?: string, count?: unknown } | null
  if (!data) return

  // The MAIN world is shared with the page, so treat counts as untrusted: cap
  // them (no real response carries hundreds of ads) and only record when the
  // feature is actually active, so allowlisted/disabled sites never accrue stats.
  const count = Math.min(Number(data.count), maxPruneEventCount)
  if (!Number.isFinite(count) || count <= 0) return

  if (data.source === xPruneMessageSource && xPruneActive) {
    queueEvent('x', 'other', count)
    scheduleEventFlush()
  }
  else if (data.source === ytPruneMessageSource && ytPruneActive) {
    queueEvent('video', 'media', count, estimateBytesSaved('media', count), estimateVideoSecondsSaved() * count)
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

  if (!settings.enabled || allowed) return

  sweep(settings, [document])
  observer = new MutationObserver(mutations => scheduleSweep(settings, mutations))
  observer.observe(document.documentElement, { childList: true, subtree: true })

  window.addEventListener('pagehide', () => {
    observer?.disconnect()
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

  if (settings.youtubeEnhancements && isYouTube()) {
    clickYouTubeSkip(roots)
    fastForwardYouTubeAd()
    dismissYouTubeAntiAdblock()
  }

  if (settings.twitchEnhancements && isTwitch()) {
    recordTwitchVideoAds(roots)
  }

  scheduleEventFlush()
}

/**
 * Skippable ads have a Skip button (handled above). Non-skippable pre/mid-rolls
 * do not, so when the player marks itself `ad-showing` we jump the ad video to
 * its end and speed it up — YouTube then loads the real video immediately.
 */
function fastForwardYouTubeAd(): void {
  const player = document.querySelector('.html5-video-player')
  if (!player || !player.classList.contains('ad-showing')) return

  const video = player.querySelector('video')
  if (!(video instanceof HTMLVideoElement)) return

  const duration = video.duration
  if (!Number.isFinite(duration) || duration <= 0 || video.currentTime >= duration - 0.5) return

  const secondsSaved = Math.max(1, Math.round(duration - video.currentTime))
  try {
    video.currentTime = duration
    video.playbackRate = adFastForwardRate
  }
  catch {
    return
  }

  queueEvent('video', 'media', 1, estimateBytesSaved('media'), secondsSaved)
}

/**
 * When YouTube shows its "ad blockers violate Terms" enforcement modal it also
 * dims and scroll-locks the page and pauses the video. The cosmetic stylesheet
 * hides the modal card; here we clear the shared backdrop, restore scrolling,
 * and resume playback — only when the enforcement message is actually present,
 * so ordinary dialogs and menus are untouched.
 */
function dismissYouTubeAntiAdblock(): void {
  const message = document.querySelector('ytd-enforcement-message-view-model, ytd-enforcement-message-renderer')
  if (!message || antiAdblockSeen.has(message)) return
  antiAdblockSeen.add(message)

  for (const backdrop of document.querySelectorAll('tp-yt-iron-overlay-backdrop')) {
    if (backdrop instanceof HTMLElement) backdrop.style.setProperty('display', 'none', 'important')
  }

  document.documentElement.style.setProperty('overflow', 'auto', 'important')
  document.body?.style.setProperty('overflow', 'auto', 'important')

  const video = document.querySelector('.html5-video-player video')
  if (video instanceof HTMLVideoElement && video.paused) void video.play().catch(() => {})

  queueEvent('youtube', 'other')
}

type SelectorRoot = Document | Element

/**
 * Tag and count elements the cosmetic stylesheet is hiding. Hiding already
 * happened via CSS; this only attributes each newly-matched node to its
 * selector for per-page diagnostics and the blocked-count metric.
 */
function countHiddenPlacements(roots: readonly SelectorRoot[]): void {
  for (const group of cosmeticGroups) {
    for (const selector of group.selectors) {
      for (const root of roots) {
        for (const element of queryAllSafe(root, selector)) {
          if (seen.has(element)) continue
          seen.add(element)
          element.setAttribute('data-adblock-hidden', 'true')
          selectorHits.set(selector, (selectorHits.get(selector) ?? 0) + 1)
          queueEvent(group.source, group.category)
        }
      }
    }
  }
}

function clickYouTubeSkip(roots: readonly SelectorRoot[]): void {
  for (const root of roots) {
    for (const button of queryAllSafe(root, '.ytp-ad-skip-button, .ytp-skip-ad-button, button[class*="ytp-ad-skip"]')) {
      if (!(button instanceof HTMLButtonElement) || button.offsetParent === null || seen.has(button)) continue
      seen.add(button)
      button.click()
      queueEvent('video', 'media', 1, estimateBytesSaved('media'), estimateVideoSecondsSaved())
    }
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

function recordTwitchVideoAds(roots: readonly SelectorRoot[]): void {
  for (const selector of twitchVideoAdMarkers) {
    for (const root of roots) {
      for (const marker of queryAllSafe(root, selector)) {
        if (videoMarkersSeen.has(marker)) continue
        videoMarkersSeen.add(marker)
        queueEvent('video', 'media', 1, estimateBytesSaved('media'), estimateVideoSecondsSaved())
      }
    }
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
