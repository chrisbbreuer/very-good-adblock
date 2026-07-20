/**
 * MAIN-world pop-up / pop-under defuser.
 *
 * Sketchy sites (streaming, file hosts) attach a click listener to the page and
 * call `window.open()` to an ad domain when you click the video — often returning
 * a decoy window so their code thinks it worked and retries on the next click.
 * MV3's declarativeNetRequest can't block pop-ups, so we neutralise them here by
 * wrapping `window.open` in the page's own context.
 *
 * The heuristic is deliberately conservative to preserve legitimate pop-ups
 * (OAuth sign-in, "share", "print"): a call is only blocked when it shows the
 * abusive shape — cross-origin, and either not tied to a click on a real link/
 * button, fired with no user gesture at all, or part of a rapid flood. Blocked
 * calls return a decoy window so the site does not detect the block and retry.
 */
import { popupBlockMessageSource, popupConfigMessageSource } from '../shared/constants'
import { createPruneBridge } from './inpage-bridge'

installPopupGuard()

function installPopupGuard(): void {
  const original = window.open
  if (typeof original !== 'function' || (original as { __vgaGuarded?: boolean }).__vgaGuarded) return

  const bridge = createPruneBridge(popupConfigMessageSource, popupBlockMessageSource)

  // Sub-frames (player iframes, ad iframes) stay guarded unconditionally: the
  // content script's config only reaches the top frame, and honoring a config
  // message inside a sub-frame would let a hostile ad frame post its own
  // `enabled: false` to switch the guard off. The top frame honors the config.
  const isTopFrame = window === window.top
  const active = (): boolean => (isTopFrame ? bridge.isEnabled() : true)

  // Track the most recent user gesture: when, what kind of element it hit, and
  // (for links) where that link points.
  let gestureAt = 0
  let gestureKind: 'anchor' | 'control' | 'other' = 'other'
  let gestureHref = ''
  const gestureEvents = ['pointerdown', 'mousedown', 'click', 'keydown', 'touchstart']
  for (const type of gestureEvents) {
    window.addEventListener(type, (event) => {
      const info = classifyGesture(event.target)
      gestureAt = timestamp()
      gestureKind = info.kind
      gestureHref = info.href
    }, { capture: true, passive: true })
  }

  const recentOpens: number[] = []

  const guarded = function open(url?: string | URL, target?: string, features?: string): Window | null {
    if (!active()) return original.call(window, url as string, target, features)

    const now = timestamp()
    while (recentOpens.length && now - recentOpens[0] > 4000) recentOpens.shift()

    const openOrigin = originOf(url == null ? '' : String(url))
    const sameOriginPage = openOrigin !== '' && openOrigin === window.location.origin
    const browserActivated = navigator.userActivation?.isActive === true
    const withGesture = now - gestureAt < 1000 || browserActivated
    const openerIsolated = isolatesOpener(target, features)

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
      allow = sameOriginPage || (openOrigin !== '' && openOrigin === linkOrigin)
    }
    else if (gestureKind === 'control') {
      // A real button/input — OAuth, share, payment pop-ups live here.
      allow = true
    }
    else {
      // Clicking a non-interactive area (video/overlay): same-origin only. The
      // narrow exception is an opener-isolated window while the browser itself
      // still reports transient user activation. Frameworks such as Bluesky's
      // React Native Web link handler prevent the native anchor navigation and
      // call window.open(url, target, 'noopener'); event abstraction can hide
      // the original anchor from our classifier. Timers have no activation,
      // while ordinary pop-under calls do not isolate their opener.
      allow = sameOriginPage || (browserActivated && openerIsolated)
    }

    // Never let a flood through, whatever the gesture was (a couple of legit
    // pop-ups in a row is fine; a burst is the pop-under signature).
    if (recentOpens.length >= 3) allow = false

    if (!allow) {
      reportBlock()
      return decoyWindow()
    }

    recentOpens.push(now)
    return original.call(window, url as string, target, features)
  }

  ;(guarded as { __vgaGuarded?: boolean }).__vgaGuarded = true
  window.open = guarded as typeof window.open
}

/** Whether the requested new context is explicitly isolated from its opener. */
function isolatesOpener(target?: string, features?: string): boolean {
  if (target !== '_blank') return false
  return (features ?? '')
    .split(/[\s,]+/)
    .some(feature => feature.toLowerCase() === 'noopener' || feature.toLowerCase() === 'noreferrer')
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
}

/** Walk up from the event target to classify what the user actually clicked. */
function classifyGesture(node: EventTarget | null): GestureInfo {
  let element = node instanceof Element ? node : null
  for (let depth = 0; element && depth < 12; depth++) {
    const tag = element.tagName
    const href = element.getAttribute('href')
    if (tag === 'A' && href) {
      // Some established sites still implement legitimate chat/help links as
      // `javascript:void(open("https://…"))` anchors. Compare the eventual
      // pop-up with that statically declared URL, just as we do for a normal
      // href. We deliberately do not execute or broadly trust javascript:
      // links; an unrelated destination remains blocked.
      return { kind: 'anchor', href: popupHrefFromJavascript(href) || resolve(href) }
    }
    if (tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'SELECT') return { kind: 'control', href: '' }
    if (element.getAttribute('role') === 'button' || element.getAttribute('role') === 'link') return { kind: 'control', href: '' }
    if (tag === 'INPUT') {
      const type = (element.getAttribute('type') ?? '').toLowerCase()
      if (type === 'button' || type === 'submit' || type === 'image') return { kind: 'control', href: '' }
    }
    element = element.parentElement
  }
  return { kind: 'other', href: '' }
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
