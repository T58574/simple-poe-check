export type ItemRarity =
  | 'Normal'
  | 'Magic'
  | 'Rare'
  | 'Unique'
  | 'Currency'
  | 'Gem'
  | 'Divination Card'
  | 'Unknown'

export type ModifierKind = 'implicit' | 'explicit' | 'crafted' | 'fractured' | 'enchant'

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
}

export interface ArmourStats {
  armour: number
  evasion: number
  energyShield: number
  ward: number
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
  maxLinks: number
  corrupted: boolean
  synthesised: boolean
  fractured: boolean
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
  accountName: string
  indexed: string
}

export interface PriceCheckResult {
  source: 'ninja' | 'trade'
  item: ParsedItem
  chaosValue?: number
  divineValue?: number
  totalResults?: number
  tradeUrl?: string
  listings: PriceListing[]
  matchedMods: MatchedModifier[]
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
  useBaseType?: boolean
  useIlvl?: boolean
  useLinks?: boolean
  useCorrupted?: boolean
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
}

export interface AppConfig {
  league: string
  realm: 'pc'
  gameWindowTitle: string
  priceCheckHotkey: string
  hideoutHotkey: string
  closeHotkey: string
  ninjaCacheTtlMinutes: number
  statsCacheTtlHours: number
  requestTimeoutMs: number
  overlayWidth: number
  overlayMaxHeight: number
}

export const DEFAULT_CONFIG: AppConfig = {
  league: 'Standard',
  realm: 'pc',
  gameWindowTitle: 'Path of Exile',
  priceCheckHotkey: 'Ctrl+D',
  hideoutHotkey: 'F5',
  closeHotkey: 'Escape',
  ninjaCacheTtlMinutes: 30,
  statsCacheTtlHours: 24,
  requestTimeoutMs: 8000,
  overlayWidth: 440,
  overlayMaxHeight: 620
}

export interface OverlayStatePayload {
  visible: boolean
  mode?: 'price-check' | 'settings'
  x?: number
  y?: number
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
  REFRESH_CACHE: 'cache:refresh'
} as const
