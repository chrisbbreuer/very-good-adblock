import { bypassMinutes, displayUrl, parseBlockedPageParams } from '../shared/blocked-page'
import type { BlockedPageParams } from '../shared/blocked-page'
import { buildFalsePositiveReport } from '../shared/report'
import { byId, sendMessage } from './dom'

/**
 * The page shown in place of the browser's "ERR_BLOCKED_BY_CLIENT / try
 * disabling your extensions" error when we stop a top-level navigation.
 *
 * Two things matter here. First, ownership: the browser's error names no
 * culprit, so a blocked link from a text message or newsletter reads as a
 * broken site (or a broken browser) rather than as a blocker doing its job.
 * Second, a way through: the destination is usually a click tracker in front
 * of a page the user actually wants, so "continue" has to work without making
 * them go and find the toggle for it.
 */
const params = parseBlockedPageParams(window.location.search)

const title = byId<HTMLHeadingElement>('blocked-title')
const lede = byId<HTMLParagraphElement>('blocked-lede')
const hostLabel = byId<HTMLElement>('blocked-host')
const urlLabel = byId<HTMLElement>('blocked-url')
const note = byId<HTMLParagraphElement>('blocked-note')
const status = byId<HTMLParagraphElement>('blocked-status')
const footnote = document.querySelector<HTMLParagraphElement>('.blocked-footnote')
const continueButton = byId<HTMLButtonElement>('continue-once')
const allowButton = byId<HTMLButtonElement>('allow-always')
const backButton = byId<HTMLButtonElement>('go-back')
const reportLink = byId<HTMLAnchorElement>('report-link')

// Fresh tab (a link opened from another app) versus one with somewhere to
// return to. The entries are the failed navigation and this page, so anything
// beyond two means there is real history behind us.
const hasHistory = window.history.length > 2

if (!params) renderUnknown()
else render(params)

function render(blocked: BlockedPageParams): void {
  document.title = `${blocked.hostname} blocked · Very Good AdBlock`
  hostLabel.textContent = blocked.hostname
  urlLabel.textContent = displayUrl(blocked.url)
  urlLabel.title = blocked.url

  if (blocked.reason === 'user') {
    title.textContent = 'You blocked this site'
    lede.textContent = `${blocked.hostname} is on your block list, so Very Good AdBlock stopped the page before it loaded.`
    allowButton.textContent = `Remove ${blocked.hostname} from my block list`
    footnote?.setAttribute('hidden', '')
  }
  else {
    title.textContent = 'Very Good AdBlock blocked this page'
    lede.textContent = `${blocked.hostname} is on the ad and tracker filter lists, so the page was stopped before it loaded. Links from texts, marketing emails and ads are usually routed through a tracker like this one on the way to the real page.`
    allowButton.textContent = `Always allow ${blocked.hostname}`
    reportLink.href = buildFalsePositiveReport({
      hostname: blocked.hostname,
      url: blocked.url,
      version: chrome.runtime.getManifest().version,
      browser: navigator.userAgent,
    }).url
  }

  note.textContent = `Continuing opens the page and lets requests to ${blocked.hostname} through for ${bypassMinutes} minutes. Ads and trackers on the page you land on stay blocked.`
  backButton.textContent = hasHistory ? 'Go back' : 'Close tab'

  continueButton.addEventListener('click', () => {
    void act(continueButton, 'Opening the page…', async () => {
      const result = await sendMessage<{ url: string }>({ type: 'bypass-block', url: blocked.url })
      leaveFor(result.url)
    })
  })

  allowButton.addEventListener('click', () => {
    void act(allowButton, 'Allowing this site…', async () => {
      await sendMessage({ type: 'toggle-site', hostname: blocked.hostname, allowed: true })
      leaveFor(blocked.url)
    })
  })

  continueButton.focus()
}

/**
 * No usable address in the query string — the page was opened by hand, or the
 * link was mangled. Everything that needs a destination goes away; what is left
 * still says who blocked the page.
 */
function renderUnknown(): void {
  lede.textContent = 'Very Good AdBlock stopped this page before it loaded, but the address it was for is no longer available.'
  hostLabel.textContent = 'Unknown address'
  continueButton.hidden = true
  allowButton.hidden = true
  backButton.textContent = hasHistory ? 'Go back' : 'Close tab'
  note.hidden = true
  footnote?.setAttribute('hidden', '')
}

backButton.addEventListener('click', () => {
  // Skip the failed navigation's own history entry, or there is nothing behind
  // this page at all and the tab is the thing to close.
  if (hasHistory) window.history.go(-2)
  else void sendMessage({ type: 'close-tab' }).catch(() => window.close())
})

/** Run a button's action with a disabled state and a legible failure. */
async function act(button: HTMLButtonElement, pending: string, run: () => Promise<void>): Promise<void> {
  continueButton.disabled = true
  allowButton.disabled = true
  status.textContent = pending

  try {
    await run()
  }
  catch (error) {
    continueButton.disabled = false
    allowButton.disabled = false
    status.textContent = error instanceof Error ? error.message : 'That did not work — try again.'
    button.focus()
  }
}

/**
 * Replace this page in history rather than pushing onto it, so a later Back
 * press goes where the user came from instead of landing them back here.
 */
function leaveFor(url: string): void {
  window.location.replace(url)
}
