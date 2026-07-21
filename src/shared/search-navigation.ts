import { normalizeHostname } from './domain'

/** Search providers are valid top-level destinations and must never be learned
 * as ad hosts from a remotely refreshed list. */
export function isProtectedSearchHost(hostname: string): boolean {
  const host = normalizeHostname(hostname)
  if (/^google\.(?:com|[a-z]{2,3}(?:\.[a-z]{2})?)$/.test(host)) return true

  return [
    'bing.com',
    'duckduckgo.com',
    'ecosia.org',
    'kagi.com',
    'search.brave.com',
    'search.yahoo.com',
    'startpage.com',
  ].includes(host)
}

/** Whether a URL is an actual results page produced by a browser search. */
export function isSearchResultsUrl(url?: string): boolean {
  if (!url) return false

  try {
    const parsed = new URL(url)
    const host = normalizeHostname(parsed.hostname)
    if (!isProtectedSearchHost(host)) return false

    if (/^google\./.test(host)) return parsed.pathname === '/search' && parsed.searchParams.has('q')
    if (host === 'search.yahoo.com') return parsed.pathname === '/search' && parsed.searchParams.has('p')
    if (host === 'duckduckgo.com') return (parsed.pathname === '/' || parsed.pathname === '/html/') && parsed.searchParams.has('q')
    return parsed.pathname.startsWith('/search') && parsed.searchParams.has('q')
  }
  catch {
    return false
  }
}
