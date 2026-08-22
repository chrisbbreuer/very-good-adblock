/**
 * MAIN-world content script for YouTube.
 *
 * Runs in the page's own JavaScript context (manifest `world: "MAIN"`) at
 * document_start, before YouTube's app, and strips ads out of its Innertube JSON
 * so nothing schedules or renders: video ads (`adPlacements`/`adSlots`/`playerAds`)
 * from player responses, Shorts ads from reel sequences, and feed ad cells from
 * browse/search responses — while `streamingData` and real content are untouched.
 * This is uBlock Origin's source-level approach; it replaces guessing in the DOM
 * and only supplements the existing skip/fast-forward and cosmetic safety nets.
 *
 * Entry points cover every path ads take into the app:
 * - the inline `ytInitialPlayerResponse` / `ytInitialData` used on first load,
 * - the `/youtubei/v1/{player,get_watch,browse,search,playlist,reel_watch_sequence}`
 *   responses fetched over `fetch` OR `XMLHttpRequest` for every subsequent
 *   video, feed page, playlist, and Shorts sequence,
 * - and fresh realms: YouTube captures pristine `fetch`/`JSON.parse` from a
 *   dynamically inserted iframe to slip payloads past wrappers installed before
 *   it ran. Same-origin frames get the same patches the moment they are added.
 */
import { ytConfigMessageSource, ytPruneMessageSource } from '../shared/constants'
import { isYouTubeAdResponseUrl, pruneYouTubeAds } from '../shared/yt-prune'
import { createPruneBridge, rebuildJsonResponse, requestUrl } from './inpage-bridge'

const bridge = createPruneBridge(ytConfigMessageSource, ytPruneMessageSource)
// Captured before interceptJsonParse patches JSON.parse, so the network hooks can
// parse without the hook pre-pruning (and zeroing) its result.
const nativeJsonParse = JSON.parse

// Realms already patched — a WeakSet rather than a window property so the page
// can neither discover nor remove the marker.
const patchedRealms = new WeakSet<Window>()

patchRealm(window)
interceptInlinePlayerResponse()
interceptInlineBrowseData()
watchFrameRealms()

interface MarkedFunction {
  __vgaPatched?: boolean
}

/**
 * A realm's global object. Plain `Window` lacks the standard constructors in
 * lib.dom; every realm we patch is a full `globalThis`.
 */
type Realm = Window & typeof globalThis

/**
 * Apply the realm-generic defenses (ad-period defusal plus the fetch/XHR/parse
 * pruners) to one same-origin realm. The inline accessors are top-page globals
 * and stay out of here. Cross-origin frames throw on `document` access and are
 * skipped — their natives are unreachable and carry no first-party ads anyway.
 */
function patchRealm(target: Realm): void {
  if (!target || patchedRealms.has(target)) return

  try {
    // Reading `document` throws SecurityError on a cross-origin window, so this
    // both gates the patch and confirms the realm is reachable at all.
    if (!target.document) return
  }
  catch {
    return
  }

  patchedRealms.add(target)
  defuseAdPeriod(target)
  interceptJsonParse(target)
  installFetchPruner(target)
  installXhrPruner(target)
}

/**
 * Prune ads from anything parsed via `JSON.parse` — uBlock Origin's `json-prune`.
 * YouTube parses player/browse responses through `JSON.parse` in code paths the
 * network wraps and the inline accessors can miss (module-scoped vars, workers'
 * results serialized back, prefetch). A cheap string test on the raw text keeps
 * this from walking every unrelated parse. Applied per realm, so a frame cannot
 * use its own untouched parser to slip an ad payload past the top window's hook.
 */
function interceptJsonParse(target: Realm): void {
  const original = target.JSON.parse
  if (typeof original !== 'function' || (original as MarkedFunction).__vgaPatched) return

  const patched = function patchedParse(this: unknown, text: string, reviver?: (key: string, value: unknown) => unknown): unknown {
    const result = (original as (t: string, r?: (key: string, value: unknown) => unknown) => unknown).call(this, text, reviver)
    try {
      pruneParsedPayload(text, result)
    }
    catch {
      // Never let ad pruning break a parse — return the untouched result.
    }
    return result
  }

  ;(patched as MarkedFunction).__vgaPatched = true
  target.JSON.parse = patched as typeof JSON.parse
}

/** Fast pre-check so only payloads that could carry ads get walked. */
function looksAdShaped(text: string): boolean {
  return text.includes('adPlacements')
    || text.includes('playerAds')
    || text.includes('adSlotRenderer')
    || text.includes('adClientParams')
    || text.includes('inFeedAdLayoutRenderer')
}

/** Shared tail of the parse/fetch/XHR hooks: gate, pre-check, prune, report. */
function pruneParsedPayload(text: string, result: unknown): void {
  if (!bridge.isEnabled()) return
  if (typeof text !== 'string' || !looksAdShaped(text)) return
  if (!result || typeof result !== 'object') return

  const removed = pruneYouTubeAds(result)
  if (removed > 0) bridge.report(removed)
}

