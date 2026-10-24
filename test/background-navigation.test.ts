import { beforeAll, describe, expect, it } from 'bun:test'
import { runInNewContext } from 'node:vm'
import type { ExtensionSettings, PageBlockEntry } from '../src/shared/types'
import { defaultSettings } from '../src/shared/storage'
import { navigationRuleStartId } from '../src/rules/navigation'

let backgroundScript: string

beforeAll(async () => {
  const result = await Bun.build({ entrypoints: ['src/background/index.ts'], target: 'browser' })
  if (!result.success) throw new Error(result.logs.map(log => log.message).join('\n'))
  backgroundScript = await result.outputs[0].text()
})

function event<Args extends unknown[]>() {
  let listener: (...args: Args) => unknown = () => {}
  return {
    addListener(callback: (...args: Args) => unknown) { listener = callback },
    emit(...args: Args) { return listener(...args) },
  }
}

/** Run the shipping background listeners with isolated browser state and timers. */
async function background(settings: ExtensionSettings = defaultSettings, matches: chrome.declarativeNetRequest.MatchedRuleInfo[] = []) {
  const onCreated = event<[chrome.tabs.Tab]>()
  const onUpdated = event<[number, chrome.tabs.OnUpdatedInfo, chrome.tabs.Tab]>()
  const onBeforeRequest = event<[chrome.webRequest.OnBeforeRequestDetails]>()
  const onErrorOccurred = event<[chrome.webRequest.OnErrorOccurredDetails]>()
  const onRuleMatchedDebug = event<[chrome.declarativeNetRequest.MatchedRuleInfoDebug]>()
  const removed: number[] = []
  const navigated: Array<{ tabId: number, url?: string }> = []
  const session: Record<string, unknown> = {}
  const timers: Array<{ callback: () => void, delay: number }> = []
  const onChanged = event<[Record<string, chrome.storage.StorageChange>, string]>()
  const storage = { async get() { return {} }, async set() {} }
  const chromeStub = {
    runtime: {
      onInstalled: event(), onStartup: event(), onMessage: event(),
      getURL(path: string) { return `chrome-extension://test/${path}` },
    },
    tabs: {
      onCreated, onUpdated, onRemoved: event(), onActivated: event(),
      async query() { return [] },
      async remove(tabId: number) { removed.push(tabId) },
      async update(tabId: number, options: { url?: string }) { navigated.push({ tabId, url: options.url }) },
    },
    webRequest: { onBeforeRequest, onErrorOccurred },
    declarativeNetRequest: {
      onRuleMatchedDebug,
      async getMatchedRules() { return { rulesMatchedInfo: matches } },
      async getDynamicRules() { return [] },
      async updateDynamicRules() {},
    },
    storage: {
      sync: { ...storage, async get() { return { settings } } }, local: storage, onChanged,
      session: { ...storage, async set(values: Record<string, unknown>) { Object.assign(session, values) } },
    },
    action: {
      async setBadgeText() {}, async setBadgeBackgroundColor() {}, async setTitle() {},
    },
  }
  runInNewContext(backgroundScript, {
    chrome: chromeStub, URL, URLSearchParams,
    setTimeout(callback: () => void, delay: number) {
      return timers.push({ callback, delay })
    },
  })
  onChanged.emit({ settings: { newValue: settings } }, 'sync')
  // Finish session hydration before delivering live navigation events.
  await Promise.resolve()

  function tab(id: number, url: string, openerTabId?: number): chrome.tabs.Tab {
    return {
      id, url, openerTabId, index: 0, pinned: false, highlighted: false,
      windowId: 1, active: false, incognito: false, selected: false,
      discarded: false, autoDiscardable: true, groupId: -1, frozen: false, lastAccessed: 0,
    }
  }

  return {
    removed, navigated,
    open(url: string, withOpener = true) {
      onUpdated.emit(1, { url: 'https://publisher.example/' }, tab(1, 'https://publisher.example/'))
      onCreated.emit(tab(2, url, withOpener ? 1 : undefined))
      onUpdated.emit(2, { url }, tab(2, url))
    },
    complete(url: string) {
      onUpdated.emit(2, { status: 'complete' }, tab(2, url))
    },
    start(url: string) {
      onBeforeRequest.emit({ requestId: 'navigation', url, method: 'GET', frameId: 0, parentFrameId: -1, tabId: 2, type: 'main_frame', timeStamp: Date.now() })
    },
    fail(url: string, type: chrome.webRequest.OnErrorOccurredDetails['type'], extra: Partial<chrome.webRequest.OnErrorOccurredDetails> = {}) {
      onErrorOccurred.emit({
        requestId: 'blocked', url, method: 'GET', frameId: 0, parentFrameId: -1,
        tabId: 2, type, timeStamp: Date.now(), error: 'net::ERR_BLOCKED_BY_CLIENT',
        fromCache: false, documentLifecycle: 'active', frameType: 'outermost_frame', ...extra,
      })
    },
    matchNavigation(url: string) {
      onRuleMatchedDebug.emit({
        rule: { ruleId: navigationRuleStartId, rulesetId: 'very_good_adblock_static_rules_3' },
        request: { requestId: 'allowed', url, method: 'GET', frameId: 0, parentFrameId: -1, tabId: 2, type: 'main_frame', initiator: 'https://publisher.example' },
      })
    },
    log(tabId: number): PageBlockEntry[] {
      for (const timer of timers.filter(timer => timer.delay === 500)) timer.callback()
      return (session.pageBlockLog as Record<string, PageBlockEntry[]> | undefined)?.[String(tabId)] ?? []
    },
  }
}

