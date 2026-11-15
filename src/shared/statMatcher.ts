import type { ItemModifier, MatchedModifier, StatEntry } from './types'

function normalizeStatKey (text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export class StatMatcher {
  private readonly index = new Map<string, StatEntry[]>()

  constructor (entries: StatEntry[]) {
    for (const entry of entries) {
      const key = normalizeStatKey(entry.text)
      const list = this.index.get(key)
      if (list) {
        list.push(entry)
      } else {
        this.index.set(key, [entry])
      }
      // Also index without leading '+' for templates like "+# to maximum Life" vs "# to maximum Life"
      if (key.startsWith('+#')) {
        const altKey = key.slice(1)
        const altList = this.index.get(altKey)
        if (altList) {
          altList.push(entry)
        } else {
          this.index.set(altKey, [entry])
        }
      }
    }
  }

  matchModifier (mod: ItemModifier): MatchedModifier {
    const key = normalizeStatKey(mod.template)
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

    const preferred =
      candidates.find((c) => c.type === mod.kind)
      ?? candidates.find((c) => c.type === 'explicit')
      ?? candidates[0]

    return {
      modifier: mod,
      statId: preferred.id,
      statText: preferred.text,
      enabled: mod.kind !== 'enchant'
    }
  }

  matchAll (mods: ItemModifier[]): MatchedModifier[] {
    return mods.map((m) => this.matchModifier(m))
  }
}
