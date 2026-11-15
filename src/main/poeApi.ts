import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { StatMatcher } from '../shared/statMatcher'
import type {
  AppConfig,
  MatchedModifier,
  ParsedItem,
  PriceCheckResult,
  PriceListing,
  StatEntry,
  TradeSearchRequest
} from '../shared/types'

const USER_AGENT = 'SimplePoeCheck/0.1.0 (local desktop overlay)'
const POE_API_BASE = 'https://www.pathofexile.com/api/trade'
const NINJA_API_BASE = 'https://poe.ninja/api/data'

interface NinjaEntry {
  name: string
  chaosValue: number
  divineValue?: number
}

interface CacheFile<T> {
  updatedAt: number
  data: T
}

export class PoeApiClient {
  private readonly cacheDir: string
  private matcher: StatMatcher | null = null
  private ninjaCache = new Map<string, NinjaEntry>()
  private ninjaLoadedLeague = ''
  private ninjaLoadedAt = 0
  private divineChaosRate = 0

  constructor (private readonly getConfig: () => AppConfig) {
    this.cacheDir = path.join(app.getPath('userData'), 'cache')
    fs.mkdirSync(this.cacheDir, { recursive: true })
  }

  async getLeagues (): Promise<string[]> {
    const data = await this.fetchJson<{ result: Array<{ id: string; text: string }> }>(
      `${POE_API_BASE}/data/leagues`
    )
    return data.result.map((l) => l.id)
  }

  async ensureStatsLoaded (forceRefresh = false): Promise<StatMatcher> {
    const cfg = this.getConfig()
    const cachePath = path.join(this.cacheDir, 'stats.json')
    const ttlMs = cfg.statsCacheTtlHours * 3600 * 1000

    if (!forceRefresh && this.matcher) {
      return this.matcher
    }

    if (!forceRefresh) {
      const cached = this.readCache<StatEntry[]>(cachePath, ttlMs)
      if (cached) {
        this.matcher = new StatMatcher(cached)
        return this.matcher
      }
    }

    const raw = await this.fetchJson<{
      result: Array<{
        id: string
        label: string
        entries: Array<{ id: string; text: string; type: string }>
      }>
    }>(`${POE_API_BASE}/data/stats`)

    const flat: StatEntry[] = []
    for (const group of raw.result) {
      for (const entry of group.entries) {
        flat.push({ id: entry.id, text: entry.text, type: entry.type })
      }
    }

    this.writeCache(cachePath, flat)
    this.matcher = new StatMatcher(flat)
    return this.matcher
  }

  async ensureNinjaLoaded (forceRefresh = false): Promise<void> {
    const cfg = this.getConfig()
    const ttlMs = cfg.ninjaCacheTtlMinutes * 60 * 1000
    const now = Date.now()

    if (
      !forceRefresh &&
      this.ninjaLoadedLeague === cfg.league &&
      now - this.ninjaLoadedAt < ttlMs &&
      this.ninjaCache.size > 0
    ) {
      return
    }

    const cachePath = path.join(this.cacheDir, `ninja-${sanitizeFilename(cfg.league)}.json`)
    if (!forceRefresh) {
      const cached = this.readCache<{ entries: Array<[string, NinjaEntry]>; divineChaosRate: number }>(
        cachePath,
        ttlMs
      )
      if (cached) {
        this.ninjaCache = new Map(cached.entries)
        this.divineChaosRate = cached.divineChaosRate
        this.ninjaLoadedLeague = cfg.league
        this.ninjaLoadedAt = now
        return
      }
    }

    const map = new Map<string, NinjaEntry>()
    let divRate = 0

    // Currency & Fragments
    for (const type of ['Currency', 'Fragment']) {
      try {
        const res = await this.fetchJson<{
          lines: Array<{ currencyTypeName: string; chaosEquivalent: number }>
        }>(`${NINJA_API_BASE}/currencyoverview?league=${encodeURIComponent(cfg.league)}&type=${type}`)
        for (const line of res.lines) {
          if (line.currencyTypeName === 'Divine Orb') {
            divRate = line.chaosEquivalent
          }
          map.set(line.currencyTypeName.toLowerCase(), {
            name: line.currencyTypeName,
            chaosValue: line.chaosEquivalent
          })
        }
      } catch {
        // Ignore individual ninja category failures
      }
    }

    // Items (Uniques, Divination Cards, Scarabs, Maps, Skill Gems)
    const itemTypes = [
      'UniqueWeapon',
      'UniqueArmour',
      'UniqueAccessory',
      'UniqueFlask',
      'UniqueJewel',
      'DivinationCard',
      'Scarab',
      'SkillGem',
      'Map'
    ]
    await Promise.all(
      itemTypes.map(async (type) => {
        try {
          const res = await this.fetchJson<{
            lines: Array<{ name: string; chaosValue: number; divineValue?: number }>
          }>(`${NINJA_API_BASE}/itemoverview?league=${encodeURIComponent(cfg.league)}&type=${type}`)
          for (const line of res.lines) {
            const key = line.name.toLowerCase()
            if (!map.has(key)) {
              map.set(key, {
                name: line.name,
                chaosValue: line.chaosValue,
                divineValue: line.divineValue
              })
            }
          }
        } catch {
          // Ignore individual ninja category failures
        }
      })
    )

    this.ninjaCache = map
    this.divineChaosRate = divRate
    this.ninjaLoadedLeague = cfg.league
    this.ninjaLoadedAt = now
    this.writeCache(cachePath, { entries: Array.from(map.entries()), divineChaosRate: divRate })
  }

