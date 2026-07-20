import { describe, expect, it } from 'bun:test'
import { resolveBrowserInstall } from '../resources/scripts/browser-install'

describe('browser-aware install target', () => {
  it('links macOS Safari to the App Store', () => {
    const target = resolveBrowserInstall('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15')
    expect(target.browser).toBe('safari')
    expect(target.label).toBe('Add to Safari')
    expect(target.href).toBe('https://apps.apple.com/app/id6792576349')
  })

  it('links Safari on iPhone and iPad to the universal app', () => {
    const safari = resolveBrowserInstall('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1')
    const chrome = resolveBrowserInstall('Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/138.0 Mobile/15E148 Safari/604.1')
    expect(safari.browser).toBe('safari')
    expect(chrome.browser).toBe('safari')
  })

  it('links Firefox to Mozilla Add-ons', () => {
    const target = resolveBrowserInstall('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0')
    expect(target.browser).toBe('firefox')
    expect(target.label).toBe('Add to Firefox')
    expect(target.href).toBe('https://addons.mozilla.org/firefox/addon/very-good-adblock/')
  })

  it.each([
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0',
  ])('links Chromium desktop browsers to the Chrome Web Store', (userAgent) => {
    const target = resolveBrowserInstall(userAgent)
    expect(target.browser).toBe('chrome')
    expect(target.label).toBe('Add to Chrome')
    expect(target.href).toContain('chromewebstore.google.com')
  })

  it('keeps a neutral fallback for unknown clients', () => {
    expect(resolveBrowserInstall('curl/8.7.1')).toEqual({
      browser: 'other',
      href: '#get',
      label: 'Choose your browser',
    })
  })
})
