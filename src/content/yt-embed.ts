import { ytConfigMessageSource, ytPruneMessageSource } from '../shared/constants'
import { estimateBytesSaved, estimateVideoAdBytes, estimateVideoSecondsSaved } from '../shared/metrics'
import type { BlockEvent, BlockSource, ResourceCategory, RuntimeResponse } from '../shared/types'
import { createYouTubePlayerDefense } from './youtube-player'

/**
 * YouTube players embedded in other sites (youtube.com/embed and
 * youtube-nocookie.com/embed iframes).
 *
 * A YouTube page and an embed run the same player, but they are different
 * jobs: the page content script owns a whole site (cosmetic filtering, pop-ups,
 * click-catchers), while an embed is only a player inside someone else's page.
 * So the page script stays top-frame only, and this small one takes the embed
 * frames: it switches the MAIN-world pruner (`yt-inpage.ts`) on or off, runs
 * the shared player safety net, and reports what both remove.
 *
 * Whether to act is decided against the page the user is on, not the embed's
 * own origin. Allow-listing a site lets its embedded videos play their ads too,
 * and the worker credits these blocks to that page, so they show up in its
 * badge and per-site stats.
 */
const maxPruneEventCount = 200
const playerPollMs = 300
const eventFlushDelayMs = 1_000

const pending = new Map<string, BlockEvent>()
let enabled: boolean | undefined
let earlyPruned = 0
let flushTimer: number | undefined
let pollTimer: number | undefined

// The top frame is the page content script's, including a youtube.com/embed
// URL opened directly; running both there would count every ad twice.
if (window.top !== window) {
  window.addEventListener('message', onPruneMessage)
  void start()
}

async function start(): Promise<void> {
  enabled = await loadEnabled()
  window.postMessage({ source: ytConfigMessageSource, enabled }, location.origin)

  // The pruner works from the first response, before this answer arrives;
  // what it removed in that gap counts only if the embed is on.
  if (enabled && earlyPruned > 0) queue('youtube', 'other', earlyPruned)
  earlyPruned = 0
  if (!enabled) return

  const player = createYouTubePlayerDefense({
    videoAd: () => queue('video', 'media', 1, estimateVideoAdBytes(), estimateVideoSecondsSaved()),
    overlay: () => queue('youtube', 'other', 1),
  })
  pollTimer = window.setInterval(() => player.tick(), playerPollMs)

  window.addEventListener('pagehide', () => {
    if (pollTimer) window.clearInterval(pollTimer)
    pollTimer = undefined
    flush()
  })
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && !pollTimer) pollTimer = window.setInterval(() => player.tick(), playerPollMs)
  })
}

async function loadEnabled(): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get-embed-config' }) as RuntimeResponse<{ enabled: boolean }>
    return response.ok && response.data ? response.data.enabled : true
  }
  catch {
    // The pruner defaults on; with no answer, stay consistent with it.
    return true
  }
}

/** Counts from the same-frame MAIN pruner. The world is shared with the page, so cap them. */
function onPruneMessage(event: MessageEvent): void {
  if (event.source !== window || event.origin !== location.origin) return
  const data = event.data as { source?: string, count?: unknown } | null
  if (!data || data.source !== ytPruneMessageSource) return

  const count = Math.min(Number(data.count), maxPruneEventCount)
  if (!Number.isFinite(count) || count <= 0) return

  if (enabled === undefined) earlyPruned = Math.min(earlyPruned + count, maxPruneEventCount)
  else if (enabled) queue('youtube', 'other', count)
}

function queue(source: BlockSource, category: ResourceCategory, count: number, bytesSaved: number = estimateBytesSaved(category, count), videoSecondsSaved = 0): void {
  const key = `${source}:${category}`
  const existing = pending.get(key)
  if (existing) {
    existing.count += count
    existing.bytesSaved = (existing.bytesSaved ?? 0) + bytesSaved
    existing.videoSecondsSaved = (existing.videoSecondsSaved ?? 0) + videoSecondsSaved
  }
  else {
    // The hostname is filled in by the worker: these blocks belong to the page
    // the embed sits in, which this frame cannot reliably name itself.
    pending.set(key, { hostname: '', source, category, count, bytesSaved, videoSecondsSaved, occurredAt: new Date().toISOString() })
  }
  if (!flushTimer) flushTimer = window.setTimeout(flush, eventFlushDelayMs)
}

function flush(): void {
  if (flushTimer) window.clearTimeout(flushTimer)
  flushTimer = undefined
  if (!pending.size) return
  const events = [...pending.values()]
  pending.clear()
  void chrome.runtime.sendMessage({ type: 'record-blocks', events }).catch(() => {})
}
