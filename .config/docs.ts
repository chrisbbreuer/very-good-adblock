import type { BunPressOptions } from '@stacksjs/bunpress'

const config: BunPressOptions = {
  verbose: false,
  docsDir: './docs',
  outDir: './dist/docs',
  theme: 'vitepress',
  // The docs are served under /docs; prefix all root-relative internal links so
  // sidebar/nav links resolve (were pointing at /guide/... instead of /docs/guide/...).
  basePath: '/docs',
  // Respect the visitor's OS preference and expose the theme toggle; the CSS
  // below styles both `:root` (light) and `html.dark` so neither breaks.
  darkMode: 'auto',

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
      /* Light theme (default) — red brand on the vitepress light base. */
      :root {
        --bp-c-brand-1: #dc2626;
        --bp-c-brand-2: #ef4444;
        --bp-c-brand-3: #b91c1c;
        --bp-c-brand-soft: rgba(239, 68, 68, 0.14);
      }

      /* Dark theme — warm red-tinted surfaces + a lighter red brand for contrast. */
      html.dark {
        --bp-c-bg: #120b0c;
        --bp-c-bg-alt: #180f11;
        --bp-c-bg-elv: #201619;
        --bp-c-bg-soft: #23181a;
        --bp-c-divider: rgba(255, 236, 236, 0.13);
        --bp-c-border: rgba(255, 236, 236, 0.2);
        --bp-c-text-1: #fbf3f3;
        --bp-c-text-2: rgba(251, 243, 243, 0.78);
        --bp-c-text-3: rgba(251, 243, 243, 0.58);
        --bp-c-brand-1: #ff9a9a;
        --bp-c-brand-2: #ef4444;
        --bp-c-brand-3: #ff7a6b;
        --bp-c-brand-soft: rgba(239, 68, 68, 0.16);
      }

      .BPNavBarTitle::before {
        display: inline-block;
        width: 26px;
        height: 26px;
        margin-right: 10px;
        border: 1px solid rgba(239, 68, 68, 0.42);
        border-radius: 8px;
        background: linear-gradient(145deg, rgba(239, 68, 68, 0.96), rgba(255, 122, 77, 0.86));
        box-shadow: inset 0 0 0 7px rgba(120, 20, 24, 0.2);
        content: "";
        vertical-align: -7px;
      }

      /* Home hero ambient wash — light and dark variants. */
      .BPHome {
        background:
          radial-gradient(circle at 78% 16%, rgba(255, 122, 77, 0.12), transparent 26%),
          linear-gradient(145deg, #fff6f6 0%, #fff0f1 54%, #ffe9ea 100%);
      }

      html.dark .BPHome {
        background:
          radial-gradient(circle at 78% 16%, rgba(255, 122, 77, 0.16), transparent 26%),
          linear-gradient(145deg, #140c0d 0%, #1a1113 54%, #221621 100%);
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
        color: #fff;
      }

      .BPFeatures {
        max-width: 1180px;
        gap: 16px;
      }

      .BPFeature {
        border-color: var(--bp-c-border);
        background: rgba(120, 20, 24, 0.03);
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.06);
      }

      html.dark .BPFeature {
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
