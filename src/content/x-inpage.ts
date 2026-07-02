/**
 * MAIN-world content script for X / Twitter.
 *
 * Runs in the page's own JavaScript context (manifest `world: "MAIN"`) at
 * document_start, before X's bundle, and wraps `fetch` so promoted tweets are
 * pruned out of GraphQL timeline responses before the app ever sees them. This
 * is the same source-level approach uBlock Origin uses — locale-independent and
 * flash-free, unlike hiding rendered ad nodes.
 */
import { xConfigMessageSource, xPruneMessageSource } from '../shared/constants'
import { isXGraphqlUrl, prunePromotedFromTimeline } from '../shared/x-prune'
import { createPruneBridge, requestUrl } from './inpage-bridge'

installFetchPruner()

function installFetchPruner(): void {
  const original = window.fetch
  if (typeof original !== 'function') return
  if ((original as { __vgaPatched?: boolean }).__vgaPatched) return

  const bridge = createPruneBridge(xConfigMessageSource, xPruneMessageSource)

  const patched = async function patchedFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const response = await original.call(this as typeof globalThis, input, init)
    if (!bridge.isEnabled()) return response

    try {
      if (!isXGraphqlUrl(requestUrl(input))) return response
      if (!(response.headers.get('content-type') ?? '').includes('json')) return response

      const data = JSON.parse(await response.clone().text()) as unknown
      const removed = prunePromotedFromTimeline(data)
      if (removed <= 0) return response

      bridge.report(removed)
      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }
    catch {
      // Never break a response over ad pruning — hand back the untouched original.
      return response
    }
  }

  // Preserve any static members (e.g. fetch.preconnect) before swapping in, and
  // mark it so a second injection does not double-wrap.
  const merged = Object.assign(patched, original)
  ;(merged as { __vgaPatched?: boolean }).__vgaPatched = true
  window.fetch = merged as typeof window.fetch
}
