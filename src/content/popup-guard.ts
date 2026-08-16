/**
 * MAIN-world pop-up / pop-under defuser.
 *
 * Sketchy sites (streaming, file hosts) attach a click listener to the page and
 * open an ad domain in a new tab when you click the video — often returning a
 * decoy window so their code thinks it worked and retries on the next click.
 * MV3's declarativeNetRequest can't block pop-ups, so we neutralise them here by
 * wrapping the page's own new-context entry points.
 *
 * `window.open` is only one of those entry points, and no longer the common one:
 * pop-under scripts moved to synthetic anchor clicks
 * (`Object.assign(document.createElement('a'), { target: '_blank', href }).click()`)
 * precisely because everyone guards `window.open`. Forms with `target="_blank"`
 * and untrusted `dispatchEvent` clicks are the same trick in a different shape,
 * so every route funnels through one decision (`allowNewContext`).
 *
 * The heuristic is deliberately conservative to preserve legitimate pop-ups
 * (OAuth sign-in, "share", "print") and — just as important — the site's *own*
 * outbound link, which on these pages is itself a synthetic anchor click. The
 * discriminator is what the element under the user's cursor declared: a row
 * carrying `data-stream-link="https://…"` is asking for that destination, while
 * the ad script's anchor points somewhere nothing on the page ever mentioned.
 * Blocked `window.open` calls return a decoy window so the site does not detect
 * the block and retry.
 */
import { isClickCatcherElement } from '../shared/click-catcher'
import { popupBlockMessageSource, popupConfigMessageSource } from '../shared/constants'
import { createPruneBridge } from './inpage-bridge'

/** How long after a gesture a new context can still claim it opened by hand. */
const gestureWindowMs = 1000
/** Sliding window for the generic flood cap. */
const floodWindowMs = 4000
/** Allowed opens inside that window before everything is treated as a flood. */
const floodBudget = 3
/** Allowed new tabs attributable to a single gesture (a click is not a burst). */
const opensPerGesture = 2
/** How far up the tree we look when classifying what the user clicked. */
const ancestorDepth = 12
/** Cap on destinations harvested from one element chain. */
const maxDeclaredDestinations = 16

installPopupGuard()

