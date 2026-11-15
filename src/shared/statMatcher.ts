import type { ItemModifier, MatchedModifier, StatEntry } from './types'

function normalizeStatKey (text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function stripLocalSuffix (key: string): string {
  return key.replace(/\s*\(local\)/gi, '').replace(/\s+/g, ' ').trim()
}

interface IndexedStat {
  entry: StatEntry
  isLocal: boolean
}

export interface MatchOptions {
  isLocalItem?: boolean
}

export function getModPrimaryValue (values: number[]): number | undefined {
  if (values.length === 0) return undefined
  if (values.length === 2) {
    return (values[0] + values[1]) / 2
  }
  return values[0]
}

export function calcDefaultMinFilter (values: number[], ratio?: number, tier?: number): number | undefined {
  const val = getModPrimaryValue(values)
  if (val === undefined) return undefined
  const effectiveRatio = ratio ?? (tier === 1 ? 0.94 : tier === 2 ? 0.91 : 0.88)
  if (val < 0) {
    return Math.floor(val * (2 - effectiveRatio))
  }
  if (val > 0 && val < 10 && !Number.isInteger(val)) {
    return Number((val * effectiveRatio).toFixed(1))
  }
  return Math.floor(val * effectiveRatio)
}

export class StatMatcher {
  private readonly index = new Map<string, IndexedStat[]>()

  constructor (entries: StatEntry[]) {
    for (const entry of entries) {
      const rawKey = normalizeStatKey(entry.text)
      const isLocal = /\(local\)/i.test(entry.text)
      const baseKey = stripLocalSuffix(rawKey)
      const item: IndexedStat = { entry, isLocal }

      this.addToIndex(rawKey, item)
      if (baseKey !== rawKey) {
        this.addToIndex(baseKey, item)
      }

      if (baseKey.startsWith('+#')) {
        this.addToIndex(baseKey.slice(1), item)
      }
    }
  }

  private addToIndex (key: string, item: IndexedStat): void {
    const list = this.index.get(key)
    if (list) {
      list.push(item)
    } else {
      this.index.set(key, [item])
    }
  }

  findPseudoStat (text: string): StatEntry | null {
    const key = normalizeStatKey(text)
    const candidates = this.index.get(key)
      ?? (key.startsWith('+#') ? this.index.get(key.slice(1)) : undefined)
    if (!candidates) return null
    return candidates.find((c) => c.entry.type === 'pseudo')?.entry ?? null
  }

  matchModifier (mod: ItemModifier, opts?: MatchOptions): MatchedModifier {
    const key = stripLocalSuffix(normalizeStatKey(mod.template))
    const candidates = this.index.get(key)
      ?? (key.startsWith('+#') ? this.index.get(key.slice(1)) : undefined)

    if (!candidates || candidates.length === 0) {
      return {
        modifier: mod,
        statId: null,
        statText: null,
        enabled: false
      }
    }

    const preferLocal = Boolean(opts?.isLocalItem)
    const preferred =
      candidates.find((c) => c.entry.type === mod.kind && c.isLocal === preferLocal)
      ?? candidates.find((c) => c.entry.type === mod.kind)
      ?? candidates.find((c) => c.entry.type === 'explicit' && c.isLocal === preferLocal)
      ?? candidates.find((c) => c.entry.type === 'explicit')
      ?? candidates[0]

    return {
      modifier: mod,
      statId: preferred.entry.id,
      statText: preferred.entry.text,
      enabled: mod.kind !== 'enchant'
    }
  }

  matchAll (mods: ItemModifier[], opts?: MatchOptions): MatchedModifier[] {
    return mods.map((m) => this.matchModifier(m, opts))
  }

  computePseudoMods (matched: MatchedModifier[]): MatchedModifier[] {
    let totalEleRes = 0
    let totalChaosRes = 0
    let totalLife = 0
    let totalStr = 0
    let totalDex = 0
    let totalInt = 0

    for (const m of matched) {
      if (!m.statId || m.modifier.kind === 'enchant' || m.modifier.values.length === 0) continue
      const tpl = m.modifier.template.toLowerCase()
      const v = m.modifier.values[0]

      if (/^\+#% to all elemental resistances$/.test(tpl)) {
        totalEleRes += v * 3
      } else if (/^\+#% to (fire|cold|lightning) and (fire|cold|lightning) resistances$/.test(tpl)) {
        totalEleRes += v * 2
      } else if (/^\+#% to (fire|cold|lightning) resistance$/.test(tpl)) {
        totalEleRes += v
      } else if (/^\+#% to chaos resistance$/.test(tpl)) {
        totalChaosRes += v
      } else if (/^\+# to maximum life$/.test(tpl)) {
        totalLife += v
      } else if (/^\+# to all attributes$/.test(tpl)) {
        totalStr += v
        totalDex += v
        totalInt += v
      } else if (/^\+# to strength and (dexterity|intelligence)$/.test(tpl) || /^\+# to (dexterity|intelligence) and strength$/.test(tpl)) {
        totalStr += v
        if (tpl.includes('dexterity')) totalDex += v
        if (tpl.includes('intelligence')) totalInt += v
      } else if (/^\+# to dexterity and intelligence$/.test(tpl)) {
        totalDex += v
        totalInt += v
      } else if (/^\+# to strength$/.test(tpl)) {
        totalStr += v
      } else if (/^\+# to dexterity$/.test(tpl)) {
        totalDex += v
      } else if (/^\+# to intelligence$/.test(tpl)) {
        totalInt += v
      }
    }

    totalLife += Math.floor(totalStr / 2)

    const pseudos: MatchedModifier[] = []
    const pushPseudo = (text: string, value: number, enabled: boolean): void => {
      if (value <= 0) return
      const entry = this.findPseudoStat(text)
      if (!entry) return
      const display = text.replace('#', String(value))
      pseudos.push({
        modifier: {
          raw: display,
          display,
          template: text,
          values: [value],
          kind: 'pseudo'
        },
        statId: entry.id,
        statText: entry.text,
        enabled
      })
    }

    pushPseudo('+#% total Elemental Resistance', totalEleRes, totalEleRes >= 40)
    pushPseudo('+#% total Chaos Resistance', totalChaosRes, totalChaosRes >= 15)
    pushPseudo('+# total maximum Life', totalLife, totalLife >= 40)
    pushPseudo('+# total to Strength', totalStr, false)
    pushPseudo('+# total to Dexterity', totalDex, false)
    pushPseudo('+# total to Intelligence', totalInt, false)

    return pseudos
  }
}
