import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { BlockEvent } from '../src/shared/types'
import { ytConfigMessageSource, ytPruneMessageSource } from '../src/shared/constants'
import { buildEntry } from './helpers/bundle'
import { openChromeView } from './helpers/webview'

// A publisher page embedding a youtube-nocookie player, served from two real
// origins so the embed script runs in a genuine cross-origin subframe.
let server: ReturnType<typeof Bun.serve>
let certDir: string
let embedScript: string

beforeAll(async () => {
  embedScript = await buildEntry('src/content/yt-embed.ts')
  certDir = await mkdtemp(join(tmpdir(), 'adblock-embed-test-'))
  const keyPath = join(certDir, 'key.pem')
  const certPath = join(certDir, 'cert.pem')
  await Bun.$`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${keyPath} -out ${certPath} -subj /CN=localhost -days 1`.quiet()

  server = Bun.serve({
    port: 0,
    tls: { key: await Bun.file(keyPath).text(), cert: await Bun.file(certPath).text() },
    fetch(request) {
      const url = new URL(request.url)
      const html = url.hostname === 'www.youtube-nocookie.com' ? embedPage() : publisherPage(url.port)
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    },
  })
})

afterAll(async () => {
  server?.stop(true)
  await rm(certDir, { recursive: true, force: true })
})

async function view(): Promise<Bun.WebView> {
  return openChromeView({
    width: 900,
    height: 700,
    backend: {
      type: 'chrome',
      url: false,
      argv: [
        '--host-resolver-rules=MAP www.youtube-nocookie.com 127.0.0.1, MAP publisher.test 127.0.0.1',
        '--proxy-server=direct://',
        '--proxy-bypass-list=*',
        '--ignore-certificate-errors',
        '--allow-insecure-localhost',
      ],
    },
  })
}

describe('YouTube players embedded in other sites', () => {
  it('turns the pruner on, skips the ad, and reports both to the page around it', async () => {
    const page = await view()
    try {
      await page.navigate(`https://publisher.test:${server.port}/article`)
      await waitFor(page, `(window.__embedEvents ?? []).some(event => event.source === 'video')`, 'embed video-ad event')
      await waitFor(page, `(window.__embedEvents ?? []).some(event => event.source === 'youtube')`, 'embed prune event')

      const events = await page.evaluate<BlockEvent[]>(`window.__embedEvents`)
      const total = (source: string) => events.filter(event => event.source === source).reduce((sum, event) => sum + event.count, 0)
      // One ad, counted once even though both the skip click and the
      // fast-forward handled it; two placements the pruner removed.
      expect(total('video')).toBe(1)
      expect(total('youtube')).toBe(2)
      expect(await page.evaluate<unknown[]>(`window.__embedConfig`)).toEqual([true])
    }
    finally {
      page.close()
    }
  }, 30_000)

  it('stays out of the way when the embed URL is the page itself', async () => {
    const page = await view()
    try {
      await page.navigate(`https://www.youtube-nocookie.com:${server.port}/embed/abc`)
      await Bun.sleep(1_500)
      // Top frames are the page content script's; this one must not act there.
      expect(await page.evaluate<boolean>(`document.querySelector('.ytp-ad-skip-button').dataset.clicked === 'true'`)).toBe(false)
      expect(await page.evaluate<number>(`window.__sent.length`)).toBe(0)
    }
    finally {
      page.close()
    }
  }, 30_000)
})

function publisherPage(port: string): string {
  return `<!doctype html>
<html>
  <head><title>Publisher</title></head>
  <body>
    <h1>Article with a video</h1>
    <script>
      window.__embedEvents = [];
      window.__embedConfig = [];
      window.addEventListener('message', event => {
        if (event.data?.test === 'events') window.__embedEvents.push(...event.data.events);
        if (event.data?.test === 'config') window.__embedConfig.push(event.data.enabled);
      });
    </script>
    <iframe src="https://www.youtube-nocookie.com:${port}/embed/abc" width="640" height="360"></iframe>
  </body>
</html>`
}

function embedPage(): string {
  return `<!doctype html>
<html>
  <head>
    <script>
      window.__sent = [];
      window.chrome = {
        runtime: {
          sendMessage: async message => {
            window.__sent.push(message);
            if (message.type === 'get-embed-config') return { ok: true, data: { enabled: true } };
            if (message.type === 'record-blocks') parent.postMessage({ test: 'events', events: message.events }, '*');
            return { ok: true, data: true };
          },
        },
      };
      window.addEventListener('message', event => {
        if (event.data?.source === ${JSON.stringify(ytConfigMessageSource)}) parent.postMessage({ test: 'config', enabled: event.data.enabled }, '*');
      });
    </script>
  </head>
  <body>
    <div class="html5-video-player ad-showing">
      <video muted></video>
      <button class="ytp-ad-skip-button" onclick="this.dataset.clicked = 'true'">Skip</button>
    </div>
    <script>${embedScript}</script>
    <script>
      // What the MAIN-world pruner posts after removing two ad placements.
      window.postMessage({ source: ${JSON.stringify(ytPruneMessageSource)}, count: 2 }, location.origin);
    </script>
  </body>
</html>`
}

async function waitFor(page: Bun.WebView, expression: string, label: string, timeoutMs = 8_000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await page.evaluate<boolean>(`Boolean(${expression})`)) return
    await Bun.sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}
