import { extensionDescription, extensionName, staticRulesetId } from './shared/constants'

export interface ManifestInput {
  version: string
}

export function buildManifest(input: ManifestInput): chrome.runtime.ManifestV3 {
  return {
    manifest_version: 3,
    name: extensionName,
    description: extensionDescription,
    version: input.version,
    // world: 'MAIN' content scripts (the X/YouTube source pruners) need Chrome 111+.
    minimum_chrome_version: '111',
    action: {
      default_title: extensionName,
      default_popup: 'popup.html',
    },
    options_page: 'options.html',
    background: {
      service_worker: 'background.js',
      type: 'module',
    },
    permissions: ['declarativeNetRequest', 'declarativeNetRequestFeedback', 'storage', 'tabs', 'scripting', 'alarms'],
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
