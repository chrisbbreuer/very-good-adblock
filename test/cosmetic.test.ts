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
