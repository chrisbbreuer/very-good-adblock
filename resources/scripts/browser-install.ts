export interface BrowserInstallTarget {
  browser: 'chrome' | 'firefox' | 'safari' | 'other'
  href: string
  label: string
}

export type BrowserStore = Exclude<BrowserInstallTarget['browser'], 'other'>

const browserStores: BrowserStore[] = ['chrome', 'firefox', 'safari']

const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/very-good-adblock/ondclgjpkclbchfbbjdikdpdnopbachc'
const FIREFOX_STORE_URL = 'https://addons.mozilla.org/firefox/addon/very-good-adblock/'
const SAFARI_STORE_URL = 'https://apps.apple.com/app/id6792576349'

const targets: Record<BrowserInstallTarget['browser'], BrowserInstallTarget> = {
  chrome: { browser: 'chrome', href: CHROME_STORE_URL, label: 'Add to Chrome' },
  firefox: { browser: 'firefox', href: FIREFOX_STORE_URL, label: 'Add to Firefox' },
  safari: { browser: 'safari', href: SAFARI_STORE_URL, label: 'Add to Safari' },
  other: { browser: 'other', href: '#get', label: 'Choose your browser' },
}

export function resolveBrowserInstall(userAgent: string): BrowserInstallTarget {
  // Apple mobile browsers all use WebKit and cannot install desktop browser
  // extensions. Send them to the universal Safari app instead.
  if (/\b(?:iPhone|iPad|iPod)\b/i.test(userAgent)) return targets.safari

  if (/\b(?:Firefox|FxiOS)\//i.test(userAgent)) return targets.firefox

  const isSafari = /\bSafari\//i.test(userAgent)
    && !/\b(?:Chrome|Chromium|CriOS|Edg|EdgiOS|OPR|OPiOS)\//i.test(userAgent)
  if (isSafari) return targets.safari

  if (/\b(?:Chrome|Chromium|CriOS|Edg|EdgiOS|OPR|OPiOS)\//i.test(userAgent)) return targets.chrome

  return targets.other
}

/** Store pills shown beside the primary CTA, excluding its duplicate. */
export function alternateBrowserStores(target: BrowserInstallTarget): BrowserStore[] {
  return target.browser === 'other'
    ? browserStores
    : browserStores.filter(store => store !== target.browser)
}
