import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const fixtureUrl = 'https://www.youtube.com/watch?v=adblock-fixture'
const fixturePath = resolve('test/fixtures/youtube-watch.cached.html')
const cacheDir = resolve('.cache/youtube-fixtures')
const scraperRoot = resolve(process.env.TS_WEB_SCRAPER_DIR ?? '../Libraries/ts-web-scraper')
const fixtureHtml = buildYoutubeFixture()

await mkdir(dirname(fixturePath), { recursive: true })

const scraper = await loadLocalScraper()
if (scraper) {
  const document = scraper.parseHTML(fixtureHtml)
  assertFixture(document.querySelector('.ytp-ad-skip-button'), 'missing YouTube skip button')
  assertFixture(document.querySelector('.video-ads'), 'missing YouTube video ads container')
  assertFixture(document.querySelector('ytd-display-ad-renderer'), 'missing YouTube display ad renderer')
  assertFixture(document.querySelector('#masthead-ad'), 'missing YouTube masthead ad')
  assertFixture(document.querySelector('#feed-ad'), 'missing YouTube in-feed ad cell')
  assertFixture(document.querySelector('#feed-video'), 'missing YouTube real feed video cell')

  const cache = new scraper.ScraperCache({
    storage: 'disk',
    cacheDir,
    ttl: 30 * 24 * 60 * 60 * 1000,
  })

  await cache.set(fixtureUrl, fixtureHtml, undefined, {
    url: fixtureUrl,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'x-fixture-source': 'ts-web-scraper',
    },
  })

  const cachedHtml = (await cache.get<string>(fixtureUrl))?.data
  if (!cachedHtml?.includes('ytInitialPlayerResponse')) {
    throw new Error('cached fixture did not round-trip')
  }
  await Bun.write(fixturePath, cachedHtml)
  console.log(`Cached YouTube fixture with ts-web-scraper: ${fixturePath}`)
}
else {
  const existing = Bun.file(fixturePath)
  if (!await existing.exists()) {
    await Bun.write(fixturePath, fixtureHtml)
  }
  console.log(`Using committed YouTube fixture: ${fixturePath}`)
}

async function loadLocalScraper(): Promise<{
  ScraperCache: new (options?: Record<string, unknown>) => {
    set: <T>(key: string, data: T, ttl?: number, options?: Record<string, unknown>) => Promise<void>
    get: <T>(key: string) => Promise<{ data: T } | null>
  }
  parseHTML: (html: string) => {
    querySelector: (selector: string) => unknown
  }
} | undefined> {
  try {
    const cacheModule = await import(pathToFileURL(join(scraperRoot, 'src/cache.ts')).href)
    const parserModule = await import(pathToFileURL(join(scraperRoot, 'src/web-scraper.ts')).href)
    return {
      ScraperCache: cacheModule.ScraperCache,
      parseHTML: parserModule.parseHTML,
    }
  }
  catch (error) {
    if (process.env.CI !== 'true') {
      console.warn(`ts-web-scraper fixture cache unavailable at ${scraperRoot}: ${error instanceof Error ? error.message : String(error)}`)
    }
    return undefined
  }
}

function buildYoutubeFixture(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Cached YouTube Watch Fixture</title>
    <meta name="description" content="Deterministic YouTube-like ad fixture for Adblock tests">
    <script nonce="fixture">
      var ytInitialPlayerResponse = {
        "adPlacements": [
          {
            "adPlacementRenderer": {
              "config": {
                "adPlacementConfig": {
                  "kind": "AD_PLACEMENT_KIND_INSTREAM"
                }
              }
            }
          }
        ],
        "playbackTracking": {
          "videostatsWatchtimeUrl": {
            "baseUrl": "https://www.youtube.com/api/stats/watchtime?fixture=1"
          }
        }
      };
    </script>
  </head>
  <body>
    <ytd-app>
      <div id="masthead-ad">Masthead banner ad</div>
      <ytd-watch-flexy video-id="adblock-fixture">
        <div id="player" class="style-scope ytd-watch-flexy">
          <div id="movie_player" class="ad-showing html5-video-player">
            <div class="ytp-ad-module">
              <div class="ytp-ad-player-overlay">Sponsored video module</div>
            </div>
            <div class="video-ads ytp-ad-overlay-container">
              <button class="ytp-ad-skip-button ytp-button" type="button" onclick="document.body.dataset.skipped = 'true'">
                <span class="ytp-ad-skip-button-text">Skip Ads</span>
              </button>
            </div>
            <video class="html5-main-video video-stream" src="blob:https://www.youtube.com/fixture"></video>
          </div>
        </div>
        <div id="columns">
          <ytd-display-ad-renderer class="style-scope ytd-watch-next-secondary-results-renderer">Display ad</ytd-display-ad-renderer>
          <ytd-promoted-sparkles-web-renderer>Promoted sparkle</ytd-promoted-sparkles-web-renderer>
          <ytd-companion-slot-renderer>Companion ad</ytd-companion-slot-renderer>
          <ytd-ad-slot-renderer>Inline slot ad</ytd-ad-slot-renderer>
          <div id="comments">
            <ytd-comment-thread-renderer>A real viewer comment</ytd-comment-thread-renderer>
          </div>
        </div>
        <ytd-rich-grid-renderer>
          <ytd-rich-item-renderer id="feed-ad">
            <div id="content">
              <ytd-ad-slot-renderer>In-feed sponsored card</ytd-ad-slot-renderer>
            </div>
          </ytd-rich-item-renderer>
          <ytd-rich-item-renderer id="feed-video">
            <div id="content">
              <ytd-rich-grid-media>A real recommended video</ytd-rich-grid-media>
            </div>
          </ytd-rich-item-renderer>
        </ytd-rich-grid-renderer>
      </ytd-watch-flexy>
    </ytd-app>
  </body>
</html>
`
}

function assertFixture(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
