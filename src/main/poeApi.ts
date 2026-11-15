import { app, net } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { normalizeModTemplate } from '../shared/itemParser'
import { calcDefaultMinFilter, StatMatcher } from '../shared/statMatcher'
import { classifyStashItem, type RawStashItem } from '../shared/stashValuation'
import type {
  AppConfig,
  MatchedModifier,
  ParsedItem,
  PriceCheckResult,
  PriceListing,
  PriceSummary,
  RateLimitStatus,
  StatEntry,
  TradeSearchRequest
} from '../shared/types'

const USER_AGENT = 'SimplePoeCheck/0.2.0 (desktop overlay)'
const POE_API_BASE = 'https://www.pathofexile.com/api/trade'
const NINJA_EXCHANGE_BASE = 'https://poe.ninja/poe1/api/economy/exchange/current/overview'
const NINJA_STASH_ITEM_BASE = 'https://poe.ninja/poe1/api/economy/stash/current/item/overview'

const TRADE_CURRENCY_TO_NAME: Record<string, string> = {
  chaos: 'chaos orb',
  divine: 'divine orb',
  exalted: 'exalted orb',
  mirror: 'mirror of kalandra',
  alch: 'orb of alchemy',
  vaal: 'vaal orb',
  fusing: 'orb of fusing',
  jewellers: "jeweller's orb",
  chrom: 'chromatic orb',
  alt: 'orb of alteration',
  scour: 'orb of scouring',
  regret: 'orb of regret',
  regal: 'regal orb',
  gcp: "gemcutter's prism",
  chisel: "cartographer's chisel",
  blessed: 'blessed orb',
  chance: 'orb of chance',
  annul: 'orb of annulment',
  ancient: 'ancient orb',
  stacked_deck: 'stacked deck'
}

interface NinjaEntry {
  name: string
  chaosValue: number
  divineValue?: number
  links?: number
  gemLevel?: number
  gemQuality?: number
  corrupted?: boolean
  mapTier?: number
  variantCount?: number
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
  private readonly queues = new Map<string, Promise<void>>()

  async acquire (policyKey: string): Promise<void> {
    const prev = this.queues.get(policyKey) ?? Promise.resolve()
    let release!: () => void
    const next = new Promise<void>((resolve) => {
      release = resolve
    })
    this.queues.set(policyKey, next)
    await prev
    try {
      await this.waitForSlot(policyKey)
    } finally {
      release()
    }
  }

