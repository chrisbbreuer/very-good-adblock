import { describe, expect, it } from 'bun:test'
import generatedNetworkHosts from '../src/rules/generated/network-hosts.json'
import { addBlockedHosts, isBlockedHost, isBlockedRequest } from '../src/rules/blocked-hosts'
import { isNavigationHost } from '../src/rules/navigation'

describe('blocked-hosts matcher', () => {
  it('allows merchant SMS link documents while still recognizing their tracking requests', () => {
    for (const url of ['https://ruffwear.attn.tv/an9_JTRemUCA', 'https://ekster.attn.tv/a477mZJ3GAHl', 'https://attn.tv/link']) {
      expect(isBlockedRequest(url, 'main_frame')).toBe(false)
      for (const type of ['script', 'image', 'xmlhttprequest', 'sub_frame']) {
        expect(isBlockedRequest(url, type)).toBe(true)
      }
    }
  })

  it('matches navigation exceptions at domain boundaries', () => {
    expect(isNavigationHost('RUFFWEAR.ATTN.TV')).toBe(true)
    expect(isNavigationHost('attn.tv.evil.example')).toBe(false)
    expect(isNavigationHost('notattn.tv')).toBe(false)
    expect(isNavigationHost('tv')).toBe(false)
    expect(isNavigationHost('')).toBe(false)
    expect(isBlockedRequest('https://doubleclick.net/pop', 'main_frame')).toBe(true)
  })

  it('keeps document exceptions when host blocks are refreshed', () => {
    addBlockedHosts(['ruffwear.attn.tv'])
    expect(isBlockedRequest('https://ruffwear.attn.tv/an9_JTRemUCA', 'main_frame')).toBe(false)
    expect(isBlockedRequest('https://ruffwear.attn.tv/pixel', 'image')).toBe(true)
  })

  it('matches hosts from the generated network list', () => {
    const host = generatedNetworkHosts.hosts[0]
    expect(isBlockedHost(host)).toBe(true)
  })

  it('matches subdomains of a blocked host', () => {
    const host = generatedNetworkHosts.hosts[0]
    expect(isBlockedHost(`cdn.${host}`)).toBe(true)
    expect(isBlockedHost(`deep.cdn.${host}`)).toBe(true)
  })

  it('matches curated rule hosts', () => {
    expect(isBlockedHost('doubleclick.net')).toBe(true)
    expect(isBlockedHost('pagead2.googlesyndication.com')).toBe(true)
  })

  it('normalizes the lookup hostname', () => {
    expect(isBlockedHost('WWW.DoubleClick.NET')).toBe(true)
  })

  it('rejects unrelated hosts', () => {
    expect(isBlockedHost('example.com')).toBe(false)
    expect(isBlockedHost('www.google.com')).toBe(false)
    expect(isBlockedHost('pantry.dev')).toBe(false)
    expect(isBlockedHost('thestreameast.one')).toBe(false)
    expect(isBlockedHost('')).toBe(false)
  })

  it('does not attribute unrelated first-party font failures to our rules', () => {
    expect(isBlockedRequest('https://pantry.dev/fonts/IBMPlexSans-Regular.woff2', 'font')).toBe(false)
    expect(isBlockedRequest('https://pantry.dev/fonts/Lilex.woff2', 'font')).toBe(false)
  })

  it('matches host rules only for resource types they block', () => {
    expect(isBlockedRequest('https://cdn.doubleclick.net/ad.js', 'script')).toBe(true)
    expect(isBlockedRequest('https://cdn.doubleclick.net/event', 'ping')).toBe(false)
  })

  it('matches curated path rules without blocking the rest of the host', () => {
    expect(isBlockedRequest('https://www.youtube.com/pagead/interaction/', 'xmlhttprequest')).toBe(true)
    expect(isBlockedRequest('https://www.youtube.com/watch?v=abc', 'xmlhttprequest')).toBe(false)
    expect(isBlockedRequest('https://www.youtube.com/pagead/interaction/', 'font')).toBe(false)
  })

  it('does not match sibling domains of a blocked host', () => {
    expect(isBlockedHost('notdoubleclick.net')).toBe(false)
    expect(isBlockedHost('doubleclick.net.evil.example')).toBe(false)
  })

  it('learns hosts added by the filter refresh', () => {
    expect(isBlockedHost('refresh-test.invalid')).toBe(false)
    addBlockedHosts(['refresh-test.invalid'])
    expect(isBlockedHost('refresh-test.invalid')).toBe(true)
    expect(isBlockedHost('sub.refresh-test.invalid')).toBe(true)
  })

  it('never learns browser search providers as ad hosts', () => {
    addBlockedHosts(['google.com', 'search.brave.com'])

    expect(isBlockedHost('google.com')).toBe(false)
    expect(isBlockedHost('www.google.com')).toBe(false)
    expect(isBlockedHost('search.brave.com')).toBe(false)
  })
})
