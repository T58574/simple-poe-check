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
  'Fishing Rods': 'weapon.rod',
  Shields: 'armour.shield',
  Helmets: 'armour.helmet',
  'Body Armours': 'armour.chest',
  Gloves: 'armour.gloves',
  Boots: 'armour.boots',
  Quivers: 'armour.quiver',
  Amulets: 'accessory.amulet',
  Rings: 'accessory.ring',
  Belts: 'accessory.belt',
  Trinkets: 'accessory.trinket',
  Jewels: 'jewel',
  'Abyss Jewels': 'jewel.abyss',
  'Cluster Jewels': 'jewel.cluster',
  Flasks: 'flask',
  Maps: 'map',
  'Skill Gems': 'gem.activegem',
  'Support Gems': 'gem.supportgem',
  'Divination Cards': 'card',
  'Stackable Currency': 'currency',
  'Heist Contracts': 'heistmission.contract',
  'Heist Blueprints': 'heistmission.blueprint',
  'Heist Tools': 'heistequipment.heisttool',
  'Heist Brooches': 'heistequipment.heistreward',
  'Heist Gear': 'heistequipment.heistweapon',
  'Heist Cloaks': 'heistequipment.heistutility',
  'Sanctum Relics': 'sanctum.relic',
  Tinctures: 'tincture'
}

const INFLUENCE_FLAGS: Record<string, string> = {
  'Shaper Item': 'Shaper',
  'Elder Item': 'Elder',
  'Crusader Item': 'Crusader',
  'Redeemer Item': 'Redeemer',
  'Hunter Item': 'Hunter',
  'Warlord Item': 'Warlord',
  'Searing Exarch Item': 'Searing Exarch',
  'Eater of Worlds Item': 'Eater of Worlds'
}

