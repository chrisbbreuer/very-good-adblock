import type { WebKitManifest } from '../resources/functions/webkit'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { buildExtension, isWebKitRegex } from '@stacksjs/browser-extension'
import { Window } from 'very-happy-dom'
import extension from '../config/extension'
import { webkitManifest, webkitRuleLists, webkitUserScripts } from '../resources/functions/webkit'
import { navigationHosts } from '../src/rules/navigation'
import { buildStaticRules, redirectRuleSeeds } from '../src/rules/static-rules'
import { consentCosmetic, genericCosmetic, youtubeCosmetic } from '../src/shared/cosmetic'

interface Rule {
  trigger: { 'url-filter': string, 'resource-type'?: string[], 'if-domain'?: string[] }
  action: { type: string, selector?: string }
}

/** The built `webkit` target, as the published library ships it. */
describe('the WebKit target and library', () => {
  let dir: string
  let manifest: WebKitManifest
  let lists: Record<string, Rule[]>

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vga-webkit-'))
    await buildExtension(extension, { target: 'webkit', version: '9.9.9', outdir: dir })
    manifest = webkitManifest({ dir })
    lists = Object.fromEntries((await webkitRuleLists({ dir, includeDisabled: true })).map(list => [list.id, JSON.parse(list.json) as Rule[]]))
  }, 60_000)

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('builds one list per ruleset and cosmetic group, under the rule cap', () => {
    expect(manifest.lists.map(list => [list.id, list.kind, list.enabled])).toEqual([
      ...(extension.rules ?? []).map(rule => [rule.id, 'network', true]),
      ['very_good_adblock_cosmetic', 'cosmetic', true],
      ['very_good_adblock_cosmetic_aggressive', 'cosmetic', false],
      ['very_good_adblock_cosmetic_consent', 'cosmetic', false],
    ])
    expect(manifest.lists.every(list => list.ruleCount <= manifest.maxRulesPerList && /^[0-9a-f]{16}$/.test(list.version))).toBe(true)
  })

  it('converts every rule but the stub redirects, and says so', () => {
    expect(manifest.report.unsupported).toEqual([{
      reason: 'redirect actions (content blockers cannot redirect)',
      count: redirectRuleSeeds.length,
      examples: buildStaticRules().filter(rule => rule.action.type === 'redirect').map(rule => rule.id),
    }])
    expect(manifest.report.approximated).toEqual([])
  })

  it('blocks every host the extension blocks, with patterns WebKit accepts', () => {
    const network = manifest.lists.filter(list => list.kind === 'network').flatMap(list => lists[list.id]!)
    const blocks = network.filter(rule => rule.action.type === 'block')
    const extensionBlocks = buildStaticRules().filter(rule => rule.action.type === 'block')
    expect(blocks.length).toBeGreaterThanOrEqual(extensionBlocks.length)
    expect(network.every(rule => isWebKitRegex(rule.trigger['url-filter']))).toBe(true)

    const matches = (url: string, type: string) => blocks.some(rule => (!rule.trigger['resource-type'] || rule.trigger['resource-type'].includes(type)) && new RegExp(rule.trigger['url-filter'], 'i').test(url))
    expect(matches('https://securepubads.g.doubleclick.net/gampad/ads?x=1', 'script')).toBe(true)
    expect(matches('https://www.example.com/', 'document')).toBe(false)
  })

  it('lifts the navigation exceptions in every network list, after the blocks', () => {
    for (const list of manifest.lists.filter(entry => entry.kind === 'network')) {
      const rules = lists[list.id]!
      const firstException = rules.findIndex(rule => rule.action.type === 'ignore-previous-rules')
      expect(rules.slice(firstException).every(rule => rule.action.type === 'ignore-previous-rules')).toBe(true)
      expect(rules.length - firstException).toBe(navigationHosts.length * 2)
    }
  })

  it('hides with selectors a browser parses, scoped to their sites', () => {
    const document = new Window().document
    const hiding = Object.values(lists).flat().filter(rule => rule.action.type === 'css-display-none')
    for (const rule of hiding)
      expect(() => document.querySelectorAll(rule.action.selector!)).not.toThrow()

    const defaults = lists.very_good_adblock_cosmetic!
    expect(defaults[0]!.action.selector!.split(', ')).toEqual([...genericCosmetic.default])
    expect(defaults.find(rule => rule.trigger['if-domain']?.includes('*youtube.com'))!.action.selector!.split(', ')).toEqual([...youtubeCosmetic.default])
    expect(lists.very_good_adblock_cosmetic_consent![0]!.action.selector!.split(', ')).toEqual([...consentCosmetic.default])
  })

  it('returns only the lists the extension applies by default unless asked', async () => {
    const enabled = await webkitRuleLists({ dir })
    expect(enabled.map(list => list.id)).toEqual(manifest.lists.filter(list => list.enabled).map(list => list.id))
    expect(enabled.every(list => typeof list.json === 'string' && !('file' in list))).toBe(true)
  })

  it('ships the content scripts as standalone user scripts', () => {
    const scripts = Object.fromEntries(webkitUserScripts({ dir }).map(script => [script.id, script]))
    expect(Object.keys(scripts)).toEqual(['content', 'x-inpage', 'yt-inpage', 'popup-guard'])
    expect(scripts['yt-inpage']).toMatchObject({ world: 'page', runAt: 'document-start', bridged: false })
    expect(scripts['popup-guard']).toMatchObject({ world: 'page', allFrames: true, matchAboutBlank: true })
    // The content script asks the background for settings; in WebKit it asks the app.
    expect(scripts.content).toMatchObject({ world: 'isolated', bridged: true })
    expect(manifest.bridge).toEqual({ messageHandler: 'very-good-adblock', version: 1 })
    expect(manifest.scripts.find(script => script.id === 'content')!.unsupportedApis).toEqual([])
    for (const script of Object.values(scripts))
      expect(() => new Function(script.source)).not.toThrow()
  })
})
