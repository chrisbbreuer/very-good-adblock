import type { BunPressOptions } from '@stacksjs/bunpress'

const config: BunPressOptions = {
  verbose: false,
  docsDir: './docs',
  outDir: './dist/docs',
  theme: 'vitepress',
  // The docs theme only styles `html.dark`; force it so headings and code render
  // correctly regardless of the visitor's OS preference (was breaking in light mode).
  darkMode: 'dark',

  markdown: {
    title: 'Very Good AdBlock Docs',
    meta: {
      description: 'Docs for a polished, performant, minimal, modern Chrome MV3 ad blocker for pop-up, ad, YouTube, and Twitch protection.',
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
    css: `
      :root {
        --bp-c-brand-1: #147c4f;
        --bp-c-brand-2: #199861;
        --bp-c-brand-3: #0f6842;
        --bp-c-brand-soft: rgba(20, 124, 79, 0.14);
      }

      html.dark {
        --bp-c-bg: #07110f;
        --bp-c-bg-alt: #0b1715;
        --bp-c-bg-elv: #101f1d;
        --bp-c-bg-soft: #11231f;
        --bp-c-divider: rgba(219, 255, 236, 0.13);
        --bp-c-border: rgba(219, 255, 236, 0.2);
        --bp-c-text-1: #f3fbf8;
        --bp-c-text-2: rgba(243, 251, 248, 0.78);
        --bp-c-text-3: rgba(243, 251, 248, 0.58);
        --bp-c-brand-1: #8dffb8;
        --bp-c-brand-2: #56d4ff;
        --bp-c-brand-3: #37d987;
        --bp-c-brand-soft: rgba(124, 255, 173, 0.16);
      }

      .BPNav {
        background: rgba(7, 17, 15, 0.9);
      }

      .BPNavBarTitle::before {
        display: inline-block;
        width: 26px;
        height: 26px;
        margin-right: 10px;
        border: 1px solid rgba(152, 255, 193, 0.42);
        border-radius: 8px;
        background: linear-gradient(145deg, rgba(152, 255, 193, 0.96), rgba(88, 220, 255, 0.86));
        box-shadow: inset 0 0 0 7px rgba(6, 18, 15, 0.3);
        content: "";
        vertical-align: -7px;
      }

      .BPHome {
        background:
          radial-gradient(circle at 78% 16%, rgba(86, 212, 255, 0.16), transparent 26%),
          linear-gradient(145deg, #07110f 0%, #0b1715 54%, #171021 100%);
      }

      .BPHomeHero {
        border-bottom: 1px solid var(--bp-c-divider);
      }

      .BPHero-tagline {
        max-width: 720px;
        color: var(--bp-c-text-2);
      }

      .BPButton-brand,
      .BPButton-brand:hover {
        color: #03110b;
      }

      .BPFeatures {
        max-width: 1180px;
        gap: 16px;
      }

      .BPFeature {
        border-color: var(--bp-c-border);
        background: rgba(255, 255, 255, 0.055);
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.18);
      }

      .BPFeature p,
      .vp-doc p,
      .vp-doc li {
        color: var(--bp-c-text-2);
      }
    `,
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
            { text: 'YouTube and Twitch', link: '/architecture/youtube-x' },
            { text: 'Cosmetic Filtering', link: '/architecture/cosmetic-filtering' },
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
    baseUrl: 'https://verygoodadblock.org',
    filename: 'sitemap.xml',
  },

  robots: {
    enabled: true,
    filename: 'robots.txt',
  },
}

export default config