  async checkItem (item: ParsedItem): Promise<PriceCheckResult> {
    try {
      await Promise.all([this.ensureStatsLoaded(), this.ensureNinjaLoaded()])
    } catch (err) {
      return {
        source: 'ninja',
        item,
        listings: [],
        matchedMods: [],
        error: `Failed to sync PoE data: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    const matchedMods: MatchedModifier[] = this.matcher ? this.matcher.matchAll(item.modifiers) : []

    // Fast path via poe.ninja for Currency, Divination Card, Unique, Gem
    if (
      item.rarity === 'Currency' ||
      item.rarity === 'Divination Card' ||
      item.rarity === 'Unique' ||
      item.rarity === 'Gem'
    ) {
      const lookupName = item.name.toLowerCase()
      const ninjaHit = this.ninjaCache.get(lookupName) ?? this.ninjaCache.get(item.baseType.toLowerCase())
      if (ninjaHit) {
        const divineValue =
          ninjaHit.divineValue ??
          (this.divineChaosRate > 0 ? Number((ninjaHit.chaosValue / this.divineChaosRate).toFixed(2)) : undefined)
        return {
          source: 'ninja',
          item,
          chaosValue: Number(ninjaHit.chaosValue.toFixed(1)),
          divineValue,
          listings: [],
          matchedMods
        }
      }
    }

    // Trade API search for Rare / Magic / Normal / unmatched items
    const enabledFilters = matchedMods
      .filter((m) => m.enabled && m.statId)
      .slice(0, 6)
      .map((m) => ({
        statId: m.statId!,
        min: m.modifier.values.length > 0 ? Math.floor(m.modifier.values[0] * 0.85) : undefined
      }))

    return this.searchTrade({
      item,
      filters: enabledFilters,
      useIlvl: false,
      useLinks: item.maxLinks >= 5
    }, matchedMods)
  }

  async searchTrade (
    req: TradeSearchRequest,
    existingMatchedMods?: MatchedModifier[]
  ): Promise<PriceCheckResult> {
    const cfg = this.getConfig()
    const matchedMods =
      existingMatchedMods ?? (this.matcher ? this.matcher.matchAll(req.item.modifiers) : [])

    const statFilters = req.filters.map((f) => ({
      id: f.statId,
      disabled: false,
      value: f.min !== undefined || f.max !== undefined
        ? { min: f.min, max: f.max }
        : undefined
    }))

    const query: Record<string, unknown> = {
      status: { option: 'online' },
      stats: [{ type: 'and', filters: statFilters }]
    }

    if (req.item.rarity === 'Unique') {
      query.name = req.item.name
      query.type = req.item.baseType
    } else if (req.item.rarity === 'Currency' || req.item.rarity === 'Divination Card') {
      query.type = req.item.baseType
    } else {
      query.type = req.item.baseType
    }

    const filters: Record<string, unknown> = {}
    if (req.useLinks && req.item.maxLinks >= 5) {
      filters.socket_filters = { filters: { links: { min: req.item.maxLinks } } }
    }
    if (req.useIlvl && req.item.ilvl) {
      filters.misc_filters = { filters: { ilvl: { min: req.item.ilvl } } }
    }
    if (Object.keys(filters).length > 0) {
      query.filters = filters
    }

    try {
      const searchRes = await this.fetchJson<{
        id: string
        result: string[]
        total: number
      }>(`${POE_API_BASE}/search/${encodeURIComponent(cfg.league)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, sort: { price: 'asc' } })
      })

      const tradeUrl = `https://www.pathofexile.com/trade/search/${encodeURIComponent(cfg.league)}/${searchRes.id}`
      const ids = searchRes.result.slice(0, 10)
      if (ids.length === 0) {
        return {
          source: 'trade',
          item: req.item,
          totalResults: 0,
          tradeUrl,
          listings: [],
          matchedMods
        }
      }

      const fetchRes = await this.fetchJson<{
        result: Array<{
          listing?: {
            indexed?: string
            account?: { name?: string }
            price?: { amount?: number; currency?: string }
          }
        }>
      }>(`${POE_API_BASE}/fetch/${ids.join(',')}?query=${searchRes.id}`)

      const listings: PriceListing[] = []
      for (const entry of fetchRes.result) {
        const price = entry.listing?.price
        if (!price || price.amount === undefined || !price.currency) continue
        listings.push({
          amount: price.amount,
          currency: price.currency,
          accountName: entry.listing?.account?.name ?? 'unknown',
          indexed: entry.listing?.indexed ?? ''
        })
      }

      return {
        source: 'trade',
        item: req.item,
        totalResults: searchRes.total,
        tradeUrl,
        listings,
        matchedMods
      }
    } catch (err) {
      return {
        source: 'trade',
        item: req.item,
        listings: [],
        matchedMods,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  private async fetchJson<T> (url: string, init?: RequestInit): Promise<T> {
    const cfg = this.getConfig()
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(cfg.requestTimeoutMs),
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        ...(init?.headers ?? {})
      }
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} (${url}): ${body.slice(0, 140)}`)
    }
    return (await res.json()) as T
  }

  private readCache<T> (filePath: string, ttlMs: number): T | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf8')
      const parsed = JSON.parse(raw) as CacheFile<T>
      if (Date.now() - parsed.updatedAt <= ttlMs) {
        return parsed.data
      }
      return null
    } catch {
      return null
    }
  }

  private writeCache<T> (filePath: string, data: T): void {
    try {
      const payload: CacheFile<T> = { updatedAt: Date.now(), data }
      fs.writeFileSync(filePath, JSON.stringify(payload), 'utf8')
    } catch {
      // Ignore cache write errors
    }
  }
}

function sanitizeFilename (name: string): string {
  return name.replace(/[^a-z0-9_-]/gi, '_')
}
