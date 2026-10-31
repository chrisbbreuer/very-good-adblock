/**
 * Very Good AdBlock for WebKit browsers: the extension's blocking as WebKit
 * content-blocker lists and page scripts, for an app that embeds WKWebView
 * (`WKContentRuleListStore`, `WKUserScript`) instead of running an extension.
 *
 * ```ts
 * import { webkitContentRules, webkitPageScripts } from 'very-good-adblock'
 *
 * for (const list of webkitContentRules()) store.compile(list.identifier, list.version, JSON.stringify(list.rules))
 * for (const script of webkitPageScripts()) inject(script)   // page world, document start
 * ```
 *
 * The rules are the extension's own (its curated and generated host rules,
 * navigation exceptions and cosmetic selectors), regenerated from src/ by
 * resources/scripts/build-webkit-data.ts, so both stay one blocker.
 */

import { data as bundled } from './webkit-data'

/** A WebKit content-blocker rule (Safari's content blocker JSON format). */
export interface WebKitRule {
  trigger: {
    'url-filter': string
    'url-filter-is-case-sensitive'?: boolean
    'resource-type'?: WebKitResourceType[]
    'load-type'?: Array<'first-party' | 'third-party'>
    'if-domain'?: string[]
    'unless-domain'?: string[]
  }
  action: { type: 'block' } | { type: 'ignore-previous-rules' } | { type: 'css-display-none', selector: string }
}

export type WebKitResourceType = 'document' | 'image' | 'style-sheet' | 'script' | 'font' | 'raw' | 'svg-document' | 'media' | 'popup' | 'ping' | 'fetch' | 'websocket' | 'other'

export interface WebKitList {
  /** Stable across releases: the same list, newer rules. */
  identifier: string
  /** Changes whenever the rules do, so a compiled copy is reused until then. */
  version: string
  rules: WebKitRule[]
}

export interface WebKitPageScript {
  id: string
  /** Hosts it runs on (each covers its subdomains); empty for every site. */
  hosts: string[]
  allFrames: boolean
  /** Runs in the page's own world at document start, before the site's scripts. */
  js: string
}

interface CosmeticGroup { default: string[], aggressive: string[] }

export interface WebKitData {
  generatedAt: string
  blockedHosts: string[]
  curated: Array<{ name: string, urlFilter: string, resourceTypes: string[] }>
  navigationHosts: string[]
  cosmetic: { generic: CosmeticGroup, youtube: CosmeticGroup, twitch: CosmeticGroup, x: CosmeticGroup, consent: CosmeticGroup }
  pageScripts: WebKitPageScript[]
}

export interface WebKitRuleOptions {
  /** Hide cookie-consent banners too (the extension's opt-in). Default false. */
  cookieConsent?: boolean
  /** The broader cosmetic selectors that may occasionally over-hide. Default false. */
  aggressive?: boolean
  /** Rules per list; WebKit compiles up to 150,000, and smaller lists compile faster. Default 50,000. */
  listSize?: number
  /** Selectors per hiding rule. Default 100. */
  selectorsPerRule?: number
}

/** Which sites each site-specific cosmetic group belongs to. */
const COSMETIC_SITES = {
  youtube: ['youtube.com', 'youtube-nocookie.com'],
  twitch: ['twitch.tv'],
  x: ['x.com', 'twitter.com'],
} as const

const RESOURCE_TYPES: Record<string, WebKitResourceType> = {
  main_frame: 'document',
  sub_frame: 'document',
  script: 'script',
  image: 'image',
  stylesheet: 'style-sheet',
  font: 'font',
  media: 'media',
  xmlhttprequest: 'raw',
  ping: 'ping',
  websocket: 'websocket',
  other: 'other',
}

const escapeRegex = (text: string) => text.replace(/[.+?${}()|[\]\\]/g, '\\$&')
/** Characters that end a host or path segment, as an adblock `^` means. */
const SEPARATOR = '[^a-zA-Z0-9_.%-]'

/**
 * An adblock-style URL filter (`||host^`, `||host/path`, `|https://…`, with
 * `*` wildcards) as the regular expression WebKit content blockers accept: no
 * alternation, no counted repetition.
 */
