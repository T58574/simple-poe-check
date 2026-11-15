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

interface RateRule {
  max: number
  windowSec: number
  penaltySec: number
  timestamps: number[]
  blockedUntil: number
}

class PolicyRateLimiter {
  private readonly policies = new Map<string, RateRule[]>()

  async waitForSlot (policyKey: string): Promise<void> {
    const rules = this.policies.get(policyKey)
    if (!rules || rules.length === 0) return

    const now = Date.now()
    for (const rule of rules) {
      if (rule.blockedUntil > now) {
        const waitSec = Math.ceil((rule.blockedUntil - now) / 1000)
        throw new Error(`PoE Trade rate limit active (${waitSec}s remaining)`)
      }
      const cutoff = now - rule.windowSec * 1000
      rule.timestamps = rule.timestamps.filter((ts) => ts > cutoff)

      if (rule.timestamps.length >= rule.max) {
        const oldest = rule.timestamps[0]
        const waitMs = oldest + rule.windowSec * 1000 - now + 150
        if (waitMs > 10_000) {
          throw new Error(`Rate limit window full, wait ${Math.ceil(waitMs / 1000)}s`)
        }
        if (waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitMs))
        }
      }
    }

    const recordNow = Date.now()
    for (const rule of rules) {
      rule.timestamps.push(recordNow)
    }
  }

  updateFromHeaders (policyKey: string, headers: Headers): void {
    const limitHeader = headers.get('x-rate-limit-ip')
    const stateHeader = headers.get('x-rate-limit-ip-state')
    if (!limitHeader) return

    const parsedLimits = limitHeader.split(',').map((part) => {
      const [max, windowSec, penaltySec] = part.trim().split(':').map(Number)
      return { max, windowSec, penaltySec }
    }).filter((r) => r.max > 0 && r.windowSec > 0)

    const parsedStates = (stateHeader ?? '').split(',').map((part) => {
      const [count, windowSec, activePenalty] = part.trim().split(':').map(Number)
      return { count, windowSec, activePenalty }
    })

    const existing = this.policies.get(policyKey) ?? []
    const now = Date.now()

    const nextRules: RateRule[] = parsedLimits.map((lim, idx) => {
      const prev = existing.find((e) => e.max === lim.max && e.windowSec === lim.windowSec)
      const state = parsedStates[idx]
      const blockedUntil = state && state.activePenalty > 0
        ? now + state.activePenalty * 1000
        : (prev?.blockedUntil ?? 0)

      let timestamps = prev?.timestamps ?? []
      if (state && state.count > timestamps.length) {
        // Sync timestamps up to server-reported count
        const missing = state.count - timestamps.length
        for (let i = 0; i < missing; i++) {
          timestamps.push(now)
        }
      }

      return {
        max: lim.max,
        windowSec: lim.windowSec,
        penaltySec: lim.penaltySec,
        timestamps,
        blockedUntil
      }
    })

    this.policies.set(policyKey, nextRules)
  }
}

export class PoeApiClient {
  private readonly cacheDir: string
  private matcher: StatMatcher | null = null
  private leaguesCache: string[] | null = null
  private ninjaCache = new Map<string, NinjaEntry>()
  private ninjaLoadedLeague = ''
  private ninjaLoadedAt = 0
  private divineChaosRate = 0
  private searchCache = new Map<string, { at: number; result: PriceCheckResult }>()
  private readonly rateLimiter = new PolicyRateLimiter()

  constructor (private readonly getConfig: () => AppConfig) {
    this.cacheDir = path.join(app.getPath('userData'), 'cache')
    fs.mkdirSync(this.cacheDir, { recursive: true })
    this.loadSearchCacheFromDisk()
  }

  async getLeagues (forceRefresh = false): Promise<string[]> {
    const cfg = this.getConfig()
    const cachePath = path.join(this.cacheDir, 'leagues.json')
    const ttlMs = cfg.statsCacheTtlHours * 3600 * 1000

    if (!forceRefresh && this.leaguesCache && this.leaguesCache.length > 0) {
      return this.leaguesCache
    }

    if (!forceRefresh) {
      const cached = this.readCache<string[]>(cachePath, ttlMs)
      if (cached && cached.length > 0) {
        this.leaguesCache = cached
        return cached
      }
    }

    const data = await this.fetchJson<{ result: Array<{ id: string; text: string }> }>(
      `${POE_API_BASE}/data/leagues`
    )
    const leagues = data.result.map((l) => l.id)
    this.leaguesCache = leagues
    this.writeCache(cachePath, leagues)
    return leagues
  }

