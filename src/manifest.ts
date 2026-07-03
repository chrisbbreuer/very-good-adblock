import { extensionDescription, extensionGeckoId, extensionName, staticRulesetId } from './shared/constants'

export type ManifestTarget = 'chrome' | 'firefox'

export interface ManifestInput {
  version: string
  target?: ManifestTarget
}

// @types/chrome's ManifestV3.background only allows the Chrome `service_worker`
// shape; widen it to also allow Firefox's `scripts` event-page shape, and add
// the Firefox-only `browser_specific_settings` key.
export type BuildManifestResult = Omit<chrome.runtime.ManifestV3, 'background'> & {
  background?: { service_worker: string, type?: 'module' } | { scripts: string[], type?: 'module' }
  browser_specific_settings?: {
    gecko: {
      id: string
      strict_min_version: string
      data_collection_permissions: {
        required: ['none']
      }
    }
  }
}

export function buildManifest(input: ManifestInput): BuildManifestResult {
  const target = input.target ?? 'chrome'
  const isFirefox = target === 'firefox'

  return {
    manifest_version: 3,
    name: extensionName,
    description: extensionDescription,
    version: input.version,
    // world: 'MAIN' content scripts (the X/YouTube source pruners) need Chrome 111+.
    ...(isFirefox ? {} : { minimum_chrome_version: '111' }),
    action: {
      default_title: extensionName,
      default_popup: 'popup.html',
    },
    options_page: 'options.html',
    // Firefox has no MV3 service worker support; it runs `background.scripts` as
    // a non-persistent event page instead. Chrome ignores `scripts` and requires
    // `service_worker`, so the two targets need distinct shapes.
    background: isFirefox
      ? { scripts: ['background.js'], type: 'module' }
      : { service_worker: 'background.js', type: 'module' },
    ...(isFirefox
      ? {
          // Required for Firefox to sign/publish an MV3 add-on. `world: 'MAIN'`
          // content scripts (the X/YouTube source pruners) need Firefox 128+, but
          // data_collection_permissions below needs 140+, which is the binding floor.
          browser_specific_settings: {
            gecko: {
              id: extensionGeckoId,
              strict_min_version: '140.0',
              // Required by AMO for all new extensions; this ships no telemetry
              // and sends nothing to a developer-owned server, so "none" applies.
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
    permissions: ['declarativeNetRequest', 'declarativeNetRequestFeedback', 'storage', 'tabs', 'alarms'],
    host_permissions: ['http://*/*', 'https://*/*'],
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    content_scripts: [
      {
        matches: ['http://*/*', 'https://*/*'],
        js: ['content.js'],
        run_at: 'document_start',
      },
      {
        // Runs in the page's own context to prune promoted tweets out of X's
        // GraphQL responses before they render. MAIN world is required to patch
        // the page's `fetch`; it talks to content.js over window.postMessage.
        matches: ['*://x.com/*', '*://*.x.com/*', '*://twitter.com/*', '*://*.twitter.com/*'],
        js: ['x-inpage.js'],
        run_at: 'document_start',
        world: 'MAIN',
      },
      {
        // Prunes ad instructions out of YouTube player responses in the page's
        // own context, so the player never schedules pre/mid-rolls.
        matches: ['*://*.youtube.com/*'],
        js: ['yt-inpage.js'],
        run_at: 'document_start',
        world: 'MAIN',
      },
      {
        // Defuses abusive pop-ups/pop-unders by wrapping window.open in the
        // page's own context (MV3 DNR cannot block pop-ups). Runs in every frame
        // — pop-under scripts live in the player iframe, and some grab a fresh
        // window.open from an about:blank iframe to dodge a top-frame-only guard.
        matches: ['http://*/*', 'https://*/*'],
        js: ['popup-guard.js'],
        run_at: 'document_start',
        world: 'MAIN',
        all_frames: true,
        match_about_blank: true,
      },
    ],
    declarative_net_request: {
      rule_resources: [
        {
          id: staticRulesetId,
          enabled: true,
          path: 'rules/static.json',
        },
      ],
    },
    content_security_policy: {
      extension_pages: `script-src 'self'; object-src 'self'`,
    },
    web_accessible_resources: [
      {
        // Inert stubs the ad-SDK redirect rules point at (see redirectRuleSeeds).
        resources: ['stubs/googletag.js', 'stubs/adsbygoogle.js'],
        matches: ['<all_urls>'],
      },
    ],
  }
}
