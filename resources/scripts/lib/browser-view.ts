import { existsSync } from 'node:fs'

/**
 * Which Chromium binary drives the headless views (tests, smoke run, capture
 * scripts). Dia first: it speaks the same DevTools protocol Bun.WebView drives,
 * and picking it keeps the harness off the machine's Chrome, whose profile
 * locking made whole batches die with "Failed to spawn Chrome" partway through
 * a run. BUN_CHROME_PATH still wins, and where neither exists (CI images ship
 * Chrome, not Dia) the path stays unset and Bun auto-detects as before.
 */
const candidates = [
  process.env.BUN_CHROME_PATH,
  '/Applications/Dia.app/Contents/MacOS/Dia',
]

export function browserBinaryPath(): string | undefined {
  return candidates.find(candidate => candidate !== undefined && existsSync(candidate))
}

/**
 * Point a `chrome` backend at that binary. Backends that connect to an already
 * running browser (`url`), or that name their own `path`, are left alone —
 * there is nothing for us to spawn.
 */
export function withBrowserBinary(backend: Bun.WebView.Backend): Bun.WebView.Backend {
  const path = browserBinaryPath()
  if (!path) return backend
  if (backend === 'chrome') return { type: 'chrome', url: false, path }
  if (typeof backend === 'string' || backend.type !== 'chrome') return backend
  if ('url' in backend && typeof backend.url === 'string') return backend
  if ('path' in backend && backend.path) return backend

  return { ...backend, path }
}

/**
 * Spawn a headless view on that binary, with the requested size actually
 * applied to the page.
 *
 * Dia's headless targets start with 0x0 window bounds, so `innerWidth` and
 * every `getBoundingClientRect()` come back as zero and anything that measures
 * the viewport (the click-catcher heuristic, screenshots) sees a collapsed
 * page. The metrics override that fixes it needs a live session, which only
 * exists after the first navigation — hence the blank hop before the caller's
 * own navigate. The override survives it.
 */
export async function openBrowserView(options: Bun.WebView.ConstructorOptions): Promise<Bun.WebView> {
  const view = new Bun.WebView(options.backend ? { ...options, backend: withBrowserBinary(options.backend) } : options)
  if (!options.width || !options.height) return view

  try {
    await view.navigate('about:blank')
    await view.resize(options.width, options.height)
  }
  catch {
    // A backend that refuses the override keeps whatever size it launched with.
  }

  return view
}
