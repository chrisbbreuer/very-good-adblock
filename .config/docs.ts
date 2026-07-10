import type { BunPressOptions } from '@stacksjs/bunpress'

const config: BunPressOptions = {
  verbose: false,
  docsDir: './docs',
  outDir: './dist/docs',
  theme: 'vitepress',
  // The docs are served under /docs; prefix all root-relative internal links so
  // sidebar/nav links resolve (were pointing at /guide/... instead of /docs/guide/...).
  basePath: '/docs',
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
        --bp-c-brand-1: #1f6feb;
        --bp-c-brand-2: #2f81f7;
        --bp-c-brand-3: #1a5fd0;
        --bp-c-brand-soft: rgba(47, 129, 247, 0.14);
      }

      html.dark {
        --bp-c-bg: #070f16;
        --bp-c-bg-alt: #0b161d;
        --bp-c-bg-elv: #101d26;
        --bp-c-bg-soft: #111f2b;
        --bp-c-divider: rgba(219, 255, 236, 0.13);
        --bp-c-border: rgba(219, 255, 236, 0.2);
        --bp-c-text-1: #f3fbf8;
        --bp-c-text-2: rgba(243, 251, 248, 0.78);
        --bp-c-text-3: rgba(243, 251, 248, 0.58);
        --bp-c-brand-1: #8db4ff;
        --bp-c-brand-2: #56d4ff;
        --bp-c-brand-3: #4f97ff;
        --bp-c-brand-soft: rgba(125, 180, 255, 0.16);
      }

      .BPNav {
        background: rgba(7, 17, 15, 0.9);
      }

      .BPNavBarTitle::before {
        display: inline-block;
        width: 26px;
        height: 26px;
        margin-right: 10px;
        border: 1px solid rgba(125, 180, 255, 0.42);
        border-radius: 8px;
        background: linear-gradient(145deg, rgba(125, 180, 255, 0.96), rgba(88, 220, 255, 0.86));
        box-shadow: inset 0 0 0 7px rgba(6, 15, 24, 0.3);
        content: "";
        vertical-align: -7px;
      }

      .BPHome {
        background:
          radial-gradient(circle at 78% 16%, rgba(86, 212, 255, 0.16), transparent 26%),
          linear-gradient(145deg, #070f16 0%, #0b161d 54%, #171021 100%);
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
        color: #04101f;
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
      { text: 'GitHub', link: 'https://github.com/chrisbbreuer/very-good-adblock' },
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
