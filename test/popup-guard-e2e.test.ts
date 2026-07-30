import { describe, expect, it } from 'bun:test'
import { Window } from 'very-happy-dom'

const blueskyUrl = 'https://bsky.app/profile/dbernstein.bsky.social/post/3mr4nwjqq2222'
const surveyUrl = 'https://engage.stevescalise.com/2026-gop-agenda-survey-ads/?twclid=25g3yx9feo1eiimin5k49w3vso&&utm_campaign=20260415_FL-UF.103525_t1871243-1756'
const surveyProxyUrl = `https://go.bsky.app/redirect?u=${encodeURIComponent(surveyUrl)}`

describe('popup guard end-to-end navigation', () => {
  it('allows Bluesky-style outbound links and still blocks a pop-under', async () => {
    const guardScript = await buildGuardScript()
    const window = new Window({ url: blueskyUrl })
    const opened: Window[] = []
    const nativeOpen = window.open.bind(window)
    window.open = ((url?: string | URL, target?: string, features?: string) => {
      const child = nativeOpen(url, target, features)
      opened.push(child)
      return child
    }) as typeof window.open

    installGuard(window, guardScript)
    window.document.body!.innerHTML = `
      <a id="survey" href="${surveyUrl}" target="_blank" rel="noopener noreferrer">
        <span>engage.stevescalise.com/2026-gop-age...</span>
      </a>
      <a id="foreign-proxy" href="${surveyUrl}" target="_blank" rel="noopener noreferrer">
        Foreign proxy
      </a>
      <div id="video">play</div>
    `

    const survey = window.document.querySelector('#survey')!
    survey.addEventListener('click', (event) => {
      // Bluesky leaves the final URL in the anchor but opens a page-owned
      // redirector that carries the exact destination in its query string.
      event.preventDefault()
      window.open(surveyProxyUrl, '_blank', 'noopener')
    })
    survey.click()

    expect(opened).toHaveLength(1)
    expect(opened[0].location.href).toBe(surveyProxyUrl)
    expect(opened[0].opener).toBeNull()
    expect(opened[0].closed).toBe(false)

    const foreignProxy: Array<Window | null> = []
    const foreignProxyLink = window.document.querySelector('#foreign-proxy')!
    foreignProxyLink.addEventListener('click', (event) => {
      event.preventDefault()
      foreignProxy.push(window.open(
        `https://ads.example/redirect?u=${encodeURIComponent(surveyUrl)}`,
        '_blank',
        'noopener',
      ))
    })
    foreignProxyLink.click()

    expect(foreignProxy[0]?.closed).toBe(true)
    expect(opened).toHaveLength(1)

    window.document.querySelector('#video')!.click()
    const blankPopunder = window.open('about:blank', '_blank')
    const popunder = window.open('https://ads.example/pop', '_blank')

    expect(blankPopunder?.closed).toBe(true)
    expect(popunder?.closed).toBe(true)
    expect(opened).toHaveLength(1)
  })

  it('preserves target and rel for an argument-less blank link window', async () => {
    const guardScript = await buildGuardScript()
    const window = new Window({ url: blueskyUrl })
    const opened: Window[] = []
    const nativeOpen = window.open.bind(window)
    window.open = ((url?: string | URL, target?: string, features?: string) => {
      const child = nativeOpen(url, target, features)
      opened.push(child)
      return child
    }) as typeof window.open

    installGuard(window, guardScript)
    window.document.body!.innerHTML = `
      <a id="survey" href="${surveyUrl}" target="_blank" rel="noopener noreferrer">Survey</a>
    `
    const survey = window.document.querySelector('#survey')!
    survey.addEventListener('click', (event) => {
      event.preventDefault()
      const child = window.open()
      if (child) child.location.href = surveyUrl
    })
    survey.click()

    expect(opened).toHaveLength(1)
    expect(opened[0].location.href).toBe(surveyUrl)
    expect(opened[0].opener).toBeNull()
  })

  it('allows native target-blank anchor activation', async () => {
    const guardScript = await buildGuardScript()
    const window = new Window({ url: blueskyUrl })
    const opened: Window[] = []
    const nativeOpen = window.open.bind(window)
    window.open = ((url?: string | URL, target?: string, features?: string) => {
      const child = nativeOpen(url, target, features)
      opened.push(child)
      return child
    }) as typeof window.open

    installGuard(window, guardScript)
    window.document.body!.innerHTML = `<a id="survey" href="${surveyUrl}" target="_blank" rel="noopener noreferrer">Survey</a>`
    window.document.querySelector('#survey')!.click()

    expect(opened).toHaveLength(1)
    expect(opened[0].location.href).toBe(surveyUrl)
    expect(opened[0].opener).toBeNull()
  })
})

async function buildGuardScript(): Promise<string> {
  const result = await Bun.build({
    entrypoints: ['src/content/popup-guard.ts'],
    target: 'browser',
    write: false,
    minify: false,
  } as Parameters<typeof Bun.build>[0] & { write: false })

  if (!result.success) throw new Error(result.logs.map(log => log.message).join('\n'))
  return result.outputs[0].text()
}

function installGuard(window: Window, script: string): void {
  // Execute the shipping browser bundle against a complete isolated DOM, not
  // reimplemented guard logic. This covers capture events, anchor activation,
  // window.open, opener isolation, and the resulting child navigation together.
  const run = new Function('window', 'document', 'Element', 'navigator', 'URL', script)
  run(window, window.document, window.Element, window.navigator, window.URL)
}
