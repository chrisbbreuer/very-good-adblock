import type { BlockEvent, ResourceCategory, StatBucket } from './types'

const byteEstimates: Record<ResourceCategory, number> = {
  document: 180_000,
  script: 52_000,
  image: 92_000,
  media: 2_800_000,
  stylesheet: 18_000,
  xhr: 34_000,
  font: 42_000,
  other: 24_000,
}

export function estimateBytesSaved(category: ResourceCategory, count = 1): number {
  return byteEstimates[category] * count
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