const KNOWN_FLAGS = new Set([
  'Corrupted',
  'Synthesised Item',
  'Fractured Item',
  'Mirrored',
  'Split',
  'Unidentified',
  ...Object.keys(INFLUENCE_FLAGS)
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
  'Take this to ',
  'Right click',
  'Right-click ',
  'Shift click',
  'Shift-click ',
  'Left-click ',
  'Cannot use this item',
  'Corpse Level:',
  'Monster Level:',
  'Monster Category:',
  'Monster Genus:',
  'Heist Target:',
  'Talisman Tier:',
  'Area:'
]

const VISCERA_SLOTS = new Set([
  'Upper Limb',
  'Lower Limb',
  'Torso',
  'Head',
  'Brain',
  'Eye',
  'Heart',
  'Liver',
  'Lung'
])

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

function parseSocketsInfo (socketsLine: string): {
  sockets: number
  maxLinks: number
  socketColors: { r: number; g: number; b: number; w: number }
} {
  const value = socketsLine.slice('Sockets:'.length).trim()
  const socketColors = { r: 0, g: 0, b: 0, w: 0 }
  if (!value) return { sockets: 0, maxLinks: 0, socketColors }

  let sockets = 0
  let maxLinks = 0
  for (const group of value.split(/\s+/)) {
    const parts = group.split('-').filter(Boolean)
    sockets += parts.length
    if (parts.length > maxLinks) {
      maxLinks = parts.length
    }
    for (const p of parts) {
      const ch = p.toUpperCase()
      if (ch === 'R') socketColors.r++
      else if (ch === 'G') socketColors.g++
      else if (ch === 'B') socketColors.b++
      else if (ch === 'W') socketColors.w++
    }
  }
  return { sockets, maxLinks, socketColors }
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

function cleanBaseType (rawBase: string, rarity: ItemRarity, itemClass = ''): string {
  let cleaned = rawBase
  if (rarity === 'Normal' || rarity === 'Magic' || rarity === 'Rare') {
    cleaned = cleaned.replace(/^Superior\s+/i, '').trim()
  }
  if (itemClass === 'Viscera') {
    cleaned = cleaned.replace(/^(?:Lesser|Greater)\s+/i, '').trim()
  }
  return cleaned
}

function calcQ20Multiplier (
  currentQuality: number | null,
  corrupted: boolean,
  localIncreasedPct: number
): number | null {
  const q = currentQuality ?? 0
  if (corrupted || q >= 20) return null
  const denom = 100 + localIncreasedPct + q
  if (denom <= 0) return null
  return (100 + localIncreasedPct + 20) / denom
}

export function parseItemText (rawText: string): ParsedItem | null {
  const trimmed = rawText.trim()
  if (!trimmed.includes('Rarity:') && !trimmed.includes('Item Class:')) {
    return null
  }

  const sections = trimmed.split(SECTION_SPLIT)
  if (sections.length === 0) return null

  const headerLines = sections[0].split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  let itemClass = ''
  let rarity: ItemRarity = 'Unknown'
  let sawRarity = false
  const titleLines: string[] = []

  for (const line of headerLines) {
    if (line.startsWith('Item Class:')) {
      itemClass = line.slice('Item Class:'.length).trim()
    } else if (line.startsWith('Rarity:')) {
      sawRarity = true
      const r = line.slice('Rarity:'.length).trim().toLowerCase()
      rarity = RARITY_MAP[r] ?? 'Unknown'
    } else {
      titleLines.push(line)
    }
  }

  if (!sawRarity && itemClass) {
    rarity = 'Normal'
  }

  if (titleLines.length === 0) return null

  const name = titleLines[0]
  const rawBaseType = titleLines.length > 1 ? titleLines[1] : titleLines[0]
  const baseType = cleanBaseType(rawBaseType, rarity, itemClass)

  let ilvl: number | null = null
  let quality: number | null = null
  let stackSize: number | null = null
  let sockets = 0
  let socketColors: { r: number; g: number; b: number; w: number } | undefined
  let maxLinks = 0
  let corrupted = false
  let synthesised = false
  let fractured = false
  let unidentified = false
  let mirrored = false
  let split = false
  let gemLevel: number | undefined
  let mapTier: number | undefined
  const blighted = /\bBlighted\b|\bBlight-ravaged\b/i.test(baseType)
  const influences: string[] = []

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
        const parsedSockets = parseSocketsInfo(line)
        sockets = parsedSockets.sockets
        maxLinks = parsedSockets.maxLinks
        socketColors = parsedSockets.sockets > 0 ? parsedSockets.socketColors : undefined
        sectionHasKnownHeader = true
      } else if (line.startsWith('Map Tier:')) {
        mapTier = Number.parseInt(line.slice('Map Tier:'.length).trim(), 10) || undefined
        sectionHasKnownHeader = true
      } else if (line.startsWith('Level:') && rarity === 'Gem') {
        gemLevel = Number.parseInt(line.slice('Level:'.length).trim(), 10) || undefined
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
      } else if (line === 'Unidentified') {
        unidentified = true
        sectionHasKnownHeader = true
      } else if (line === 'Mirrored') {
        mirrored = true
        sectionHasKnownHeader = true
      } else if (line === 'Split') {
        split = true
        sectionHasKnownHeader = true
      } else if (INFLUENCE_FLAGS[line]) {
        influences.push(INFLUENCE_FLAGS[line])
        sectionHasKnownHeader = true
      }
    }

    const hasMetaLines = lines.some((l) => META_MOD_RE.test(l))
    if (sectionHasKnownHeader && !hasMetaLines) continue

    if (rarity === 'Gem') continue

    if (itemClass === 'Viscera' && lines.length === 1 && VISCERA_SLOTS.has(lines[0])) {
      continue
    }

    if (lines.some((l) => l.startsWith('Requirements:') || l.startsWith('Note:') || l.startsWith('Place into'))) {
      continue
    }

    // Flavor text on Uniques sits in its own trailing section without numbers or mod markers
    if (
      rarity === 'Unique' &&
      modifiers.length > 0 &&
      lines.every((l) => !/\d/.test(l) && !l.includes('(') && !META_MOD_RE.test(l))
    ) {
      continue
    }

    // Group lines under Advanced Mod Descriptions ({...}) so multi-line mods stay together
    if (hasMetaLines) {
      let pendingKind: ModifierKind | undefined
      let pendingTier: number | undefined
      let bufferedLines: string[] = []

      const flushBuffered = (): void => {
        if (bufferedLines.length === 0) return
        const rawJoined = bufferedLines.join('\n')
        const joined = bufferedLines.join(' ')
        bufferedLines = []
        if (!isModLine(joined)) return
        const normalized = normalizeModTemplate(joined, pendingKind, pendingTier)
        if (normalized.kind === 'fractured') fractured = true
        modifiers.push({
          raw: rawJoined,
          display: normalized.display,
          template: normalized.template,
          values: normalized.values,
          kind: normalized.kind,
          tier: normalized.tier
        })
        pendingKind = undefined
        pendingTier = undefined
      }

      for (const line of lines) {
        const meta = parseMetaLine(line)
        if (meta) {
          flushBuffered()
          pendingKind = meta.kind
          pendingTier = meta.tier
          continue
        }
        if (isModLine(line)) {
          bufferedLines.push(line)
        }
      }
      flushBuffered()
      continue
    }

    for (const line of lines) {
      if (!isModLine(line)) continue
      const normalized = normalizeModTemplate(line)
      if (normalized.kind === 'fractured') fractured = true
      modifiers.push({
        raw: line,
        display: normalized.display,
        template: normalized.template,
        values: normalized.values,
        kind: normalized.kind,
        tier: normalized.tier
      })
    }
  }

  // Estimate local % increased phys / defence for Q20 normalization
  let localIncPhys = 0
  let localIncDef = 0
  for (const m of modifiers) {
    if (/^#% increased Physical Damage$/i.test(m.template) && m.values.length > 0) {
      localIncPhys += m.values[0]
    }
    if (/^#% increased (?:Armour|Evasion|Energy Shield|Armour and Evasion|Armour and Energy Shield|Evasion and Energy Shield|Armour, Evasion and Energy Shield)$/i.test(m.template) && m.values.length > 0) {
      localIncDef += m.values[0]
    }
  }

  let weapon: WeaponStats | undefined
  if (aps > 0 && (physAvg > 0 || eleAvg > 0 || chaosAvg > 0)) {
    const physicalDps = Math.round(physAvg * aps)
    const elementalDps = Math.round(eleAvg * aps)
    const totalDps = Math.round((physAvg + eleAvg + chaosAvg) * aps)
    const mult = calcQ20Multiplier(quality, corrupted, localIncPhys)
    const q20PhysicalDps = mult ? Math.round(physicalDps * mult) : undefined
    const q20TotalDps = mult ? Math.round((physAvg * mult + eleAvg + chaosAvg) * aps) : undefined
    weapon = { physicalDps, elementalDps, totalDps, aps, crit, q20PhysicalDps, q20TotalDps }
  }

  let armour: ArmourStats | undefined
  if (armourVal > 0 || evasionVal > 0 || esVal > 0 || wardVal > 0) {
    const mult = calcQ20Multiplier(quality, corrupted, localIncDef)
    armour = {
      armour: armourVal,
      evasion: evasionVal,
      energyShield: esVal,
      ward: wardVal,
      q20Armour: mult && armourVal > 0 ? Math.round(armourVal * mult) : undefined,
      q20Evasion: mult && evasionVal > 0 ? Math.round(evasionVal * mult) : undefined,
      q20EnergyShield: mult && esVal > 0 ? Math.round(esVal * mult) : undefined
    }
  }

  const tradeCategory = ITEM_CLASS_TO_CATEGORY[itemClass] ?? null

  if (!mapTier && itemClass === 'Maps') {
    const tierMatch = baseType.match(/Map \(Tier (\d+)\)/i) ?? name.match(/Map \(Tier (\d+)\)/i)
    if (tierMatch) {
      mapTier = Number.parseInt(tierMatch[1], 10) || undefined
    }
  }

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
    sockets: sockets > 0 ? sockets : undefined,
    socketColors,
    maxLinks,
    corrupted,
    synthesised,
    fractured,
    unidentified: unidentified || undefined,
    mirrored: mirrored || undefined,
    split: split || undefined,
    influences: influences.length > 0 ? influences : undefined,
    gemLevel,
    mapTier,
    blighted: blighted || undefined,
    weapon,
    armour,
    modifiers
  }
}
