import type {
  ArmourStats,
  ItemModifier,
  ItemRarity,
  ModifierKind,
  ParsedItem,
  WeaponStats
} from './types'

const SECTION_SPLIT = /\r?\n--------\r?\n/
const NUMBER_RE = /[+-]?\d+(?:\.\d+)?/g
const INLINE_RANGE_RE = /(\d+(?:\.\d+)?)\([^)]+\)/g
const META_MOD_RE = /^\{(.+)\}$/
const TIER_RE = /\(Tier:\s*(\d+)\)/i

const RARITY_MAP: Record<string, ItemRarity> = {
  normal: 'Normal',
  magic: 'Magic',
  rare: 'Rare',
  unique: 'Unique',
  currency: 'Currency',
  gem: 'Gem',
  'divination card': 'Divination Card'
}

const ITEM_CLASS_TO_CATEGORY: Record<string, string> = {
  'One Hand Swords': 'weapon.onesword',
  'Thrusting One Hand Swords': 'weapon.onesword',
  'Two Hand Swords': 'weapon.twosword',
  'One Hand Axes': 'weapon.oneaxe',
  'Two Hand Axes': 'weapon.twoaxe',
  'One Hand Maces': 'weapon.onemace',
  'Two Hand Maces': 'weapon.twomace',
  Sceptres: 'weapon.sceptre',
  Staves: 'weapon.staff',
  Warstaves: 'weapon.warstaff',
  Bows: 'weapon.bow',
  Claws: 'weapon.claw',
  Daggers: 'weapon.dagger',
  'Rune Daggers': 'weapon.runedagger',
  Wands: 'weapon.wand',
  Shields: 'armour.shield',
  Helmets: 'armour.helmet',
  'Body Armours': 'armour.chest',
  Gloves: 'armour.gloves',
  Boots: 'armour.boots',
  Quivers: 'armour.quiver',
  Amulets: 'accessory.amulet',
  Rings: 'accessory.ring',
  Belts: 'accessory.belt',
  Jewels: 'jewel',
  'Abyss Jewels': 'jewel.abyss',
  'Cluster Jewels': 'jewel.cluster',
  Flasks: 'flask',
  Maps: 'map'
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

export function stripInlineRanges (raw: string): string {
  return raw.replace(INLINE_RANGE_RE, '$1')
}

export function normalizeModTemplate (
  raw: string,
  hintedKind?: ModifierKind,
  hintedTier?: number
): { display: string; template: string; values: number[]; kind: ModifierKind; tier?: number } {
  let kind: ModifierKind = hintedKind ?? 'explicit'
  let cleaned = stripInlineRanges(raw.trim())

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

  cleaned = cleaned.replace(/\s*\((?:augmented|unscalable)\)/g, '').trim()

  const values: number[] = []
  const template = cleaned.replace(NUMBER_RE, (match) => {
    const num = Number(match)
    values.push(num)
    return match.startsWith('+') ? '+#' : '#'
  })

  return { display: cleaned, template, values, kind, tier: hintedTier }
}

function parseMetaLine (line: string): { kind?: ModifierKind; tier?: number } | null {
  const m = line.match(META_MOD_RE)
  if (!m) return null
  const inner = m[1]
  let kind: ModifierKind | undefined
  if (/Implicit Modifier/i.test(inner)) kind = 'implicit'
  else if (/Master Crafted/i.test(inner) || /Crafted/i.test(inner)) kind = 'crafted'
  else if (/Fractured/i.test(inner)) kind = 'fractured'
  else if (/Enchant/i.test(inner)) kind = 'enchant'
  else if (/Prefix Modifier|Suffix Modifier/i.test(inner)) kind = 'explicit'

  const tierMatch = inner.match(TIER_RE)
  const tier = tierMatch ? Number.parseInt(tierMatch[1], 10) : undefined
  return { kind, tier }
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

function parseDamageRangesAverage (line: string): number {
  const matches = line.matchAll(/(\d+)-(\d+)/g)
  let totalAvg = 0
  for (const m of matches) {
    const min = Number.parseFloat(m[1])
    const max = Number.parseFloat(m[2])
    totalAvg += (min + max) / 2
  }
  return totalAvg
}

function parseFirstFloat (line: string): number {
  const m = line.match(/(\d+(?:\.\d+)?)/)
  return m ? Number.parseFloat(m[1]) : 0
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

  let physAvg = 0
  let eleAvg = 0
  let chaosAvg = 0
  let aps = 0
  let crit = 0

  let armourVal = 0
  let evasionVal = 0
  let esVal = 0
  let wardVal = 0

  const modifiers: ItemModifier[] = []

  for (let i = 1; i < sections.length; i++) {
    const lines = sections[i].split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) continue

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
      } else if (line.startsWith('Physical Damage:')) {
        physAvg = parseDamageRangesAverage(line)
        sectionHasKnownHeader = true
      } else if (line.startsWith('Elemental Damage:')) {
        eleAvg = parseDamageRangesAverage(line)
        sectionHasKnownHeader = true
      } else if (line.startsWith('Chaos Damage:')) {
        chaosAvg = parseDamageRangesAverage(line)
        sectionHasKnownHeader = true
      } else if (line.startsWith('Attacks per Second:')) {
        aps = parseFirstFloat(line)
        sectionHasKnownHeader = true
      } else if (line.startsWith('Critical Strike Chance:')) {
        crit = parseFirstFloat(line)
        sectionHasKnownHeader = true
      } else if (line.startsWith('Armour:')) {
        armourVal = parseFirstFloat(line)
        sectionHasKnownHeader = true
      } else if (line.startsWith('Evasion Rating:')) {
        evasionVal = parseFirstFloat(line)
        sectionHasKnownHeader = true
      } else if (line.startsWith('Energy Shield:')) {
        esVal = parseFirstFloat(line)
        sectionHasKnownHeader = true
      } else if (line.startsWith('Ward:')) {
        wardVal = parseFirstFloat(line)
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

    if (lines.some((l) => l.startsWith('Requirements:') || l.startsWith('Note:') || l.startsWith('Place into'))) {
      continue
    }

    let pendingKind: ModifierKind | undefined
    let pendingTier: number | undefined

    for (const line of lines) {
      const meta = parseMetaLine(line)
      if (meta) {
        pendingKind = meta.kind
        pendingTier = meta.tier
        continue
      }

      if (!isModLine(line)) continue
      if (rarity === 'Unique' && !/\d/.test(line) && !line.includes('(')) {
        continue
      }

      const normalized = normalizeModTemplate(line, pendingKind, pendingTier)
      if (normalized.kind === 'fractured') fractured = true
      modifiers.push({
        raw: line,
        display: normalized.display,
        template: normalized.template,
        values: normalized.values,
        kind: normalized.kind,
        tier: normalized.tier
      })
      pendingKind = undefined
      pendingTier = undefined
    }
  }

  let weapon: WeaponStats | undefined
  if (aps > 0 && (physAvg > 0 || eleAvg > 0 || chaosAvg > 0)) {
    const physicalDps = Math.round(physAvg * aps)
    const elementalDps = Math.round(eleAvg * aps)
    const totalDps = Math.round((physAvg + eleAvg + chaosAvg) * aps)
    weapon = { physicalDps, elementalDps, totalDps, aps, crit }
  }

  let armour: ArmourStats | undefined
  if (armourVal > 0 || evasionVal > 0 || esVal > 0 || wardVal > 0) {
    armour = { armour: armourVal, evasion: evasionVal, energyShield: esVal, ward: wardVal }
  }

  const tradeCategory = ITEM_CLASS_TO_CATEGORY[itemClass] ?? null

  return {
    rawText: trimmed,
    itemClass,
    tradeCategory,
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
    weapon,
    armour,
    modifiers
  }
}
