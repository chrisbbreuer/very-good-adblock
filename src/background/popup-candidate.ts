import { hostnameFromUrl, isHttpUrl } from '../shared/domain'

export interface PopupCandidate {
  openerTabId: number
  openedAt: number
  initialUrl?: string
}

/**
 * Remember the first real web destination for an opener-linked tab. Browser
 * new-tab and about:blank URLs are deliberately ignored so a later navigation
 * can still establish the tab's intended destination.
 */
export function rememberInitialPopupUrl(candidate: PopupCandidate, url?: string): void {
  if (candidate.initialUrl || !isHttpUrl(url)) return
  candidate.initialUrl = url
}

/**
 * A blocked main-frame request is safe to auto-close only when it belongs to
 * the destination that originally created the tab. Without this check, a real
 * user-opened tab can be removed when an early redirect touches an ad host.
 */
export function isOriginalPopupDestination(candidate: PopupCandidate, blockedUrl: string): boolean {
  const initialHostname = hostnameFromUrl(candidate.initialUrl ?? '')
  const blockedHostname = hostnameFromUrl(blockedUrl)
  if (!initialHostname || !blockedHostname) return false

  return initialHostname === blockedHostname
    || initialHostname.endsWith(`.${blockedHostname}`)
    || blockedHostname.endsWith(`.${initialHostname}`)
}
