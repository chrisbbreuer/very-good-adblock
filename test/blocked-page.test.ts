import { describe, expect, it } from 'bun:test'
import { blockedPageQuery, displayUrl, parseBlockedPageParams, safeNavigationUrl } from '../src/shared/blocked-page'
import { activeBypasses, buildBypassRules, bypassStorageKey, grantBypass, pruneBypasses } from '../src/background/bypass'
import type { BlockBypass } from '../src/background/bypass'
import { bypassRuleStartId, maxBypasses } from '../src/shared/constants'
import { buildFalsePositiveReport } from '../src/shared/report'

describe('blocked page params', () => {
  it('round-trips the blocked address and reason', () => {
    const query = blockedPageQuery('http://ekster.attn.tv/a477mZJ3GAHl', 'filter')
    const params = parseBlockedPageParams(query)

    expect(params).toEqual({
      url: 'http://ekster.attn.tv/a477mZJ3GAHl',
      hostname: 'ekster.attn.tv',
      reason: 'filter',
    })
  })

  it('keeps the query string of the blocked link intact', () => {
    const url = 'https://click.example.com/r?id=abc&u=https%3A%2F%2Fshop.example.com'
    expect(parseBlockedPageParams(blockedPageQuery(url, 'filter'))?.url).toBe(url)
  })

  it('defaults an unknown or missing reason to a filter-list block', () => {
    expect(parseBlockedPageParams('?url=https://ads.test/')?.reason).toBe('filter')
    expect(parseBlockedPageParams('?url=https://ads.test/&reason=nonsense')?.reason).toBe('filter')
    expect(parseBlockedPageParams('?url=https://ads.test/&reason=user')?.reason).toBe('user')
  })

  // The page navigates to this value and offers to unblock its host, so a
  // non-http scheme in the query string must never survive the parse.
  it('rejects anything that is not an http(s) page', () => {
    expect(parseBlockedPageParams('?url=javascript:alert(1)')).toBeUndefined()
    expect(parseBlockedPageParams('?url=data:text/html,<b>hi</b>')).toBeUndefined()
    expect(parseBlockedPageParams('?url=chrome-extension://abc/blocked.html')).toBeUndefined()
    expect(parseBlockedPageParams('?url=not a url')).toBeUndefined()
    expect(parseBlockedPageParams('')).toBeUndefined()
    expect(safeNavigationUrl('ftp://files.test/x')).toBeUndefined()
  })
})

describe('displayUrl', () => {
  it('drops the scheme and trailing slash', () => {
    expect(displayUrl('https://ekster.attn.tv/')).toBe('ekster.attn.tv')
    expect(displayUrl('http://ekster.attn.tv/a477mZJ3GAHl')).toBe('ekster.attn.tv/a477mZJ3GAHl')
  })

  it('elides the middle of a long link so host and tail both stay visible', () => {
    const long = `https://click.example.com/${'x'.repeat(120)}/final`
    const shown = displayUrl(long, 40)

    expect(shown.length).toBe(40)
    expect(shown.startsWith('click.example.com/')).toBe(true)
    expect(shown.endsWith('/final')).toBe(true)
    expect(shown).toContain('…')
  })
})

describe('buildBypassRules', () => {
  it('allows requests to the host, at a priority above every block rule', () => {
    const rules = buildBypassRules([{ hostname: 'ekster.attn.tv', expiresAt: 1 }])

    expect(rules).toHaveLength(1)
    expect(rules[0].id).toBe(bypassRuleStartId)
    expect(rules[0].action.type).toBe('allow')
    expect(rules[0].priority).toBeGreaterThan(20)
    expect(rules[0].condition?.requestDomains).toEqual(['ekster.attn.tv'])
    expect(rules[0].condition?.resourceTypes).toContain('main_frame')
    // Not allowAllRequests: ads served by third parties on the page the user
    // continues to must still be blocked.
    expect(rules.some(rule => rule.action.type === 'allowAllRequests')).toBe(false)
  })

  it('numbers rules inside the reserved range and caps the list', () => {
    const entries = Array.from({ length: maxBypasses + 5 }, (_, index) => ({ hostname: `h${index}.test`, expiresAt: 1 }))
    const rules = buildBypassRules(entries)

    expect(rules).toHaveLength(maxBypasses)
    expect(rules.at(-1)?.id).toBe(bypassRuleStartId + maxBypasses - 1)
  })
})

describe('activeBypasses', () => {
  it('keeps only grants that have not elapsed', () => {
    const entries: BlockBypass[] = [
      { hostname: 'old.test', expiresAt: 500 },
      { hostname: 'live.test', expiresAt: 1500 },
    ]

    expect(activeBypasses(entries, 1000).map(entry => entry.hostname)).toEqual(['live.test'])
  })
})

interface BypassStub {
  store: Record<string, unknown>
  rules: chrome.declarativeNetRequest.Rule[]
}