  clearSearchCache (): void {
    this.searchCache.clear()
    try {
      fs.rmSync(path.join(this.cacheDir, 'trade-search-cache.json'), { force: true })
    } catch {
      // Ignore
    }
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

    const isLocalItem = Boolean(item.weapon || item.armour)
    const matchedMods: MatchedModifier[] = this.matcher
      ? mergeMatchedMods(this.matcher.matchAll(item.modifiers, { isLocalItem }))
      : []

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
    if (item.weapon && item.weapon.totalDps > 0) {
      return this.searchTrade({
        item,
        filters: [],
        useBaseType: false,
        useIlvl: false,
        useLinks: item.maxLinks >= 5,
        weaponFilters: {
          dps: { min: Math.floor(item.weapon.totalDps * 0.9) }
        }
      }, matchedMods)
    }

    const enabledFilters = matchedMods
      .filter((m) => m.enabled && m.statId)
      .slice(0, 3)
      .map((m) => ({
        statId: m.statId!,
        min: m.modifier.values.length > 0 ? Math.floor(m.modifier.values[0] * 0.85) : undefined
      }))

    return this.searchTrade({
      item,
      filters: enabledFilters,
      useBaseType: false,
      useIlvl: false,
      useLinks: item.maxLinks >= 5
    }, matchedMods)
  }

