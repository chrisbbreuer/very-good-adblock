export const extensionName = 'Very Good AdBlock'
// Store-facing summary (Chrome caps this at 132 chars).
export const extensionDescription = 'Removes ads, pop-ups, and YouTube and Twitch interruptions at the source. Fast, private, no telemetry.'
// Firefox requires a stable add-on ID (browser_specific_settings.gecko.id) to sign
// and publish an MV3 extension. Changing this after the first AMO submission
// creates a new, disconnected listing, so it must stay fixed going forward.
export const extensionGeckoId = 'extension@verygoodadblock.org'
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

// GitHub project links, used by the one-click "report an ad that got through"
// flow so users can file a fully pre-filled issue straight from the popup.
export const repositoryUrl = 'https://github.com/chrisbbreuer/very-good-adblock'
export const issuesUrl: string = `${repositoryUrl}/issues`
export const newIssueUrl: string = `${issuesUrl}/new`
export const adReportLabel = 'ad-reached-user'

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
export const popupBlockMessageSource = 'very-good-adblock:popup-blocked'
export const popupConfigMessageSource = 'very-good-adblock:popup-config'

export const twitchVideoAdMarkers = [
  '.player-ad-notice',
  '.commercial-break-in-progress',
  '[data-a-target="video-ad-label"]',
  '[data-a-target="video-ad-countdown"]',
] as const
