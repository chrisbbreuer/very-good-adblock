/**
 * Shared plumbing for the MAIN-world pruners (`x-inpage.ts`, `yt-inpage.ts`).
 *
 * These scripts run in the page's own JavaScript context and cannot use chrome.*,
 * so they coordinate with the isolated content script over window.postMessage:
 * the isolated side sends an enable flag (honoring the off switch / allowlist /
 * per-site toggles) and the MAIN side reports how many ads it removed for stats.
 */

export interface PruneBridge {
  /** Whether pruning is currently enabled (defaults on until told otherwise). */
  isEnabled: () => boolean
  /** Report a positive count of removed ads back to the isolated content script. */
  report: (count: number) => void
}

export function createPruneBridge(configSource: string, pruneSource: string): PruneBridge {
  // Default on: protection ships enabled, so early requests are pruned before
  // settings load. The isolated script flips this off when disabled/allowlisted.
  let enabled = true

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return
    const data = event.data as { source?: string, enabled?: unknown } | null
    if (!data || data.source !== configSource) return
    if (typeof data.enabled === 'boolean') enabled = data.enabled
  })

  return {
    isEnabled: () => enabled,
    report: (count: number) => {
      if (count <= 0) return
      try {
        window.postMessage({ source: pruneSource, count }, window.location.origin)
      }
      catch {
        // postMessage can throw on exotic origins; the prune already happened.
      }
    },
  }
}

/** Resolve a fetch input to its URL string without throwing. */
export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (input instanceof Request) return input.url
  return String(input)
}
