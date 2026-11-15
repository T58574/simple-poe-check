import type { ItemModifier, MatchedModifier, StatEntry } from './types'

function normalizeStatKey (text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function stripLocalSuffix (key: string): string {
  return key.replace(/\s*\(local\)$/i, '').trim()
}

interface IndexedStat {
  entry: StatEntry
  isLocal: boolean
}

export interface MatchOptions {
  isLocalItem?: boolean
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
}
