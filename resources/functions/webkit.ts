/**
 * Very Good AdBlock for apps that embed WebKit (`WKWebView`) instead of running
 * an extension: the extension's own rules as content-blocker lists, and its
 * content scripts as user scripts, built by Stacks' `webkit` extension target
 * (`bun run build:webkit`) and shipped beside this module in `webkit/`.
 *
 * ```ts
 * import { webkitRuleLists, webkitUserScripts } from 'very-good-adblock'
 *
 * for (const list of await webkitRuleLists())
 *   compile(list.id, list.version, list.json)   // WKContentRuleListStore; recompile when version changes
 * for (const script of webkitUserScripts())
 *   inject(script)                              // WKUserScript in script.world, at script.runAt
 * ```
 */

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

/** One compiled-list entry, as `webkit/manifest.json` describes it. */
export interface WebKitListEntry {
  /** Stable across releases: compile under this identifier. */
  id: string
  /** A content hash: reuse the compiled list until it changes. */
  version: string
  /** The ruleset or cosmetic group the list was built from. */
  group: string
  kind: 'network' | 'cosmetic'
  /** Whether the extension applies it by default (aggressive and cookie-consent hiding are opt-in). */
  enabled: boolean
  ruleCount: number
  file: string
}

/** A content-blocker list, with the JSON `compileContentRuleList` takes. */
export interface WebKitRuleList extends Omit<WebKitListEntry, 'file'> {
  json: string
}

/** A content script, ready for `WKUserScript`. */
export interface WebKitUserScript {
  id: string
  /** Extension match patterns (`*://*.youtube.com/*`) to test page URLs against. */
  matches: string[]
  excludeMatches: string[]
  runAt: 'document-start' | 'document-end'
  /** False means main frame only. */
  allFrames: boolean
  matchAboutBlank: boolean
  /** `page` is the page's own world; `isolated` is a content world of the app's. */
  world: 'page' | 'isolated'
  /** Whether it posts `chrome.runtime` / `chrome.storage` calls to the message handler. */
  bridged: boolean
  source: string
}

/** `webkit/manifest.json`. */
export interface WebKitManifest {
  format: 'stacks-webkit'
  formatVersion: number
  name: string
  version: string
  maxRulesPerList: number
  /** The `webkit.messageHandlers` name bridged scripts post to, and its contract version. */
  bridge: { messageHandler: string, version: number }
  lists: WebKitListEntry[]
  scripts: Array<Omit<WebKitUserScript, 'source'> & { file: string, apis: string[], unsupportedApis: string[] }>
  report: {
    input: number
    output: number
    unsupported: Array<{ reason: string, count: number, examples: Array<number | string> }>
    approximated: Array<{ reason: string, count: number, examples: Array<number | string> }>
  }
}

export interface WebKitOptions {
  /** Include the lists the extension leaves off by default. Default false. */
  includeDisabled?: boolean
  /** Where the built `webkit/` directory is. Defaults to the one shipped beside this module. */
  dir?: string | URL
}

function base(dir?: string | URL): URL {
  if (dir === undefined)
    return new URL('./webkit/', import.meta.url)
  const url = typeof dir === 'string' ? pathToFileURL(dir) : dir
  return url.href.endsWith('/') ? url : new URL(`${url.href}/`)
}

/** The manifest the lists and scripts were built with. */
export function webkitManifest(options: Pick<WebKitOptions, 'dir'> = {}): WebKitManifest {
  return JSON.parse(readFileSync(new URL('manifest.json', base(options.dir)), 'utf8')) as WebKitManifest
}

/** The content-blocker lists, enabled ones only unless `includeDisabled`. */
export async function webkitRuleLists(options: WebKitOptions = {}): Promise<WebKitRuleList[]> {
  const root = base(options.dir)
  const lists = webkitManifest({ dir: root }).lists.filter(list => options.includeDisabled || list.enabled)
  return Promise.all(lists.map(async ({ file, ...list }) => ({ ...list, json: await readFile(new URL(file, root), 'utf8') })))
}

/** The content scripts: YouTube and X pruning, the pop-up guard, and the cosmetic and Twitch content script. */
export function webkitUserScripts(options: Pick<WebKitOptions, 'dir'> = {}): WebKitUserScript[] {
  const root = base(options.dir)
  return webkitManifest({ dir: root }).scripts.map(script => ({
    id: script.id,
    matches: script.matches,
    excludeMatches: script.excludeMatches,
    runAt: script.runAt,
    allFrames: script.allFrames,
    matchAboutBlank: script.matchAboutBlank,
    world: script.world,
    bridged: script.bridged,
    source: readFileSync(new URL(script.file, root), 'utf8'),
  }))
}
