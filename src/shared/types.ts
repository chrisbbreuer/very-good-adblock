export type ResourceCategory = 'document' | 'script' | 'image' | 'media' | 'stylesheet' | 'xhr' | 'font' | 'other'

export type BlockSource = 'dnr' | 'twitch' | 'video' | 'manual' | 'cosmetic' | 'youtube' | 'x' | 'consent'

export interface ExtensionSettings {
  enabled: boolean
  badgeEnabled: boolean
  cosmeticFiltering: boolean
  aggressiveCosmetic: boolean
  cookieConsentFiltering: boolean
  youtubeEnhancements: boolean
  twitchEnhancements: boolean
  allowedSites: string[]
  blockedSites: string[]
  /** When set and in the future, protection is paused until this time (ms epoch). */
  resumeAt?: number
}

export interface LifetimeStats {
  adsBlocked: number
  bytesSaved: number
  videoSecondsSaved: number
  since: string
  lastUpdated: string
}

export interface StatBucket {
  key: string
  adsBlocked: number
  bytesSaved: number
  videoSecondsSaved: number
}

export interface SiteStats {
  hostname: string
  adsBlocked: number
  bytesSaved: number
  videoSecondsSaved: number
  lastBlockedAt: string
}

export interface BlockEvent {
  hostname: string
  source: BlockSource
  category: ResourceCategory
  count: number
  bytesSaved?: number
  videoSecondsSaved?: number
  occurredAt: string
}

export interface LocalStats {
  hourly: StatBucket[]
  daily: StatBucket[]
  sites: Record<string, SiteStats>
  recentEvents: BlockEvent[]
}

export interface CloudStatsSnapshot {
  schemaVersion: 1
  lifetime: LifetimeStats
  daily: StatBucket[]
  sites: SiteStats[]
  syncedAt: string
}

export interface CloudSyncState {
  available: boolean
  syncedAt?: string
  dailyBuckets: number
  siteRollups: number
}

export interface DashboardState {
  settings: ExtensionSettings
  lifetime: LifetimeStats
  local: LocalStats
  cloudSync: CloudSyncState
  activeTab?: ActiveTabState
  activePage: ActivePageStats
  dnr: DnrTelemetry
  cosmetic: CosmeticTelemetry
  filters: FilterMetadata
  manifestVersion: string
}

export interface CosmeticSelectorHit {
  selector: string
  count: number
}

export interface CosmeticTelemetry {
  enabled: boolean
  aggressive: boolean
  activeTabHidden: number
  activeTabSelectors: CosmeticSelectorHit[]
}

export interface DnrTelemetry {
  available: boolean
  recentMatchedRules: number
  activeTabMatchedRules: number
  rulesetHits: Record<string, number>
  checkedAt: string
  reason?: string
}

export interface FilterMetadata {
  staticRuleCount: number
  generatedHostRules: number
  sources: Array<{
    name: string
    revision: string
    hosts: number
    sha256: string
  }>
}

/**
 * Live counts for the current tab's *most recent page visit* (reset on
 * navigation), as opposed to the cumulative per-site totals in `SiteStats`.
 */
export interface ActivePageStats {
  /** network + content, the number surfaced on the toolbar badge. */
  blocked: number
  /** declarativeNetRequest matches on this page load. */
  network: number
  /** Cosmetic hides + video skips reported by the content script. */
  content: number
}

export interface ActiveTabState {
  tabId?: number
  hostname: string
  url: string
  allowed: boolean
  blocked: boolean
}

export type RuntimeMessage =
  | { type: 'get-dashboard' }
  | { type: 'set-settings', settings: Partial<ExtensionSettings> }
  | { type: 'toggle-site', hostname: string, allowed: boolean }
  | { type: 'record-blocks', events: BlockEvent[] }
  | { type: 'record-cosmetic', hostname: string, hits: CosmeticSelectorHit[] }
  | { type: 'reset-stats' }
  | { type: 'refresh-filters' }
  | { type: 'pause-protection', minutes: number }
  | { type: 'export-data' }

export interface RuntimeResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}
