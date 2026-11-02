import type { LibraryConfig } from '@stacksjs/types'

/**
 * The blocker as a library, released by Stacks (`buddy build:libs`,
 * `buddy libs:publish`).
 *
 * `very-good-adblock` is the extension's own blocking for apps that embed
 * WebKit rather than run an extension. Its `prebuild` runs the extension's
 * `webkit` target, and `assets` ships the result (content-blocker lists, user
 * scripts, manifest) beside resources/functions/webkit.ts, which reads it. A
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
      description: 'Very Good AdBlock\'s blocking for WebKit apps: content-blocker lists and user scripts from the extension\'s own rules.',
      keywords: ['adblock', 'webkit', 'content-blocker', 'wkwebview', 'safari', 'youtube-adblock', 'privacy'],
      include: ['webkit.ts'],
      runtime: 'standalone',
      prebuild: 'bun node_modules/@stacksjs/buddy/dist/cli.js extension:build --target webkit',
      assets: { webkit: 'dist-webkit' },
      // Apps install it with Bun from npm, like the rest of their dependencies.
      registry: 'npm',
      readme: 'resources/library/README.md',
    },
  ],
} satisfies LibraryConfig