  async searchTrade (
    req: TradeSearchRequest,
    existingMatchedMods?: MatchedModifier[]
  ): Promise<PriceCheckResult> {
    const cfg = this.getConfig()
    const isLocalItem = Boolean(req.item.weapon || req.item.armour)
    const matchedMods =
      existingMatchedMods ??
      (this.matcher ? mergeMatchedMods(this.matcher.matchAll(req.item.modifiers, { isLocalItem })) : [])

    // Merge duplicate statIds (e.g. hybrid % increased Physical Damage mods) by summing mins
    const mergedMap = new Map<string, { min?: number; max?: number }>()
    for (const f of req.filters) {
      const prev = mergedMap.get(f.statId)
      if (!prev) {
        mergedMap.set(f.statId, { min: f.min, max: f.max })
      } else {
        mergedMap.set(f.statId, {
          min: prev.min !== undefined && f.min !== undefined ? prev.min + f.min : (prev.min ?? f.min),
          max: prev.max !== undefined && f.max !== undefined ? prev.max + f.max : (prev.max ?? f.max)
        })
      }
    }

    const statFilters = Array.from(mergedMap.entries()).map(([statId, range]) => ({
      id: statId,
      disabled: false,
      value: range.min !== undefined || range.max !== undefined
        ? { min: range.min, max: range.max }
        : undefined
    }))

    const query: Record<string, unknown> = {
      status: { option: 'available' },
      stats: [{ type: 'and', filters: statFilters }]
    }

    if (req.item.rarity === 'Unique') {
      query.name = req.item.name
      query.type = req.item.baseType
    } else if (req.item.rarity === 'Currency' || req.item.rarity === 'Divination Card') {
      query.type = req.item.baseType
    } else if (req.useBaseType || !req.item.tradeCategory) {
      query.type = req.item.baseType
    }

    const filters: Record<string, unknown> = {}

    if (req.item.tradeCategory && !req.useBaseType && req.item.rarity !== 'Unique') {
      filters.type_filters = {
        filters: {
          category: { option: req.item.tradeCategory }
        }
      }
    }

    if (req.weaponFilters) {
      const wf: Record<string, unknown> = {}
      if (req.weaponFilters.dps) wf.dps = req.weaponFilters.dps
      if (req.weaponFilters.pdps) wf.pdps = req.weaponFilters.pdps
      if (req.weaponFilters.edps) wf.edps = req.weaponFilters.edps
      if (req.weaponFilters.aps) wf.aps = req.weaponFilters.aps
      if (req.weaponFilters.crit) wf.crit = req.weaponFilters.crit
      if (Object.keys(wf).length > 0) {
        filters.weapon_filters = { filters: wf }
      }
    }

    if (req.armourFilters) {
      const af: Record<string, unknown> = {}
      if (req.armourFilters.ar) af.ar = req.armourFilters.ar
      if (req.armourFilters.ev) af.ev = req.armourFilters.ev
      if (req.armourFilters.es) af.es = req.armourFilters.es
      if (Object.keys(af).length > 0) {
        filters.armour_filters = { filters: af }
      }
    }

    if (req.useLinks && req.item.maxLinks >= 5) {
      filters.socket_filters = { filters: { links: { min: req.item.maxLinks } } }
    }

    const miscFilters: Record<string, unknown> = {}
    if (req.useIlvl && req.item.ilvl) {
      miscFilters.ilvl = { min: req.item.ilvl }
    }
    if (req.useCorrupted) {
      miscFilters.corrupted = { option: req.item.corrupted ? 'true' : 'false' }
    }
    if (Object.keys(miscFilters).length > 0) {
      filters.misc_filters = { filters: miscFilters }
    }

    if (Object.keys(filters).length > 0) {
      query.filters = filters
    }

    const tradeTtlMs = (cfg.tradeCacheTtlMinutes ?? 5) * 60 * 1000
    const cacheKey = JSON.stringify({ league: cfg.league, query })
    const cachedSearch = this.searchCache.get(cacheKey)
    if (cachedSearch && Date.now() - cachedSearch.at < tradeTtlMs) {
      return { ...cachedSearch.result, item: req.item, matchedMods }
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
        const emptyRes: PriceCheckResult = {
          source: 'trade',
          item: req.item,
          totalResults: 0,
          tradeUrl,
          listings: [],
          matchedMods
        }
        this.saveSearchEntry(cacheKey, emptyRes)
        return emptyRes
      }

      const fetchRes = await this.fetchJson<{
        result: Array<{
          listing?: {
            indexed?: string
            fee?: number
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
          indexed: entry.listing?.indexed ?? '',
          isInstantBuyout: entry.listing?.fee != null
        })
      }

      const out: PriceCheckResult = {
        source: 'trade',
        item: req.item,
        totalResults: searchRes.total,
        tradeUrl,
        listings,
        matchedMods
      }
      this.saveSearchEntry(cacheKey, out)
      return out
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

  private async fetchJson<T> (url: string, init?: RequestInit, retried = false): Promise<T> {
    const cfg = this.getConfig()
    const policyKey = url.includes('/api/trade/search/')
      ? 'trade-search'
      : url.includes('/api/trade/fetch/')
        ? 'trade-fetch'
        : ''

    if (policyKey) {
      await this.rateLimiter.waitForSlot(policyKey)
    }

    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(cfg.requestTimeoutMs),
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        ...(init?.headers ?? {})
      }
    })

    if (policyKey) {
      this.rateLimiter.updateFromHeaders(policyKey, res.headers)
    }

    if (res.status === 429) {
      const retryAfter = Number.parseInt(res.headers.get('retry-after') ?? '0', 10) || 2
      if (!retried && retryAfter <= 5) {
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000))
        return this.fetchJson<T>(url, init, true)
      }
      throw new Error(`Rate limited by PoE Trade API (retry in ${retryAfter}s)`)
    }
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

  private saveSearchEntry (key: string, result: PriceCheckResult): void {
    this.searchCache.set(key, { at: Date.now(), result })
    // Keep up to 100 most recent cached scans on disk
    if (this.searchCache.size > 100) {
      const oldestKey = this.searchCache.keys().next().value
      if (oldestKey) this.searchCache.delete(oldestKey)
    }
    try {
      const entries = Array.from(this.searchCache.entries())
      fs.writeFileSync(
        path.join(this.cacheDir, 'trade-search-cache.json'),
        JSON.stringify(entries),
        'utf8'
      )
    } catch {
      // Ignore cache write errors
    }
  }

  private loadSearchCacheFromDisk (): void {
    try {
      const raw = fs.readFileSync(path.join(this.cacheDir, 'trade-search-cache.json'), 'utf8')
      const entries = JSON.parse(raw) as Array<[string, { at: number; result: PriceCheckResult }]>
      const ttlMs = (this.getConfig().tradeCacheTtlMinutes ?? 5) * 60 * 1000
      const now = Date.now()
      for (const [k, v] of entries) {
        if (now - v.at < ttlMs) {
          this.searchCache.set(k, v)
        }
      }
    } catch {
      // No cache yet
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

function mergeMatchedMods (mods: MatchedModifier[]): MatchedModifier[] {
  const out: MatchedModifier[] = []
  const byStatAndKind = new Map<string, number>()

  for (const mod of mods) {
    if (!mod.statId || mod.modifier.values.length !== 1) {
      out.push(mod)
      continue
    }
    const key = `${mod.statId}::${mod.modifier.kind}`
    const existingIdx = byStatAndKind.get(key)
    if (existingIdx === undefined) {
      byStatAndKind.set(key, out.length)
      out.push(mod)
      continue
    }

    const existing = out[existingIdx]
    const summed = existing.modifier.values[0] + mod.modifier.values[0]
    const updatedDisplay = existing.modifier.template.replace(/\+?#/g, (m) =>
      m.startsWith('+') ? `+${summed}` : String(summed)
    )
    out[existingIdx] = {
      ...existing,
      modifier: {
        ...existing.modifier,
        display: updatedDisplay,
        values: [summed],
        tier: existing.modifier.tier ?? mod.modifier.tier
      }
    }
  }

  return out
}
