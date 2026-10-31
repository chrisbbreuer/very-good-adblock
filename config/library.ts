import type { LibraryConfig } from '@stacksjs/types'

/**
 * The blocker as a library, released by Stacks out of `resources/functions`
 * (`buddy build:libs`, `buddy libs:publish`).
 *
 * `very-good-adblock` is the extension's own blocking for apps that embed
 * WebKit rather than run an extension: content-blocker lists and page-world
 * scripts generated from src/ (resources/scripts/build-webkit-data.ts). A
 * browser built on Craft's WKWebView tabs compiles the lists and injects the
 * scripts; versions follow the extension's.
 */
export default {
  name: 'very-good-adblock',
  owner: null,
  repository: 'chrisbbreuer/very-good-adblock',
  license: 'MIT',
  author: 'Chris Breuer <chris@stacksjs.org>',
  contributors: [],
  defaultLanguage: 'en',
  releaseable: true,

  packages: [
    {
      name: 'very-good-adblock',
      kind: 'functions',
      description: 'Very Good AdBlock\'s blocking for WebKit apps: content-blocker lists and page scripts from the extension\'s own rules.',
      keywords: ['adblock', 'webkit', 'content-blocker', 'wkwebview', 'safari', 'youtube-adblock', 'privacy'],
      include: ['webkit.ts', 'webkit-data.ts'],
      runtime: 'standalone',
    },
  ],
} satisfies LibraryConfig
