import type { ResourceCategory } from '../shared/types'
import generatedNetworkHosts from './generated/network-hosts.json'

export interface CuratedRuleSeed {
  id: number
  name: string
  category: ResourceCategory
  urlFilter: string
  resourceTypes: chrome.declarativeNetRequest.ResourceType[]
}

// Host rules cover subresources AND top-level documents: pop-under scripts
// open tracked ad hosts as whole tabs, and only a main_frame rule stops those
// (the background closes such tabs and credits the opener with the block).
// Path-scoped curated and redirect rules keep their own narrower type lists.
const blockedHostTypes: chrome.declarativeNetRequest.ResourceType[] = [
  resourceType('main_frame'),
  resourceType('script'),
  resourceType('image'),
  resourceType('xmlhttprequest'),
  resourceType('sub_frame'),
  resourceType('media'),
  resourceType('font'),
  resourceType('stylesheet'),
]

export const curatedRuleSeeds: CuratedRuleSeed[] = [
  { id: 1, name: 'DoubleClick', category: 'script', urlFilter: '||doubleclick.net^', resourceTypes: blockedHostTypes },
  { id: 2, name: 'Google syndication', category: 'script', urlFilter: '||googlesyndication.com^', resourceTypes: blockedHostTypes },
  { id: 3, name: 'Google ad services', category: 'script', urlFilter: '||googleadservices.com^', resourceTypes: blockedHostTypes },
  { id: 4, name: 'Adnxs', category: 'script', urlFilter: '||adnxs.com^', resourceTypes: blockedHostTypes },
  { id: 5, name: 'Rubicon', category: 'script', urlFilter: '||rubiconproject.com^', resourceTypes: blockedHostTypes },
  { id: 6, name: 'Taboola', category: 'script', urlFilter: '||taboola.com^', resourceTypes: blockedHostTypes },
  { id: 7, name: 'Outbrain', category: 'script', urlFilter: '||outbrain.com^', resourceTypes: blockedHostTypes },
  { id: 8, name: 'PubMatic', category: 'script', urlFilter: '||pubmatic.com^', resourceTypes: blockedHostTypes },
  { id: 9, name: 'OpenX', category: 'script', urlFilter: '||openx.net^', resourceTypes: blockedHostTypes },
  { id: 10, name: 'Amazon ads', category: 'script', urlFilter: '||amazon-adsystem.com^', resourceTypes: blockedHostTypes },
  { id: 11, name: 'YouTube ad stats', category: 'xhr', urlFilter: '||youtube.com/api/stats/ads^', resourceTypes: [resourceType('xmlhttprequest'), resourceType('ping')] },
  { id: 12, name: 'YouTube page ads', category: 'xhr', urlFilter: '|https://www.youtube.com/pagead/', resourceTypes: [resourceType('xmlhttprequest'), resourceType('script'), resourceType('image')] },
  { id: 13, name: 'Twitter ads API', category: 'xhr', urlFilter: '|https://twitter.com/i/api/1.1/promoted_content/', resourceTypes: [resourceType('xmlhttprequest')] },
  { id: 14, name: 'X ads API', category: 'xhr', urlFilter: '|https://x.com/i/api/1.1/promoted_content/', resourceTypes: [resourceType('xmlhttprequest')] },
  { id: 15, name: 'Twitch ads GraphQL', category: 'xhr', urlFilter: '|https://gql.twitch.tv/gql?operationName=VideoAd', resourceTypes: [resourceType('xmlhttprequest')] },
  { id: 16, name: 'Twitch ad events', category: 'xhr', urlFilter: '||twitch.tv/ads^', resourceTypes: [resourceType('xmlhttprequest'), resourceType('ping')] },
  { id: 17, name: 'Twitch ad telemetry', category: 'xhr', urlFilter: '||twitch.tv/widgets/advertising^', resourceTypes: [resourceType('xmlhttprequest'), resourceType('script')] },
  // Mainstream analytics/ad trackers that the truncated host list can miss — a
  // guaranteed floor of high-value domains, kept as a stable curated set.
  { id: 18, name: 'Google Analytics', category: 'script', urlFilter: '||google-analytics.com^', resourceTypes: blockedHostTypes },
  { id: 19, name: 'Google Tag Manager', category: 'script', urlFilter: '||googletagmanager.com^', resourceTypes: blockedHostTypes },
  { id: 20, name: 'Google ad service', category: 'script', urlFilter: '||adservice.google.com^', resourceTypes: blockedHostTypes },
  { id: 21, name: 'App measurement', category: 'script', urlFilter: '||app-measurement.com^', resourceTypes: blockedHostTypes },
  { id: 22, name: 'ScorecardResearch', category: 'script', urlFilter: '||scorecardresearch.com^', resourceTypes: blockedHostTypes },
  { id: 23, name: 'Quantserve', category: 'script', urlFilter: '||quantserve.com^', resourceTypes: blockedHostTypes },
  { id: 24, name: 'Criteo', category: 'script', urlFilter: '||criteo.com^', resourceTypes: blockedHostTypes },
  { id: 25, name: 'Criteo net', category: 'script', urlFilter: '||criteo.net^', resourceTypes: blockedHostTypes },
  { id: 26, name: 'Casale Media', category: 'script', urlFilter: '||casalemedia.com^', resourceTypes: blockedHostTypes },
  { id: 27, name: 'Moat ads', category: 'script', urlFilter: '||moatads.com^', resourceTypes: blockedHostTypes },
  { id: 28, name: 'Adform', category: 'script', urlFilter: '||adform.net^', resourceTypes: blockedHostTypes },
  { id: 29, name: 'Twitter ads pixel', category: 'script', urlFilter: '||ads-twitter.com^', resourceTypes: blockedHostTypes },
  { id: 30, name: 'Bing ad tracker', category: 'xhr', urlFilter: '||bat.bing.com^', resourceTypes: blockedHostTypes },
  { id: 31, name: 'LinkedIn ads pixel', category: 'script', urlFilter: '||px.ads.linkedin.com^', resourceTypes: blockedHostTypes },
  // European ad stack that the English-language filter lists still miss. These
  // are the head of the chain on German/EU publishers (transfermarkt.de,
  // t-online.de and the rest of the Ströer network): the Ströer slot library
  // and its Yieldlove prebid wrapper request every downstream SSP, so blocking
  // them stops the auction before it starts.
  // Ströer's CDN also serves non-ad assets, so only the ad tag path is blocked
  // — the same scoping uBlock Origin uses for it.
  { id: 32, name: 'Ströer ad tag', category: 'script', urlFilter: '||stroeerdigitalgroup.de/metatag/', resourceTypes: [resourceType('script'), resourceType('xmlhttprequest'), resourceType('sub_frame')] },
  { id: 33, name: 'Nativendo', category: 'script', urlFilter: '||nativendo.de^', resourceTypes: blockedHostTypes },
  { id: 34, name: 'DSPX', category: 'xhr', urlFilter: '||dspx.tv^', resourceTypes: blockedHostTypes },
  { id: 35, name: 'Presage', category: 'xhr', urlFilter: '||presage.io^', resourceTypes: blockedHostTypes },
  { id: 36, name: 'InMobi', category: 'xhr', urlFilter: '||inmobi.com^', resourceTypes: blockedHostTypes },
  { id: 37, name: 'Viralize', category: 'media', urlFilter: '||viralize.tv^', resourceTypes: blockedHostTypes },
  { id: 38, name: 'Benelph creatives', category: 'image', urlFilter: '||benelph.de^', resourceTypes: blockedHostTypes },
  { id: 39, name: 'Adobe tag manager', category: 'script', urlFilter: '||adobedtm.com^', resourceTypes: blockedHostTypes },
  // Push-notification opt-in spam: SDKs whose only job is the "allow
  // notifications" nag that ad networks resell as a channel.
  { id: 40, name: 'NotifPush', category: 'script', urlFilter: '||notifpush.com^', resourceTypes: blockedHostTypes },
  { id: 41, name: 'PushAddict', category: 'script', urlFilter: '||pushaddict.com^', resourceTypes: blockedHostTypes },
]

