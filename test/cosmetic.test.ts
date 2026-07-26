import { describe, expect, it } from 'bun:test'
import { activeCosmeticGroups } from '../src/shared/cosmetic'
import type { CosmeticContext } from '../src/shared/cosmetic'

const base: CosmeticContext = {
  isYouTube: false,
  isTwitch: false,
  isX: false,
  youtubeEnhancements: true,
  twitchEnhancements: true,
  cookieConsent: false,
  aggressive: false,
}

describe('generic ad-slot selectors', () => {
  it('hides reserved ad boxes that survive network blocking', () => {
    const generic = activeCosmeticGroups(base).find(group => group.source === 'cosmetic')

    // Ströer's slot library sizes its box before the ad request is made, so
    // blocking the request alone leaves a banner-sized hole and a spinner.
    expect(generic?.selectors).toContain('[id^="sdgSlotContainer-"]')
    expect(generic?.selectors).toContain('.sdgSpinner')
    // German publishers ship the "Werbung" placement wrapper in their HTML.
    expect(generic?.selectors).toContain('div.werbung')
    expect(generic?.selectors).toContain('.ad-placement-note')
  })

  it('hides ad wrappers that outlive re-injected, randomised slot markup', () => {
    // Publishers that re-inject ads past a blocker randomise the slot's own id
    // and classes every load, so the only stable handle left is the wrapper
    // naming itself "Werbung".
    const generic = activeCosmeticGroups(base).find(group => group.source === 'cosmetic')

    expect(generic?.selectors).toContain('[class*="werbung-"]')
    expect(generic?.selectors).toContain('[id^="werbung"]')
  })

  it('leaves the short, guessable slot ids to the aggressive tier', () => {
    const off = activeCosmeticGroups(base).find(group => group.source === 'cosmetic')
    const on = activeCosmeticGroups({ ...base, aggressive: true }).find(group => group.source === 'cosmetic')

    expect(off?.selectors).not.toContain('#superbanner')
    expect(on?.selectors).toContain('#superbanner')
    expect(on?.selectors).toContain('[id^="banner_btf"]')
  })
})

describe('activeCosmeticGroups cookie-consent gating', () => {
  it('omits the consent group by default', () => {
    const groups = activeCosmeticGroups(base)
    expect(groups.some(group => group.source === 'consent')).toBe(false)
  })

  it('includes the consent group only when opted in', () => {
    const groups = activeCosmeticGroups({ ...base, cookieConsent: true })
    const consent = groups.find(group => group.source === 'consent')
    expect(consent).toBeDefined()
    expect(consent?.selectors).toContain('#onetrust-consent-sdk')
    expect(consent?.selectors).toContain('.fc-consent-root')
  })

  it('keeps consent selectors independent of the aggressive tier', () => {
    const off = activeCosmeticGroups({ ...base, cookieConsent: true, aggressive: false })
    const on = activeCosmeticGroups({ ...base, cookieConsent: true, aggressive: true })
    const consentOff = off.find(group => group.source === 'consent')?.selectors.length ?? 0
    const consentOn = on.find(group => group.source === 'consent')?.selectors.length ?? 0
    expect(consentOff).toBe(consentOn)
    expect(consentOff).toBeGreaterThan(0)
  })
})
