import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { ytPruneMessageSource } from '../src/shared/constants'

/**
 * Runs the real built `yt-inpage.js` in a real Chromium (Bun WebView), against a
 * player response served exactly like YouTube's, to prove ads are pruned from
 * both the inline `ytInitialPlayerResponse` and a live `/youtubei/v1/player`
 * fetch — while the `streamingData` the player needs to actually play is kept.
 */
describe('built YouTube MAIN-world pruner', () => {
  it('strips ad instructions from inline and fetched player responses, keeps playback data', async () => {
    const inpageScript = await buildInpageScript()
    const page = fixture(inpageScript)
    const certDir = await mkdtemp(join(tmpdir(), 'adblock-yt-test-'))
    const keyPath = join(certDir, 'key.pem')
    const certPath = join(certDir, 'cert.pem')

    await Bun.$`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${keyPath} -out ${certPath} -subj /CN=localhost -days 1`.quiet()

    const server = Bun.serve({
      port: 0,
      tls: {
        key: await Bun.file(keyPath).text(),
        cert: await Bun.file(certPath).text(),
      },
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname.includes('/youtubei/v1/player')) {
          return new Response(JSON.stringify(playerResponse()), {
            headers: { 'content-type': 'application/json; charset=utf-8' },
          })
        }
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
      await view.navigate(`https://www.youtube.com:${server.port}/watch?v=abc123`)
      await waitFor(view, `window.__ytTest && window.__ytTest.done === true`, 'pruner ran')

      const result = await view.evaluate<{
        inlineAdPlacements: boolean
        inlineStreaming: boolean
        fetchAdPlacements: boolean
        fetchAdSlots: boolean
        fetchStreamingFormats: number
        jsonParseAdPlacements: boolean
        jsonParseStreaming: boolean
        reportedCount: number
      }>(`window.__ytTest`)

      // Inline ytInitialPlayerResponse: ads gone, playback data kept.
      expect(result.inlineAdPlacements).toBe(false)
      expect(result.inlineStreaming).toBe(true)

      // Fetched /youtubei/v1/player response: ads gone, streamingData intact.
      expect(result.fetchAdPlacements).toBe(false)
      expect(result.fetchAdSlots).toBe(false)
      expect(result.fetchStreamingFormats).toBe(1)

      // JSON.parse of an ad-shaped payload is pruned, playback data kept.
      expect(result.jsonParseAdPlacements).toBe(false)
      expect(result.jsonParseStreaming).toBe(true)

      // The pruner reported removed ads back over postMessage (inline + fetch + parse).
      expect(result.reportedCount).toBeGreaterThanOrEqual(3)

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

async function buildInpageScript(): Promise<string> {
  const result = await Bun.build({
    entrypoints: ['src/content/yt-inpage.ts'],
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

function playerResponse(): Record<string, unknown> {
  return {
    playabilityStatus: { status: 'OK' },
    streamingData: { formats: [{ itag: 18, url: 'https://example/video' }], adaptiveFormats: [] },
    videoDetails: { videoId: 'abc123', title: 'Test video', lengthSeconds: '212' },
    adPlacements: [{ adPlacementRenderer: {} }, { adPlacementRenderer: {} }],
    adSlots: [{ adSlotRenderer: {} }],
    playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
  }
}

function fixture(inpageScript: string): string {
  const source = JSON.stringify(ytPruneMessageSource)
  return `<!doctype html>
<html>
  <head>
    <title>YouTube Prune Fixture</title>
    <script>
      window.__ytErrors = [];
      window.addEventListener('error', e => window.__ytErrors.push(e.message));
    </script>
    <script>${inpageScript}</script>
    <script>
      (function () {
        let reportedCount = 0;
        window.addEventListener('message', function (event) {
          if (event.source !== window) return;
          if (event.data && event.data.source === ${source}) reportedCount += Number(event.data.count) || 0;
        });

        // Inline first-video player response (ads present).
        window.ytInitialPlayerResponse = {
          playabilityStatus: { status: 'OK' },
          streamingData: { formats: [{ itag: 18 }] },
          videoDetails: { videoId: 'abc123' },
          adPlacements: [{ adPlacementRenderer: {} }],
          playerAds: [{ x: 1 }],
        };

        const inline = window.ytInitialPlayerResponse || {};

        // A player response parsed via JSON.parse (the path fetch/accessor miss).
        var parsed = JSON.parse('{"adPlacements":[{"a":1}],"playerAds":[{"b":2}],"streamingData":{"formats":[{"itag":22}]}}');

        fetch('/youtubei/v1/player?prettyPrint=false')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            window.__ytTest = {
              inlineAdPlacements: Boolean(inline.adPlacements),
              inlineStreaming: Boolean(inline.streamingData),
              fetchAdPlacements: Boolean(data.adPlacements),
              fetchAdSlots: Boolean(data.adSlots),
              fetchStreamingFormats: (data.streamingData && data.streamingData.formats ? data.streamingData.formats.length : 0),
              jsonParseAdPlacements: Boolean(parsed.adPlacements),
              jsonParseStreaming: Boolean(parsed.streamingData),
              reportedCount: reportedCount,
              done: true,
            };
          })
          .catch(function (err) {
            window.__ytTest = { done: true, error: String(err) };
          });
      }());
    </script>
  </head>
  <body><div id="player"></div></body>
</html>`
}

async function waitFor(view: Bun.WebView, expression: string, label: string, timeoutMs = 8_000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await view.evaluate<boolean>(`Boolean(${expression})`)) return
    await Bun.sleep(100)
  }

  throw new Error(`Timed out waiting for ${label}`)
}
