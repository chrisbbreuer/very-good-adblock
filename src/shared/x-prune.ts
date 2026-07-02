/**
 * Source-level removal of X / Twitter promoted tweets.
 *
 * X delivers its timelines as GraphQL JSON whose entries carry a
 * `content.itemContent.promotedMetadata` object on ads (and inside module items
 * for threads). uBlock Origin removes promoted tweets by pruning exactly those
 * entries from the response before the app renders them — locale-independent, no
 * flash, and no DOM guessing. We reimplement that idea here (the pruning walk is
 * ours; the field name is a fact about X's API, not copied code).
 *
 * These helpers are pure so they can be unit-tested without a browser; the
 * MAIN-world content script (`content/x-inpage.ts`) applies them to live fetch
 * responses.
 */

/** True for X GraphQL endpoints whose responses may carry timeline entries. */
export function isXGraphqlUrl(url: string): boolean {
  return url.includes('/i/api/graphql/') || url.includes('/graphql/') || url.includes('/graphql?')
}

interface TimelineEntry {
  entryId?: unknown
  content?: {
    itemContent?: { promotedMetadata?: unknown }
    items?: Array<{ item?: { itemContent?: { promotedMetadata?: unknown } } }>
  }
}

/** An entry is an ad when it (or any of its module items) carries promotedMetadata. */
function entryIsPromoted(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false
  const typed = entry as TimelineEntry

  const content = typed.content
  if (!content || typeof content !== 'object') return false

  // The `promoted-` id prefix is only trusted on real timeline entries (those
  // with a `content` object), so an unrelated `entries` array whose elements
  // merely have such an id is never pruned.
  if (typeof typed.entryId === 'string' && typed.entryId.startsWith('promoted-')) return true

  if (content.itemContent?.promotedMetadata) return true

  if (Array.isArray(content.items)) {
    for (const moduleItem of content.items) {
      if (moduleItem?.item?.itemContent?.promotedMetadata) return true
    }
  }

  return false
}

/**
 * Walk a parsed GraphQL response and drop promoted entries from every `entries`
 * array in it, in place. Non-timeline `entries` arrays are untouched because
 * their elements never satisfy `entryIsPromoted`. Returns how many entries were
 * removed so the caller can attribute the block for stats.
 */
export function prunePromotedFromTimeline(data: unknown): number {
  let removed = 0
  const visited = new WeakSet<object>()

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (visited.has(node)) return
    visited.add(node)

    if (Array.isArray(node)) {
      for (const element of node) walk(element)
      return
    }

    const record = node as Record<string, unknown>
    for (const key of Object.keys(record)) {
      const value = record[key]

      if (key === 'entries' && Array.isArray(value)) {
        const kept = value.filter(entry => !entryIsPromoted(entry))
        removed += value.length - kept.length
        record[key] = kept
        for (const entry of kept) walk(entry)
        continue
      }

      walk(value)
    }
  }

  walk(data)
  return removed
}
