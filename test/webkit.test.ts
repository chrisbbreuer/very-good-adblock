import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { Window } from 'very-happy-dom'
import { outFile, render } from '../resources/scripts/build-webkit-data'
import { urlFilterToRegex, webkitContentRules, webkitPageScripts } from '../resources/functions/webkit'
import { buildStaticRules } from '../src/rules/static-rules'

/** WebKit's content-blocker regex subset: no alternation outside classes, no counted repetition. */
function webkitAccepts(pattern: string): boolean {
  const outsideClasses = pattern.replace(/\[(?:\\.|[^\]])*\]/g, '')
  return !/(?<!\\)\|/.test(outsideClasses) && !/(?<!\\)\{/.test(outsideClasses)
}

describe('the WebKit library', () => {
  it('carries data generated from the extension\'s current rules and scripts', async () => {
    expect(readFileSync(outFile, 'utf8')).toBe(await render())
  }, 60_000)

  it('turns adblock filters into patterns WebKit compiles and that match what they should', () => {
    const host = new RegExp(urlFilterToRegex('||doubleclick.net^'))
    expect(host.test('https://doubleclick.net/x')).toBe(true)
    expect(host.test('https://ad.g.doubleclick.net:443/x')).toBe(true)
    expect(host.test('https://notdoubleclick.net/x')).toBe(false)
    expect(host.test('https://doubleclick.network/x')).toBe(false)
    const path = new RegExp(urlFilterToRegex('||youtube.com/api/stats/ads^'))
    expect(path.test('https://www.youtube.com/api/stats/ads?ver=2')).toBe(true)
    expect(path.test('https://www.youtube.com/api/stats/adsense')).toBe(false)
    const anchored = new RegExp(urlFilterToRegex('|https://gql.twitch.tv/gql?operationName=VideoAd'))
    expect(anchored.test('https://gql.twitch.tv/gql?operationName=VideoAdUi')).toBe(true)
    expect(anchored.test('http://x/https://gql.twitch.tv/gql?operationName=VideoAd')).toBe(false)
  })

  it('blocks every host the extension blocks, in lists WebKit can compile', () => {
    const lists = webkitContentRules()
    const rules = lists.flatMap(list => list.rules)
    const blocks = rules.filter(rule => rule.action.type === 'block')
    const extensionBlocks = buildStaticRules().filter(rule => rule.action.type === 'block')
    expect(blocks).toHaveLength(extensionBlocks.length)
    expect(rules.every(rule => webkitAccepts(rule.trigger['url-filter']))).toBe(true)
    expect(lists.every(list => list.rules.length <= 50_000 && /^very-good-adblock-\d+$/.test(list.identifier))).toBe(true)
    // An exception only lifts the blocks before it in the same list.
    const last = lists.at(-1)!.rules
    const exception = last.findIndex(rule => rule.action.type === 'ignore-previous-rules')
    expect(exception).toBeGreaterThan(-1)
    expect(lists.at(-1)!.rules.slice(0, exception).some(rule => rule.action.type === 'block') || lists.length > 1).toBe(true)
  })

  it('gives each version of the rules its own version string', () => {
    const plain = webkitContentRules()
    expect(webkitContentRules().map(list => list.version)).toEqual(plain.map(list => list.version))
    expect(webkitContentRules({ cookieConsent: true }).at(-1)!.version).not.toBe(plain.at(-1)!.version)
    const small = webkitContentRules({ listSize: 10_000 })
    expect(small.length).toBeGreaterThan(plain.length)
  })

  it('hides only with selectors a browser parses, scoped to their sites', () => {
    const document = new Window().document
    const hiding = webkitContentRules({ cookieConsent: true, aggressive: true }).flatMap(list => list.rules).filter(rule => rule.action.type === 'css-display-none')
    for (const rule of hiding) {
      const selector = (rule.action as { selector: string }).selector
      expect(() => document.querySelectorAll(selector)).not.toThrow()
    }
    const youtube = hiding.filter(rule => rule.trigger['if-domain']?.includes('*youtube.com'))
    expect(youtube.length).toBeGreaterThan(0)
  })

  it('ships the page-world scripts with the sites they belong to', () => {
    const scripts = Object.fromEntries(webkitPageScripts().map(script => [script.id, script]))
    expect(Object.keys(scripts).sort()).toEqual(['popup-guard', 'x-inpage', 'yt-inpage'])
    expect(scripts['yt-inpage']!.hosts).toEqual(['youtube.com', 'youtube-nocookie.com'])
    expect(scripts['x-inpage']!.hosts).toEqual(['x.com', 'twitter.com'])
    expect(scripts['popup-guard']).toMatchObject({ hosts: [], allFrames: true })
    for (const script of Object.values(scripts)) expect(() => new Function(script.js)).not.toThrow()
  })
})
