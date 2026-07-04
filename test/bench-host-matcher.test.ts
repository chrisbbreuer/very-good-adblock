import { describe, expect, it } from 'bun:test'
import { createHostSetMatcher } from '../bench/lib/competitive'
import { loadBlockedHostSet } from '../bench/lib/fixtures'

const req = (url: string) => ({ url, sourceUrl: 'https://news.example/', type: 'script' as const })

describe('bench host-set reference matcher (||host^ semantics)', () => {
  const match = createHostSetMatcher(new Set(['doubleclick.net', 'ads.example.com']))

  it('blocks an exact host', () => {
    expect(match(req('https://doubleclick.net/gpt.js'))).toBe(true)
  })

  it('blocks any subdomain, like ||host^', () => {
    expect(match(req('https://sub.deep.doubleclick.net/x'))).toBe(true)
    expect(match(req('https://ads.example.com/beacon'))).toBe(true)
    expect(match(req('https://cdn.ads.example.com/beacon'))).toBe(true)
  })

  it('strips www the way DNR normalizes it', () => {
    expect(match(req('https://www.doubleclick.net/x'))).toBe(true)
  })

  it('does not block a parent domain of a blocked subdomain', () => {
    // Only ads.example.com is blocked, not example.com itself.
    expect(match(req('https://example.com/app.js'))).toBe(false)
  })

  it('does not match on partial labels or suffix tricks', () => {
    expect(match(req('https://notdoubleclick.net/x'))).toBe(false)
    expect(match(req('https://doubleclick.net.evil.com/x'))).toBe(false)
  })

  it('never blocks the bare TLD or unparseable URLs', () => {
    expect(match(req('https://net/x'))).toBe(false)
    expect(match(req('not a url'))).toBe(false)
  })
})

describe('loadBlockedHostSet folds in only pure ||host^ curated seeds', () => {
  const set = loadBlockedHostSet()

  it('includes host-only seeds', () => {
    expect(set.has('doubleclick.net')).toBe(true)
    expect(set.has('googlesyndication.com')).toBe(true)
  })

  it('excludes path-scoped seeds so the reference matcher never over-blocks whole domains', () => {
    // These curated seeds block a specific path (stats/ads, /pagead/, promoted_content, /ads),
    // not the whole host — folding the hostname in would wrongly block all of youtube/x/twitch.
    for (const host of ['youtube.com', 'www.youtube.com', 'twitter.com', 'x.com', 'twitch.tv', 'gql.twitch.tv'])
      expect(set.has(host)).toBe(false)
  })
})
