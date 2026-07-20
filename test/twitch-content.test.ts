import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import type { BlockEvent } from '../src/shared/types'

describe('cached Twitch content script fixture', () => {
  it('hides Twitch display banners but keeps video-ad markers for detection', async () => {
    const contentScript = await buildContentScript()
    const page = wrapFixture(twitchFixture(), contentScript)
    const certDir = await mkdtemp(join(tmpdir(), 'adblock-twitch-test-'))
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
          '--host-resolver-rules=MAP www.twitch.tv 127.0.0.1',
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
      await view.navigate(`https://www.twitch.tv:${server.port}/streamer`)
      await waitFor(view, `(window.__adblockEvents?.length ?? 0) > 0`, 'batched event flush')
      await waitFor(view, `getComputedStyle(document.querySelector('button[aria-label="Leave feedback for this Ad"]')).display === 'none'`, 'ad feedback button hidden')

      const hiddenCount = await view.evaluate<number>(`document.querySelectorAll('[data-adblock-hidden="true"]').length`)
      const events = await view.evaluate<BlockEvent[]>(`window.__adblockEvents ?? []`)
      const eventSources = new Set(events.map(event => event.source))
      const videoSecondsSaved = events.reduce((total, event) => total + (event.videoSecondsSaved ?? 0), 0)

      const isHidden = (selector: string): Promise<boolean | null> =>
        view.evaluate<boolean | null>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? getComputedStyle(el).display === 'none' : null })()`)

      // Ad-only affordances are hidden: the feedback button and the anti-adblock
      // "disable your ad blocker" nag overlay.
      expect(await isHidden('button[aria-label="Leave feedback for this Ad"]')).toBe(true)
      expect(await isHidden('.player-overlay-background')).toBe(true)

      // The legacy display-ad container is no longer targeted (Twitch dropped it),
      // so we must not hide it — proves the modernized selectors don't over-reach.
      expect(await isHidden('.stream-display-ad__container')).toBe(false)

      // Video-ad markers stay visible — the ad IS the stream, so we only detect them.
      expect(await isHidden('.player-ad-notice')).toBe(false)
      expect(await isHidden('.commercial-break-in-progress')).toBe(false)
      expect(await isHidden('[data-a-target="video-ad-label"]')).toBe(false)
      expect(await view.evaluate<boolean>(`document.querySelector('.player-ad-notice')?.hasAttribute('data-adblock-hidden') ?? true`)).toBe(false)

      expect(errors).toEqual([])
      expect(hiddenCount).toBeGreaterThanOrEqual(1)
      expect(eventSources.has('video')).toBe(true)
      expect(eventSources.has('twitch')).toBe(true)
      expect(videoSecondsSaved).toBeGreaterThanOrEqual(15)
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

function twitchFixture(): string {
  return `<!doctype html>
<html>
  <head>
    <title>Cached Twitch Fixture</title>
  </head>
  <body>
    <main>
      <div class="persistent-player">
        <video></video>
        <div class="player-ad-notice">Commercial break in progress</div>
        <div class="commercial-break-in-progress">Ad 1 of 2</div>
        <div data-a-target="video-ad-label">Advertisement</div>
        <div data-a-target="video-ad-countdown">0:24</div>
        <button aria-label="Leave feedback for this Ad">Feedback</button>
        <div class="video-player__overlay">
          <div class="player-overlay-background">
            <a href="/how-to-allow-ads-browser">Disable your ad blocker to keep watching</a>
          </div>
        </div>
        <div class="stream-display-ad__container">legacy display ad slot</div>
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
