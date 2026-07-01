export const extensionName = 'Very Good AdBlock'
export const extensionDescription = 'A polished, performant, minimal, modern Chrome MV3 ad blocker for popup, ad, YouTube, and Twitch protection.'
export const staticRulesetId = 'very_good_adblock_static_rules'
export const dynamicRuleStartId = 50000
export const dynamicRuleEndId = 50999
export const maxRecentEvents = 240

// Reserved dynamic-rule range for hosts fetched by the scheduled filter refresh.
// Kept disjoint from the allow/block dynamic range so neither clobbers the other.
export const refreshRuleStartId = 60000
export const refreshRuleEndId = 89999
export const maxRefreshRules = 25000
export const filterRefreshAlarm = 'very-good-adblock-filter-refresh'
export const filterRefreshUrl = 'https://raw.githubusercontent.com/chrisbbreuer/very-good-adblock/main/rules/generated/network-hosts.json'

export const protectedHosts = {
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com'],
  twitch: ['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'],
  x: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'],
} as const

export const twitchVideoAdMarkers = [
  '.player-ad-notice',
  '.commercial-break-in-progress',
  '[data-a-target="video-ad-label"]',
  '[data-a-target="video-ad-countdown"]',
] as const
