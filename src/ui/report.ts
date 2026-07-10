import { buildAdReport } from '../shared/report'
import type { DashboardState } from '../shared/types'

/**
 * One-click "an ad got through" report. Captures the visible tab to the
 * clipboard (best effort — the user can paste it into the issue), builds a
 * fully pre-filled GitHub issue from the dashboard state, and opens it.
 */
export async function reportAdThatGotThrough(state: DashboardState): Promise<void> {
  const screenshotCopied = await copyVisibleTabToClipboard().catch(() => false)
  const report = buildAdReport(state, {
    userAgent: navigator.userAgent,
    browser: browserLabel(),
    screenshotCopied,
  })
  await chrome.tabs.create({ url: report.url })
}

/** Grab a PNG of the current page onto the clipboard so it can be pasted. */
async function copyVisibleTabToClipboard(): Promise<boolean> {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined')
    return false

  const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' })
  if (!dataUrl)
    return false

  const blob = await (await fetch(dataUrl)).blob()
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
  return true
}

/** Best-effort "Chrome 126 on macOS"-style label from UA client hints. */
function browserLabel(): string {
  const data = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData
  if (data) {
    const brand = data.brands.find(entry => !/not.a.brand/i.test(entry.brand)) ?? data.brands[0]
    const name = brand ? `${brand.brand} ${brand.version}` : 'Unknown browser'
    return data.platform ? `${name} on ${data.platform}` : name
  }
  return navigator.userAgent
}

interface NavigatorUAData {
  brands: Array<{ brand: string, version: string }>
  platform: string
}