function installPopupGuard(): void {
  const originalOpen = window.open
  if (typeof originalOpen !== 'function' || (originalOpen as { __vgaGuarded?: boolean }).__vgaGuarded) return

  const bridge = createPruneBridge(popupConfigMessageSource, popupBlockMessageSource)

  // Sub-frames (player iframes, ad iframes) stay guarded unconditionally: the
  // content script's config only reaches the top frame, and honoring a config
  // message inside a sub-frame would let a hostile ad frame post its own
  // `enabled: false` to switch the guard off. The top frame honors the config.
  const isTopFrame = window === window.top
  const active = (): boolean => (isTopFrame ? bridge.isEnabled() : true)

  // Track the most recent user gesture: when, what kind of element it hit, where
  // any link points, and every destination the clicked element chain declared.
  let gestureAt = 0
  let gestureKind: 'anchor' | 'control' | 'other' = 'other'
  let gestureHref = ''
  let gestureTarget = ''
  let gestureIsolationFeatures = ''
  let gestureDeclared: string[] = []
  let gestureElement: Element | null = null
  let gestureCaughtByLid = false
  let gestureOpens = 0
  let trustedAnchorOpenConsumed = true
  const gestureEvents = ['pointerdown', 'mousedown', 'click', 'keydown', 'touchstart']
  const gestureStartEvents = new Set(['pointerdown', 'touchstart', 'keydown'])
  for (const type of gestureEvents) {
    window.addEventListener(type, (event) => {
      const info = classifyGesture(event.target)
      gestureAt = timestamp()
      gestureKind = info.kind
      gestureHref = info.href
      gestureTarget = info.target
      gestureIsolationFeatures = info.isolationFeatures
      gestureDeclared = info.declared
      gestureElement = event.target instanceof Element ? event.target : null
      // Measured as the events arrive rather than when the pop-up is decided:
      // these scripts tear the lid out of the document and build a fresh one
      // during the very gesture they harvest, and a detached element reports
      // empty computed style. `pointerdown` still sees it; by `mousedown` there
      // is nothing left to recognise. So the verdict is only cleared by the
      // event that *starts* an interaction, and the later events of that same
      // interaction can confirm a lid but never argue one away.
      const lid = gestureElement !== null && caughtByClickCatcher(gestureElement)
      gestureCaughtByLid = gestureStartEvents.has(type) ? lid : gestureCaughtByLid || lid
      gestureOpens = 0
      trustedAnchorOpenConsumed = false
    }, { capture: true, passive: true })
  }

  const recentOpens: number[] = []

  /** Trim the flood window and report whether the budget is already spent. */
  function floodExhausted(now: number): boolean {
    while (recentOpens.length && now - recentOpens[0] > floodWindowMs) recentOpens.shift()
    return recentOpens.length >= floodBudget
  }

  /** Whether a destination is one the clicked element chain asked for. */
  function declaredByGesture(url: string): boolean {
    const resolved = resolve(url)
    return resolved !== '' && gestureDeclared.includes(resolved)
  }

  const guarded = function open(url?: string | URL, target?: string, features?: string): Window | null {
    if (!active()) return originalOpen.call(window, url as string, target, features)

    const now = timestamp()
    const floodSpent = floodExhausted(now)

    const openOrigin = originOf(url == null ? '' : String(url))
    const sameOriginPage = openOrigin !== '' && openOrigin === window.location.origin
    const browserActivated = navigator.userActivation?.isActive === true
    const withGesture = now - gestureAt < gestureWindowMs || browserActivated
    const blankOpen = isBlankOpen(url)
    // Framework-managed anchors sometimes create about:blank first, then set
    // the child location. Carry the clicked anchor's target and rel isolation
    // into that window.open call so allowing the temporary blank context cannot
    // expose the opener, even when the framework omitted those arguments.
    const blankTargetFromAnchor = blankOpen
      && gestureKind === 'anchor'
      && gestureTarget === '_blank'
    const effectiveTarget = blankTargetFromAnchor && !target ? '_blank' : target
    const effectiveFeatures = blankTargetFromAnchor
      ? mergeFeatures(features, gestureIsolationFeatures)
      : features
    const openerIsolated = isolatesOpener(effectiveTarget, effectiveFeatures)
    const declaredLinkNavigation = gestureKind === 'anchor'
      && (matchesUrl(url, gestureHref) || isPageOwnedRedirectTo(url, gestureHref))
    const isolatedBlankLink = blankTargetFromAnchor && openerIsolated
    // A real anchor gets one guaranteed open for the URL (or isolated blank
    // context) it declared. This keeps rapid UI activity elsewhere on the page
    // from exhausting the generic pop-up flood budget before the user's click.
    const trustedAnchorOpen = !trustedAnchorOpenConsumed
      && (declaredLinkNavigation || isolatedBlankLink)

    let allow: boolean
    if (!withGesture) {
      // No user gesture at all — a timer-driven pop-under.
      allow = false
    }
    else if (gestureKind === 'anchor') {
      // Clicking a link: only allow the pop-up if it goes where the link points
      // (or stays same-origin). A pop-up to a different ad domain is a pop-under
      // piggybacking on the click, even though a real link was clicked.
      const linkOrigin = originOf(gestureHref)
      allow = sameOriginPage
        || declaredLinkNavigation
        || (openOrigin !== '' && openOrigin === linkOrigin)
        || isolatedBlankLink
    }
    else if (gestureKind === 'control') {
      // A real button/input — OAuth, share, payment pop-ups live here.
      allow = true
    }
    else {
      // Clicking a non-interactive area (video/overlay): same-origin, or a
      // destination the clicked element itself declared (a table row carrying
      // `data-stream-link`, say — the site's own outbound link). The narrow
      // remaining exception is an opener-isolated window while the browser
      // itself still reports transient user activation. Frameworks such as
      // Bluesky's React Native Web link handler prevent the native anchor
      // navigation and call window.open(url, target, 'noopener'); event
      // abstraction can hide the original anchor from our classifier. Timers
      // have no activation, while ordinary pop-under calls do not isolate
      // their opener.
      //
      // That exception is withdrawn when the click was swallowed by an
      // invisible lid over the page: pop-under networks pass
      // 'noopener,noreferrer' too, so isolation alone stops telling a hidden
      // framework link apart from a harvested click once the element under the
      // cursor was never something the user could see.
      allow = sameOriginPage
        || (url != null && declaredByGesture(String(url)))
        || (browserActivated && openerIsolated && !gestureCaughtByLid)
    }

    // Never let a flood through, whatever the gesture was (a couple of legit
    // pop-ups in a row is fine; a burst is the pop-under signature).
    if (floodSpent && !trustedAnchorOpen) allow = false

    if (!allow) {
      reportBlock()
      return decoyWindow()
    }

    if (trustedAnchorOpen) trustedAnchorOpenConsumed = true
    recentOpens.push(now)
    return originalOpen.call(window, url as string, effectiveTarget, effectiveFeatures)
  }

  ;(guarded as { __vgaGuarded?: boolean }).__vgaGuarded = true
  window.open = guarded as typeof window.open

  /**
   * The shared verdict for a scripted navigation into a new browsing context
   * (synthetic anchor click, form submit, dispatched click event).
   *
   * `window.open` keeps its own richer branch above because it carries opener
   * isolation and blank-context nuances that do not exist here; what these
   * routes share is the question this answers — did the user ask for *this*
   * destination, or is a script riding their click to somewhere else?
   */
  function allowNewContext(url: string, element: Element | null): boolean {
    if (!active()) return true

    const now = timestamp()
    const openOrigin = originOf(url)

    // Same-origin new tabs are the site navigating itself; never a pop-under.
    if (openOrigin !== '' && openOrigin === window.location.origin) return true

    const browserActivated = navigator.userActivation?.isActive === true
    if (now - gestureAt >= gestureWindowMs && !browserActivated) return false

    // The destination the user's own click declared always wins, even when an
    // ad script's capture-phase listener got to fire first. This is what keeps
    // the site's real outbound link working on pages where both the link and
    // the pop-under are synthetic anchor clicks.
    let declared = declaredByGesture(url)

    if (!declared && gestureKind === 'anchor') {
      const linkOrigin = originOf(gestureHref)
      declared = matchesUrl(url, gestureHref)
        || isPageOwnedRedirectTo(url, gestureHref)
        || (openOrigin !== '' && openOrigin === linkOrigin)
    }

    let allowed = declared

    // A real button computing a destination (share, "open in new tab") has no
    // declared href to match against, so controls keep the benefit of the
    // doubt — bounded by the per-gesture and flood budgets below.
    if (!allowed && gestureKind === 'control') allowed = true

    // An anchor the user actually clicked, re-clicked by the page's own
    // framework code, is the same navigation arriving by another route.
    if (!allowed && element && gestureElement && element.isConnected) {
      allowed = element === gestureElement
        || element.contains(gestureElement)
        || gestureElement.contains(element)
    }

    if (!allowed) return false

    // One click is not a burst: cap how many new tabs a single gesture can be
    // credited with, then apply the generic flood window on top. A destination
    // the click itself declared skips that second cap — impatient repeat clicks
    // on the same "watch" row are still the user asking for the same page, and
    // must not start failing just because they came in quick succession.
    if (gestureOpens >= opensPerGesture) return false
    if (!declared && floodExhausted(now)) return false

    gestureOpens++
    recentOpens.push(now)
    return true
  }

  installClickInterception(allowNewContext)
  installFormInterception(allowNewContext)
}

