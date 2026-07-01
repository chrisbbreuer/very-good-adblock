import type { BlockSource, ResourceCategory } from './types'

/**
 * Cosmetic filtering hides ad placements that survive network blocking because
 * they are served inline from the first-party origin (YouTube feed/masthead
 * ads, Twitch display banners, X promoted entries). To keep the page usable we
 * only ship precise, ad-only selectors:
 *
 * - `default` is a narrow, high-confidence set that ships on by default.
 * - `aggressive` is a broader, opt-in set for people who accept a small risk of
 *   over-hiding in exchange for catching more placements.
 *
 * Player-region selectors (`.video-ads`, `.ytp-ad-module`) are intentionally
 * excluded: instream video ads are handled by skip automation, and hiding the
 * player overlay would also hide the skip control.
 */
export interface CosmeticGroup {
  /** Which surface this group protects; also the stat/source label. */
  source: BlockSource
  /** Byte-estimate category used for the "data saved" metric. */
  category: ResourceCategory
  /** Ships on by default. Must be ad-only and layout-safe. */
  default: readonly string[]
  /** Opt-in. Broader matches that may occasionally over-hide. */
  aggressive: readonly string[]
}

/** Cross-site ad slots. Only unambiguous ad markers are on by default. */
export const genericCosmetic: CosmeticGroup = {
  source: 'cosmetic',
  category: 'other',
  default: [
    'ins.adsbygoogle',
    '[id^="google_ads_iframe_"]',
    '[id^="div-gpt-ad"]',
    '[data-google-query-id]',
    '[aria-label="Advertisement"]',
  ],
  aggressive: [
    '[id*="ad-container"]',
    '[class*="ad-container"]',
    'iframe[src*="/ads/"]',
    '[data-ad-slot]',
  ],
}

/**
 * YouTube feed, watch-page, and search ad modules. These are dedicated custom
 * elements that only ever hold ads, so hiding them cannot remove real videos,
 * comments, Shorts, or recommendations. `ytd-rich-item-renderer:has(...)` hides
 * the whole grid cell so the feed does not leave an empty gap.
 */
export const youtubeCosmetic: CosmeticGroup = {
  source: 'youtube',
  category: 'image',
  default: [
    '#masthead-ad',
    '#player-ads',
    'ytd-ad-slot-renderer',
    'ytd-in-feed-ad-layout-renderer',
    'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
    'ytd-rich-item-renderer:has(ytd-in-feed-ad-layout-renderer)',
    'ytd-display-ad-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-promoted-sparkles-text-search-renderer',
    'ytd-promoted-video-renderer',
    'ytd-compact-promoted-video-renderer',
    'ytd-companion-slot-renderer',
    'ytd-action-companion-ad-renderer',
    'ytd-player-legacy-desktop-watch-ads-renderer',
    'ytd-statement-banner-renderer',
    'ytd-brand-video-shelf-renderer',
    'ytd-brand-video-singleton-renderer',
    'ytd-search-pyv-renderer',
    'ytd-enforcement-message-view-model',
    'ytd-enforcement-message-renderer',
    'ytd-popup-container:has(ytd-enforcement-message-view-model)',
  ],
  aggressive: [
    'ytd-rich-section-renderer:has(ytd-statement-banner-renderer)',
    'ytd-reel-shelf-renderer:has(ytd-ad-slot-renderer)',
    '.ytp-ad-overlay-slot',
    'ytd-merch-shelf-renderer',
  ],
}

/**
 * Twitch display/banner ads. Video-ad markers (`.player-ad-notice`,
 * `.commercial-break-in-progress`, countdown/label) are deliberately NOT hidden
 * here: the ad is the live stream itself, so hiding the notice would only hide
 * feedback while the ad keeps playing. Those markers are detected for stats
 * instead (see the content script).
 */
export const twitchCosmetic: CosmeticGroup = {
  source: 'twitch',
  category: 'image',
  default: [
    '.stream-display-ad__container',
    '[data-test-selector="sad-overlay"]',
  ],
  aggressive: [
    '[data-a-target="video-ad-banner"]',
    '[data-test-selector="video-ad-banner"]',
  ],
}

/** X / Twitter promoted feed entries. Only the structural marker is on. */
export const xCosmetic: CosmeticGroup = {
  source: 'x',
  category: 'other',
  default: [
    '[data-testid="placementTracking"]',
  ],
  aggressive: [
    'div[data-testid="trend"]:has([data-testid="promotedIndicator"])',
  ],
}

export interface CosmeticContext {
  isYouTube: boolean
  isTwitch: boolean
  isX: boolean
  youtubeEnhancements: boolean
  twitchEnhancements: boolean
  aggressive: boolean
}

export interface ActiveCosmeticGroup {
  source: BlockSource
  category: ResourceCategory
  selectors: string[]
}

function resolveGroup(group: CosmeticGroup, aggressive: boolean): ActiveCosmeticGroup {
  const selectors = aggressive ? [...group.default, ...group.aggressive] : [...group.default]
  return { source: group.source, category: group.category, selectors }
}

/**
 * Returns the cosmetic selector groups that apply to the current page, honoring
 * the per-site enhancement toggles and the aggressive opt-in. The caller is
 * responsible for the global `cosmeticFiltering` and allowlist gates.
 */
export function activeCosmeticGroups(context: CosmeticContext): ActiveCosmeticGroup[] {
  const groups: ActiveCosmeticGroup[] = [resolveGroup(genericCosmetic, context.aggressive)]

  if (context.isYouTube && context.youtubeEnhancements) groups.push(resolveGroup(youtubeCosmetic, context.aggressive))
  if (context.isTwitch && context.twitchEnhancements) groups.push(resolveGroup(twitchCosmetic, context.aggressive))
  if (context.isX) groups.push(resolveGroup(xCosmetic, context.aggressive))

  return groups.filter(group => group.selectors.length > 0)
}
