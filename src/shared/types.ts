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
  template: string
  values: number[]
  kind: ModifierKind
}

export interface ParsedItem {
  rawText: string
  itemClass: string
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

export interface TradeSearchModFilter {
  statId: string
  min?: number
  max?: number
}

export interface TradeSearchRequest {
  item: ParsedItem
  filters: TradeSearchModFilter[]
  useIlvl?: boolean
  useLinks?: boolean
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
  overlayWidth: 420,
  overlayMaxHeight: 560
}

export const IPC_CHANNELS = {
  PRICE_CHECK_RESULT: 'price-check:result',
  PRICE_CHECK_LOADING: 'price-check:loading',
  SEARCH_TRADE: 'trade:search',
  HIDE_OVERLAY: 'overlay:hide',
  GET_CONFIG: 'config:get',
  SAVE_CONFIG: 'config:save',
  GET_LEAGUES: 'leagues:get',
  REFRESH_CACHE: 'cache:refresh'
} as const