export interface RedirectRuleSeed {
  name: string
  urlFilter: string
  path: string
}

/**
 * Ad SDK loaders are neutered (redirected to inert stubs), not hard-blocked, so
 * pages that await the SDK keep working while no ad is requested. Redirect rules
 * run at priority 2 so they win over the domain block rules above. The IMA video
 * SDK is deliberately not stubbed here — YouTube video ads are already removed by
 * source pruning, and a partial IMA stub risks breaking third-party players.
 */
export const redirectRuleSeeds: RedirectRuleSeed[] = [
  { name: 'Google Publisher Tag', urlFilter: '||googletagservices.com/tag/js/gpt.js', path: '/stubs/googletag.js' },
  { name: 'Google Publisher Tag (securepubads)', urlFilter: '||securepubads.g.doubleclick.net/tag/js/gpt.js', path: '/stubs/googletag.js' },
  { name: 'Google AdSense', urlFilter: '||pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', path: '/stubs/adsbygoogle.js' },
]

const staticRedirectStartId = 90_000

export function buildStaticRules(): chrome.declarativeNetRequest.Rule[] {
  const curatedRules = curatedRuleSeeds.map(seed => ({
    id: seed.id,
    priority: 1,
    action: { type: 'block' as const },
    condition: {
      urlFilter: seed.urlFilter,
      resourceTypes: seed.resourceTypes,
    },
  }))

  const redirectRules = redirectRuleSeeds.map((seed, index) => ({
    id: staticRedirectStartId + index,
    priority: 2,
    action: { type: 'redirect' as const, redirect: { extensionPath: seed.path } },
    condition: {
      urlFilter: seed.urlFilter,
      resourceTypes: [resourceType('script')],
    },
  }))

  const generatedRules = generatedNetworkHosts.hosts.map((host, index) => ({
    id: curatedRuleSeeds.length + index + 1,
    priority: 1,
    action: { type: 'block' as const },
    condition: {
      urlFilter: `||${host}^`,
      resourceTypes: blockedHostTypes,
    },
  }))

  return [...curatedRules, ...redirectRules, ...generatedRules]
}

function resourceType(value: string): chrome.declarativeNetRequest.ResourceType {
  return value as chrome.declarativeNetRequest.ResourceType
}
