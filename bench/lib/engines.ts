/**
 * Competitor engine adapters. Each factory instantiates its engine once, then
 * exposes a repeatable `ingest(raw)` (the parse/compile step we time) and a
 * uniform `match(request) => boolean` translating our canonical request into the
 * engine's native request shape.
 *
 * The engines are real, upstream packages:
 *   - uBlock Origin      @gorhill/ubo-core       (uBO's static network filtering engine)
 *   - Adblock Plus       adblockpluscore         (ABP's Matcher + Filter classes)
 *   - Ghostery           @ghostery/adblocker     (the reference TS engine; Brave uses native adblock-rust)
 *
 * Imports are dynamic and guarded so `bun run bench` still runs the extension's
 * own hot-path numbers even if the competitive dev-deps aren't installed.
 *
 * Note uBO's StaticNetFilteringEngine is a singleton (only one instance per
 * process), so its adapter creates once and re-runs `useLists` to re-ingest —
 * which is exactly the cost we want to measure.
 */
import { hostnameFromUrl } from '../../src/shared/domain'
import type { BenchRequest, BenchResourceType } from './harness'

export interface Engine {
  /** (Re)parse the raw filter text into a ready-to-match state. Timed for compile cost. */
  ingest: (raw: string) => Promise<void>
  match: (r: BenchRequest) => boolean
}

export interface EngineFactory {
  /** Human-readable label used in the tables. */
  name: string
  /** What this row represents, for the notes under the table. */
  note: string
  /** Instantiate the engine once (before any ingest). */
  prepare: () => Promise<Engine>
}

/** Returns the factories whose packages are installed, plus messages for any that aren't. */
export async function availableEngines(): Promise<{ factories: EngineFactory[], missing: string[] }> {
  const candidates: (() => Promise<EngineFactory>)[] = [abpFactory, uboFactory, ghosteryFactory]
  const factories: EngineFactory[] = []
  const missing: string[] = []
  for (const make of candidates) {
    try {
      factories.push(await make())
    }
    catch (err) {
      missing.push((err as Error).message)
    }
  }
  return { factories, missing }
}

// --- Ghostery / Brave --------------------------------------------------------

async function ghosteryFactory(): Promise<EngineFactory> {
  const { FiltersEngine, Request } = await import('@ghostery/adblocker')
  return {
    name: 'Ghostery',
    note: '@ghostery/adblocker — the reference TypeScript matching engine (Brave ships native adblock-rust)',
    async prepare() {
      let engine: ReturnType<typeof FiltersEngine.parse> | null = null
      return {
        async ingest(raw) { engine = FiltersEngine.parse(raw) },
        match: r => engine!.match(Request.fromRawDetails({ url: r.url, sourceUrl: r.sourceUrl, type: r.type })).match,
      }
    },
  }
}

// --- uBlock Origin -----------------------------------------------------------

const uboType: Record<BenchResourceType, string> = {
  script: 'script',
  image: 'image',
  xmlhttprequest: 'xmlhttprequest',
  sub_frame: 'sub_frame',
  stylesheet: 'stylesheet',
  font: 'font',
  media: 'media',
}

async function uboFactory(): Promise<EngineFactory> {
  const { StaticNetFilteringEngine } = await import('@gorhill/ubo-core')
  return {
    name: 'uBlock Origin',
    note: '@gorhill/ubo-core — uBO\'s own static network filtering engine',
    async prepare() {
      const engine = await StaticNetFilteringEngine.create()
      return {
        async ingest(raw) { await engine.useLists([{ name: 'bench', raw }]) },
        match: r => engine.matchRequest({ url: r.url, originURL: r.sourceUrl, type: uboType[r.type] }) !== 0,
      }
    },
  }
}

// --- Adblock Plus ------------------------------------------------------------

async function abpFactory(): Promise<EngineFactory> {
  const [{ Filter }, { Matcher }, { contentTypes }, { parseURL }] = await Promise.all([
    import('adblockpluscore/lib/filterClasses.js'),
    import('adblockpluscore/lib/matcher.js'),
    import('adblockpluscore/lib/contentTypes.js'),
    import('adblockpluscore/lib/url.js'),
  ])
  const abpType: Record<BenchResourceType, number> = {
    script: contentTypes.SCRIPT,
    image: contentTypes.IMAGE,
    xmlhttprequest: contentTypes.XMLHTTPREQUEST,
    sub_frame: contentTypes.SUBDOCUMENT,
    stylesheet: contentTypes.STYLESHEET,
    font: contentTypes.FONT,
    media: contentTypes.MEDIA,
  }
  return {
    name: 'Adblock Plus',
    note: 'adblockpluscore — ABP\'s Matcher over the parsed filter set',
    async prepare() {
      let matcher: InstanceType<typeof Matcher> | null = null
      return {
        async ingest(raw) {
          const next = new Matcher()
          for (const line of raw.split('\n')) {
            const text = line.trim()
            if (!text || text[0] === '!' || text[0] === '[') continue
            // Skip cosmetic/element-hiding filters — this is the network matcher.
            if (text.includes('##') || text.includes('#@#') || text.includes('#?#') || text.includes('#$#')) continue
            try {
              const filter = Filter.fromText(text)
              if (filter.type === 'blocking' || filter.type === 'allowing') next.add(filter)
            }
            catch {
              // Ignore filters ABP can't parse — same as it would at load time.
            }
          }
          matcher = next
        },
        match: (r) => {
          const filter = matcher!.match(parseURL(r.url), abpType[r.type], hostnameFromUrl(r.sourceUrl))
          return Boolean(filter && filter.type === 'blocking')
        },
      }
    },
  }
}
