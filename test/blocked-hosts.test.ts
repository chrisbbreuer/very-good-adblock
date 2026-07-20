import { describe, expect, it } from 'bun:test'
import generatedNetworkHosts from '../src/rules/generated/network-hosts.json'
import { addBlockedHosts, isBlockedHost } from '../src/rules/blocked-hosts'

describe('blocked-hosts matcher', () => {
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
    expect(isBlockedHost('thestreameast.one')).toBe(false)
    expect(isBlockedHost('')).toBe(false)
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
})
