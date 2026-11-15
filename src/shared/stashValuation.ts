import type {
  BulkListingItem,
  FarmSessionSummary,
  ItemRarity,
  PricedStashItem,
  SnapshotDiffItem,
  StashSnapshot
} from './types'

export interface RawStashSocket {
  group: number
}

export interface RawStashItem {
  id: string
  name?: string
  typeLine: string
  baseType?: string
  icon?: string
  stackSize?: number
  frameType?: number
  corrupted?: boolean
  ilvl?: number
  sockets?: RawStashSocket[]
  properties?: Array<{ name: string; values?: Array<[string, number]> }>
}

const FRAME_TO_RARITY: Record<number, ItemRarity> = {
  0: 'Normal',
  1: 'Magic',
  2: 'Rare',
  3: 'Unique',
  4: 'Gem',
  5: 'Currency',
  6: 'Divination Card'
}

export function countMaxLinks (sockets?: RawStashSocket[]): number {
  if (!sockets || sockets.length === 0) return 0
  const groups = new Map<number, number>()
  for (const s of sockets) {
    groups.set(s.group, (groups.get(s.group) ?? 0) + 1)
  }
  let max = 0
  for (const count of groups.values()) {
    if (count > max) max = count
  }
  return max
}

export function classifyStashItem (raw: RawStashItem): {
  category: string
  rarity: ItemRarity
  links: number
} {
  const frame = raw.frameType ?? 0
  const rarity: ItemRarity = FRAME_TO_RARITY[frame] ?? 'Unknown'
  const links = countMaxLinks(raw.sockets)
  const type = raw.typeLine || raw.baseType || ''
  const lower = type.toLowerCase()

  if (frame === 6) return { category: 'Divination Card', rarity, links }
  if (frame === 4) return { category: 'Skill Gem', rarity, links }
  if (frame === 3) return { category: 'Unique', rarity, links }

  if (frame === 5) {
    if (lower.includes('scarab')) return { category: 'Scarab', rarity, links }
    if (lower.includes('essence')) return { category: 'Essence', rarity, links }
    if (lower.includes('oil')) return { category: 'Oil', rarity, links }
    if (lower.includes('fossil')) return { category: 'Fossil', rarity, links }
    if (lower.includes('resonator')) return { category: 'Resonator', rarity, links }
    if (lower.includes('catalyst')) return { category: 'Catalyst', rarity, links }
    if (lower.includes('delirium orb')) return { category: 'Delirium Orb', rarity, links }
    if (lower.includes('incubator')) return { category: 'Incubator', rarity, links }
    if (lower.includes('tattoo')) return { category: 'Tattoo', rarity, links }
    if (lower.includes('omen')) return { category: 'Omen', rarity, links }
    if (lower.includes('splinter') || lower.includes('breachstone') || lower.includes('emblem') || lower.includes('fragment') || lower.includes('mortal') || lower.includes('sacrifice') || lower.includes('invitation') || lower.includes('writ')) {
      return { category: 'Fragment', rarity, links }
    }
    return { category: 'Currency', rarity, links }
  }

  if (lower.endsWith(' map') || lower.includes(' map (')) {
    return { category: 'Map', rarity, links }
  }

  return { category: 'Other', rarity, links }
}

/**
 * Computes item-by-item delta and hourly profit rate between two stash snapshots.
 */
