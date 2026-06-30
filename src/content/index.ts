import { defaultCosmeticSelectors, twitchSelectors, twitchVideoAdMarkers, xSelectors, youtubeSelectors } from '../shared/constants'
import { hostnameFromUrl, siteMatches } from '../shared/domain'
import { estimateBytesSaved, estimateVideoSecondsSaved } from '../shared/metrics'
import { defaultSettings } from '../shared/storage'
import type { BlockEvent, BlockSource, ExtensionSettings, ResourceCategory, RuntimeResponse } from '../shared/types'

const hostname = hostnameFromUrl(location.href)
const seen = new WeakSet<Element>()
const videoMarkersSeen = new WeakSet<Element>()
const pending = new Map<string, BlockEvent>()
const pendingRoots = new Set<Element>()
const mutationSweepDelayMs = 150
const eventFlushDelayMs = 1_000
const maxPendingRoots = 80
let observer: MutationObserver | undefined
let sweepTimer: number | undefined
let eventFlushTimer: number | undefined
let scanDocumentOnNextSweep = false

void boot()

async function boot(): Promise<void> {
  const settings = await loadSettings()
  if (!settings.enabled || siteMatches(hostname, settings.allowedSites)) return

  sweep(settings, [document])
  observer = new MutationObserver(mutations => scheduleSweep(settings, mutations))
  observer.observe(document.documentElement, { childList: true, subtree: true })

  window.addEventListener('pagehide', () => {
    observer?.disconnect()
    flushEvents()
  }, { once: true })
}

async function loadSettings(): Promise<ExtensionSettings> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get-dashboard' }) as RuntimeResponse<{ settings: ExtensionSettings }>
    return response.ok && response.data ? response.data.settings : defaultSettings
  }
  catch {
    return defaultSettings
  }
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

  if (settings.cosmeticFiltering) hideSelectors(defaultCosmeticSelectors, roots, 'cosmetic', 'other')

  if (settings.youtubeEnhancements && isYouTube()) {
    clickYouTubeSkip(roots)
    hideSelectors(youtubeSelectors, roots, 'youtube', 'media')
  }

  if (settings.twitchEnhancements && isTwitch()) {
    recordTwitchVideoAds(roots)
    hideSelectors(twitchSelectors, roots, 'twitch', 'media')
  }

  if (settings.xEnhancements && isX()) {
    hidePromotedArticles(roots)
    hideSelectors(xSelectors, roots, 'x', 'xhr')
  }

  scheduleEventFlush()
}

type SelectorRoot = Document | Element

function hideSelectors(selectors: readonly string[], roots: readonly SelectorRoot[], source: BlockSource, category: ResourceCategory): void {
  for (const selector of selectors) {
    for (const root of roots) {
      for (const element of queryAllSafe(root, selector)) {
        hideElement(element, source, category)
      }
    }
  }
}

function hidePromotedArticles(roots: readonly SelectorRoot[]): void {
  for (const root of roots) {
    for (const article of queryAllSafe(root, 'article')) {
      hidePromotedArticle(article)
    }

    if (root instanceof Element) {
      const article = root.closest('article')
      if (article) hidePromotedArticle(article)
    }
  }
}

function hidePromotedArticle(article: Element): void {
  if (seen.has(article)) return
  const text = article.textContent?.toLowerCase() ?? ''
  if (text.includes('promoted')) hideElement(article, 'x', 'xhr')
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

function hideElement(element: Element, source: BlockSource, category: ResourceCategory): void {
  if (seen.has(element)) return
  seen.add(element)
  element.setAttribute('data-adblock-hidden', 'true')
  if (element instanceof HTMLElement) {
    element.style.setProperty('display', 'none', 'important')
    element.style.setProperty('visibility', 'hidden', 'important')
  }
  queueEvent(source, category)
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
  if (!pending.size || eventFlushTimer) return
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

  if (!pending.size) return
  const events = [...pending.values()]
  pending.clear()
  void chrome.runtime.sendMessage({ type: 'record-blocks', events })
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
