import { dismissNotice, isNoticeDismissed } from '../shared/storage'

const noticeId = 'safari-site-access' as const
const allSites = ['http://*/*', 'https://*/*']

/**
 * Safari never grants host permissions at install the way Chrome does — it asks
 * per site, and "Allow for One Day" re-prompts on the next visit, so a new user
 * can get a permission sheet on every site they open and reasonably conclude the
 * extension is broken. Nothing here can pre-empt that: only the user choosing
 * "Always Allow on Every Website" ends it. So say it once, in the one place
 * they'll open when they're wondering why nothing is being blocked.
 */
export async function shouldShowSafariSiteAccessNotice(): Promise<boolean> {
  if (!isSafariBuild()) return false
  if (await isNoticeDismissed(noticeId)) return false
  return !(await hasAllSiteAccess())
}

export async function dismissSafariSiteAccessNotice(): Promise<void> {
  await dismissNotice(noticeId)
}

/**
 * Safari is the only target that ships `browser_specific_settings.safari` (see
 * config/extension.ts), so the manifest names the build outright. The user agent
 * would not: Safari's UA differs between macOS and iOS, and every Chromium
 * browser claims to be Safari in it.
 */
function isSafariBuild(): boolean {
  const manifest = chrome.runtime.getManifest() as chrome.runtime.Manifest & {
    browser_specific_settings?: { safari?: unknown }
  }
  return Boolean(manifest.browser_specific_settings?.safari)
}

/**
 * Once the grant lands the notice retires itself, so nobody who already fixed it
 * has to dismiss it. Undetermined counts as not granted — the notice is one
 * tap to dismiss, whereas never showing it leaves the prompts unexplained.
 */
async function hasAllSiteAccess(): Promise<boolean> {
  try {
    return (await chrome.permissions?.contains({ origins: allSites })) ?? false
  }
  catch {
    return false
  }
}
