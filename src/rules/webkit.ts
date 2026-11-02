import type { CosmeticGroup } from '../shared/cosmetic'
import { consentCosmetic, genericCosmetic, twitchCosmetic, xCosmetic, youtubeCosmetic } from '../shared/cosmetic'
import { defaultSettings } from '../shared/storage'
import { buildDynamicRules } from './dynamic-rules'

/**
 * What the `webkit` build target (`bun run build:webkit`) reads beyond the
 * static rulesets: the cosmetic selectors the content script applies, as
 * WebKit `css-display-none` lists, and the dynamic rules the background
 * installs for the default settings. Each export is one list group, named in
 * config/extension.ts as `src/rules/webkit.ts#<export>`.
 */

interface CosmeticRule {
  selector: string[]
  domains?: string[]
}

/** The sites each site-specific group belongs to, as the content script decides them. */
const sites = {
  youtube: ['youtube.com', 'youtube-nocookie.com'],
  twitch: ['twitch.tv'],
  x: ['x.com', 'twitter.com'],
}

function rules(pick: (group: CosmeticGroup) => readonly string[]): CosmeticRule[] {
  return [
    { selector: [...pick(genericCosmetic)] },
    { selector: [...pick(youtubeCosmetic)], domains: sites.youtube },
    { selector: [...pick(twitchCosmetic)], domains: sites.twitch },
    { selector: [...pick(xCosmetic)], domains: sites.x },
  ].filter(rule => rule.selector.length > 0)
}

/** The narrow, ad-only selectors that ship on by default. */
export function cosmetic(): CosmeticRule[] {
  return rules(group => group.default)
}

/** The opt-in broader selectors (the extension's "aggressive" setting). */
export function cosmeticAggressive(): CosmeticRule[] {
  return rules(group => group.aggressive)
}

/** Cookie-consent banners (the extension's opt-in). */
export function cosmeticConsent(): CosmeticRule[] {
  return [{ selector: [...consentCosmetic.default] }].filter(rule => rule.selector.length > 0)
}

/** The dynamic rules the background installs for the default settings. */
export function dynamicRules(): chrome.declarativeNetRequest.Rule[] {
  return buildDynamicRules(defaultSettings)
}
