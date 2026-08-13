import { hostnameFromUrl } from './domain'

/**
 * Why a top-level page was stopped, which is the only thing that changes the
 * interstitial's wording: a filter-list match ("we blocked it") reads very
 * differently from a site the user added to their own block list.
 */
export type BlockedReason = 'filter' | 'user'

export interface BlockedPageParams {
  /** The blocked destination, validated as http(s). */
  url: string
  hostname: string
  reason: BlockedReason
}

/** Built into the extension root by the page pipeline (config/extension.ts). */
export const blockedPageFile = 'blocked.html'

/** How long "Continue anyway" keeps the destination reachable, in minutes. */
export const bypassMinutes = 15

export function blockedPageQuery(url: string, reason: BlockedReason): string {
  return `?${new URLSearchParams({ url, reason }).toString()}`
}

/**
 * Read back what `blockedPageQuery` wrote. The URL is re-validated here rather
 * than trusted: the interstitial navigates to it and offers to unblock its
 * host, so a `javascript:`/`data:` value in the query string must never make it
 * that far, even though the page is not web-accessible.
 */
export function parseBlockedPageParams(search: string): BlockedPageParams | undefined {
  const params = new URLSearchParams(search)
  const url = safeNavigationUrl(params.get('url') ?? '')
  if (!url) return undefined

  const hostname = hostnameFromUrl(url)
  if (!hostname) return undefined

  return { url, hostname, reason: params.get('reason') === 'user' ? 'user' : 'filter' }
}

/** The blocked URL, or undefined when it is anything but a real http(s) page. */
export function safeNavigationUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    return parsed.toString()
  }
  catch {
    return undefined
  }
}

/**
 * The URL as a person reads it: scheme and trailing slash dropped, and a long
 * tracking path elided in the middle so both the host and the tail stay
 * visible (SMS and email links are mostly opaque IDs).
 */
export function displayUrl(url: string, maxLength = 72): string {
  const trimmed = url.replace(/^https?:\/\//, '').replace(/\/$/, '')
  if (trimmed.length <= maxLength) return trimmed

  const head = Math.ceil((maxLength - 1) / 2)
  const tail = Math.floor((maxLength - 1) / 2)
  return `${trimmed.slice(0, head)}…${trimmed.slice(trimmed.length - tail)}`
}