/**
 * A whole `chrome` global per case (storage + dynamic rules), so a field the
 * code reads but the stub forgot fails here instead of leaking between cases.
 */
async function withChrome<T>(seed: BlockBypass[], run: (stub: BypassStub) => Promise<T>): Promise<T> {
  const original = globalThis.chrome
  const stub: BypassStub = { store: { [bypassStorageKey]: seed }, rules: [] }

  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      storage: {
        local: {
          async get(key: string) {
            return { [key]: stub.store[key] }
          },
          async set(values: Record<string, unknown>) {
            Object.assign(stub.store, values)
          },
        },
      },
      declarativeNetRequest: {
        async getDynamicRules() {
          return stub.rules
        },
        async updateDynamicRules({ removeRuleIds, addRules }: { removeRuleIds?: number[], addRules?: chrome.declarativeNetRequest.Rule[] }) {
          stub.rules = stub.rules.filter(rule => !removeRuleIds?.includes(rule.id)).concat(addRules ?? [])
        },
      },
    },
  })

  try {
    return await run(stub)
  }
  finally {
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: original })
  }
}

describe('grantBypass', () => {
  it('stores a grant with an expiry and installs the matching allow rule', async () => {
    await withChrome([], async (stub) => {
      const url = await grantBypass('http://ekster.attn.tv/a477mZJ3GAHl', 1_000)

      expect(url).toBe('http://ekster.attn.tv/a477mZJ3GAHl')
      const stored = stub.store[bypassStorageKey] as BlockBypass[]
      expect(stored).toHaveLength(1)
      expect(stored[0].hostname).toBe('ekster.attn.tv')
      expect(stored[0].expiresAt).toBeGreaterThan(1_000)
      expect(stub.rules.map(rule => rule.condition?.requestDomains?.[0])).toEqual(['ekster.attn.tv'])
    })
  })

  it('refreshes rather than duplicates a grant for the same host', async () => {
    await withChrome([{ hostname: 'ekster.attn.tv', expiresAt: 5_000 }], async (stub) => {
      await grantBypass('https://ekster.attn.tv/other', 4_000)

      const stored = stub.store[bypassStorageKey] as BlockBypass[]
      expect(stored).toHaveLength(1)
      expect(stored[0].expiresAt).toBeGreaterThan(5_000)
      expect(stub.rules).toHaveLength(1)
    })
  })

  it('drops elapsed grants and their rules as it goes', async () => {
    await withChrome([{ hostname: 'stale.test', expiresAt: 100 }], async (stub) => {
      await grantBypass('https://fresh.test/', 1_000)

      const stored = stub.store[bypassStorageKey] as BlockBypass[]
      expect(stored.map(entry => entry.hostname)).toEqual(['fresh.test'])
      expect(stub.rules.map(rule => rule.condition?.requestDomains?.[0])).toEqual(['fresh.test'])
    })
  })

  it('refuses a URL that is not an http(s) page', async () => {
    await withChrome([], async (stub) => {
      await expect(grantBypass('javascript:alert(1)')).rejects.toThrow()
      expect(stub.rules).toHaveLength(0)
    })
  })
})

describe('pruneBypasses', () => {
  // Dynamic rules outlive the browser session; the stored expiry is the only
  // thing that makes a grant temporary, so the sweep has to clear both.
  it('expires grants and removes their rules', async () => {
    await withChrome([{ hostname: 'ekster.attn.tv', expiresAt: 900 }], async (stub) => {
      stub.rules = buildBypassRules([{ hostname: 'ekster.attn.tv', expiresAt: 900 }])
      const remaining = await pruneBypasses(1_000)

      expect(remaining).toHaveLength(0)
      expect(stub.store[bypassStorageKey]).toEqual([])
      expect(stub.rules).toHaveLength(0)
    })
  })

  it('leaves live grants alone', async () => {
    await withChrome([{ hostname: 'live.test', expiresAt: 9_000 }], async (stub) => {
      const remaining = await pruneBypasses(1_000)

      expect(remaining.map(entry => entry.hostname)).toEqual(['live.test'])
      expect(stub.rules).toHaveLength(1)
    })
  })

  it('touches nothing when no grant was ever made', async () => {
    await withChrome([], async (stub) => {
      expect(await pruneBypasses(1_000)).toEqual([])
      expect(stub.rules).toHaveLength(0)
    })
  })
})

describe('buildFalsePositiveReport', () => {
  it('files the host and a token-free address', () => {
    const report = buildFalsePositiveReport({
      hostname: 'ekster.attn.tv',
      url: 'https://ekster.attn.tv/a477mZJ3GAHl?recipient=secret#frag',
      version: '0.2.14',
    })

    expect(report.title).toBe('Blocked in error: ekster.attn.tv')
    expect(report.body).toContain('https://ekster.attn.tv/a477mZJ3GAHl')
    expect(report.body).not.toContain('secret')
    expect(report.url.startsWith('https://github.com/')).toBe(true)
  })
})
