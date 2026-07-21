import { describe, expect, it } from 'bun:test'
import { isOriginalPopupDestination, rememberInitialPopupUrl } from '../src/background/popup-candidate'
import { isSearchResultsUrl } from '../src/shared/search-navigation'
import type { PopupCandidate } from '../src/background/popup-candidate'

function candidate(initialUrl?: string): PopupCandidate {
  return { openerTabId: 1, openedAt: Date.now(), initialUrl }
}

describe('popup tab candidates', () => {
  it('captures the first real web destination', () => {
    const value = candidate()

    rememberInitialPopupUrl(value, 'about:blank')
    rememberInitialPopupUrl(value, 'https://www.youtube.com/')
    rememberInitialPopupUrl(value, 'https://doubleclick.net/redirect')

    expect(value.initialUrl).toBe('https://www.youtube.com/')
  })

  it('recognizes a blocked request for the original pop-under destination', () => {
    const value = candidate('https://ads.doubleclick.net/pop')

    expect(isOriginalPopupDestination(value, 'https://doubleclick.net/blocked')).toBe(true)
    expect(isOriginalPopupDestination(value, 'https://cdn.ads.doubleclick.net/blocked')).toBe(true)
  })

  it('preserves a user-opened YouTube tab when a redirect host is blocked', () => {
    const value = candidate('https://www.youtube.com/')

    expect(isOriginalPopupDestination(value, 'https://doubleclick.net/redirect')).toBe(false)
  })

  it('does not auto-close a tab whose original destination is unknown', () => {
    expect(isOriginalPopupDestination(candidate(), 'https://doubleclick.net/pop')).toBe(false)
  })

  it('recognizes Google address-bar search results as protected navigation', () => {
    expect(isSearchResultsUrl('https://www.google.com/search?q=HQ+logo&sourceid=chrome&ie=UTF-8')).toBe(true)
    expect(isSearchResultsUrl('https://google.co.uk/search?q=HQ+logo')).toBe(true)
    expect(isSearchResultsUrl('https://www.google.com/')).toBe(false)
    expect(isSearchResultsUrl('https://google.com.evil.example/search?q=HQ+logo')).toBe(false)
  })
})