type NewContextDecision = (url: string, element: Element | null) => boolean

/**
 * Intercept scripted anchor clicks — `a.click()` and untrusted click events
 * dispatched at an anchor. A genuine user click arrives as a trusted event and
 * never travels through either path, so anything seen here is script-driven.
 */
function installClickInterception(allowNewContext: NewContextDecision): void {
  const elementProto = typeof HTMLElement === 'function' ? HTMLElement.prototype : undefined
  if (elementProto && typeof elementProto.click === 'function') {
    const originalClick = elementProto.click
    elementProto.click = function click(this: HTMLElement): void {
      const navigation = scriptedNavigationOf(this)
      if (navigation && !allowNewContext(navigation, this)) {
        reportBlock()
        return
      }
      return originalClick.call(this)
    }
  }

  const targetProto = typeof EventTarget === 'function' ? EventTarget.prototype : undefined
  if (targetProto && typeof targetProto.dispatchEvent === 'function') {
    const originalDispatch = targetProto.dispatchEvent
    targetProto.dispatchEvent = function dispatchEvent(this: EventTarget, event: Event): boolean {
      // Cheapest possible guard on a very hot path: everything else only runs
      // for untrusted click events, which are rare.
      if (event && event.type === 'click' && event.isTrusted === false && this instanceof Element) {
        const navigation = scriptedNavigationOf(this)
        if (navigation && !allowNewContext(navigation, this)) {
          reportBlock()
          // Report "not cancelled", the same answer a click nobody prevented
          // gives, so the caller does not treat the block as a failure.
          return true
        }
      }
      return originalDispatch.call(this, event)
    }
  }
}

