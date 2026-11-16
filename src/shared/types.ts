export type ItemRarity =
  | 'Normal'
  | 'Magic'
  | 'Rare'
  | 'Unique'
  | 'Currency'
  | 'Gem'
  | 'Divination Card'
  | 'Unknown'

export type ModifierKind = 'implicit' | 'explicit' | 'crafted' | 'fractured' | 'enchant' | 'pseudo'

export type TradeStatusOption = 'available' | 'securable' | 'online' | 'any'

export interface ItemModifier {
  raw: string
  display: string
  template: string
  values: number[]
  kind: ModifierKind
  tier?: number
}

export interface WeaponStats {
  physicalDps: number
  elementalDps: number
  totalDps: number
  aps: number
  crit: number
  q20PhysicalDps?: number
  q20TotalDps?: number
}

export interface ArmourStats {
  armour: number
  evasion: number
  energyShield: number
  ward: number
  q20Armour?: number
  q20Evasion?: number
  q20EnergyShield?: number
}

export interface ParsedItem {
  rawText: string
  itemClass: string
  tradeCategory: string | null
  rarity: ItemRarity
  name: string
  baseType: string
  ilvl: number | null
  quality: number | null
  stackSize: number | null
  sockets?: number
  socketColors?: { r: number; g: number; b: number; w: number }
  maxLinks: number
  corrupted: boolean
  synthesised: boolean
  fractured: boolean
  unidentified?: boolean
  mirrored?: boolean
  split?: boolean
  influences?: string[]
  gemLevel?: number
  mapTier?: number
  blighted?: boolean
  weapon?: WeaponStats
  armour?: ArmourStats
  modifiers: ItemModifier[]
}

export interface StatEntry {
  id: string
  text: string
  type: string
}

export interface MatchedModifier {
  modifier: ItemModifier
  statId: string | null
  statText: string | null
  enabled: boolean
}

export interface PriceListing {
  amount: number
  currency: string
  chaosAmount?: number
  accountName: string
  indexed: string
  isInstantBuyout: boolean
}

export interface PriceSummary {
  minChaos: number
  medianChaos: number
  minDivine?: number
  medianDivine?: number
  instantCount: number
}

export interface RateLimitStatus {
  remaining: number
  max: number
  windowSec: number
  blockedUntil: number
}

export interface RateLimitOverview {
  trade?: RateLimitStatus
  stash?: RateLimitStatus
  stashCooldownUntil?: number
}

export interface PriceCheckResult {
  source: 'ninja' | 'trade'
  item: ParsedItem
  chaosValue?: number
  divineValue?: number
  ninjaAmbiguous?: boolean
  ninjaVariantNote?: string
  totalResults?: number
  tradeUrl?: string
  listings: PriceListing[]
  summary?: PriceSummary
  matchedMods: MatchedModifier[]
  rateLimit?: RateLimitStatus
  error?: string
}

export interface NumericRange {
  min?: number
  max?: number
}

export interface TradeSearchModFilter {
  statId: string
  min?: number
  max?: number
}

export interface TradeSearchRequest {
  item: ParsedItem
  filters: TradeSearchModFilter[]
  status?: TradeStatusOption
  useBaseType?: boolean
  useIlvl?: boolean
  useLinks?: boolean
  useCorrupted?: boolean
  useQuality?: boolean
  weaponFilters?: {
    dps?: NumericRange
    pdps?: NumericRange
    edps?: NumericRange
    aps?: NumericRange
    crit?: NumericRange
  }
  armourFilters?: {
    ar?: NumericRange
    ev?: NumericRange
    es?: NumericRange
  }
  socketFilters?: {
    socketsMin?: number
    linksMin?: number
    r?: number
    g?: number
    b?: number
    w?: number
  }
}

export interface ChatMacro {
  id: string
  label: string
  hotkey: string
  command: string
  send: boolean
}

export const DEFAULT_CHAT_MACROS: ChatMacro[] = [
  { id: 'hideout', label: 'Hideout', hotkey: 'F5', command: '/hideout', send: true },
  { id: 'kingsmarch', label: 'Kingsmarch', hotkey: 'F6', command: '/kingsmarch', send: true },
  { id: 'leave', label: 'Leave Party', hotkey: 'F9', command: '/leave', send: true },
  { id: 'whisper-last', label: 'Whisper Last', hotkey: 'F7', command: '@last ', send: false }
]

