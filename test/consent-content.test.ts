import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import type { BlockEvent } from '../src/shared/types'

describe('cookie-consent content filtering', () => {
  it('hides a consent banner and restores page scrolling when opted in', async () => {
    const contentScript = await buildContentScript()
    const page = wrapFixture(consentFixture(), contentScript)
    const certDir = await mkdtemp(join(tmpdir(), 'adblock-consent-test-'))
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
      width: 900,
      height: 700,
      backend: {
        type: 'chrome',
        url: false,
        argv: [
          '--host-resolver-rules=MAP www.example.com 127.0.0.1',
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
      await view.navigate(`https://www.example.com:${server.port}/`)
      await waitFor(view, `getComputedStyle(document.querySelector('#onetrust-consent-sdk')).display === 'none'`, 'consent banner hidden')

      const isHidden = (selector: string): Promise<boolean | null> =>
        view.evaluate<boolean | null>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? getComputedStyle(el).display === 'none' : null })()`)

      // The consent overlay is hidden, real content is not.
      expect(await isHidden('#onetrust-consent-sdk')).toBe(true)
      expect(await isHidden('#main-content')).toBe(false)

      // Page scrolling is restored (the fixture locked it, the class is cleared).
      expect(await view.evaluate<string>(`document.body.style.overflow`)).toBe('auto')
      expect(await view.evaluate<boolean>(`document.body.classList.contains('modal-open')`)).toBe(false)

      await waitFor(view, `(window.__adblockEvents ?? []).some(event => event.source === 'consent')`, 'consent event flush')
      const events = await view.evaluate<BlockEvent[]>(`window.__adblockEvents ?? []`)
      expect(events.some(event => event.source === 'consent')).toBe(true)
      expect(errors).toEqual([])
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

  if (!result.success) throw new Error(result.logs.map(log => log.message).join('\n'))
  const output = result.outputs.find(file => file.path.endsWith('.js')) ?? result.outputs[0]
  return output.text()
}

function consentFixture(): string {
  return `<!doctype html>
<html>
  <head><title>Consent Fixture</title></head>
  <body class="modal-open" style="overflow: hidden">
    <main id="main-content"><h1>Real article content</h1></main>
    <div id="onetrust-consent-sdk">
      <div id="onetrust-banner-sdk">We value your privacy. <button>Accept all</button></div>
    </div>
  </body>
</html>`
}

function wrapFixture(fixture: string, contentScript: string): string {
  return fixture.replace('</head>', `<script>
    window.__adblockEvents = [];
    window.chrome = {
      runtime: {
        sendMessage: async message => {
          if (message.type === 'get-dashboard') {
            return { ok: true, data: { settings: {
              enabled: true,
              badgeEnabled: true,
              cosmeticFiltering: true,
              aggressiveCosmetic: false,
              cookieConsentFiltering: true,
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
  </script></head>`).replace('</body>', `<script>${contentScript}</script></body>`)
}

async function waitFor(view: Bun.WebView, expression: string, label: string, timeoutMs = 6_000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await view.evaluate<boolean>(`Boolean(${expression})`)) return
    await Bun.sleep(100)
  }

  throw new Error(`Timed out waiting for ${label}`)
}
