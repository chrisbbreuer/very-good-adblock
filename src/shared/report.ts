import { adReportLabel, extensionName, newIssueUrl } from './constants'
import { formatBytes, formatMinutes } from './metrics'
import type { DashboardState } from './types'

/**
 * Builds a fully pre-filled GitHub issue for "an ad got through" reports so a
 * user can file one in a single click from the popup. All the diagnostics the
 * maintainer needs (version, page, protection state, filter revisions, DNR /
 * cosmetic telemetry) are auto-collected here — no browsing history is included,
 * and the page URL is stripped of its query string and hash before it goes in.
 */

/** GitHub rejects issue URLs past ~8 KB; stay comfortably under with headroom. */
const maxIssueUrlLength = 7000

export interface ReportContext {
  /** navigator.userAgent, folded into the diagnostics table when present. */
  userAgent?: string
  /** Short human label for the browser, e.g. "Chrome 126 on macOS". */
  browser?: string
  /** Set when a screenshot was copied to the clipboard for the user to paste. */
  screenshotCopied?: boolean
}

export interface IssueReport {
  title: string
  body: string
  labels: string[]
  /** Ready-to-open GitHub "new issue" URL with title, body and labels pre-filled. */
  url: string
}

/** Assemble the report and its shareable GitHub URL from the current dashboard. */
export function buildAdReport(state: DashboardState, context: ReportContext = {}): IssueReport {
  const host = state.activeTab?.hostname
  const title = host ? `Ad got through on ${host}` : 'Ad got through'
  const labels = [adReportLabel]

  // Prefer the full report; if the encoded URL would be too long, fall back to a
  // compact one that drops the (trimmable) filter-source list rather than failing.
  const full = buildBody(state, context, { includeFilterSources: true })
  let body = full
  let url = issueUrl(title, body, labels)
  if (url.length > maxIssueUrlLength) {
    body = buildBody(state, context, { includeFilterSources: false })
    url = issueUrl(title, body, labels)
  }

  return { title, body, labels, url }
}

/** Compose the GitHub "new issue" URL with title/body/labels query params. */
export function issueUrl(title: string, body: string, labels: string[]): string {
  const params = new URLSearchParams({ title, body, labels: labels.join(',') })
  return `${newIssueUrl}?${params.toString()}`
}

interface BodyOptions {
  includeFilterSources: boolean
}

function buildBody(state: DashboardState, context: ReportContext, options: BodyOptions): string {
  const lines: string[] = []

  lines.push('Thanks for reporting an ad that slipped through — the more detail here, the faster it gets fixed.')
  lines.push('')

  if (context.screenshotCopied) {
    lines.push('> 📎 A screenshot of the page was copied to your clipboard. Press **Ctrl/Cmd + V** to paste it here — it helps a lot.')
    lines.push('')
  }

  lines.push('**What ad did you see, and where on the page?**')
  lines.push('<!-- e.g. a video pre-roll on YouTube, a banner across the top, a pop-up window -->')
  lines.push('')
  lines.push('')
  lines.push('**Does it still show after reloading the page?**')
  lines.push('<!-- Yes / No -->')
  lines.push('')
  lines.push('')
  lines.push('**Anything else worth knowing?** (optional)')
  lines.push('')
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('<details>')
  lines.push('<summary>Diagnostics — auto-collected, no browsing history</summary>')
  lines.push('')
  lines.push('| Field | Value |')
  lines.push('| --- | --- |')
  for (const [field, value] of diagnosticsRows(state, context, options)) {
    lines.push(`| ${field} | ${escapeCell(value)} |`)
  }
  lines.push('')
  lines.push('</details>')
  lines.push('')
  lines.push(`_Filed from the ${extensionName} popup._`)

  return lines.join('\n')
}

function diagnosticsRows(state: DashboardState, context: ReportContext, options: BodyOptions): Array<[string, string]> {
  const rows: Array<[string, string]> = []

  rows.push(['Extension', `${extensionName} v${state.manifestVersion}`])
  if (context.browser)
    rows.push(['Browser', context.browser])
  if (context.userAgent && context.userAgent !== context.browser)
    rows.push(['User agent', context.userAgent])

  rows.push(['Page', sanitizeUrl(state.activeTab?.url) ?? state.activeTab?.hostname ?? '(no active tab)'])
  rows.push(['Protection', protectionLabel(state)])
  rows.push(['This site', state.activeTab?.allowed ? 'Allowlisted (not protected)' : 'Protected'])
  rows.push(['Blocked on this page', `${state.activePage.blocked} (${state.activePage.network} network, ${state.activePage.content} hidden)`])
  rows.push(['Lifetime blocked', `${state.lifetime.adsBlocked.toLocaleString()} · ${formatBytes(state.lifetime.bytesSaved)} · ${formatMinutes(state.lifetime.videoSecondsSaved)}`])
  rows.push(['Features', featureFlags(state)])

  const cosmetic = state.cosmetic
  rows.push(['Cosmetic hides here', cosmetic.enabled ? `${cosmetic.activeTabHidden}${cosmetic.aggressive ? ' (aggressive)' : ''}` : 'Off'])

  const dnr = state.dnr
  rows.push(['Network rules (DNR)', dnr.available
    ? `${dnr.activeTabMatchedRules} on this tab, ${dnr.recentMatchedRules} in last 5 min`
    : `Unavailable${dnr.reason ? ` (${dnr.reason})` : ''}`])

  rows.push(['Filter rules', `${state.filters.staticRuleCount.toLocaleString()} static · ${state.filters.generatedHostRules.toLocaleString()} hosts · ${state.filters.sources.length} sources`])

  if (options.includeFilterSources && state.filters.sources.length) {
    for (const source of state.filters.sources.slice(0, 8))
      rows.push([`↳ ${source.name}`, `${source.hosts.toLocaleString()} hosts @ ${source.revision}`])
  }

  return rows
}

function protectionLabel(state: DashboardState): string {
  if (state.settings.enabled)
    return 'On'
  const resumeAt = state.settings.resumeAt
  if (typeof resumeAt === 'number' && resumeAt > Date.now())
    return 'Paused'
  return 'Off'
}

function featureFlags(state: DashboardState): string {
  const s = state.settings
  return [
    flag('Cosmetic', s.cosmeticFiltering),
    flag('Aggressive', s.aggressiveCosmetic),
    flag('Consent', s.cookieConsentFiltering),
    flag('Pop-ups', s.popupBlocking),
    flag('YouTube', s.youtubeEnhancements),
    flag('Twitch', s.twitchEnhancements),
  ].join(' · ')
}

function flag(name: string, on: boolean): string {
  return `${name} ${on ? '✓' : '✗'}`
}

/** Drop the query string and hash so no session tokens leak into the report. */
export function sanitizeUrl(url: string | undefined): string | undefined {
  if (!url)
    return undefined
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  }
  catch {
    return url
  }
}

/** Keep table values on one line so a stray `|` or newline can't break the grid. */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}
