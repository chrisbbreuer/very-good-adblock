export type ResourceCategory = 'document' | 'script' | 'image' | 'media' | 'stylesheet' | 'xhr' | 'font' | 'other'

export type BlockSource = 'dnr' | 'cosmetic' | 'youtube' | 'twitch' | 'x' | 'video' | 'manual'

export interface ExtensionSettings {
  enabled: boolean
  badgeEnabled: boolean
  cosmeticFiltering: boolean
  youtubeEnhancements: boolean
  twitchEnhancements: boolean
  xEnhancements: boolean
  allowedSites: string[]
  blockedSites: string[]
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
  dnr: DnrTelemetry
  filters: FilterMetadata
  manifestVersion: string
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
  | { type: 'reset-stats' }
  | { type: 'export-data' }

export interface RuntimeResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}