export function urlFilterToRegex(filter: string): string {
  let pattern = filter
  let prefix = ''
  if (pattern.startsWith('||')) {
    prefix = '^[a-z][a-z0-9+.-]*://([^/:]+\\.)?'
    pattern = pattern.slice(2)
  }
  else if (pattern.startsWith('|')) {
    prefix = '^'
    pattern = pattern.slice(1)
  }
  let suffix = ''
  if (pattern.endsWith('|')) {
    suffix = '$'
    pattern = pattern.slice(0, -1)
  }
  // A host followed by `^` is always followed by a port or a path in a real request URL.
  const hostOnly = prefix.startsWith('^[a-z]') && /^[^/^*]+\^$/.test(pattern)
  if (hostOnly) return `${prefix}${escapeRegex(pattern.slice(0, -1))}[:/]`
  const body = pattern.split('*').map(part => part.split('^').map(escapeRegex).join(SEPARATOR)).join('.*')
  return `${prefix}${body}${suffix}`
}

function blockRule(urlFilter: string, types: string[]): WebKitRule {
  const resourceTypes = [...new Set(types.map(type => RESOURCE_TYPES[type]).filter((type): type is WebKitResourceType => Boolean(type)))]
  return { trigger: { 'url-filter': urlFilterToRegex(urlFilter), ...(resourceTypes.length ? { 'resource-type': resourceTypes } : {}) }, action: { type: 'block' } }
}

function hideRules(selectors: string[], perRule: number, domains?: readonly string[]): WebKitRule[] {
  const rules: WebKitRule[] = []
  for (let index = 0; index < selectors.length; index += perRule) {
    rules.push({
      trigger: { 'url-filter': '.*', ...(domains ? { 'if-domain': domains.map(domain => `*${domain}`) } : {}) },
      action: { type: 'css-display-none', selector: selectors.slice(index, index + perRule).join(', ') },
    })
  }
  return rules
}

/** FNV-1a over the rules' JSON: a short version that changes whenever they do, in any runtime. */
function fingerprint(text: string): string {
  let hash = 0x811C9DC5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/**
 * Every rule as WebKit content-blocker lists: network blocks first, then the
 * navigation exceptions (a tracker host people open from messages), then
 * cosmetic hiding. Lists are cut at `listSize`; an exception only lifts the
 * blocks before it in its own list, so exceptions and the blocks they lift
 * always share the last network list.
 */
export function webkitContentRules(options: WebKitRuleOptions = {}, data: WebKitData = bundled): WebKitList[] {
  const listSize = options.listSize ?? 50_000
  const perRule = options.selectorsPerRule ?? 100
  const pick = (group: CosmeticGroup) => (options.aggressive ? [...group.default, ...group.aggressive] : [...group.default])
  const hostTypes = ['main_frame', 'sub_frame', 'script', 'image', 'stylesheet', 'font', 'media', 'xmlhttprequest']
  const network: WebKitRule[] = [
    ...data.curated.map(seed => blockRule(seed.urlFilter, seed.resourceTypes)),
    ...data.blockedHosts.map(host => blockRule(`||${host}^`, hostTypes)),
  ]
  const exceptions: WebKitRule[] = data.navigationHosts.map(host => ({ trigger: { 'url-filter': urlFilterToRegex(`||${host}^`), 'resource-type': ['document'] }, action: { type: 'ignore-previous-rules' } }))
  const cosmetic: WebKitRule[] = [
    ...hideRules(pick(data.cosmetic.generic), perRule),
    ...hideRules(pick(data.cosmetic.youtube), perRule, COSMETIC_SITES.youtube),
    ...hideRules(pick(data.cosmetic.twitch), perRule, COSMETIC_SITES.twitch),
    ...hideRules(pick(data.cosmetic.x), perRule, COSMETIC_SITES.x),
    ...(options.cookieConsent ? hideRules(pick(data.cosmetic.consent), perRule) : []),
  ]

  const lists: WebKitRule[][] = []
  for (let index = 0; index < network.length; index += listSize) lists.push(network.slice(index, index + listSize))
  if (!lists.length) lists.push([])
  lists[lists.length - 1]!.push(...exceptions)
  if (lists[lists.length - 1]!.length + cosmetic.length > listSize) lists.push([])
  lists[lists.length - 1]!.push(...cosmetic)

  return lists.map((rules, index) => ({ identifier: `very-good-adblock-${index + 1}`, version: fingerprint(JSON.stringify(rules)), rules }))
}

/** The extension's page-world scripts: YouTube and X ads removed from the site's own data, and pop-ups defused. */
export function webkitPageScripts(data: WebKitData = bundled): WebKitPageScript[] {
  return data.pageScripts.map(script => ({ ...script, hosts: [...script.hosts] }))
}

/** When the bundled host list was generated from the filter lists. */
export const webkitRulesGeneratedAt: string = bundled.generatedAt
