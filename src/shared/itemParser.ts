import type { ItemModifier, ItemRarity, ModifierKind, ParsedItem } from './types'

const SECTION_SPLIT = /\r?\n--------\r?\n/
const NUMBER_RE = /[+-]?\d+(?:\.\d+)?/g

const RARITY_MAP: Record<string, ItemRarity> = {
  normal: 'Normal',
  magic: 'Magic',
  rare: 'Rare',
  unique: 'Unique',
  currency: 'Currency',
  gem: 'Gem',
  'divination card': 'Divination Card'
}

const KNOWN_FLAGS = new Set([
  'Corrupted',
  'Synthesised Item',
  'Fractured Item',
  'Mirrored',
  'Split',
  'Unidentified'
])

const NON_MOD_PREFIXES = [
  'Item Class:',
  'Rarity:',
  'Item Level:',
  'Quality:',
  'Stack Size:',
  'Sockets:',
  'Requirements:',
  'Level:',
  'Str:',
  'Dex:',
  'Int:',
  'Armour:',
  'Evasion Rating:',
  'Energy Shield:',
  'Ward:',
  'Physical Damage:',
  'Elemental Damage:',
  'Chaos Damage:',
  'Critical Strike Chance:',
  'Attacks per Second:',
  'Weapon Range:',
  'Chance to Block:',
  'Map Tier:',
  'Item Quantity:',
  'Item Rarity:',
  'Monster Pack Size:',
  'Area Level:',
  'Note:',
  'Place into',
  'Right click',
  'Shift click'
]

export function normalizeModTemplate (raw: string): { template: string; values: number[]; kind: ModifierKind } {
  let kind: ModifierKind = 'explicit'
  let cleaned = raw.trim()

  if (cleaned.endsWith(' (implicit)')) {
    kind = 'implicit'
    cleaned = cleaned.slice(0, -' (implicit)'.length)
  } else if (cleaned.endsWith(' (crafted)')) {
    kind = 'crafted'
    cleaned = cleaned.slice(0, -' (crafted)'.length)
  } else if (cleaned.endsWith(' (fractured)')) {
    kind = 'fractured'
    cleaned = cleaned.slice(0, -' (fractured)'.length)
  } else if (cleaned.endsWith(' (enchant)')) {
    kind = 'enchant'
    cleaned = cleaned.slice(0, -' (enchant)'.length)
  }

  const values: number[] = []
  const template = cleaned.replace(NUMBER_RE, (match) => {
    const num = Number(match)
    values.push(num)
    return match.startsWith('+') ? '+#': '#'
  })

  return { template, values, kind }
}

function parseMaxLinks (socketsLine: string): number {
  const value = socketsLine.slice('Sockets:'.length).trim()
  if (!value) return 0
  let maxLinks = 0
  for (const group of value.split(/\s+/)) {
    const socketsInGroup = group.split('-').length
    if (socketsInGroup > maxLinks) {
      maxLinks = socketsInGroup
    }
  }
  return maxLinks
}

function isModLine (line: string): boolean {
  if (!line || KNOWN_FLAGS.has(line)) return false
  if (line.startsWith('(') && line.endsWith(')')) return false
  return !NON_MOD_PREFIXES.some((prefix) => line.startsWith(prefix))
}

export function parseItemText (rawText: string): ParsedItem | null {
  const trimmed = rawText.trim()
  if (!trimmed.includes('Rarity:')) {
    return null
  }

  const sections = trimmed.split(SECTION_SPLIT)
  if (sections.length === 0) return null

  const headerLines = sections[0].split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  let itemClass = ''
  let rarity: ItemRarity = 'Unknown'
  const titleLines: string[] = []

  for (const line of headerLines) {
    if (line.startsWith('Item Class:')) {
      itemClass = line.slice('Item Class:'.length).trim()
    } else if (line.startsWith('Rarity:')) {
      const r = line.slice('Rarity:'.length).trim().toLowerCase()
      rarity = RARITY_MAP[r] ?? 'Unknown'
    } else {
      titleLines.push(line)
    }
  }

  if (titleLines.length === 0) return null

  const name = titleLines[0]
  const baseType = titleLines.length > 1 ? titleLines[1] : titleLines[0]

  let ilvl: number | null = null
  let quality: number | null = null
  let stackSize: number | null = null
  let maxLinks = 0
  let corrupted = false
  let synthesised = false
  let fractured = false
  const modifiers: ItemModifier[] = []

  for (let i = 1; i < sections.length; i++) {
    const lines = sections[i].split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) continue

    // Flavor text on uniques / divination cards is usually the last non-mod section without numbers or tags
    let sectionHasKnownHeader = false
    for (const line of lines) {
      if (line.startsWith('Item Level:')) {
        ilvl = Number.parseInt(line.slice('Item Level:'.length).trim(), 10) || null
        sectionHasKnownHeader = true
      } else if (line.startsWith('Quality:')) {
        const m = line.match(/\d+/)
        quality = m ? Number.parseInt(m[0], 10) : null
        sectionHasKnownHeader = true
      } else if (line.startsWith('Stack Size:')) {
        const m = line.slice('Stack Size:'.length).trim().match(/^(\d+)/)
        stackSize = m ? Number.parseInt(m[1], 10) : null
        sectionHasKnownHeader = true
      } else if (line.startsWith('Sockets:')) {
        maxLinks = parseMaxLinks(line)
        sectionHasKnownHeader = true
      } else if (line === 'Corrupted') {
        corrupted = true
        sectionHasKnownHeader = true
      } else if (line === 'Synthesised Item') {
        synthesised = true
        sectionHasKnownHeader = true
      } else if (line === 'Fractured Item') {
        fractured = true
        sectionHasKnownHeader = true
      }
    }

    if (sectionHasKnownHeader) continue

    // Skip requirements / stats blocks
    if (lines.some((l) => l.startsWith('Requirements:') || l.startsWith('Note:') || l.startsWith('Place into'))) {
      continue
    }

    for (const line of lines) {
      if (!isModLine(line)) continue
      // Skip pure flavor text on Unique items (no numbers and no mod tags)
      if (rarity === 'Unique' && !/\d/.test(line) && !line.includes('(')) {
        continue
      }
      const { template, values, kind } = normalizeModTemplate(line)
      if (kind === 'fractured') fractured = true
      modifiers.push({ raw: line, template, values, kind })
    }
  }

  return {
    rawText: trimmed,
    itemClass,
    rarity,
    name,
    baseType,
    ilvl,
    quality,
    stackSize,
    maxLinks,
    corrupted,
    synthesised,
    fractured,
    modifiers
  }
}
