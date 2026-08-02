/**
 * Serve the built marketing pages from `dist/` for design work.
 *
 * `bun --bun resources/scripts/serve-site.ts` — `/` maps to marketing.html and
 * every other page keeps the name the extension build gave it, so the routes
 * match what `build-site.ts` publishes.
 *
 * Run `bun run build` first — this serves `dist/`, it does not produce it.
 */
import { join, resolve } from 'node:path'
import process from 'node:process'

const dist = resolve('dist')

const server = Bun.serve({
  port: Number(process.env.PORT ?? 8124),
  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname === '/' ? '/marketing.html' : url.pathname
    const name = path.replace(/^\//, '')

    // `dist/` holds the extension build; the product screenshots the feature
    // pages reference only reach the site at `build-site.ts` time. Falling back
    // to their source keeps the preview from showing broken images that the
    // published site does not have.
    for (const root of [dist, resolve('docs/public')]) {
      const file = Bun.file(join(root, name))
      if (await file.exists())
        return new Response(file, { headers: { 'cache-control': 'no-store' } })
    }

    return new Response('Not found', { status: 404 })
  },
})

console.log(`Marketing site on http://localhost:${server.port}/`)
