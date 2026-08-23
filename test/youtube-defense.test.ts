import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { BlockEvent } from '../src/shared/types'
import { buildContentScript, buildEntry } from './helpers/bundle'
import { openChromeView } from './helpers/webview'

let contentScript = ''
let ytInpageScript = ''

beforeAll(async () => {
  contentScript = await buildContentScript()
  ytInpageScript = await buildEntry('src/content/yt-inpage.ts')
})

describe('YouTube video-ad defenses', () => {
  it('mutes, speeds, and seeks a non-skippable video ad to its end, then restores the player', async () => {
    await withYouTubePage(fastForwardFixture(), async (view) => {
      // While the ad runs it is muted and sped up, and — once the duration is
      // known — seeked straight to its end so the pod advances immediately.
      await waitFor(view, `document.getElementById('ad-video').playbackRate === 16`, 'ad sped up')
      await waitFor(view, `document.getElementById('ad-video').muted === true`, 'ad muted')
      await waitFor(view, `document.getElementById('ad-video').currentTime === 30`, 'ad seeked to end')

      await waitFor(view, `(window.__adblockEvents?.length ?? 0) > 0`, 'event flush')
      const events = await view.evaluate<BlockEvent[]>(`window.__adblockEvents ?? []`)
      const videoEvents = events.filter(event => event.source === 'video')
      // The skip click and the fast-forward both fire for the same ad; the ad
      // must still be credited exactly once.
      expect(videoEvents.reduce((total, event) => total + event.count, 0)).toBe(1)

      // When the ad ends, the viewer's speed and sound come back…
      await view.evaluate(`document.getElementById('movie_player').classList.remove('ad-showing')`)
      await waitFor(view, `document.getElementById('ad-video').playbackRate === 1`, 'rate restored')
      await waitFor(view, `document.getElementById('ad-video').muted === false`, 'sound restored')
      // …and the video starts playing on its own instead of staying parked.
      await waitFor(view, `document.getElementById('ad-video').paused === false`, 'playback auto-started')
    })
  }, 30_000)

  it('clicks a skip button that becomes visible without a DOM mutation', async () => {
    await withYouTubePage(pollSkipFixture(), async (view) => {
      // The button is in the DOM from the start but hidden; it is revealed via a
      // style change (an attribute mutation the childList observer ignores), so
      // only the ad-poll interval can catch it.
      await waitFor(view, `window.__skipClicked === true`, 'skip clicked by the poll', 6_000)
      expect(await view.evaluate<boolean>(`window.__skipClicked === true`)).toBe(true)
    })
  }, 30_000)

  it('closes and removes the anti-adblock enforcement popup so the scroll lock releases', async () => {
    await withYouTubePage(antiAdblockFixture(), async (view) => {
      // The dialog must be CLOSED (via its close()), not merely hidden: while it
      // stays open, YouTube's overlay manager keeps snapping scroll back and the
      // page judders up and down without ever scrolling.
      await waitFor(view, `window.__dialogClosed === true`, 'dialog close() called')
      await waitFor(view, `document.querySelector('ytd-enforcement-message-view-model') === null`, 'enforcement popup removed')
      await waitFor(view, `document.querySelector('tp-yt-iron-overlay-backdrop') === null`, 'backdrop removed')
      await waitFor(view, `document.getElementById('main-video').paused === false`, 'playback resumed')

      expect(await view.evaluate<string>(`document.documentElement.style.overflow`)).toBe('auto')

      await waitFor(view, `(window.__adblockEvents?.length ?? 0) > 0`, 'event flush')
      const events = await view.evaluate<BlockEvent[]>(`window.__adblockEvents ?? []`)
      expect(new Set(events.map(event => event.source)).has('youtube')).toBe(true)
    })
  }, 30_000)

  it('leaves a leftover skip button alone once the player is out of ad state', async () => {
    await withYouTubePage(staleSkipFixture(), async (view) => {
      // The button is visible and matches the skip selectors, but the player is
      // not in `ad-showing` — the poll must not keep clicking the player.
      await Bun.sleep(1_200)
      expect(await view.evaluate<boolean>(`window.__skipClicked === true`)).toBe(false)
    })
  }, 30_000)

  it('prunes ads out of XMLHttpRequest-delivered player responses before the app reads them', async () => {
    await withYouTubePage(xhrFixture(), async (view) => {
      // Both response shapes YouTube reads: raw text parsed by the app, and the
      // browser-parsed `responseType: 'json'`.
      await waitFor(view, `window.__xhrTextAds === 0`, 'text XHR pruned')
      await waitFor(view, `window.__xhrJsonAds === 0`, 'json XHR pruned')

      // The removals are attributed for stats.
      await waitFor(view, `(window.__adblockEvents ?? []).some(e => e.source === 'youtube')`, 'prune event flushed')
      const events = await view.evaluate<BlockEvent[]>(`window.__adblockEvents ?? []`)
      const pruned = events.filter(event => event.source === 'youtube').reduce((total, event) => total + event.count, 0)
      expect(pruned).toBeGreaterThanOrEqual(4)
    })
  }, 30_000)

  it('prunes the inline ytInitialData browse payload as it is assigned', async () => {
    await withYouTubePage(initialDataFixture(), async (view) => {
      await waitFor(view, `Array.isArray(window.__initialDataContents)`, 'fixture assigned ytInitialData')
      await waitFor(view, `window.__initialDataContents.length === 1`, 'feed ad cell pruned from ytInitialData')

      await waitFor(view, `(window.__adblockEvents ?? []).some(e => e.source === 'youtube')`, 'prune event flushed')
    })
  }, 30_000)

  it('patches the fresh realm a dynamically inserted iframe hands out, so stolen natives stay defused', async () => {
    await withYouTubePage(frameRealmFixture(), async (view) => {
      // The classic bypass: append a blank iframe, grab `contentWindow.fetch`
      // before anything patches it, then use that reference for Innertube calls.
      // The frame realm is patched at insertion, so the stolen fetch prunes too.
      await waitFor(view, `window.__stolenFetchAds === 0`, 'stolen fetch pruned')

      await waitFor(view, `(window.__adblockEvents ?? []).some(e => e.source === 'youtube')`, 'prune event flushed')
    })
  }, 30_000)
})

