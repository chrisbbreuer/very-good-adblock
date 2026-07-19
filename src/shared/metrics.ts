import type { BlockEvent, ResourceCategory, StatBucket } from './types'

/**
 * Average compressed transfer size of a blocked request, per category. These
 * are deliberately modest: most blocked requests are tracker pings and beacons
 * (~1 KB), not full creatives, and a blocked media REQUEST is one HLS segment,
 * not a whole video — the full video-ad credit lives in estimateVideoAdBytes
 * and is applied only when an actual ad is skipped or neutralized.
 */
const byteEstimates: Record<ResourceCategory, number> = {
  document: 60_000,
  script: 40_000,
  image: 25_000,
  media: 250_000,
  stylesheet: 12_000,
  xhr: 2_000,
  font: 35_000,
  other: 6_000,
}

export function estimateBytesSaved(category: ResourceCategory, count = 1): number {
  return byteEstimates[category] * count
}

/** A whole blocked/skipped video ad creative (15–30 s at roughly 1 Mbps). */
export function estimateVideoAdBytes(count = 1): number {
  return count * 2_500_000
}

/** Map a network request type (webRequest / DNR match info) to a stat category. */
export function categoryForRequestType(type: string): ResourceCategory {
  switch (type) {
    case 'script':
      return 'script'
    case 'image':
      return 'image'
    case 'media':
      return 'media'
    case 'stylesheet':
      return 'stylesheet'
    case 'font':
      return 'font'
    case 'xmlhttprequest':
    case 'ping':
    case 'websocket':
    case 'beacon':
      return 'xhr'
    case 'main_frame':
    case 'sub_frame':
      return 'document'
    default:
      return 'other'
  }
}

export function estimateVideoSecondsSaved(count = 1): number {
  return count * 15
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = units[0]

  for (let index = 1; index < units.length && value >= 1024; index++) {
    value /= 1024
    unit = units[index]
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`
}

export function formatMinutes(seconds: number): string {
  const minutes = seconds / 60
  if (minutes < 60) return `${minutes >= 10 ? minutes.toFixed(0) : minutes.toFixed(1)} min`
  const hours = minutes / 60
  return `${hours >= 10 ? hours.toFixed(0) : hours.toFixed(1)} hr`
}

export function compactBuckets(buckets: StatBucket[], limit: number): StatBucket[] {
  return [...buckets].sort((a, b) => a.key.localeCompare(b.key)).slice(-limit)
}

/**
 * YYYY-MM-DD in the user's local timezone. Daily buckets follow the local
 * calendar so "Blocked today" rolls over at local midnight, and the chart's
 * day labels (parsed as local dates) match the day the user experienced.
 */
export function localDayKey(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function eventTotals(events: BlockEvent[]): Pick<StatBucket, 'adsBlocked' | 'bytesSaved' | 'videoSecondsSaved'> {
  return events.reduce(
    (totals, event) => {
      totals.adsBlocked += event.count
      totals.bytesSaved += event.bytesSaved ?? estimateBytesSaved(event.category, event.count)
      totals.videoSecondsSaved += event.videoSecondsSaved ?? 0
      return totals
    },
    { adsBlocked: 0, bytesSaved: 0, videoSecondsSaved: 0 },
  )
}