describe('background navigation safety', () => {
  it.each(['script', 'image', 'xmlhttprequest', 'sub_frame', 'media', 'font', 'stylesheet'] as const)(
    'keeps Stripe open when its top frame has a blocked %s request', async (type) => {
      const browser = await background()
      browser.open('https://stripe.com/')
      browser.fail('https://r.stripe.com/telemetry', type)

      expect(browser.removed).toEqual([])
      expect(browser.navigated).toEqual([])
      expect(browser.log(2)).toEqual([expect.objectContaining({ kind: 'network', label: 'r.stripe.com', count: 1 })])
      expect(browser.log(1)).toEqual([])
    },
  )

  it('does not close the page for a blocked iframe document', async () => {
    const browser = await background()
    browser.open('https://stripe.com/')
    browser.fail('https://r.stripe.com/frame', 'sub_frame', { frameId: 1, parentFrameId: 0 })
    expect(browser.removed).toEqual([])
    expect(browser.navigated).toEqual([])
  })

  it('still closes an original ad document after a blocked subresource', async () => {
    const browser = await background()
    browser.open('https://doubleclick.net/pop')
    browser.fail('https://doubleclick.net/ad.js', 'script')
    expect(browser.removed).toEqual([])
    browser.fail('https://doubleclick.net/pop', 'main_frame', { initiator: 'https://publisher.example' })

    expect(browser.removed).toEqual([2])
    expect(browser.navigated).toEqual([])
    expect(browser.log(1)).toEqual([expect.objectContaining({ kind: 'popup', label: 'doubleclick.net', count: 1 })])
  })

  it('captures an ad tab destination before its first navigation fails', async () => {
    const browser = await background()
    browser.open('about:blank')
    browser.start('https://doubleclick.net/pop')
    browser.fail('https://doubleclick.net/pop', 'main_frame', { initiator: 'https://publisher.example' })
    expect(browser.removed).toEqual([2])
  })

  it('shows a notice for a directly visited blocked page without closing the tab', async () => {
    const browser = await background()
    browser.open('https://doubleclick.net/', false)
    browser.fail('https://doubleclick.net/', 'main_frame')
    expect(browser.removed).toEqual([])
    expect(browser.navigated).toEqual([{ tabId: 2, url: expect.stringContaining('blocked.html?') }])
  })

  it('preserves a legitimate tab when a later document redirect is blocked', async () => {
    const browser = await background()
    browser.open('https://stripe.com/')
    browser.fail('https://doubleclick.net/redirect', 'main_frame')
    expect(browser.removed).toEqual([])
    expect(browser.navigated).toHaveLength(1)
  })

  it('retires popup status after the original page finishes loading', async () => {
    const browser = await background()
    browser.open('https://stripe.com/')
    browser.complete('https://stripe.com/')
    browser.fail('https://r.stripe.com/redirect', 'main_frame')
    expect(browser.removed).toEqual([])
    expect(browser.navigated).toHaveLength(1)
  })

  it('does not close a visible tab when a speculative document is blocked', async () => {
    const browser = await background()
    browser.open('https://stripe.com/')
    browser.fail('https://r.stripe.com/speculative', 'main_frame', { documentLifecycle: 'prerender' })
    expect(browser.removed).toEqual([])
    expect(browser.navigated).toEqual([])
    expect(browser.log(1)).toEqual([])
  })

  it('ignores cancellation errors outside our rules', async () => {
    const browser = await background()
    browser.open('https://stripe.com/')
    browser.fail('https://stripe.com/', 'main_frame')
    expect(browser.removed).toEqual([])
    expect(browser.navigated).toEqual([])
  })

  it.each(['net::ERR_BLOCKED_BY_CLIENT', 'NS_ERROR_ABORT'])(
    'preserves SMS links with an assigned opener on %s', async (error) => {
      const browser = await background()
      browser.open('https://ruffwear.attn.tv/an9_JTRemUCA')
      browser.fail('https://ruffwear.attn.tv/an9_JTRemUCA', 'main_frame', { error, initiator: 'https://publisher.example' })

      expect(browser.removed).toEqual([])
      expect(browser.navigated).toEqual([])
      expect(browser.log(1)).toEqual([])
      expect(browser.log(2)).toEqual([])
    },
  )

  it.each([undefined, 'null', 'chrome://newtab', 'https://different.example', 'https://publisher.example.evil.test'])(
    'preserves external or ambiguous navigation with initiator %s despite an assigned opener', async (initiator) => {
      const browser = await background()
      browser.open('https://doubleclick.net/link')
      browser.fail('https://doubleclick.net/link', 'main_frame', { initiator })

      expect(browser.removed).toEqual([])
      expect(browser.navigated).toHaveLength(1)
      expect(browser.log(1)).toEqual([])
    },
  )

  it('keeps a user-blocked SMS destination open with an explanatory notice', async () => {
    const browser = await background({ ...defaultSettings, blockedSites: ['attn.tv'] })
    browser.open('https://ruffwear.attn.tv/an9_JTRemUCA')
    browser.fail('https://ruffwear.attn.tv/an9_JTRemUCA', 'main_frame', { initiator: 'https://publisher.example' })

    expect(browser.removed).toEqual([])
    expect(browser.navigated).toEqual([{ tabId: 2, url: expect.stringContaining('reason=user') }])
    expect(browser.log(1)).toEqual([])
  })

  it('does not count an allowed SMS document as blocked in live or reconciled feedback', async () => {
    const browser = await background(defaultSettings, [{
      rule: { ruleId: navigationRuleStartId, rulesetId: 'very_good_adblock_static_rules_3' },
      tabId: 2, timeStamp: Date.now(),
    }])
    browser.open('https://ruffwear.attn.tv/an9_JTRemUCA')
    browser.matchNavigation('https://ruffwear.attn.tv/an9_JTRemUCA')
    // Finish the asynchronous badge reconciliation without running its timers.
    await new Promise(resolve => setImmediate(resolve))

    expect(browser.removed).toEqual([])
    expect(browser.navigated).toEqual([])
    expect(browser.log(2)).toEqual([])
  })
})
