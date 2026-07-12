import type { ExtensionConfig } from '@stacksjs/browser-extension'
import { defineExtension } from '@stacksjs/browser-extension'

/**
 * Very Good AdBlock — MV3 extension config.
 *
 * This fully replaces the old `src/manifest.ts` + `scripts/build-extension.ts`
 * boilerplate: `@stacksjs/browser-extension` derives the Chrome/Firefox
 * manifests, bundles content/background + page scripts, builds & sanitizes the
 * stx pages, compiles the DNR ruleset, copies assets, and packages the
 * store-ready zips from this single declaration (`buddy extension:build` /
 * `extension:package`). The one app-specific step — inlining the popup preview
 * into the marketing hero — stays as a `postBuild` hook.
 */
// Explicitly typed so the default export is inferrable under
// `isolatedDeclarations` (the test suite imports this config directly).
const extension: ExtensionConfig = defineExtension({
  name: 'Very Good AdBlock',
  description: 'Removes ads, pop-ups, and YouTube and Twitch interruptions at the source. Fast, private, no telemetry.',
  geckoId: 'extension@verygoodadblock.org',
  targets: ['chrome', 'firefox'],

  background: 'src/background/index.ts',

  content: [
    { entry: 'src/content/index.ts', out: 'content.js', matches: ['http://*/*', 'https://*/*'], runAt: 'document_start' },
    { entry: 'src/content/x-inpage.ts', matches: ['*://x.com/*', '*://*.x.com/*', '*://twitter.com/*', '*://*.twitter.com/*'], runAt: 'document_start', world: 'MAIN' },
    { entry: 'src/content/yt-inpage.ts', matches: ['*://*.youtube.com/*'], runAt: 'document_start', world: 'MAIN' },
    { entry: 'src/content/popup-guard.ts', matches: ['http://*/*', 'https://*/*'], runAt: 'document_start', world: 'MAIN', allFrames: true, matchAboutBlank: true },
  ],

  pages: {
    popup: { template: 'resources/views/popup.stx', script: 'src/ui/popup.ts' },
    options: { template: 'resources/views/options.stx', script: 'src/ui/options.ts' },
    // The marketing site pages are bundled alongside (reused by the site build).
    // Only `marketing` carries the shared script bundle (theme toggle + subscribe
    // form); the site build injects `/marketing.js` into the other pages.
    extra: {
      marketing: { template: 'resources/views/marketing.stx', script: 'resources/scripts/marketing.ts' },
      features: 'resources/views/features.stx',
      privacy: 'resources/views/privacy.stx',
      'feature-network-blocking': 'resources/views/features/network-blocking.stx',
      'feature-youtube-twitch': 'resources/views/features/youtube-twitch.stx',
      'feature-popups': 'resources/views/features/popups.stx',
      'feature-controls': 'resources/views/features/controls.stx',
    },
  },

  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },

  public: 'public',
  assets: { 'styles.css': 'resources/css/styles.css' },

  rules: [
    { id: 'very_good_adblock_static_rules', path: 'rules/static.json', source: 'src/rules/static-rules.ts' },
  ],

  manifest: {
    permissions: ['declarativeNetRequest', 'declarativeNetRequestFeedback', 'storage', 'tabs', 'alarms'],
    hostPermissions: ['http://*/*', 'https://*/*'],
    minimumChromeVersion: '111',
    firefoxMinVersion: '140.0',
    webAccessibleResources: [
      { resources: ['stubs/googletag.js', 'stubs/adsbygoogle.js'], matches: ['<all_urls>'] },
    ],
  },

  hooks: {
    // Inline the real popup component into the marketing hero, replacing the
    // #popup-preview placeholder. Runs after sanitize so the markup survives.
    async postBuild({ outdir }) {
      const file = `${outdir}/marketing.html`
      const partial = 'resources/partials/popup-preview.html'
      if (!(await Bun.file(file).exists()) || !(await Bun.file(partial).exists()))
        return
      const frame = (await Bun.file(partial).text()).replace(/^<!--[\s\S]*?-->\s*/, '').trim()
      const placeholder = /<div class="hero-device" id="popup-preview"[^>]*><\/div>/
      const html = await Bun.file(file).text()
      if (!placeholder.test(html))
        return
      const label = 'The Very Good AdBlock popup: 47 ads blocked on this page, 8.4 GB of data saved, 20 hours of video time recovered, and a chart of the last 24 hours.'
      const replacement = `<div class="hero-device" role="img" aria-label="${label}"><div class="popup-preview popup-shell" aria-hidden="true">${frame}</div></div>`
      await Bun.write(file, html.replace(placeholder, replacement))
    },
  },
})

export default extension
