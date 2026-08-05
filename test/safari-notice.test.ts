import { describe, expect, it } from 'bun:test'
import { dismissSafariSiteAccessNotice, shouldShowSafariSiteAccessNotice } from '../src/ui/safari-notice'

interface StubOptions {
  /** Emitted only by the Safari build (see config/extension.ts). */
  safari?: boolean
  /** What `chrome.permissions.contains` resolves to, or 'missing'/'throws'. */
  access?: boolean | 'missing' | 'throws'
  dismissed?: string[]
}

/**
 * Each case installs a whole `chrome` global rather than patching one, so a
 * field the code reads but the stub forgot surfaces as a failure here instead of
 * leaking the previous case's value.
 */
async function withChrome<T>(options: StubOptions, run: (store: Record<string, unknown>) => Promise<T>): Promise<T> {
  const originalChrome = globalThis.chrome
  const store: Record<string, unknown> = options.dismissed ? { dismissedNotices: options.dismissed } : {}

  const permissions = options.access === 'missing'
    ? undefined
    : {
        async contains() {
          if (options.access === 'throws') throw new Error('unsupported')
          return options.access === true
        },
      }

  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: {
        getManifest: () => (options.safari ? { browser_specific_settings: { safari: { strict_min_version: '18.4' } } } : {}),
      },
      permissions,
      storage: {
        local: {
          async get(key: string) {
            return { [key]: store[key] }
          },
          async set(values: Record<string, unknown>) {
            Object.assign(store, values)
          },
        },
      },
    } as unknown as typeof chrome,
  })

  try {
    return await run(store)
  }
  finally {
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: originalChrome })
  }
}

describe('safari site-access notice', () => {
  it('shows on Safari when all-site access has not been granted', async () => {
    await withChrome({ safari: true, access: false }, async () => {
      expect(await shouldShowSafariSiteAccessNotice()).toBe(true)
    })
  })

  it('stays hidden on Chrome and Firefox, which grant host access at install', async () => {
    await withChrome({ safari: false, access: false }, async () => {
      expect(await shouldShowSafariSiteAccessNotice()).toBe(false)
    })
  })

  it('retires itself once the grant lands, without needing a dismissal', async () => {
    await withChrome({ safari: true, access: true }, async () => {
      expect(await shouldShowSafariSiteAccessNotice()).toBe(false)
    })
  })

  it('stays hidden after the user dismisses it', async () => {
    await withChrome({ safari: true, access: false }, async (store) => {
      await dismissSafariSiteAccessNotice()
      expect(store.dismissedNotices).toEqual(['safari-site-access'])
      expect(await shouldShowSafariSiteAccessNotice()).toBe(false)
    })
  })

  it('shows when the permissions API cannot answer', async () => {
    // An unanswerable grant check must not swallow the notice: a stray hint is
    // one tap, an unexplained permission sheet on every site is not.
    for (const access of ['missing', 'throws'] as const) {
      await withChrome({ safari: true, access }, async () => {
        expect(await shouldShowSafariSiteAccessNotice()).toBe(true)
      })
    }
  })
})