export interface AppConfig {
  league: string
  leagueInitialized?: boolean
  firstRunShown?: boolean
  realm: 'pc'
  gameWindowTitle: string
  priceCheckHotkey: string
  toggleAppHotkey: string
  hideoutHotkey: string
  closeHotkey: string
  chatMacros: ChatMacro[]
  tradeStatus: TradeStatusOption
  poeSessId: string
  accountName: string
  selectedStashTabIds: string[]
  minItemChaos: number
  bulkMinChaos: number
  autoSearchOnFilterChange: boolean
  restoreClipboard: boolean
  ninjaCacheTtlMinutes: number
  statsCacheTtlHours: number
  tradeCacheTtlMinutes: number
  requestTimeoutMs: number
  overlayWidth: number
  overlayMaxHeight: number
}

export const DEFAULT_CONFIG: AppConfig = {
  league: 'Standard',
  leagueInitialized: false,
  firstRunShown: false,
  realm: 'pc',
  gameWindowTitle: 'Path of Exile',
  priceCheckHotkey: 'Ctrl+D',
  toggleAppHotkey: 'Ctrl+Space',
  hideoutHotkey: 'F5',
  closeHotkey: 'Escape',
  chatMacros: DEFAULT_CHAT_MACROS,
  tradeStatus: 'available',
  poeSessId: '',
  accountName: '',
  selectedStashTabIds: [],
  minItemChaos: 1,
  bulkMinChaos: 10,
  autoSearchOnFilterChange: false,
  restoreClipboard: true,
  ninjaCacheTtlMinutes: 60,
  statsCacheTtlHours: 24,
  tradeCacheTtlMinutes: 5,
  requestTimeoutMs: 8000,
  overlayWidth: 440,
  overlayMaxHeight: 620
}

export interface StashTabInfo {
  id: string
  name: string
  index: number
  type: string
  colour?: { r: number; g: number; b: number }
}

export interface PricedStashItem {
  id: string
  key: string
  name: string
  baseType: string
  typeLine: string
  icon: string
  stackSize: number
  unitChaos: number
  totalChaos: number
  tabId: string
  tabName: string
  category: string
  rarity: ItemRarity
  frameType: number
  links: number
  corrupted: boolean
}

export interface StashSnapshot {
  id: string
  league: string
  createdAt: number
  totalChaos: number
  totalDivine: number
  divineRate: number
  tabs: Array<{ id: string; name: string; totalChaos: number; itemCount: number }>
  items: PricedStashItem[]
}

export interface SnapshotDiffItem {
  key: string
  name: string
  icon: string
  category: string
  deltaQty: number
  deltaChaos: number
  currentQty: number
  unitChaos: number
}

export interface FarmSessionSummary {
  startedAt: number
  endedAt: number
  durationMin: number
  deltaChaos: number
  deltaDivine: number
  chaosPerHour: number
  divinePerHour: number
  topGains: SnapshotDiffItem[]
}

export interface BulkListingItem {
  key: string
  name: string
  icon: string
  category: string
  quantity: number
  unitChaos: number
  totalChaos: number
  tabs: string[]
}

export interface StashAuthStatus {
  authenticated: boolean
  accountName: string
  hasSessId: boolean
}

export interface OverlayStatePayload {
  visible: boolean
  mode?: 'price-check' | 'app' | 'settings'
  x?: number
  y?: number
}

export interface UpdateCheckResult {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  releaseUrl: string
  error?: string
}

export const IPC_CHANNELS = {
  PRICE_CHECK_RESULT: 'price-check:result',
  PRICE_CHECK_LOADING: 'price-check:loading',
  OVERLAY_STATE: 'overlay:state',
  SEARCH_TRADE: 'trade:search',
  HIDE_OVERLAY: 'overlay:hide',
  OPEN_EXTERNAL: 'shell:open-external',
  GET_CONFIG: 'config:get',
  SAVE_CONFIG: 'config:save',
  GET_LEAGUES: 'leagues:get',
  REFRESH_CACHE: 'cache:refresh',
  RATE_LIMIT_STATUS: 'rate-limit:status',
  STASH_AUTH_LOGIN: 'stash:auth-login',
  STASH_AUTH_LOGOUT: 'stash:auth-logout',
  STASH_AUTH_STATUS: 'stash:auth-status',
  STASH_GET_TABS: 'stash:get-tabs',
  STASH_TAKE_SNAPSHOT: 'stash:take-snapshot',
  STASH_GET_SNAPSHOTS: 'stash:get-snapshots',
  STASH_DELETE_SNAPSHOT: 'stash:delete-snapshot',
  STASH_POP_OUT: 'stash:pop-out',
  GET_APP_VERSION: 'app:get-version',
  CHECK_UPDATES: 'app:check-updates'
} as const
