import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import type { BlockEvent } from '../src/shared/types'

describe('cached X content script fixture', () => {
  it('hides promoted tweets but keeps ordinary tweet media visible', async () => {
    const contentScript = await buildContentScript()
    const page = wrapFixture(xFixture(), contentScript)
    const certDir = await mkdtemp(join(tmpdir(), 'adblock-x-test-'))
    const keyPath = join(certDir, 'key.pem')
    const certPath = join(certDir, 'cert.pem')

    await Bun.$`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${keyPath} -out ${certPath} -subj /CN=localhost -days 1`.quiet()

    const server = Bun.serve({
      port: 0,
      tls: {
        key: await Bun.file(keyPath).text(),
        cert: await Bun.file(certPath).text(),
      },
      fetch() {
        return new Response(page, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      },
    })

    const errors: string[] = []
    const view = new Bun.WebView({
      width: 1100,
      height: 780,
      backend: {
        type: 'chrome',
        url: false,
        argv: [
          '--host-resolver-rules=MAP x.com 127.0.0.1',
          '--proxy-server=direct://',
          '--proxy-bypass-list=*',
          '--ignore-certificate-errors',
          '--allow-insecure-localhost',
          '--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable,HttpsFirstModeV2ForEngagedSites',
        ],
      },
      console: (type, ...args) => {
        if (type === 'error') errors.push(args.map(String).join(' '))
      },
    })

    try {
      await view.navigate(`https://x.com:${server.port}/home`)
      await waitFor(view, `document.querySelector('#promoted-cell[data-adblock-hidden="true"]') !== null`, 'promoted tweet hidden')
      await waitFor(view, `(window.__adblockEvents ?? []).some(event => event.source === 'x')`, 'batched X event flush')

      const events = await view.evaluate<BlockEvent[]>(`window.__adblockEvents ?? []`)

      const isHidden = (selector: string): Promise<boolean | null> =>
        view.evaluate<boolean | null>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? getComputedStyle(el).display === 'none' : null })()`)

      // The promoted tweet cell is hidden...
      expect(await isHidden('#promoted-cell')).toBe(true)

      // ...but ordinary tweets and their media are left fully visible.
      expect(await isHidden('#organic-cell')).toBe(false)
      expect(await isHidden('#organic-photo')).toBe(false)
      expect(await isHidden('#organic-video')).toBe(false)
      expect(await view.evaluate<boolean>(`document.querySelector('#organic-cell')?.hasAttribute('data-adblock-hidden') ?? true`)).toBe(false)

      expect(errors).toEqual([])
      expect(events.some(event => event.source === 'x')).toBe(true)
    }
    finally {
      view.close()
      server.stop(true)
      await rm(certDir, { recursive: true, force: true })
    }
  }, 30_000)
})

async function buildContentScript(): Promise<string> {
  const result = await Bun.build({
    entrypoints: ['src/content/index.ts'],
    target: 'browser',
    write: false,
    minify: false,
  } as Parameters<typeof Bun.build>[0] & { write: false })

  if (!result.success) {
    throw new Error(result.logs.map(log => log.message).join('\n'))
  }

  const output = result.outputs.find(file => file.path.endsWith('.js')) ?? result.outputs[0]
  return output.text()
}

function xFixture(): string {
  // Both cells share the media-container test id X reuses on ordinary tweets;
  // only the promoted cell carries the standalone "Ad" label.
  return `<!doctype html>
<html>
  <head>
    <title>Cached X Fixture</title>
  </head>
  <body>
    <main>
      <div id="organic-cell" data-testid="cellInnerDiv">
        <article data-testid="tweet">
          <div data-testid="User-Name"><span>zeddotdev</span><span>@zeddotdev</span></div>
          <div data-testid="tweetText"><span>look at this Ad campaign we shipped</span></div>
          <div data-testid="placementTracking">
            <img id="organic-photo" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="photo">
            <video id="organic-video"></video>
          </div>
        </article>
      </div>
      <div id="promoted-cell" data-testid="cellInnerDiv">
        <article data-testid="tweet">
          <div data-testid="User-Name"><span>BrandCo</span><span>@brandco</span></div>
          <div data-testid="tweetText"><span>Our new product is here</span></div>
          <div data-testid="placementTracking">
            <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="ad">
          </div>
          <span>Ad</span>
        </article>
      </div>
    </main>
  </body>
</html>`
}

function wrapFixture(fixture: string, contentScript: string): string {
  return fixture.replace('</head>', `<script>
    window.__adblockEvents = [];
    window.__adblockErrors = [];
    window.addEventListener('error', event => window.__adblockErrors.push(event.message));
    window.addEventListener('unhandledrejection', event => window.__adblockErrors.push(String(event.reason)));
    window.chrome = {
      runtime: {
        sendMessage: async message => {
          if (message.type === 'get-dashboard') {
            return {
              ok: true,
              data: {
                settings: {
                  enabled: true,
                  badgeEnabled: true,
                  cosmeticFiltering: true,
                  aggressiveCosmetic: false,
                  youtubeEnhancements: true,
                  twitchEnhancements: true,
                  allowedSites: [],
                  blockedSites: [],
                },
              },
            };
          }

          if (message.type === 'record-blocks') {
            window.__adblockEvents.push(...message.events);
            return { ok: true, data: true };
          }

          return { ok: true, data: true };
        },
      },
    };
  </script></head>`).replace('</body>', `<script>${contentScript}</script></body>`)
}

async function waitFor(view: Bun.WebView, expression: string, label: string, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await view.evaluate<boolean>(`Boolean(${expression})`)) return
    await Bun.sleep(100)
  }

  throw new Error(`Timed out waiting for ${label}`)
}