/**
 * Forms are the third route into a new context: a `target="_blank"` form that a
 * script submits, or whose submit button it clicks. Anchor clicks cover the
 * button case (`scriptedNavigationOf` resolves the owning form), so this only
 * needs `form.submit()` itself.
 */
function installFormInterception(allowNewContext: NewContextDecision): void {
  const formProto = typeof HTMLFormElement === 'function' ? HTMLFormElement.prototype : undefined
  if (!formProto || typeof formProto.submit !== 'function') return

  const originalSubmit = formProto.submit
  formProto.submit = function submit(this: HTMLFormElement): void {
    const navigation = formNavigationOf(this)
    if (navigation && !allowNewContext(navigation, this)) {
      reportBlock()
      return
    }
    return originalSubmit.call(this)
  }
}

/**
 * The URL a scripted click on this element would load into a *new* context, or
 * '' when the click stays in the current page (which we never interfere with).
 *
 * Sub-frames additionally treat `_top`/`_parent` as a new context: an ad frame
 * steering the page the user is actually reading is the same abuse wearing a
 * different target.
 */
function scriptedNavigationOf(element: Element): string {
  const anchor = element.closest?.('a[href], area[href]') ?? null
  if (anchor) {
    // An anchor that lives in the document is a link the user can see and
    // click; `.click()` on one is the ordinary way to activate it, and a
    // download manager or framework doing that is not a pop-under. The abusive
    // shape is the opposite — an anchor built and clicked in the same breath,
    // never appended, existing only to carry the ad's URL. Policing only
    // detached anchors keeps ordinary link activation across the web intact.
    if (anchor.isConnected) return ''
    // Downloads and non-navigating schemes never open a competing page.
    if (anchor.hasAttribute('download')) return ''
    const href = anchor.getAttribute('href') ?? ''
    if (!isNavigableHref(href)) return ''
    if (!opensNewContext(effectiveTargetOf(anchor))) return ''
    return resolve(href)
  }

  const submitter = element.closest?.('button, input') ?? null
  if (submitter && isSubmitControl(submitter)) {
    const form = (submitter as HTMLButtonElement).form ?? submitter.closest('form')
    if (form) return formNavigationOf(form, submitter)
  }

  return ''
}

/** The URL a form submission would load into a new context, or ''. */
function formNavigationOf(form: Element, submitter?: Element): string {
  const target = submitter?.getAttribute('formtarget') ?? effectiveTargetOf(form)
  if (!opensNewContext(target)) return ''

  const action = submitter?.getAttribute('formaction')
    ?? form.getAttribute('action')
    ?? window.location.href
  return resolve(action)
}

function isSubmitControl(element: Element): boolean {
  const type = (element.getAttribute('type') ?? '').toLowerCase()
  if (element.tagName === 'BUTTON') return type === '' || type === 'submit'
  return element.tagName === 'INPUT' && (type === 'submit' || type === 'image')
}

/**
 * An element's target, falling back to `<base target>`. Injecting
 * `<base target="_blank">` turns every ordinary link on the page into a new
 * tab, so the fallback has to be part of the question.
 */
function effectiveTargetOf(element: Element): string {
  const own = (element.getAttribute('target') ?? '').trim()
  if (own) return own.toLowerCase()

  const base = document.querySelector('base[target]')
  return (base?.getAttribute('target') ?? '').trim().toLowerCase()
}

