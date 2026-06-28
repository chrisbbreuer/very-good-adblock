import type { ResourceCategory } from '../shared/types'
import generatedNetworkHosts from '../../rules/generated/network-hosts.json'

export interface CuratedRuleSeed {
  id: number
  name: string
  category: ResourceCategory
  urlFilter: string
  resourceTypes: chrome.declarativeNetRequest.ResourceType[]
}

const thirdPartyTypes: chrome.declarativeNetRequest.ResourceType[] = [
  resourceType('script'),
  resourceType('image'),
  resourceType('xmlhttprequest'),
  resourceType('sub_frame'),
  resourceType('media'),
  resourceType('font'),
  resourceType('stylesheet'),
]

export const curatedRuleSeeds: CuratedRuleSeed[] = [
  { id: 1, name: 'DoubleClick', category: 'script', urlFilter: '||doubleclick.net^', resourceTypes: thirdPartyTypes },
  { id: 2, name: 'Google syndication', category: 'script', urlFilter: '||googlesyndication.com^', resourceTypes: thirdPartyTypes },
  { id: 3, name: 'Google ad services', category: 'script', urlFilter: '||googleadservices.com^', resourceTypes: thirdPartyTypes },
  { id: 4, name: 'Adnxs', category: 'script', urlFilter: '||adnxs.com^', resourceTypes: thirdPartyTypes },
  { id: 5, name: 'Rubicon', category: 'script', urlFilter: '||rubiconproject.com^', resourceTypes: thirdPartyTypes },
  { id: 6, name: 'Taboola', category: 'script', urlFilter: '||taboola.com^', resourceTypes: thirdPartyTypes },
  { id: 7, name: 'Outbrain', category: 'script', urlFilter: '||outbrain.com^', resourceTypes: thirdPartyTypes },
  { id: 8, name: 'PubMatic', category: 'script', urlFilter: '||pubmatic.com^', resourceTypes: thirdPartyTypes },
  { id: 9, name: 'OpenX', category: 'script', urlFilter: '||openx.net^', resourceTypes: thirdPartyTypes },
  { id: 10, name: 'Amazon ads', category: 'script', urlFilter: '||amazon-adsystem.com^', resourceTypes: thirdPartyTypes },
  { id: 11, name: 'YouTube ad stats', category: 'xhr', urlFilter: '||youtube.com/api/stats/ads^', resourceTypes: [resourceType('xmlhttprequest'), resourceType('ping')] },
  { id: 12, name: 'YouTube page ads', category: 'xhr', urlFilter: '|https://www.youtube.com/pagead/', resourceTypes: [resourceType('xmlhttprequest'), resourceType('script'), resourceType('image')] },
  { id: 13, name: 'Twitter ads API', category: 'xhr', urlFilter: '|https://twitter.com/i/api/1.1/promoted_content/', resourceTypes: [resourceType('xmlhttprequest')] },
  { id: 14, name: 'X ads API', category: 'xhr', urlFilter: '|https://x.com/i/api/1.1/promoted_content/', resourceTypes: [resourceType('xmlhttprequest')] },
]

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

  const generatedRules = generatedNetworkHosts.hosts.map((host, index) => ({
    id: curatedRuleSeeds.length + index + 1,
    priority: 1,
    action: { type: 'block' as const },
    condition: {
      urlFilter: `||${host}^`,
      resourceTypes: thirdPartyTypes,
    },
  }))

  return [...curatedRules, ...generatedRules]
}

function resourceType(value: string): chrome.declarativeNetRequest.ResourceType {
  return value as chrome.declarativeNetRequest.ResourceType
}
