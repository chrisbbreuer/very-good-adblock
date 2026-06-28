import type { BunPressOptions } from '@stacksjs/bunpress'

const config: BunPressOptions = {
  verbose: false,
  docsDir: './docs',
  outDir: './dist/docs',
  theme: 'vitepress',

  markdown: {
    title: 'Adblock Docs',
    meta: {
      description: 'Documentation for the Adblock Chrome MV3 extension.',
      author: 'Chris Breuer',
      viewport: 'width=device-width, initial-scale=1.0',
    },
    toc: {
      enabled: true,
      position: ['sidebar'],
      title: 'On This Page',
      minDepth: 2,
      maxDepth: 4,
      smoothScroll: true,
      activeHighlight: true,
      collapsible: true,
    },
    syntaxHighlightTheme: 'github-dark',
    preserveDirectoryStructure: true,
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Install', link: '/guide/install' },
      { text: 'Architecture', link: '/architecture/' },
      { text: 'Development', link: '/development/' },
      { text: 'GitHub', link: 'https://github.com/chrisbbreuer/adblock' },
    ],
    sidebar: {
      '/': [
        {
          text: 'Guide',
          items: [
            { text: 'Overview', link: '/' },
            { text: 'Install', link: '/guide/install' },
            { text: 'Usage', link: '/guide/usage' },
          ],
        },
        {
          text: 'Architecture',
          items: [
            { text: 'Blocking Model', link: '/architecture/' },
            { text: 'YouTube and X', link: '/architecture/youtube-x' },
            { text: 'Stats and Cloud Sync', link: '/architecture/stats-sync' },
          ],
        },
        {
          text: 'Development',
          items: [
            { text: 'Workflow', link: '/development/' },
            { text: 'Testing', link: '/development/testing' },
          ],
        },
      ],
    },
    features: {
      inlineFormatting: true,
      containers: true,
      githubAlerts: true,
      codeBlocks: {
        lineHighlighting: true,
        lineNumbers: true,
        focus: true,
        diffs: true,
        errorWarningMarkers: true,
      },
      codeGroups: true,
      codeImports: true,
      inlineToc: true,
      customAnchors: true,
      emoji: true,
      badges: true,
      includes: true,
      externalLinks: {
        autoTarget: true,
        autoRel: true,
        showIcon: true,
      },
      imageLazyLoading: true,
      tables: {
        alignment: true,
        enhancedStyling: true,
        responsive: true,
      },
    },
  },

  sitemap: {
    enabled: true,
    baseUrl: 'https://github.com/chrisbbreuer/adblock',
    filename: 'sitemap.xml',
  },

  robots: {
    enabled: true,
    filename: 'robots.txt',
  },
}

export default config