/**
 * Force YouTube's client-side ad-period gate (`isAdPeriod`) to false — uBlock
 * Origin's `set-constant Object.prototype.isAdPeriod false`. This defuses one
 * class of ad scheduling/anti-adblock that can survive response pruning. Gated on
 * the enable flag so an allowlisted or disabled page keeps its normal behavior.
 * Applied per realm, matching the parse hook.
 */
function defuseAdPeriod(target: Realm): void {
  try {
    Object.defineProperty(target.Object.prototype, 'isAdPeriod', {
      configurable: true,
      get() {
        return bridge.isEnabled() ? false : undefined
      },
      set() {
        // Swallow assignments so the forced value stands while enabled.
      },
    })
  }
  catch {
    // Property already locked down elsewhere; the response pruning still applies.
  }
}

/**
 * The first watch page ships its player response as `window.ytInitialPlayerResponse`.
 * Install an accessor before that assignment so we can prune ads out of it as it
 * is written; the getter hands back the cleaned object the app then reads.
 */
function interceptInlinePlayerResponse(): void {
  let current: unknown
  try {
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      enumerable: true,
      get() {
        return current
      },
      set(value: unknown) {
        try {
          if (bridge.isEnabled()) bridge.report(pruneYouTubeAds(value))
        }
        catch {
          // Leave the value as-is if pruning throws; never block playback.
        }
        current = value
      },
    })
  }
  catch {
    // A non-configurable definition already exists; the network paths still apply.
  }
}

/**
 * Same treatment for `window.ytInitialData` — the inline browse/search/
 * watch-next payload the first render is built from. It is assigned as an
 * object literal (never through `JSON.parse`), so without this accessor its ad
 * cells survive until the cosmetic stylesheet hides them after the fact.
 */
function interceptInlineBrowseData(): void {
  let current: unknown
  try {
    Object.defineProperty(window, 'ytInitialData', {
      configurable: true,
      enumerable: true,
      get() {
        return current
      },
      set(value: unknown) {
        try {
          if (bridge.isEnabled()) bridge.report(pruneYouTubeAds(value))
        }
        catch {
          // Leave the value as-is if pruning throws; never block rendering.
        }
        current = value
      },
    })
  }
  catch {
    // A non-configurable definition already exists; the network paths still apply.
  }
}

function installFetchPruner(target: Realm): void {
  const original = target.fetch
  if (typeof original !== 'function') return
  if ((original as MarkedFunction).__vgaPatched) return

  const patched = async function patchedFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const response = await original.call(this as typeof globalThis, input, init)
    if (!bridge.isEnabled()) return response

    try {
      if (!isYouTubeAdResponseUrl(requestUrl(input))) return response
      if (!(response.headers.get('content-type') ?? '').includes('json')) return response

      const data = nativeJsonParse(await response.clone().text()) as unknown
      const removed = pruneYouTubeAds(data)
      if (removed <= 0) return response

      bridge.report(removed)
      return rebuildJsonResponse(response, data)
    }
    catch {
      // Never break a response over ad pruning — hand back the untouched original.
      return response
    }
  }

  const merged = Object.assign(patched, original)
  ;(merged as MarkedFunction).__vgaPatched = true
  target.fetch = merged as typeof target.fetch
}

/**
 * Prune ads from `XMLHttpRequest` responses. YouTube still moves Innertube calls
 * over XHR (its TV/mobile web clients do it routinely), and a response read
 * there never touches the fetch wrap — uBlock Origin prunes this transport too.
 * Each request's body readers are shadowed with lazy accessors, so text bodies
 * come back re-parsed and cleaned and `json` responses are pruned in place,
 * no matter when or how the app reads them.
 */
function installXhrPruner(target: Realm): void {
  const Original = target.XMLHttpRequest
  if (typeof Original !== 'function') return
  if ((Original as unknown as MarkedFunction).__vgaPatched) return

  const nativeResponseText = Object.getOwnPropertyDescriptor(Original.prototype, 'responseText')?.get
  const nativeResponse = Object.getOwnPropertyDescriptor(Original.prototype, 'response')?.get

  class PatchedXMLHttpRequest extends Original {
    override send(body?: Document | XMLHttpRequestBodyInit | null): void {
      armXhrPruner(this, nativeResponseText, nativeResponse)
      super.send(body ?? null)
    }
  }

  // The UNSENT…DONE constants come along through the `extends` chain itself;
  // copying them would throw, since the originals are read-only.
  ;(PatchedXMLHttpRequest as unknown as MarkedFunction).__vgaPatched = true
  target.XMLHttpRequest = PatchedXMLHttpRequest as unknown as typeof XMLHttpRequest
}

const armedXhrs = new WeakSet<XMLHttpRequest>()

type NativeGetter<T> = (this: XMLHttpRequest) => T

