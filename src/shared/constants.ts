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
export const resumeAlarm = 'very-good-adblock-resume-protection'
export const filterRefreshUrl = 'https://raw.githubusercontent.com/chrisbbreuer/very-good-adblock/main/rules/generated/network-hosts.json'

export const protectedHosts = {
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com'],
  twitch: ['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'],
  x: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'],
} as const

/**
 * Standalone text labels X renders on promoted timeline tweets, across locales.
 * The content script matches a tweet's leaf label span exactly against this set,
 * so promoted tweets are caught regardless of the viewer's interface language
 * without hiding ordinary posts. Kept as a flat set for O(1) exact lookups.
 *
 * English "Ad"/"Promoted" plus the localized strings verified against a real
 * source (ryanckulp/twitter_ad_blocker's PROMOTED_LABELS). Only confirmed
 * strings are listed — unverified translations are deliberately omitted rather
 * than guessed, since a wrong entry could hide a genuine post.
 */
export const xPromotedLabels: ReadonlySet<string> = new Set([
  'Ad', // English (current short label)
  'Promoted', // English
  'Promoted Tweet', // English (legacy)
  'Gesponsert', // German
  'Promocionado', // Spanish
  'Sponsorisé', // French
  'Sponsorizzato', // Italian
  'Promowane', // Polish
  'Sponsrad', // Swedish
  'Sponzorováno', // Czech
  'Реклама', // Ukrainian / Russian
  'プロモーション', // Japanese
  'プロモツイート', // Japanese ('Promoted Tweet')
  '프로모션 중', // Korean
])

/**
 * postMessage channel between the isolated content script and the MAIN-world
 * X pruner. `x-prune` carries a removed-count back for stats; `x-config` carries
 * the enable flag forward so the pruner respects the global/allowlist switches.
 */
export const xPruneMessageSource = 'very-good-adblock:x-prune'
export const xConfigMessageSource = 'very-good-adblock:x-config'
export const ytPruneMessageSource = 'very-good-adblock:yt-prune'
export const ytConfigMessageSource = 'very-good-adblock:yt-config'

export const twitchVideoAdMarkers = [
  '.player-ad-notice',
  '.commercial-break-in-progress',
  '[data-a-target="video-ad-label"]',
  '[data-a-target="video-ad-countdown"]',
] as const