  private async waitForSlot (policyKey: string): Promise<void> {
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
    const limitHeader = headers.get('x-rate-limit-ip') ?? headers.get('x-rate-limit-account')
    const stateHeader = headers.get('x-rate-limit-ip-state') ?? headers.get('x-rate-limit-account-state')
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
        : 0

      let timestamps = (prev?.timestamps ?? []).filter((ts) => ts > now - lim.windowSec * 1000)
      if (state) {
        if (state.count === 0) {
          timestamps = []
        } else if (state.count < timestamps.length) {
          timestamps = timestamps.slice(timestamps.length - state.count)
        } else if (state.count > timestamps.length) {
          const missing = state.count - timestamps.length
          for (let i = 0; i < missing; i++) {
            timestamps.push(now)
          }
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

  getStatus (policyKey: string): RateLimitStatus | undefined {
    const rules = this.policies.get(policyKey)
    if (!rules || rules.length === 0) return undefined
    const now = Date.now()
    let tightest: RateLimitStatus | undefined
    for (const r of rules) {
      const active = r.timestamps.filter((ts) => ts > now - r.windowSec * 1000).length
      const remaining = Math.max(0, r.max - active)
      if (!tightest || remaining < tightest.remaining) {
        tightest = {
          remaining,
          max: r.max,
          windowSec: r.windowSec,
          blockedUntil: r.blockedUntil > now ? r.blockedUntil : 0
        }
      }
    }
    return tightest
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

    const cachePath = path.join(this.cacheDir, `ninja-v4-${sanitizeFilename(cfg.league)}.json`)
    if (!forceRefresh) {
      const cached = this.readCache<{ entries: Array<[string, NinjaEntry]>; divineChaosRate: number }>(
        cachePath,
        ttlMs
      )
      if (cached && cached.entries.length > 0) {
        this.ninjaCache = new Map(cached.entries)
        this.divineChaosRate = cached.divineChaosRate
        this.ninjaLoadedLeague = cfg.league
        this.ninjaLoadedAt = now
        return
      }
    }

    const map = new Map<string, NinjaEntry>()
    let divRate = 0

    // Exchange categories (Currency, Fragments, Scarabs, Essences, Oils, Fossils, etc.)
    const exchangeTypes = [
      'Currency',
      'Fragment',
      'Essence',
      'Oil',
      'Fossil',
      'Resonator',
      'Catalyst',
      'DeliriumOrb',
      'Incubator',
      'Tattoo',
      'Omen',
      'Artifact',
      'Vial',
      'AllflameEmber',
      'Runegraft'
    ]
    await Promise.all(
      exchangeTypes.map(async (type) => {
        try {
          const res = await this.fetchJson<{
            core?: { rates?: { divine?: number } }
            items?: Array<{ id: string; name: string }>
            lines?: Array<{ id: string; primaryValue: number }>
          }>(`${NINJA_EXCHANGE_BASE}?league=${encodeURIComponent(cfg.league)}&type=${type}`)

          const idToName = new Map<string, string>()
          for (const it of res.items ?? []) {
            idToName.set(it.id, it.name)
          }

          if (divRate === 0 && res.core?.rates?.divine && res.core.rates.divine > 0) {
            divRate = Number((1 / res.core.rates.divine).toFixed(2))
          }

          for (const line of res.lines ?? []) {
            const name = idToName.get(line.id) ?? line.id
            const key = name.toLowerCase()
            if (line.id === 'divine' || key === 'divine orb') {
              divRate = line.primaryValue
            }
            if (!map.has(key)) {
              map.set(key, {
                name,
                chaosValue: line.primaryValue
              })
            }
          }
        } catch {
          // Ignore individual exchange category failures
        }
      })
    )

    // Stash Items (Beasts, Scarabs, Uniques, Divination Cards, Skill Gems, Maps)
    const itemTypes = [
      'Beast',
      'Scarab',
      'UniqueWeapon',
      'UniqueArmour',
      'UniqueAccessory',
      'UniqueFlask',
      'UniqueJewel',
      'UniqueMap',
      'UniqueRelic',
      'DivinationCard',
      'SkillGem',
      'Map',
      'BlightedMap',
      'BlightRavagedMap'
    ]
    await Promise.all(
      itemTypes.map(async (type) => {
        try {
          const res = await this.fetchJson<{
            lines: Array<{
              name: string
              chaosValue: number
              divineValue?: number
              links?: number
              gemLevel?: number
              gemQuality?: number
              corrupted?: boolean
              mapTier?: number
            }>
          }>(`${NINJA_STASH_ITEM_BASE}?league=${encodeURIComponent(cfg.league)}&type=${type}`)

          const nameCounts = new Map<string, number>()
          for (const line of res.lines) {
            const baseKey = line.name.toLowerCase()
            nameCounts.set(baseKey, (nameCounts.get(baseKey) ?? 0) + 1)
          }

          for (const line of res.lines) {
            const baseKey = line.name.toLowerCase()
            const variantCount = nameCounts.get(baseKey) ?? 1
            const entry: NinjaEntry = {
              name: line.name,
              chaosValue: line.chaosValue,
              divineValue: line.divineValue,
              links: line.links,
              gemLevel: line.gemLevel,
              gemQuality: line.gemQuality,
              corrupted: line.corrupted,
              mapTier: line.mapTier,
              variantCount
            }

            if (type === 'SkillGem') {
              const gKey = `gem::${baseKey}::${line.gemLevel ?? 1}::${line.gemQuality ?? 0}::${line.corrupted ? 1 : 0}`
              map.set(gKey, entry)
            } else if (type === 'Beast') {
              map.set(`beast::${baseKey}`, entry)
              if (!map.has(baseKey)) {
                map.set(baseKey, entry)
              }
            } else if (type === 'Map' || type === 'BlightedMap' || type === 'BlightRavagedMap' || type === 'UniqueMap') {
              const mKey = `map::${baseKey}::t${line.mapTier ?? 0}`
              map.set(mKey, entry)
              if (!map.has(baseKey)) {
                map.set(baseKey, entry)
              }
            } else if (type.startsWith('Unique')) {
              const linkBucket = line.links && line.links >= 5 ? line.links : 0
              const uKey = `unique::${baseKey}::${linkBucket}L`
              if (!map.has(uKey)) {
                map.set(uKey, entry)
              }
              if (linkBucket === 0 && !map.has(baseKey)) {
                map.set(baseKey, entry)
              }
            } else if (!map.has(baseKey)) {
              map.set(baseKey, entry)
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
    if (map.size > 0) {
      this.writeCache(cachePath, { entries: Array.from(map.entries()), divineChaosRate: divRate })
    }
  }

  getDivineChaosRate (): number {
    return this.divineChaosRate
  }

  async fetchPoeApi<T> (url: string, policyKey = 'stash-api'): Promise<T> {
    return this.fetchJson<T>(url, undefined, false, policyKey)
  }

  priceRawStashItem (raw: RawStashItem): { unitChaos: number; key: string } {
    const { category, rarity, links } = classifyStashItem(raw)
    const displayName = raw.name ? `${raw.name} ${raw.typeLine}`.trim() : raw.typeLine
    const cleanName = (raw.name || raw.typeLine || '').trim()
    const cleanBase = (raw.baseType || raw.typeLine || '').trim()
    const nameKey = cleanName.toLowerCase()
    const baseKey = cleanBase.toLowerCase()

    if (rarity === 'Currency' && nameKey === 'chaos orb') {
      return { unitChaos: 1, key: 'currency::chaos orb' }
    }

    if (category === 'Beast') {
      const entry =
        this.ninjaCache.get(`beast::${nameKey}`) ??
        this.ninjaCache.get(`beast::${baseKey}`) ??
        this.ninjaCache.get(nameKey) ??
        this.ninjaCache.get(baseKey)
      return {
        unitChaos: entry?.chaosValue ?? 0,
        key: `beast::${nameKey || baseKey}`
      }
    }

    if (rarity === 'Gem') {
      const lvlProp = raw.properties?.find((p) => p.name === 'Level')?.values?.[0]?.[0]
      const qualProp = raw.properties?.find((p) => p.name === 'Quality')?.values?.[0]?.[0]
      const lvl = lvlProp ? Number.parseInt(lvlProp, 10) || 1 : 1
      const qual = qualProp ? Number.parseInt(qualProp.replace(/[^0-9]/g, ''), 10) || 0 : 0
      const corr = raw.corrupted ? 1 : 0
      const entry =
        this.ninjaCache.get(`gem::${nameKey}::${lvl}::${qual}::${corr}`) ??
        this.ninjaCache.get(`gem::${nameKey}::${lvl}::0::${corr}`) ??
        this.ninjaCache.get(`gem::${nameKey}::1::0::0`)
      return {
        unitChaos: entry?.chaosValue ?? 0,
        key: `gem::${nameKey}::${lvl}::${qual}::${corr}`
      }
    }

    if (rarity === 'Unique') {
      const linkBucket = links >= 5 ? links : 0
      const entry =
        this.ninjaCache.get(`unique::${nameKey}::${linkBucket}L`) ??
        (linkBucket === 0 ? this.ninjaCache.get(nameKey) : undefined)
      return {
        unitChaos: entry?.chaosValue ?? 0,
        key: `unique::${nameKey}::${linkBucket}L`
      }
    }

    if (category === 'Map') {
      const tierProp = raw.properties?.find((p) => p.name === 'Map Tier')?.values?.[0]?.[0]
      const tier = tierProp ? Number.parseInt(tierProp, 10) || 0 : 0
      const mapKey = `map::${baseKey}::t${tier}`
      const entry = this.ninjaCache.get(mapKey) ?? this.ninjaCache.get(baseKey)
      return {
        unitChaos: entry?.chaosValue ?? 0,
        key: mapKey
      }
    }

    const entry = this.ninjaCache.get(nameKey) ?? this.ninjaCache.get(baseKey)
    return {
      unitChaos: entry?.chaosValue ?? 0,
      key: `${category.toLowerCase()}::${displayName.toLowerCase()}`
    }
  }

  private lookupNinja (item: ParsedItem): NinjaEntry | undefined {
    const nameKey = item.name.toLowerCase()
    const baseKey = item.baseType.toLowerCase()

    if (item.rarity === 'Gem') {
      const lvl = item.gemLevel ?? 1
      const qual = item.quality ?? 0
      const corr = item.corrupted ? 1 : 0
      return (
        this.ninjaCache.get(`gem::${nameKey}::${lvl}::${qual}::${corr}`) ??
        this.ninjaCache.get(`gem::${nameKey}::${lvl}::0::${corr}`) ??
        (lvl === 1 && qual === 0 && corr === 0 ? this.ninjaCache.get(`gem::${nameKey}::1::0::0`) : undefined)
      )
    }

    if (item.rarity === 'Unique' && !item.unidentified) {
      const linkBucket = item.maxLinks >= 5 ? item.maxLinks : 0
      return (
        this.ninjaCache.get(`unique::${nameKey}::${linkBucket}L`) ??
        (linkBucket === 0 ? this.ninjaCache.get(nameKey) : undefined)
      )
    }

    if (item.mapTier && (item.rarity === 'Normal' || item.rarity === 'Magic' || item.rarity === 'Rare')) {
      return this.ninjaCache.get(`map::${baseKey}::t${item.mapTier}`)
    }

    if (item.rarity === 'Currency' || item.rarity === 'Divination Card') {
      return this.ninjaCache.get(nameKey) ?? this.ninjaCache.get(baseKey)
    }

    return undefined
  }

  private buildMatchedMods (item: ParsedItem): MatchedModifier[] {
    if (!this.matcher) return []
    const isLocalItem = Boolean(item.weapon || item.armour)
    const expanded: MatchedModifier[] = []
    for (const mod of item.modifiers) {
      const m = this.matcher.matchModifier(mod, { isLocalItem })
      if (!m.statId && mod.raw.includes('\n')) {
        const subLines = mod.raw.split('\n').map((s) => s.trim()).filter(Boolean)
        if (subLines.length > 1) {
          for (const sub of subLines) {
            const norm = normalizeModTemplate(sub, mod.kind, mod.tier)
            expanded.push(this.matcher.matchModifier({
              raw: sub,
              display: norm.display,
              template: norm.template,
              values: norm.values,
              kind: norm.kind,
              tier: norm.tier
            }, { isLocalItem }))
          }
          continue
        }
      }
      expanded.push(m)
    }
    const rawMatched = mergeMatchedMods(expanded)
    const pseudos = this.matcher.computePseudoMods(rawMatched)
    return [...pseudos, ...rawMatched]
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

    const matchedMods = this.buildMatchedMods(item)

    const ninjaHit = this.lookupNinja(item)
    if (ninjaHit) {
      const divineValue =
        ninjaHit.divineValue ??
        (this.divineChaosRate > 0 ? Number((ninjaHit.chaosValue / this.divineChaosRate).toFixed(2)) : undefined)
      const ambiguous = Boolean(ninjaHit.variantCount && ninjaHit.variantCount > 1 && item.rarity === 'Unique')
      return {
        source: 'ninja',
        item,
        chaosValue: ninjaHit.chaosValue >= 1
          ? Number(ninjaHit.chaosValue.toFixed(1))
          : Number(ninjaHit.chaosValue.toFixed(3)),
        divineValue,
        ninjaAmbiguous: ambiguous || undefined,
        ninjaVariantNote: ambiguous ? 'Multiple variants on poe.ninja — verify rolls on Trade' : undefined,
        listings: [],
        matchedMods,
        rateLimit: this.rateLimiter.getStatus('trade-search')
      }
    }

    // Trade API search
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
        min: calcDefaultMinFilter(m.modifier.values, undefined, m.modifier.tier)
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
    const matchedMods = existingMatchedMods ?? this.buildMatchedMods(req.item)

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

    const statusOption = req.status ?? cfg.tradeStatus ?? 'available'
    const query: Record<string, unknown> = {
      status: { option: statusOption },
      stats: [{ type: 'and', filters: statFilters }]
    }

    const isGenericTieredMap = req.item.itemClass === 'Maps' && /^Map \(Tier \d+\)$/i.test(req.item.baseType)

    if (req.item.rarity === 'Unique') {
      if (!req.item.unidentified) {
        query.name = req.item.name
      }
      query.type = req.item.baseType
    } else if (
      req.item.rarity === 'Currency' ||
      req.item.rarity === 'Divination Card' ||
      req.item.rarity === 'Gem'
    ) {
      query.type = req.item.baseType
    } else if (!isGenericTieredMap && (req.useBaseType || !req.item.tradeCategory) && req.item.rarity !== 'Magic') {
      query.type = req.item.baseType
    }

    const filters: Record<string, unknown> = {}

    if (req.item.itemClass === 'Maps' && req.item.rarity !== 'Unique') {
      filters.type_filters = {
        filters: {
          category: { option: 'map' },
          rarity: { option: 'nonunique' }
        }
      }
      if (req.item.mapTier) {
        filters.map_filters = {
          filters: {
            map_tier: { min: req.item.mapTier, max: req.item.mapTier }
          }
        }
      }
    } else if (req.item.tradeCategory && !req.useBaseType && req.item.rarity !== 'Unique') {
      filters.type_filters = {
        filters: {
          category: { option: req.item.tradeCategory }
        }
      }
    } else if (req.item.rarity === 'Unique' && req.item.unidentified) {
      filters.type_filters = {
        filters: {
          rarity: { option: 'unique' }
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

    const sf: Record<string, unknown> = {}
    if (req.socketFilters) {
      const socketsObj: Record<string, number> = {}
      if (req.socketFilters.socketsMin && req.socketFilters.socketsMin > 0) socketsObj.min = req.socketFilters.socketsMin
      if (req.socketFilters.r && req.socketFilters.r > 0) socketsObj.r = req.socketFilters.r
      if (req.socketFilters.g && req.socketFilters.g > 0) socketsObj.g = req.socketFilters.g
      if (req.socketFilters.b && req.socketFilters.b > 0) socketsObj.b = req.socketFilters.b
      if (req.socketFilters.w && req.socketFilters.w > 0) socketsObj.w = req.socketFilters.w
      if (Object.keys(socketsObj).length > 0) sf.sockets = socketsObj
      if (req.socketFilters.linksMin && req.socketFilters.linksMin > 0) {
        sf.links = { min: req.socketFilters.linksMin }
      }
    } else if (req.useLinks && req.item.maxLinks >= 5) {
      sf.links = { min: req.item.maxLinks }
    }
    if (Object.keys(sf).length > 0) {
      filters.socket_filters = { filters: sf }
    }

    const miscFilters: Record<string, unknown> = {}
    if (req.useIlvl && req.item.ilvl) {
      miscFilters.ilvl = { min: req.item.ilvl }
    }
    if (req.useCorrupted) {
      miscFilters.corrupted = { option: req.item.corrupted ? 'true' : 'false' }
    }
    if (req.useQuality && req.item.quality && req.item.quality > 0) {
      miscFilters.quality = { min: req.item.quality }
    }
    if (req.item.rarity === 'Unique' && req.item.unidentified) {
      miscFilters.identified = { option: 'false' }
    }
    if (req.item.rarity === 'Gem') {
      if (req.item.gemLevel && req.item.gemLevel > 1) {
        miscFilters.gem_level = { min: req.item.gemLevel }
      }
      if (req.item.quality && req.item.quality > 0) {
        miscFilters.quality = { min: req.item.quality }
      }
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
      return {
        ...cachedSearch.result,
        item: req.item,
        matchedMods,
        rateLimit: this.rateLimiter.getStatus('trade-search')
      }
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
          matchedMods,
          rateLimit: this.rateLimiter.getStatus('trade-search')
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
        const chaosAmount = this.convertToChaos(price.amount, price.currency)
        listings.push({
          amount: price.amount,
          currency: price.currency,
          chaosAmount,
          accountName: entry.listing?.account?.name ?? 'unknown',
          indexed: entry.listing?.indexed ?? '',
          isInstantBuyout: entry.listing?.fee != null
        })
      }

      const summary = this.computeSummary(listings)
      const out: PriceCheckResult = {
        source: 'trade',
        item: req.item,
        totalResults: searchRes.total,
        tradeUrl,
        listings,
        summary,
        matchedMods,
        rateLimit: this.rateLimiter.getStatus('trade-search')
      }
      this.saveSearchEntry(cacheKey, out)
      return out
    } catch (err) {
      return {
        source: 'trade',
        item: req.item,
        listings: [],
        matchedMods,
        rateLimit: this.rateLimiter.getStatus('trade-search'),
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  private convertToChaos (amount: number, currency: string): number | undefined {
    const key = currency.toLowerCase()
    if (key === 'chaos') return Number(amount.toFixed(1))
    if (key === 'divine' && this.divineChaosRate > 0) {
      return Number((amount * this.divineChaosRate).toFixed(1))
    }
    const ninjaName = TRADE_CURRENCY_TO_NAME[key]
    if (ninjaName) {
      const hit = this.ninjaCache.get(ninjaName)
      if (hit && hit.chaosValue > 0) {
        return Number((amount * hit.chaosValue).toFixed(1))
      }
    }
    return undefined
  }

  private computeSummary (listings: PriceListing[]): PriceSummary | undefined {
    const chaosValues = listings
      .map((l) => l.chaosAmount)
      .filter((v): v is number => v !== undefined && v > 0)
      .sort((a, b) => a - b)

    if (chaosValues.length === 0) return undefined

    const minChaos = Number(chaosValues[0].toFixed(1))
    const mid = Math.floor(chaosValues.length / 2)
    const medianRaw = chaosValues.length % 2 === 1
      ? chaosValues[mid]
      : (chaosValues[mid - 1] + chaosValues[mid]) / 2
    const medianChaos = Number(medianRaw.toFixed(1))
    const instantCount = listings.filter((l) => l.isInstantBuyout).length

    return {
      minChaos,
      medianChaos,
      minDivine: this.divineChaosRate > 0 ? Number((minChaos / this.divineChaosRate).toFixed(2)) : undefined,
      medianDivine: this.divineChaosRate > 0 ? Number((medianChaos / this.divineChaosRate).toFixed(2)) : undefined,
      instantCount
    }
  }

  private async fetchJson<T> (url: string, init?: RequestInit, retried = false, explicitPolicyKey?: string): Promise<T> {
    const cfg = this.getConfig()
    const policyKey = explicitPolicyKey ?? (
      url.includes('/api/trade/search/')
        ? 'trade-search'
        : url.includes('/api/trade/fetch/')
          ? 'trade-fetch'
          : ''
    )

    if (policyKey) {
      await this.rateLimiter.acquire(policyKey)
    }

    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      ...(init?.headers as Record<string, string> | undefined)
    }
    if (cfg.poeSessId && url.includes('pathofexile.com')) {
      headers.Cookie = `POESESSID=${cfg.poeSessId.trim()}`
    }

    const res = await net.fetch(url, {
      ...init,
      signal: AbortSignal.timeout(cfg.requestTimeoutMs),
      headers
    })

    if (policyKey) {
      this.rateLimiter.updateFromHeaders(policyKey, res.headers)
    }

    if (res.status === 429) {
      const retryAfter = Number.parseInt(res.headers.get('retry-after') ?? '0', 10) || 2
      if (!retried && retryAfter <= 5) {
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000))
        return this.fetchJson<T>(url, init, true, explicitPolicyKey)
      }
      throw new Error(`Rate limited by PoE Trade API (retry in ${retryAfter}s)`)
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (res.status === 403 && /cloudflare|just a moment/i.test(body)) {
        throw new Error('Blocked by Cloudflare (403). Add POESESSID in Settings or open Trade in browser.')
      }
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
