import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { BlockEvent } from '../src/shared/types'

let contentScript = ''

beforeAll(async () => {
  contentScript = await buildContentScript()
})

describe('YouTube video-ad defenses', () => {
  it('fast-forwards a non-skippable video ad to its end', async () => {
    await withYouTubePage(fastForwardFixture(), async (view) => {
      await waitFor(view, `document.getElementById('ad-video').currentTime >= 29`, 'ad fast-forwarded')

      const currentTime = await view.evaluate<number>(`document.getElementById('ad-video').currentTime`)
      const playbackRate = await view.evaluate<number>(`document.getElementById('ad-video').playbackRate`)
      expect(currentTime).toBeGreaterThanOrEqual(29.5)
      expect(playbackRate).toBe(16)

      await waitFor(view, `(window.__adblockEvents?.length ?? 0) > 0`, 'event flush')
      const events = await view.evaluate<BlockEvent[]>(`window.__adblockEvents ?? []`)
      const videoSecondsSaved = events.reduce((total, event) => total + (event.videoSecondsSaved ?? 0), 0)
      expect(videoSecondsSaved).toBeGreaterThanOrEqual(29)
    })
  }, 30_000)

  it('dismisses the anti-adblock enforcement popup and resumes playback', async () => {
    await withYouTubePage(antiAdblockFixture(), async (view) => {
      await waitFor(view, `getComputedStyle(document.querySelector('ytd-enforcement-message-view-model')).display === 'none'`, 'enforcement card hidden')
      await waitFor(view, `document.getElementById('main-video').paused === false`, 'playback resumed')

      const backdropHidden = await view.evaluate<boolean>(`getComputedStyle(document.querySelector('tp-yt-iron-overlay-backdrop')).display === 'none'`)
      expect(backdropHidden).toBe(true)

      await waitFor(view, `(window.__adblockEvents?.length ?? 0) > 0`, 'event flush')
      const events = await view.evaluate<BlockEvent[]>(`window.__adblockEvents ?? []`)
      expect(new Set(events.map(event => event.source)).has('youtube')).toBe(true)
    })
  }, 30_000)
})

async function withYouTubePage(bodyMarkup: string, run: (view: Bun.WebView) => Promise<void>): Promise<void> {
  const page = wrapFixture(bodyMarkup, contentScript)
  const certDir = await mkdtemp(join(tmpdir(), 'adblock-yt-defense-'))
  const keyPath = join(certDir, 'key.pem')
  const certPath = join(certDir, 'cert.pem')
  await Bun.$`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${keyPath} -out ${certPath} -subj /CN=localhost -days 1`.quiet()

  const server = Bun.serve({
    port: 0,
    tls: { key: await Bun.file(keyPath).text(), cert: await Bun.file(certPath).text() },
    fetch() {
      return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } })
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
        '--host-resolver-rules=MAP www.youtube.com 127.0.0.1',
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
    await view.navigate(`https://www.youtube.com:${server.port}/watch?v=defense`)
    await run(view)
    expect(errors).toEqual([])
  }
  finally {
    view.close()
    server.stop(true)
    await rm(certDir, { recursive: true, force: true })
    Bun.WebView.closeAll()
  }
}

function fastForwardFixture(): string {
  return `<ytd-app>
    <div id="movie_player" class="html5-video-player ad-showing">
      <video id="ad-video"></video>
    </div>
    <script>
      (() => {
        const v = document.getElementById('ad-video');
        Object.defineProperty(v, 'duration', { configurable: true, value: 30 });
        let ct = 0;
        Object.defineProperty(v, 'currentTime', { configurable: true, get: () => ct, set: (value) => { ct = value; } });
      })();
    </script>
  </ytd-app>`
}

function antiAdblockFixture(): string {
  return `<ytd-app>
    <div id="movie_player" class="html5-video-player">
      <video id="main-video"></video>
    </div>
    <tp-yt-iron-overlay-backdrop class="opened" style="display:block"></tp-yt-iron-overlay-backdrop>
    <ytd-popup-container>
      <tp-yt-paper-dialog>
        <ytd-enforcement-message-view-model>Ad blockers violate YouTube's Terms of Service</ytd-enforcement-message-view-model>
      </tp-yt-paper-dialog>
    </ytd-popup-container>
    <script>
      (() => {
        const v = document.getElementById('main-video');
        Object.defineProperty(v, 'paused', { configurable: true, writable: true, value: true });
        v.play = () => { v.paused = false; return Promise.resolve(); };
      })();
    </script>
  </ytd-app>`
}

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

function wrapFixture(body: string, script: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>YouTube defense fixture</title>
    <script>
      window.__adblockEvents = [];
      window.chrome = {
        runtime: {
          sendMessage: async (message) => {
            if (message.type === 'get-dashboard') {
              return { ok: true, data: { settings: {
                enabled: true,
                badgeEnabled: true,
                cosmeticFiltering: true,
                aggressiveCosmetic: false,
                youtubeEnhancements: true,
                twitchEnhancements: true,
                allowedSites: [],
                blockedSites: [],
              } } };
            }
            if (message.type === 'record-blocks') {
              window.__adblockEvents.push(...message.events);
              return { ok: true, data: true };
            }
            return { ok: true, data: true };
          },
        },
      };
    </script>
  </head>
  <body>
    ${body}
    <script>${script}</script>
  </body>
</html>`
}

async function waitFor(view: Bun.WebView, expression: string, label: string, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await view.evaluate<boolean>(`Boolean(${expression})`)) return
    await Bun.sleep(100)
  }

  throw new Error(`Timed out waiting for ${label}`)
}

afterAll(() => {
  Bun.WebView.closeAll()
})
