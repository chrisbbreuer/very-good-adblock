export const extensionName = 'Very Good AdBlock'
export const extensionDescription = 'A polished, performant, minimal, modern Chrome MV3 ad blocker for popup, ad, YouTube, and Twitch cleanup.'
export const staticRulesetId = 'very_good_adblock_static_rules'
export const dynamicRuleStartId = 50000
export const dynamicRuleEndId = 50999
export const maxRecentEvents = 240

export const protectedHosts = {
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com'],
  twitch: ['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'],
  x: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'],
} as const

export const defaultCosmeticSelectors = [
  '[id^="google_ads_"]',
  '[id*="ad-container"]',
  '[class*="ad-container"]',
  '[class*="adsbygoogle"]',
  '[data-ad]',
  '[data-ad-slot]',
  '[aria-label="Advertisement"]',
] as const

export const youtubeSelectors = [
  '.ytp-ad-module',
  '.video-ads',
  '.ytp-ad-overlay-container',
  'ytd-display-ad-renderer',
  'ytd-promoted-sparkles-web-renderer',
  'ytd-companion-slot-renderer',
  'ytd-ad-slot-renderer',
  'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
] as const

export const twitchSelectors = [
  '.player-ad-notice',
  '.commercial-break-in-progress',
  '.stream-display-ad__container',
  '[data-a-target="video-ad-label"]',
  '[data-a-target="video-ad-countdown"]',
  '[data-a-target="video-player-ad-overlay"]',
  '[data-test-selector="video-ad-banner"]',
  '[class*="ad-banner"]',
  '[class*="ad-overlay"]',
] as const

export const twitchVideoAdMarkers = [
  '.player-ad-notice',
  '.commercial-break-in-progress',
  '[data-a-target="video-ad-label"]',
  '[data-a-target="video-ad-countdown"]',
] as const

export const xSelectors = [
  '[data-testid="placementTracking"]',
  'article:has([data-testid="promotedIndicator"])',
] as const
