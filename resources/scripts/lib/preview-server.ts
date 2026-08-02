/**
 * Serve `dist/` with the seeded `chrome.runtime` shim injected.
 *
 * Both the screenshot capture and any hands-on inspection of the popup and
 * dashboard need the same thing: the built pages, answering the message calls
 * they make on load, without a real extension install. Keeping that in one
 * place means a capture and a browser session look at the same surface.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { dashboardState, shimScript } from './preview-fixture'

export interface PreviewServerOptions {
  /** Directory to serve. Defaults to `dist`. */
  dist?: string
  /** Port. 0 picks a free one. */
  port?: number
  /**
   * Pin the colour scheme. The extension UI follows the OS preference, and a
   * capture has to be deterministic regardless of the machine taking it.
   */
  theme?: 'dark' | 'light'
}

export function startPreviewServer(options: PreviewServerOptions = {}): Bun.Server<undefined> {
  const dist = resolve(options.dist ?? 'dist')
  const shim = shimScript(dashboardState())
  const theme = options.theme ?? 'dark'

  const inject = (markup: string): string => markup
    .replace(/<html(?=[\s>])/, `<html data-theme="${theme}"`)
    .replace('</head>', `${shim}</head>`)

  return Bun.serve({
    port: options.port ?? 0,
    async fetch(request) {
      const url = new URL(request.url)
      const path = url.pathname === '/' ? '/options.html' : url.pathname
      const file = join(dist, path.replace(/^\//, ''))

      if (path.endsWith('.html') && existsSync(file)) {
        return new Response(inject(await Bun.file(file).text()), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      }

      if (existsSync(file))
        return new Response(Bun.file(file))

      return new Response('Not found', { status: 404 })
    },
  })
}
