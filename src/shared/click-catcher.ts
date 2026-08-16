/**
 * Invisible full-page click catchers.
 *
 * Pop-under networks lay a transparent, empty element over the whole viewport
 * at the maximum z-index. The user aims for the video's play button, the
 * overlay swallows the click, and the script spends the user activation it just
 * harvested on `window.open`. The overlay survives that first click, which is
 * why the ad comes back two or three times before the page finally responds.
 *
 * The shape is unmistakable and network-independent — one seen in the wild:
 *
 *   <div id="dontfoid" znid="10591654" style="top:0;left:0;width:1280px;
 *        height:720px;position:fixed;z-index:2147483647;background:transparent">
 *
 * Nothing legitimate looks like this. A modal backdrop is visibly tinted, a
 * lightbox holds content, a drop zone covers part of the page. Requiring *all*
 * of transparent, empty, viewport-sized and effectively topmost keeps the test
 * specific enough to act on without chasing a filter-list entry per network.
 *
 * The measurements are passed in rather than read here so the rule can be
 * tested directly, and so both the isolated content script and the MAIN-world
 * pop-up guard can apply exactly the same definition.
 */

export interface OverlayMeasurements {
  /** Computed `position`. */
  position: string
  /** Computed `z-index` (may be `auto`). */
  zIndex: string
  /** Computed `background-color`. */
  backgroundColor: string
  /** Computed `background-image`. */
  backgroundImage: string
  /** Computed `pointer-events`. */
  pointerEvents: string
  /** Rendered width in CSS pixels. */
  width: number
  /** Rendered height in CSS pixels. */
  height: number
  /** Whether the element renders anything at all: child elements or text. */
  hasContent: boolean
}

export interface Viewport {
  width: number
  height: number
}

/** Below this, a stacking context is ordinary page furniture, not a lid. */
const minZIndex = 100_000
/** How much of each axis the element must span to count as covering the page. */
const minCoverage = 0.9
/** Ignore slivers on a collapsed or not-yet-measured viewport. */
const minViewportSize = 1

/**
 * Whether an element is an invisible lid over the page whose only purpose can
 * be to intercept the next click.
 */
export function isClickCatcher(measurements: OverlayMeasurements, viewport: Viewport): boolean {
  // Already neutralised (by us or by the page): clicks pass through, so it
  // catches nothing and must not be counted again.
  if (measurements.pointerEvents === 'none') return false

  // Only a positioned element can be laid over unrelated content.
  if (measurements.position !== 'fixed' && measurements.position !== 'absolute') return false

  // Anything the user can actually see is the page's own UI, not a lid.
  if (!isTransparent(measurements.backgroundColor)) return false
  if (measurements.backgroundImage !== 'none' && measurements.backgroundImage !== '') return false
  if (measurements.hasContent) return false

  // A lid has to be on top of everything to be sure of catching the click.
  const zIndex = Number.parseInt(measurements.zIndex, 10)
  if (!Number.isFinite(zIndex) || zIndex < minZIndex) return false

  if (viewport.width < minViewportSize || viewport.height < minViewportSize) return false
  return measurements.width >= viewport.width * minCoverage
    && measurements.height >= viewport.height * minCoverage
}

/**
 * Whether a computed colour paints nothing at all.
 *
 * Only an explicit alpha channel counts. `rgb(0, 0, 0)` is opaque black, not a
 * transparent colour that happens to end in a zero — so the fourth component
 * has to be identified as alpha rather than simply taken as the last number.
 */
export function isTransparent(color: string): boolean {
  const value = color.trim().toLowerCase()
  if (value === '' || value === 'transparent') return true

  const body = value.match(/^rgba?\((.*)\)$/)?.[1]
  if (body === undefined) return false

  // Modern syntax puts alpha after a slash: `rgb(0 0 0 / 50%)`.
  const slash = body.indexOf('/')
  if (slash >= 0) return isZeroAlpha(body.slice(slash + 1))

  const parts = body.split(',')
  return parts.length === 4 && isZeroAlpha(parts[3])
}

/** Whether an alpha component — `0`, `0%`, `0.0` — paints nothing. */
function isZeroAlpha(component: string): boolean {
  const value = component.trim()
  const numeric = Number.parseFloat(value.endsWith('%') ? value.slice(0, -1) : value)
  return Number.isFinite(numeric) && numeric === 0
}

/**
 * Read an element's measurements from the live DOM.
 *
 * `hasContent` deliberately counts child *elements* and non-whitespace text
 * rather than asking whether anything painted: a catcher is empty by
 * construction, because any content would give the user something to see.
 */
export function measureOverlay(element: Element): OverlayMeasurements | undefined {
  const view = element.ownerDocument?.defaultView
  if (!view) return undefined

  const style = view.getComputedStyle(element)
  const rect = element.getBoundingClientRect()

  return {
    position: style.position,
    zIndex: style.zIndex,
    backgroundColor: style.backgroundColor,
    backgroundImage: style.backgroundImage,
    pointerEvents: style.pointerEvents,
    width: rect.width,
    height: rect.height,
    hasContent: element.childElementCount > 0 || (element.textContent ?? '').trim() !== '',
  }
}

/** Whether this live element is an invisible click catcher right now. */
export function isClickCatcherElement(element: Element): boolean {
  const view = element.ownerDocument?.defaultView
  const measurements = measureOverlay(element)
  if (!view || !measurements) return false

  return isClickCatcher(measurements, { width: view.innerWidth, height: view.innerHeight })
}
