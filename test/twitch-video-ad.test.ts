/**
 * Twitch stitches video ads into the stream server-side, so there is no request
 * to block and no container to hide — the ad IS the video. What the extension
 * can do is take the break off the viewer: mute the player, cover it, and give
 * both back the moment the stream returns.
 *
 * The failure modes are all "the cover never comes off", which is worse than the
 * ad, so the restore path is tested harder than the suppression path: markers
 * that flicker between renders must not end the break early, and the viewer's
 * own volume choice must survive it.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { openChromeView } from './helpers/webview'

describe('Twitch stitched video ads', () => {
  it('mutes and covers the player for the break, then hands the stream back', async () => {
    const contentScript = await buildContentScript()
    const certDir = await mkdtemp(join(tmpdir(), 'adblock-twitch-ad-test-'))
    const keyPath = join(certDir, 'key.pem')
    const certPath = join(certDir, 'cert.pem')

    await Bun.$`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${keyPath} -out ${certPath} -subj /CN=localhost -days 1`.quiet()

    const page = wrapFixture(streamFixture(), contentScript)
    const server = Bun.serve({
      port: 0,
      tls: { key: await Bun.file(keyPath).text(), cert: await Bun.file(certPath).text() },
      fetch() {
        return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      },
    })

    const errors: string[] = []
    const view = await openChromeView({
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

    const cover = `document.querySelector('.vga-twitch-ad-cover')`
    const muted = `document.querySelector('video').muted`

    try {
      await view.navigate(`https://www.twitch.tv:${server.port}/kim_gottwald`)

      // Nothing is playing but the stream: the player must be left alone.
      await waitFor(view, `window.__adblockReady === true`, 'content script settled')
      expect(await view.evaluate<boolean>(`Boolean(${cover})`)).toBe(false)
      expect(await view.evaluate<boolean>(muted)).toBe(false)

      await view.evaluate(`window.__startAdBreak()`)
      await waitFor(view, `Boolean(${cover})`, 'ad cover shown')

      expect(await view.evaluate<boolean>(muted)).toBe(true)
      // Over the player, not over the page, and not swallowing the controls.
      expect(await view.evaluate<string | null>(`${cover}.parentElement.getAttribute('data-a-target')`)).toBe('video-player')
      expect(await view.evaluate<string>(`getComputedStyle(${cover}).pointerEvents`)).toBe('none')
      expect(await view.evaluate<string>(`${cover}.textContent`)).toContain('0:24')

      // Twitch re-renders the notice constantly; between renders no marker is in
      // the DOM at all. Ending the break there would unmute into the ad.
      await view.evaluate(`window.__flickerMarkers()`)
      await Bun.sleep(700)
      expect(await view.evaluate<boolean>(`Boolean(${cover})`)).toBe(true)
      expect(await view.evaluate<boolean>(muted)).toBe(true)

      await view.evaluate(`window.__endAdBreak()`)
      await waitFor(view, `!${cover}`, 'ad cover removed')

      expect(await view.evaluate<boolean>(muted)).toBe(false)
      // The player is handed back exactly as it was found.
      expect(await view.evaluate<string>(`document.querySelector('[data-a-target="video-player"]').style.position`)).toBe('')
      expect(errors).toEqual([])
    }
    finally {
      view.close()
      server.stop(true)
      await rm(certDir, { recursive: true, force: true })
    }
  }, 30_000)

  it('leaves the sound off if the viewer unmuted during the break', async () => {
    const contentScript = await buildContentScript()
    const certDir = await mkdtemp(join(tmpdir(), 'adblock-twitch-unmute-test-'))
    const keyPath = join(certDir, 'key.pem')
    const certPath = join(certDir, 'cert.pem')

    await Bun.$`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${keyPath} -out ${certPath} -subj /CN=localhost -days 1`.quiet()

    const page = wrapFixture(streamFixture(), contentScript)
    const server = Bun.serve({
      port: 0,
      tls: { key: await Bun.file(keyPath).text(), cert: await Bun.file(certPath).text() },
      fetch() {
        return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      },
    })

    const view = await openChromeView({
      width: 900,
      height: 700,
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
    })

    try {
      await view.navigate(`https://www.twitch.tv:${server.port}/kim_gottwald`)
      await waitFor(view, `window.__adblockReady === true`, 'content script settled')

      await view.evaluate(`window.__startAdBreak()`)
      await waitFor(view, `Boolean(document.querySelector('.vga-twitch-ad-cover'))`, 'ad cover shown')

      // A deliberate unmute mid-break. Restoring "what it was" would silence a
      // viewer who just asked for sound, so the value they set stands.
      await view.evaluate(`document.querySelector('video').muted = false`)
      await view.evaluate(`window.__endAdBreak()`)
      await waitFor(view, `!document.querySelector('.vga-twitch-ad-cover')`, 'ad cover removed')

      expect(await view.evaluate<boolean>(`document.querySelector('video').muted`)).toBe(false)
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

  if (!result.success) throw new Error(result.logs.map(log => log.message).join('\n'))

  const output = result.outputs.find(file => file.path.endsWith('.js')) ?? result.outputs[0]
  return output.text()
}

/** A stream with no ad running, plus the controls to start and end a break. */
function streamFixture(): string {
  return `<!doctype html>
<html>
  <head><title>Twitch stream fixture</title></head>
  <body>
    <main>
      <div data-a-target="video-player">
        <video></video>
        <div id="ad-slot"></div>
      </div>
    </main>
    <script>
      const slot = document.getElementById('ad-slot');
      window.__startAdBreak = () => {
        slot.innerHTML = '<div class="commercial-break-in-progress">Ad 1 of 2</div>'
          + '<div data-a-target="video-ad-countdown">0:24</div>';
      };
      // Twitch rebuilds the notice on every countdown tick: for a frame there is
      // no marker in the DOM at all.
      window.__flickerMarkers = () => {
        slot.innerHTML = '';
        setTimeout(() => window.__startAdBreak(), 120);
      };
      window.__endAdBreak = () => { slot.innerHTML = ''; };
    </script>
  </body>
</html>`
}

function wrapFixture(fixture: string, contentScript: string): string {
  return fixture.replace('</head>', `<script>
    window.__adblockEvents = [];
    window.__adblockReady = false;
    window.chrome = {
      runtime: {
        sendMessage: async message => {
          if (message.type === 'get-dashboard') {
            window.__adblockReady = true;
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
