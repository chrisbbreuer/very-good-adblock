import type { ImageBackgroundConfig, ImagesConfig } from '@stacksjs/types'

/**
 * **Images Configuration**
 *
 * Every generated image the project ships: the social cards link previews
 * show, and the App Store screenshot set. Built by `buddy generate:images`,
 * which `bun run og` and `bun run screenshots` both go through.
 *
 * The palette is the site's own — `--bg`, `--accent`, `--wash-rgb` from
 * `resources/css/styles.css` — expressed as fractions of the canvas so the
 * 1200x630 card and the 2880x1800 Mac screenshot are the same design rather
 * than two that happen to be red.
 *
 * The captures come from `bun run capture` (`resources/scripts/capture-
 * surfaces.ts`), which shoots the real popup and dashboard against the seeded
 * fixture. Nothing here is a mockup.
 */
// Explicitly typed so the default export is inferrable under
// `isolatedDeclarations`, matching `config/extension.ts`.
const surface: ImageBackgroundConfig = {
  color: '#150c0d',
  gradient: {
    angle: 145,
    stops: [
      { offset: 0, color: '#150c0d' },
      { offset: 0.58, color: '#1b1113' },
      { offset: 1, color: '#241619' },
    ],
  },
  glows: [
    // The two washes the site's `--app-bg` carries: the warm one bottom left,
    // the accent one top right.
    { x: 0.86, y: 0.1, radius: 0.66, color: '#ef44443d' },
    { x: 0.08, y: 0.94, radius: 0.6, color: '#ff7a4d24' },
  ],
}

const images: ImagesConfig = {
  // Inter is the site's face. It arrives as a dependency rather than a
  // vendored binary, so the cards render identically in CI and on a laptop —
  // which drawing with a system font stack would not guarantee.
  fonts: {
    title: '@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf',
    body: '@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf',
  },

  brand: 'Very Good AdBlock',
  mark: 'public/icons/icon-128.png',
  background: surface,
  color: '#fbf3f3',
  accent: '#ef4444',
  device: {
    radius: 0.035,
    borderColor: '#ffffff14',
    shadow: { color: '#00000080' },
  },

  social: {
    enabled: true,
    outputDir: 'public/social',
    publicPath: '/social',
    // 1.91:1 is the primary and keeps the bare filename. The square and
    // portrait crops exist for the consumers that reserve a taller slot and
    // letterbox a wide card into it — Apple's link previews in Messages most
    // visibly, which is what sent us here.
    presets: ['og', 'square', 'portrait'],
    foreground: 'dist/captures/popup.png',
    pages: [
      {
        path: '/',
        title: 'Ads gone before the page loads.',
        eyebrow: 'Chrome · Firefox · Safari',
        subtitle: 'No account, no telemetry, no bloat.',
      },
      {
        path: '/features',
        title: 'Every defense, in one extension.',
        eyebrow: 'Features',
        subtitle: 'Network, cosmetic, pop-up, and video ad blocking.',
      },
      {
        path: '/features/network-blocking',
        title: 'Blocked before the request completes.',
        eyebrow: 'Network blocking',
        subtitle: '14,000+ ad, tracker, and annoyance hosts.',
      },
      {
        path: '/features/youtube-twitch',
        title: 'YouTube and Twitch, without the ads.',
        eyebrow: 'Video',
        subtitle: 'Stripped from the player response, not skipped after the fact.',
      },
      {
        path: '/features/popups',
        title: 'Pop-ups that never open.',
        eyebrow: 'Pop-ups',
        subtitle: 'Including the ones fired from inside a player iframe.',
      },
      {
        path: '/features/controls',
        title: 'Pause any site in one click.',
        eyebrow: 'Controls',
        subtitle: 'Allowlists, per-site stats, and a local-only dashboard.',
        foreground: 'dist/captures/popup-paused.png',
      },
      {
        path: '/privacy',
        title: 'Nothing about your browsing leaves the device.',
        eyebrow: 'Privacy',
        subtitle: 'No accounts, no analytics, no telemetry.',
        foreground: 'dist/captures/dashboard.png',
      },
    ],
  },

  appStore: {
    enabled: true,
    outputDir: 'resources/app-store/screenshots',
    displays: ['APP_IPHONE_67', 'APP_IPAD_PRO_3GEN_129', 'APP_DESKTOP'],
    format: 'png',
    slides: [
      {
        capture: 'dist/captures/popup.png',
        headline: 'Ads gone before the page loads.',
        subheadline: 'Blocks ads, pop-ups, and trackers at the source, before the page can show them.',
      },
      {
        capture: 'dist/captures/popup-paused.png',
        headline: 'Pause any site in one tap.',
        subheadline: 'Per-site control and an allowlist, with protection resuming on its own.',
      },
      {
        // The dashboard is a wide surface. On a 1290x2796 phone frame it can
        // only get so large before the slack reads as empty background, so it
        // ships on the classes whose canvases suit it.
        capture: 'dist/captures/dashboard.png',
        headline: 'Every block, counted.',
        subheadline: 'Lifetime totals, 60 days of history, and per-site stats — all of it local.',
        displays: ['APP_IPAD_PRO_3GEN_129', 'APP_DESKTOP'],
      },
    ],
  },
}

export default images
