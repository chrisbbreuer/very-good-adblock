/**
 * The page counter counts ad and tracker HOSTS, not blocked requests
 * (stacksjs/very-good-adblock — reported from a Shopify product page showing
 * 720+ "blocked" on one visit).
 *
 * A blocked tracker retries. The page that prompted this fires ~30 blockable
 * hosts on load and keeps beaconing for as long as it stays open, so counting
 * requests turned "how many ads did you block" into "how many times did one
 * analytics script fail", and the headline grew without bound while the tab
 * sat there.
 */

import { describe, expect, it } from 'bun:test'
import { isNewBlockedHost } from '../src/background/page-block-tally'

const CAP = 500

describe('what moves the page counter', () => {
  it('counts a host the first time it is blocked', () => {
    const seen = new Set<string>()

    expect(isNewBlockedHost(seen, 'analytics.tiktok.com', CAP)).toBe(true)
    expect(seen.has('analytics.tiktok.com')).toBe(true)
  })

  it('does not count the same host again, however many times it retries', () => {
    // The actual shape of the bug: one endpoint, refused over and over.
    const seen = new Set<string>()
    isNewBlockedHost(seen, 'n.clarity.ms', CAP)

    const later = Array.from({ length: 250 }, () => isNewBlockedHost(seen, 'n.clarity.ms', CAP))

    expect(later.some(Boolean)).toBe(false)
    expect(seen.size).toBe(1)
  })

  it('counts each distinct host once, so a page reads as its tracker count', () => {
    const seen = new Set<string>()
    const requests = [
      'analytics.google.com',
      'analytics.google.com',
      'bat.bing.com',
      'analytics.google.com',
      'cdn.attn.tv',
      'bat.bing.com',
    ]

    const counted = requests.filter(host => isNewBlockedHost(seen, host, CAP)).length

    expect(counted).toBe(3)
  })
})

describe('what the counter refuses to guess at', () => {
  it('does not count a block it cannot attribute to a host', () => {
    // getMatchedRules can report a match whose request URL it does not carry.
    // Counting those as new is indistinguishable from counting retries.
    const seen = new Set<string>()

    expect(isNewBlockedHost(seen, undefined, CAP)).toBe(false)
    expect(isNewBlockedHost(seen, '', CAP)).toBe(false)
    expect(seen.size).toBe(0)
  })

  it('stops rising past the cap instead of tracking randomised subdomains', () => {
    const seen = new Set<string>()
    for (let i = 0; i < CAP; i++) isNewBlockedHost(seen, `beacon-${i}.example.com`, CAP)

    expect(isNewBlockedHost(seen, 'beacon-fresh.example.com', CAP)).toBe(false)
    expect(seen.size).toBe(CAP)
  })
})
