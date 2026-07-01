import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import type { BlockEvent } from '../src/shared/types'

const fixturePath = new URL('./fixtures/youtube-watch.cached.html', import.meta.url)

describe('cached YouTube content script fixture', () => {
  it('clicks nested video ad skip buttons without hiding page containers', async () => {
    const contentScript = await buildContentScript()
    const fixture = await Bun.file(fixturePath).text()
    const page = wrapFixture(fixture, contentScript)
    const certDir = await mkdtemp(join(tmpdir(), 'adblock-youtube-test-'))
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
      await view.navigate(`https://www.youtube.com:${server.port}/watch?v=adblock-fixture`)
      await waitFor(view, `document.body.dataset.skipped === 'true'`, 'skip button click')
      await waitFor(view, `(window.__adblockEvents?.length ?? 0) > 0`, 'batched event flush')

      const hiddenCount = await view.evaluate<number>(`document.querySelectorAll('[data-adblock-hidden="true"]').length`)
      const events = await view.evaluate<BlockEvent[]>(`window.__adblockEvents ?? []`)
      const eventSources = new Set(events.map(event => event.source))
      const videoSecondsSaved = events.reduce((total, event) => total + (event.videoSecondsSaved ?? 0), 0)

      expect(errors).toEqual([])
      expect(hiddenCount).toBe(0)
      expect(eventSources.has('video')).toBe(true)
      expect(videoSecondsSaved).toBeGreaterThanOrEqual(15)
    }
    finally {
      view.close()
      server.stop(true)
      await rm(certDir, { recursive: true, force: true })
      Bun.WebView.closeAll()
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