async function withYouTubePage(
  bodyMarkup: string,
  run: (view: Bun.WebView) => Promise<void>,
  options: { api?: ApiHandler } = {},
): Promise<void> {
  const page = wrapFixture(bodyMarkup, [ytInpageScript, contentScript].join('\n;\n'))
  const certDir = await mkdtemp(join(tmpdir(), 'adblock-yt-defense-'))
  const keyPath = join(certDir, 'key.pem')
  const certPath = join(certDir, 'cert.pem')
  await Bun.$`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${keyPath} -out ${certPath} -subj /CN=localhost -days 1`.quiet()

  const api = options.api ?? adPlayerApi
  const server = Bun.serve({
    port: 0,
    tls: { key: await Bun.file(keyPath).text(), cert: await Bun.file(certPath).text() },
    fetch(request) {
      const url = new URL(request.url)
      const apiResponse = api(url.pathname + url.search)
      if (apiResponse) return apiResponse
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
  }
}

type ApiHandler = (path: string) => Response | undefined

/** A player response shaped like the live ones: playback data plus ad pods. */
function adPlayerResponse(): Record<string, unknown> {
  return {
    responseContext: {},
    playabilityStatus: { status: 'OK' },
    streamingData: { formats: [{ itag: 18, url: 'https://example/video' }] },
    videoDetails: { videoId: 'defense01', title: 'Defense fixture' },
    captions: { playerCaptionsTracklistRenderer: {} },
    adPlacements: [{ adPlacementRenderer: { config: {} } }, { adPlacementRenderer: { config: {} } }],
    adSlots: [{ adSlotRenderer: {} }],
  }
}

function adPlayerApi(path: string): Response | undefined {
  if (!path.startsWith('/youtubei/v1/player')) return undefined
  return new Response(JSON.stringify(adPlayerResponse()), {
    headers: { 'content-type': 'application/json' },
  })
}

function fastForwardFixture(): string {
  return `<ytd-app>
    <div id="movie_player" class="html5-video-player ad-showing">
      <video id="ad-video"></video>
      <button class="ytp-ad-skip-button-modern" onclick="window.__skipClicked = true">Skip</button>
    </div>
    <script>
      (() => {
        const v = document.getElementById('ad-video');
        Object.defineProperty(v, 'duration', { configurable: true, value: 30 });
        let ct = 0;
        Object.defineProperty(v, 'currentTime', { configurable: true, get: () => ct, set: (value) => { ct = value; } });
        // A source-less <video> never leaves the paused state on play(), so the
        // fixture models a real (media-backed) player's behavior instead.
        Object.defineProperty(v, 'paused', { configurable: true, writable: true, value: true });
        v.play = () => { v.paused = false; return Promise.resolve(); };
      })();
    </script>
  </ytd-app>`
}

/** A player response read back over XHR, in both text and json response modes. */
function xhrFixture(): string {
  return `<ytd-app>
    <div id="movie_player" class="html5-video-player">
      <video id="main-video"></video>
    </div>
    <script>
      setTimeout(() => {
        const text = new XMLHttpRequest();
        text.open('POST', '/youtubei/v1/player?prettyPrint=false');
        text.onload = () => {
          const data = JSON.parse(text.responseText);
          window.__xhrTextAds = (data.adPlacements || []).length + (data.adSlots || []).length;
        };
        text.send();

        const json = new XMLHttpRequest();
        json.open('POST', '/youtubei/v1/player?prettyPrint=false');
        json.responseType = 'json';
        json.onload = () => {
          const data = json.response;
          window.__xhrJsonAds = (data.adPlacements || []).length + (data.adSlots || []).length;
        };
        json.send();
      }, 400);
    </script>
  </ytd-app>`
}

/** The inline browse payload YouTube assigns as a literal, never via JSON.parse. */
function initialDataFixture(): string {
  return `<ytd-app>
    <script>
      setTimeout(() => {
        window.ytInitialData = {
          contents: {
            richGridRenderer: {
              contents: [
                { richItemRenderer: { content: { videoRenderer: { videoId: 'real' } } } },
                { richItemRenderer: { content: { adSlotRenderer: {} } } },
              ],
            },
          },
          playerResponse: { adPlacements: [{}, {}] },
        };
        window.__initialDataContents = window.ytInitialData.contents.richGridRenderer.contents;
      }, 400);
    </script>
  </ytd-app>`
}

/**
 * The fresh-realm bypass YouTube actually performs: append a blank iframe and
 * grab `contentWindow.fetch` before anything patches it, then call Innertube
 * through the stolen reference. The frame realm is patched at insertion, so the
 * stolen native is the pruned pipeline. (A frame that NAVIGATES gets a brand-new
 * realm on commit which no parent-side hook can pre-patch — but the observed
 * attack only ever reads natives from the synchronous about:blank realm.)
 */
function frameRealmFixture(): string {
  return `<ytd-app>
    <script>
      setTimeout(() => {
        const frame = document.createElement('iframe');
        document.body.appendChild(frame);
        const stolenFetch = frame.contentWindow.fetch;
        stolenFetch('/youtubei/v1/player?prettyPrint=false', { method: 'POST' })
          .then(response => response.json())
          .then((data) => { window.__stolenFetchAds = (data.adPlacements || []).length })
          .catch(() => { window.__stolenFetchAds = 'error' });
        frame.remove();
      }, 400);
    </script>
  </ytd-app>`
}

function pollSkipFixture(): string {
  return `<ytd-app>
    <div id="movie_player" class="html5-video-player ad-showing">
      <video id="ad-video"></video>
      <button class="ytp-ad-skip-button-modern" style="display:none" onclick="window.__skipClicked = true">Skip</button>
    </div>
    <script>
      setTimeout(() => {
        document.querySelector('.ytp-ad-skip-button-modern').style.display = 'block';
      }, 700);
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
        window.__dialogClosed = false;
        document.querySelector('tp-yt-paper-dialog').close = () => { window.__dialogClosed = true; };
      })();
    </script>
  </ytd-app>`
}

function staleSkipFixture(): string {
  return `<ytd-app>
    <div id="movie_player" class="html5-video-player">
      <video id="main-video"></video>
      <button class="ytp-skip-ad-button" onclick="window.__skipClicked = true">Skip</button>
    </div>
    <script>window.__skipClicked = false;</script>
  </ytd-app>`
}

function wrapFixture(body: string, scripts: string): string {
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
    <script>${scripts}</script>
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