/** Whether a target names a browsing context other than the current one. */
function opensNewContext(target: string): boolean {
  if (target === '_blank') return true
  if (window === window.top) return false
  // Inside a sub-frame, escaping to the top/parent document is equally a new
  // context from the user's point of view.
  return target === '_top' || target === '_parent'
}

/** Whether an href actually navigates (as opposed to `#`, `javascript:`, …). */
function isNavigableHref(href: string): boolean {
  const value = href.trim()
  if (value === '' || value.startsWith('#')) return false
  return !/^(?:javascript|mailto|tel|sms|blob|data):/i.test(value)
}

/**
 * Whether this gesture landed on an invisible lid laid over the page.
 *
 * Runs on every pointer event, so the expensive part is gated behind a check
 * that needs no layout: a lid is empty by construction, because any content
 * would be something the user could see. Clicks on ordinary page furniture —
 * text, images, controls — cost one property read and stop here.
 */
function caughtByClickCatcher(element: Element): boolean {
  if (element.childElementCount > 0) return false
  if ((element.textContent ?? '').trim() !== '') return false
  return isClickCatcherElement(element)
}

/** Whether the requested new context is explicitly isolated from its opener. */
function isolatesOpener(target?: string, features?: string): boolean {
  if (target !== '_blank') return false
  return (features ?? '')
    .split(/[\s,]+/)
    .some(feature => feature.toLowerCase() === 'noopener' || feature.toLowerCase() === 'noreferrer')
}

function isBlankOpen(url?: string | URL): boolean {
  const value = url == null ? '' : String(url).trim().toLowerCase()
  return value === '' || value === 'about:blank'
}

function mergeFeatures(features?: string, required?: string): string | undefined {
  if (!required) return features
  if (!features) return required
  return `${features},${required}`
}

/**
 * Report a blocked pop-up to the top frame, where the isolated content script
 * aggregates stats. Pop-unders fire inside sub-frames (the player iframe), which
 * have no content script of their own, so posting to the current window would be
 * lost — post to `window.top` instead.
 */
function reportBlock(): void {
  try {
    const target = window.top ?? window
    target.postMessage({ source: popupBlockMessageSource, count: 1 }, '*')
  }
  catch {
    // Cross-origin restrictions on window.top — the block still happened.
  }
}

interface GestureInfo {
  kind: 'anchor' | 'control' | 'other'
  href: string
  target: string
  isolationFeatures: string
  declared: string[]
}

/** Walk up from the event target to classify what the user actually clicked. */
function classifyGesture(node: EventTarget | null): GestureInfo {
  const declared = declaredDestinations(node)
  let element = node instanceof Element ? node : null
  for (let depth = 0; element && depth < ancestorDepth; depth++) {
    const tag = element.tagName
    const href = element.getAttribute('href')
    if (tag === 'A' && href) {
      // Some established sites still implement legitimate chat/help links as
      // `javascript:void(open("https://…"))` anchors. Compare the eventual
      // pop-up with that statically declared URL, just as we do for a normal
      // href. We deliberately do not execute or broadly trust javascript:
      // links; an unrelated destination remains blocked.
      const isolationFeatures = (element.getAttribute('rel') ?? '')
        .split(/\s+/)
        .filter(value => value === 'noopener' || value === 'noreferrer')
        .join(',')
      return {
        kind: 'anchor',
        href: popupHrefFromJavascript(href) || resolve(href),
        target: (element.getAttribute('target') ?? '').toLowerCase(),
        isolationFeatures,
        declared,
      }
    }
    if (tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'SELECT') return { kind: 'control', href: '', target: '', isolationFeatures: '', declared }
    if (element.getAttribute('role') === 'button' || element.getAttribute('role') === 'link') return { kind: 'control', href: '', target: '', isolationFeatures: '', declared }
    if (tag === 'INPUT') {
      const type = (element.getAttribute('type') ?? '').toLowerCase()
      if (type === 'button' || type === 'submit' || type === 'image') return { kind: 'control', href: '', target: '', isolationFeatures: '', declared }
    }
    element = element.parentElement
  }
  return { kind: 'other', href: '', target: '', isolationFeatures: '', declared }
}