export function computeSnapshotDiff (
  baseline: StashSnapshot,
  current: StashSnapshot
): FarmSessionSummary {
  const baseAgg = aggregateByKey(baseline.items)
  const currAgg = aggregateByKey(current.items)
  const allKeys = new Set([...baseAgg.keys(), ...currAgg.keys()])

  const diffs: SnapshotDiffItem[] = []
  for (const key of allKeys) {
    const b = baseAgg.get(key)
    const c = currAgg.get(key)
    const deltaQty = (c?.quantity ?? 0) - (b?.quantity ?? 0)
    const deltaChaos = Number(((c?.totalChaos ?? 0) - (b?.totalChaos ?? 0)).toFixed(1))
    if (deltaQty === 0 && Math.abs(deltaChaos) < 0.5) continue

    const ref = c ?? b!
    diffs.push({
      key,
      name: ref.name,
      icon: ref.icon,
      category: ref.category,
      deltaQty,
      deltaChaos,
      currentQty: c?.quantity ?? 0,
      unitChaos: ref.unitChaos
    })
  }

  diffs.sort((a, b) => Math.abs(b.deltaChaos) - Math.abs(a.deltaChaos))

  const durationMs = Math.max(60_000, current.createdAt - baseline.createdAt)
  const durationHours = durationMs / 3_600_000
  const durationMin = Math.round(durationMs / 60_000)

  const deltaChaos = Number((current.totalChaos - baseline.totalChaos).toFixed(1))
  const rate = current.divineRate > 0 ? current.divineRate : baseline.divineRate
  const deltaDivine = rate > 0 ? Number((deltaChaos / rate).toFixed(2)) : 0

  const chaosPerHour = Number((deltaChaos / durationHours).toFixed(1))
  const divinePerHour = rate > 0 ? Number((chaosPerHour / rate).toFixed(2)) : 0

  return {
    startedAt: baseline.createdAt,
    endedAt: current.createdAt,
    durationMin,
    deltaChaos,
    deltaDivine,
    chaosPerHour,
    divinePerHour,
    topGains: diffs.slice(0, 60)
  }
}

export function buildBulkListings (
  snapshot: StashSnapshot,
  minChaos: number,
  categoryFilter = 'All'
): BulkListingItem[] {
  const grouped = new Map<string, BulkListingItem>()

  for (const item of snapshot.items) {
    if (item.unitChaos <= 0) continue
    if (categoryFilter !== 'All' && item.category !== categoryFilter) continue

    const existing = grouped.get(item.key)
    if (!existing) {
      grouped.set(item.key, {
        key: item.key,
        name: item.name,
        icon: item.icon,
        category: item.category,
        quantity: item.stackSize,
        unitChaos: item.unitChaos,
        totalChaos: item.totalChaos,
        tabs: [item.tabName]
      })
    } else {
      existing.quantity += item.stackSize
      existing.totalChaos = Number((existing.totalChaos + item.totalChaos).toFixed(1))
      if (!existing.tabs.includes(item.tabName)) {
        existing.tabs.push(item.tabName)
      }
    }
  }

  return Array.from(grouped.values())
    .filter((entry) => entry.totalChaos >= minChaos)
    .sort((a, b) => b.totalChaos - a.totalChaos)
}

export function formatBulkText (
  items: BulkListingItem[],
  divineRate: number,
  multiplierPercent = 100
): string {
  if (items.length === 0) return ''
  const mult = multiplierPercent / 100
  const totalChaos = items.reduce((acc, i) => acc + i.totalChaos * mult, 0)
  const totalDiv = divineRate > 0 ? totalChaos / divineRate : 0

  const header = divineRate > 0
    ? `WTS Bulk (${multiplierPercent}% ninja) — Total: ${Math.round(totalChaos)}c (${totalDiv.toFixed(1)} div)`
    : `WTS Bulk (${multiplierPercent}% ninja) — Total: ${Math.round(totalChaos)}c`

  const lines = items.map((i) => {
    const unit = Number((i.unitChaos * mult).toFixed(1))
    const sum = Math.round(i.totalChaos * mult)
    return `${i.quantity}x ${i.name} @ ${unit}c each (${sum}c)`
  })

  return [header, ...lines].join('\n')
}

function aggregateByKey (items: PricedStashItem[]): Map<string, {
  name: string
  icon: string
  category: string
  quantity: number
  totalChaos: number
  unitChaos: number
}> {
  const map = new Map<string, {
    name: string
    icon: string
    category: string
    quantity: number
    totalChaos: number
    unitChaos: number
  }>()

  for (const item of items) {
    const cur = map.get(item.key)
    if (!cur) {
      map.set(item.key, {
        name: item.name,
        icon: item.icon,
        category: item.category,
        quantity: item.stackSize,
        totalChaos: item.totalChaos,
        unitChaos: item.unitChaos
      })
    } else {
      cur.quantity += item.stackSize
      cur.totalChaos += item.totalChaos
    }
  }
  return map
}
