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

  // Track the most recent user gesture and whether it landed on a real control.
  let gestureAt = 0
  let gestureInteractive = false
  const gestureEvents = ['pointerdown', 'mousedown', 'click', 'keydown', 'touchstart']
  for (const type of gestureEvents) {
    window.addEventListener(type, (event) => {
      gestureAt = timestamp()
      gestureInteractive = hitInteractiveControl(event.target)
    }, { capture: true, passive: true })
  }

  const recentOpens: number[] = []

  const guarded = function open(url?: string | URL, target?: string, features?: string): Window | null {
    if (!bridge.isEnabled()) return original.call(window, url as string, target, features)

    const now = timestamp()
    while (recentOpens.length && now - recentOpens[0] > 4000) recentOpens.shift()

    const href = url == null ? '' : String(url)
    const withGesture = now - gestureAt < 1000
    const fromControl = withGesture && gestureInteractive
    const crossOrigin = !isSameOrigin(href)

    // Abusive when a cross-origin (or blank) pop-up is opened from a click that
    // did not hit a link/button, with no gesture at all, or in a flood.
    const abusive = (crossOrigin && !fromControl) || !withGesture || recentOpens.length >= 2

    if (abusive) {
      bridge.report(1)
      return decoyWindow()
    }

    recentOpens.push(now)
    return original.call(window, url as string, target, features)
  }

  ;(guarded as { __vgaGuarded?: boolean }).__vgaGuarded = true
  window.open = guarded as typeof window.open
}

/** Walk up from the event target to see if a real interactive control was hit. */
function hitInteractiveControl(node: EventTarget | null): boolean {
  let element = node instanceof Element ? node : null
  for (let depth = 0; element && depth < 12; depth++) {
    const tag = element.tagName
    if (tag === 'A' && element.getAttribute('href')) return true
    if (tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'SELECT') return true
    if (element.getAttribute('role') === 'button' || element.getAttribute('role') === 'link') return true
    if (tag === 'INPUT') {
      const type = (element.getAttribute('type') ?? '').toLowerCase()
      if (type === 'button' || type === 'submit' || type === 'image') return true
    }
    element = element.parentElement
  }
  return false
}

function isSameOrigin(href: string): boolean {
  if (!href) return false
  try {
    return new URL(href, window.location.href).origin === window.location.origin
  }
  catch {
    return false
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