/**
 * Every destination the clicked element chain names — its own `href` plus any
 * `data-*` attribute holding a URL.
 *
 * This is what tells the site's outbound link apart from the ad riding on the
 * same click. Streaming pages hang the real destination off the row the user
 * clicks (`<tr data-stream-link="https://…">`) and open it from a script; the
 * pop-under's anchor points somewhere no attribute on the page ever mentioned.
 */
function declaredDestinations(node: EventTarget | null): string[] {
  const destinations: string[] = []
  let element = node instanceof Element ? node : null

  for (let depth = 0; element && depth < ancestorDepth; depth++) {
    for (const name of element.getAttributeNames?.() ?? []) {
      if (destinations.length >= maxDeclaredDestinations) return destinations
      if (name !== 'href' && !name.startsWith('data-')) continue

      const resolved = resolveDeclared(element.getAttribute(name) ?? '')
      if (resolved && !destinations.includes(resolved)) destinations.push(resolved)
    }
    element = element.parentElement
  }

  return destinations
}

/**
 * Resolve an attribute value that looks like a link. Only absolute http(s) URLs
 * and root-relative paths qualify — arbitrary `data-` values (ids, JSON, class
 * names) must not widen what counts as user-declared.
 */
function resolveDeclared(value: string): string {
  const candidate = value.trim()
  if (candidate === '') return ''
  if (!/^https?:\/\//i.test(candidate) && !candidate.startsWith('/')) return ''
  if (candidate.startsWith('//')) return ''
  return resolve(candidate)
}

/** Extract a literal first argument from a javascript: open() link, if present. */
function popupHrefFromJavascript(href: string): string {
  if (!/^javascript\s*:/i.test(href)) return ''

  const match = href.match(/(?:\bwindow\s*\.\s*)?\bopen\s*\(\s*(['"])([^'"]+)\1/i)
  return match ? resolve(match[2]) : ''
}

function resolve(href: string): string {
  try {
    return new URL(href, window.location.href).href
  }
  catch {
    return ''
  }
}

/** Whether a window.open URL is exactly the destination declared by a link. */
function matchesUrl(url: string | URL | undefined, href: string): boolean {
  if (url == null || !href) return false
  return resolve(String(url)) === resolve(href)
}

/**
 * Frameworks can route an outbound link through a first-party redirector while
 * leaving the final destination in the anchor. Accept that shape only when the
 * redirect host is the page host (or its subdomain) and a decoded query value
 * exactly equals the URL the user clicked.
 */
function isPageOwnedRedirectTo(url: string | URL | undefined, href: string): boolean {
  if (url == null || !href) return false

  try {
    const redirect = new URL(String(url), window.location.href)
    const pageHostname = window.location.hostname.toLowerCase()
    const redirectHostname = redirect.hostname.toLowerCase()
    const pageOwned = redirectHostname === pageHostname
      || redirectHostname.endsWith(`.${pageHostname}`)
    if (!pageOwned) return false

    const destination = resolve(href)
    return [...redirect.searchParams.values()]
      .some(value => resolve(value) === destination)
  }
  catch {
    return false
  }
}

/** The origin of a URL resolved against the page, or '' if it has none/invalid. */
function originOf(url: string): string {
  if (!url) return ''
  try {
    return new URL(url, window.location.href).origin
  }
  catch {
    return ''
  }
}

/**
 * A truthy stand-in for the blocked window. Returning this (instead of null)
 * means the pop-under script believes it succeeded and does not immediately retry.
 */
function decoyWindow(): Window {
  const noop = (): void => {}
  const decoy: Record<string, unknown> = {
    closed: true,
    close: noop,
    focus: noop,
    blur: noop,
    stop: noop,
    print: noop,
    moveTo: noop,
    resizeTo: noop,
    postMessage: noop,
    open: () => decoyWindow(),
    document: { write: noop, writeln: noop, open: noop, close: noop },
    location: { href: 'about:blank', assign: noop, replace: noop, reload: noop },
  }
  return decoy as unknown as Window
}

/** new Date()/Date.now() are fine in the browser; wrapped for a single call site. */
function timestamp(): number {
  return Date.now()
}
