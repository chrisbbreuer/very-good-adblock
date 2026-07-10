import { defineExtension } from '@stacksjs/browser-extension'

/**
 * Very Good AdBlock — MV3 extension config.
 *
 * This replaces the hand-rolled `src/manifest.ts` + `scripts/build-extension.ts`
 * boilerplate: `@stacksjs/browser-extension` derives the Chrome/Firefox
 * manifests, bundles the content/background scripts, builds the stx pages, and
 * packages the store-ready zips from this single declaration
 * (`buddy extension:build` / `buddy extension:package`).
 */
export default defineExtension({
  name: 'Very Good AdBlock',
  description: 'Removes ads, pop-ups, and YouTube and Twitch interruptions at the source. Fast, private, no telemetry.',
  geckoId: 'extension@verygoodadblock.org',
  targets: ['chrome', 'firefox'],

  background: 'src/background/index.ts',

  content: [
    // Main content script — DNR feedback, cosmetic filtering, messaging.
    { entry: 'src/content/index.ts', matches: ['http://*/*', 'https://*/*'], runAt: 'document_start' },
    // Page-context (MAIN world) pruner for X/Twitter promoted tweets.
    { entry: 'src/content/x-inpage.ts', matches: ['*://x.com/*', '*://*.x.com/*', '*://twitter.com/*', '*://*.twitter.com/*'], runAt: 'document_start', world: 'MAIN' },
    // Page-context pruner for YouTube ad instructions.
    { entry: 'src/content/yt-inpage.ts', matches: ['*://*.youtube.com/*'], runAt: 'document_start', world: 'MAIN' },
    // Pop-up/pop-under guard in every frame (incl. about:blank).
    { entry: 'src/content/popup-guard.ts', matches: ['http://*/*', 'https://*/*'], runAt: 'document_start', world: 'MAIN', allFrames: true, matchAboutBlank: true },
  ],

  pages: {
    popup: 'pages/popup.stx',
    options: 'pages/options.stx',
  },

  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },

  public: 'public',

  rules: [
    { id: 'very_good_adblock_static_rules', path: 'rules/static.json' },
  ],

  manifest: {
    permissions: ['declarativeNetRequest', 'declarativeNetRequestFeedback', 'storage', 'tabs', 'alarms'],
    hostPermissions: ['http://*/*', 'https://*/*'],
    // world: 'MAIN' content scripts need Chrome 111+.
    minimumChromeVersion: '111',
    // Firefox: MAIN-world + data_collection_permissions bind at 140+.
    firefoxMinVersion: '140.0',
    webAccessibleResources: [
      { resources: ['stubs/googletag.js', 'stubs/adsbygoogle.js'], matches: ['<all_urls>'] },
    ],
  },
})