/**
 * Shadow one request's body readers. Arming happens at `send()` so every read
 * after that point is covered — including reads from handlers registered before
 * ours, which a load listener could never beat. Reads before completion hit the
 * native getter (empty string / null states), exactly as they would unpatched.
 */
function armXhrPruner(
  xhr: XMLHttpRequest,
  nativeResponseText: NativeGetter<string> | undefined,
  nativeResponse: NativeGetter<unknown> | undefined,
): void {
  if (armedXhrs.has(xhr)) return
  armedXhrs.add(xhr)

  try {
    Object.defineProperty(xhr, 'responseText', {
      configurable: true,
      get(): string {
        // Non-text modes must keep throwing here, as the native getter does.
        if (nativeResponseText && xhr.responseType !== '' && xhr.responseType !== 'text') {
          return nativeResponseText.call(xhr)
        }
        return cleanXhrText(xhr, nativeResponseText)
      },
    })
    Object.defineProperty(xhr, 'response', {
      configurable: true,
      get() {
        const gated = bridge.isEnabled()
          && xhr.responseURL
          && isYouTubeAdResponseUrl(xhr.responseURL)
        if (xhr.responseType === 'json' && gated && nativeResponse) {
          // Already parsed by the browser; prune in place before first read.
          const data = nativeResponse.call(xhr)
          const removed = pruneYouTubeAds(data)
          if (removed > 0) bridge.report(removed)
          return data
        }
        if (xhr.responseType !== '' && xhr.responseType !== 'text') {
          return nativeResponse ? nativeResponse.call(xhr) : null
        }
        return cleanXhrText(xhr, nativeResponseText)
      },
    })
  }
  catch {
    // Could not shadow this instance (frozen, exotic); the parse-level hooks
    // still cover whatever it carries.
  }
}

/** The pruned text form of a completed response, or its untouched text. */
function cleanXhrText(xhr: XMLHttpRequest, nativeResponseText: NativeGetter<string> | undefined): string {
  const text = nativeResponseText ? nativeResponseText.call(xhr) : ''
  try {
    if (!bridge.isEnabled()) return text
    if (!xhr.responseURL || !isYouTubeAdResponseUrl(xhr.responseURL)) return text
    if (!looksAdShaped(text)) return text

    const data = nativeJsonParse(text) as unknown
    const removed = pruneYouTubeAds(data)
    if (removed <= 0) return text

    bridge.report(removed)
    return JSON.stringify(data)
  }
  catch {
    // Never break a response over ad pruning — hand back the untouched text.
    return text
  }
}

/**
 * Close the fresh-realm escape hatch: code that ran after us cannot un-patch the
 * top window, but it CAN grab pristine natives from a dynamically inserted
 * iframe's `contentWindow` and use those instead — which would undo every hook
 * above for its requests. So watch the insertion points such frames arrive
 * through and give each same-origin realm the full patch set the moment it can
 * be reached (synchronously for about:blank/srcdoc frames, on `load` for ones
 * that navigate). uBlock Origin ships the same idea as
 * `trusted-prevent-dom-bypass`.
 */
function watchFrameRealms(): void {
  const scan = (node: unknown): void => {
    // Duck-typed rather than `instanceof` so nodes from other realms match too.
    if (!node || typeof node !== 'object') return
    const element = node as Partial<Element>
    if (element.tagName !== 'IFRAME' || typeof element.addEventListener !== 'function') return

    const frame = node as HTMLIFrameElement
    patchFrameRealm(frame)
    // A frame that navigates to a URL gets a NEW realm on commit; re-patch when
    // it finishes loading. Late for scripts inside it, but it catches anything
    // that runs after load.
    frame.addEventListener('load', () => { patchFrameRealm(frame) }, true)
  }

  const nodeProto = Node.prototype
  const elementProto = Element.prototype

  const originalAppendChild = nodeProto.appendChild
  nodeProto.appendChild = function appendChild(this: Node, node: Node): Node {
    scan(node)
    return originalAppendChild.call(this, node)
  } as typeof nodeProto.appendChild

  const originalInsertBefore = nodeProto.insertBefore
  nodeProto.insertBefore = function insertBefore(this: Node, node: Node, child: Node | null): Node {
    scan(node)
    return originalInsertBefore.call(this, node, child)
  } as typeof nodeProto.insertBefore

  const originalAppend = elementProto.append
  elementProto.append = function append(this: Element, ...nodes: (Node | string)[]): void {
    for (const node of nodes) scan(node)
    originalAppend.apply(this, nodes)
  } as typeof elementProto.append

  const originalPrepend = elementProto.prepend
  elementProto.prepend = function prepend(this: Element, ...nodes: (Node | string)[]): void {
    for (const node of nodes) scan(node)
    originalPrepend.apply(this, nodes)
  } as typeof elementProto.prepend
}

function patchFrameRealm(frame: HTMLIFrameElement): void {
  try {
    const realm = frame.contentWindow as Realm | null
    if (realm) patchRealm(realm)
  }
  catch {
    // Cross-origin frame; nothing reachable to patch.
  }
}
