import { describe, expect, it } from 'bun:test'
import { buildManifest } from '../src/manifest'
import { extensionGeckoId } from '../src/shared/constants'

describe('manifest', () => {
  it('defaults to a Chrome service-worker manifest', () => {
    const manifest = buildManifest({ version: '1.2.3' })

    expect(manifest.background).toEqual({ service_worker: 'background.js', type: 'module' })
    expect(manifest.minimum_chrome_version).toBe('111')
    expect(manifest.browser_specific_settings).toBeUndefined()
  })

  it('builds a Firefox event-page manifest with gecko settings', () => {
    const manifest = buildManifest({ version: '1.2.3', target: 'firefox' })

    expect(manifest.background).toEqual({ scripts: ['background.js'], type: 'module' })
    expect(manifest.minimum_chrome_version).toBeUndefined()
    expect(manifest.browser_specific_settings).toEqual({
      gecko: {
        id: extensionGeckoId,
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
    })
  })

  it('keeps content scripts, permissions, and rulesets identical across targets', () => {
    const chrome = buildManifest({ version: '1.2.3', target: 'chrome' })
    const firefox = buildManifest({ version: '1.2.3', target: 'firefox' })

    expect(firefox.content_scripts).toEqual(chrome.content_scripts)
    expect(firefox.permissions).toEqual(chrome.permissions)
    expect(firefox.declarative_net_request).toEqual(chrome.declarative_net_request)
    expect(firefox.web_accessible_resources).toEqual(chrome.web_accessible_resources)
  })
})
