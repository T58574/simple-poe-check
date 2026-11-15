import assert from 'node:assert/strict'
import test from 'node:test'
import { parseItemText } from '../src/shared/itemParser'
import { calcDefaultMinFilter, StatMatcher } from '../src/shared/statMatcher'

test('parses rare body armour with links, implicit, explicit, crafted mods', () => {
  const raw = `Item Class: Body Armours
Rarity: Rare
Doom Shell
Astral Plate
--------
Quality: +20% (augmented)
Armour: 854
--------
Requirements:
Level: 62
Str: 180
--------
Sockets: R-R-R-G-B-R 
--------
Item Level: 86
--------
+12% to all Elemental Resistances (implicit)
--------
+98 to maximum Life
+42% to Fire Resistance
+18% to Chaos Resistance (crafted)
--------
Corrupted`

  const item = parseItemText(raw)
  assert.ok(item)
  assert.equal(item.rarity, 'Rare')
  assert.equal(item.name, 'Doom Shell')
  assert.equal(item.baseType, 'Astral Plate')
  assert.equal(item.ilvl, 86)
  assert.equal(item.quality, 20)
  assert.equal(item.maxLinks, 6)
  assert.equal(item.corrupted, true)
  assert.equal(item.modifiers.length, 4)
  assert.equal(item.modifiers[0].kind, 'implicit')
  assert.equal(item.modifiers[0].template, '+#% to all Elemental Resistances')
  assert.deepEqual(item.modifiers[0].values, [12])
  assert.equal(item.modifiers[3].kind, 'crafted')
})

test('parses unique item and ignores flavor text', () => {
  const raw = `Item Class: Rings
Rarity: Unique
Call of the Brotherhood
Two-Stone Ring
--------
Requirements:
Level: 20
--------
Item Level: 75
--------
+15% to Cold and Lightning Resistances (implicit)
--------
+22 to Intelligence
40% of Lightning Damage Converted to Cold Damage
--------
The two sisters stood together.`

  const item = parseItemText(raw)
  assert.ok(item)
  assert.equal(item.rarity, 'Unique')
  assert.equal(item.name, 'Call of the Brotherhood')
  assert.equal(item.baseType, 'Two-Stone Ring')
  assert.equal(item.modifiers.length, 3)
})

test('parses currency item with stack size', () => {
  const raw = `Item Class: Stackable Currency
Rarity: Currency
Divine Orb
--------
Stack Size: 4/20`

  const item = parseItemText(raw)
  assert.ok(item)
  assert.equal(item.rarity, 'Currency')
  assert.equal(item.name, 'Divine Orb')
  assert.equal(item.stackSize, 4)
  assert.equal(item.modifiers.length, 0)
})

test('StatMatcher matches normalized templates to stat ids', () => {
  const matcher = new StatMatcher([
    { id: 'explicit.stat_3299347043', text: '+# to maximum Life', type: 'explicit' },
    { id: 'implicit.stat_2901986750', text: '+#% to all Elemental Resistances', type: 'implicit' }
  ])

  const item = parseItemText(`Rarity: Rare
Test Ring
Iron Ring
--------
+10% to all Elemental Resistances (implicit)
--------
+75 to maximum Life`)

  assert.ok(item)
  const matched = matcher.matchAll(item.modifiers)
  assert.equal(matched[0].statId, 'implicit.stat_2901986750')
  assert.equal(matched[1].statId, 'explicit.stat_3299347043')
})

test('parses Advanced Mod Descriptions with tiers, inline ranges, and weapon DPS', () => {
  const raw = `Item Class: Warstaves
Rarity: Rare
Beast Goad
Foul Staff
--------
Warstaff
Quality: +22% (augmented)
Physical Damage: 224-379 (augmented)
Elemental Damage: 82-161 (augmented)
Critical Strike Chance: 10.00% (augmented)
Attacks per Second: 1.63 (augmented)
--------
Item Level: 85
--------
{ Implicit Modifier "Block" — Block }
+22% Chance to Block Attack Damage (implicit)
--------
{ Prefix Modifier "Glaciated" (Tier: 4) — Damage, Elemental, Cold, Attack }
Adds 82(77-104) to 161(154-178) Cold Damage
{ Prefix Modifier "Vicious" (Tier: 5) — Damage, Physical, Attack }
102(85-109)% increased Physical Damage
{ Suffix Modifier "of Destruction" (Tier: 1) — Damage, Critical }
+35(35-38)% to Global Critical Strike Multiplier`

  const item = parseItemText(raw)
  assert.ok(item)
  assert.equal(item.tradeCategory, 'weapon.warstaff')
  assert.ok(item.weapon)
  assert.equal(item.weapon.physicalDps, 491)
  assert.equal(item.weapon.elementalDps, 198)
  assert.equal(item.weapon.totalDps, 689)
  assert.equal(item.weapon.aps, 1.63)
  assert.equal(item.weapon.crit, 10)
  assert.equal(item.modifiers.length, 4)
  assert.equal(item.modifiers[1].display, 'Adds 82 to 161 Cold Damage')
  assert.equal(item.modifiers[1].template, 'Adds # to # Cold Damage')
  assert.deepEqual(item.modifiers[1].values, [82, 161])
  assert.equal(item.modifiers[1].tier, 4)
  assert.equal(item.modifiers[3].display, '+35% to Global Critical Strike Multiplier')
  assert.equal(item.modifiers[3].tier, 1)
})

test('StatMatcher prefers (Local) stats for weapons/armour and Global for accessories', () => {
  const matcher = new StatMatcher([
    { id: 'explicit.stat_681332047', text: '#% increased Attack Speed', type: 'explicit' },
    { id: 'explicit.stat_210067635', text: '#% increased Attack Speed (Local)', type: 'explicit' }
  ])

  const weaponItem = parseItemText(`Item Class: Warstaves
Rarity: Rare
Test Staff
Foul Staff
--------
26% increased Attack Speed`)

  const ringItem = parseItemText(`Item Class: Rings
Rarity: Rare
Test Ring
Iron Ring
--------
6% increased Attack Speed`)

  assert.ok(weaponItem && ringItem)
  assert.equal(matcher.matchModifier(weaponItem.modifiers[0], { isLocalItem: true }).statId, 'explicit.stat_210067635')
  assert.equal(matcher.matchModifier(ringItem.modifiers[0], { isLocalItem: false }).statId, 'explicit.stat_681332047')
})

test('parses Unidentified unique, non-numeric unique mod, Superior base, Gem, and Map', () => {
  const unid = parseItemText(`Item Class: Belts
Rarity: Unique
Leather Belt
--------
Unidentified`)
  assert.ok(unid)
  assert.equal(unid.unidentified, true)
  assert.equal(unid.baseType, 'Leather Belt')

  const uniqueWithNonNumeric = parseItemText(`Item Class: Boots
Rarity: Unique
Wanderlust
Wool Shoes
--------
+20 to Energy Shield
Cannot be Frozen
--------
Some flavor text`)
  assert.ok(uniqueWithNonNumeric)
  assert.equal(uniqueWithNonNumeric.modifiers.length, 2)
  assert.equal(uniqueWithNonNumeric.modifiers[1].template, 'Cannot be Frozen')

  const superior = parseItemText(`Item Class: Body Armours
Rarity: Normal
Superior Vaal Regalia
--------
Quality: +12% (augmented)
Energy Shield: 185 (augmented)`)
  assert.ok(superior)
  assert.equal(superior.baseType, 'Vaal Regalia')
  assert.ok(superior.armour?.q20EnergyShield && superior.armour.q20EnergyShield > 185)

  const gem = parseItemText(`Item Class: Skill Gems
Rarity: Gem
Determination
--------
Level: 21 (Max)
Quality: +20% (augmented)
--------
Corrupted`)
  assert.ok(gem)
  assert.equal(gem.gemLevel, 21)
  assert.equal(gem.quality, 20)
  assert.equal(gem.corrupted, true)

  const map = parseItemText(`Item Class: Maps
Rarity: Normal
Blighted Dune Map
--------
Map Tier: 16`)
  assert.ok(map)
  assert.equal(map.mapTier, 16)
  assert.equal(map.blighted, true)
})

test('computes pseudo-mods and calcDefaultMinFilter handles ranges, decimals, negatives', () => {
  const matcher = new StatMatcher([
    { id: 'explicit.fire', text: '+#% to Fire Resistance', type: 'explicit' },
    { id: 'explicit.cold', text: '+#% to Cold Resistance', type: 'explicit' },
    { id: 'explicit.life', text: '+# to maximum Life', type: 'explicit' },
    { id: 'pseudo.ele_res', text: '+#% total Elemental Resistance', type: 'pseudo' },
    { id: 'pseudo.life', text: '+# total maximum Life', type: 'pseudo' }
  ])

  const item = parseItemText(`Item Class: Rings
Rarity: Rare
Test Ring
Ruby Ring
--------
+40% to Fire Resistance
+35% to Cold Resistance
+70 to maximum Life`)
  assert.ok(item)

  const matched = matcher.matchAll(item.modifiers)
  const pseudos = matcher.computePseudoMods(matched)
  assert.equal(pseudos.length, 2)
  assert.equal(pseudos[0].statId, 'pseudo.ele_res')
  assert.equal(pseudos[0].modifier.values[0], 75)
  assert.equal(pseudos[1].statId, 'pseudo.life')
  assert.equal(pseudos[1].modifier.values[0], 70)

  assert.equal(calcDefaultMinFilter([10, 20], 0.8), 12)
  assert.equal(calcDefaultMinFilter([0.4], 0.85), 0.3)
  assert.equal(calcDefaultMinFilter([-10], 0.85), -12)
})

test('parses Map (Tier 15) generic map, hybrid fractured mod with inline (Local), and T1 min filter', () => {
  const mapText = [
    'Item Class: Maps',
    'Rarity: Normal',
    'Map (Tier 15)',
    '--------',
    'Item Level: 83',
    '--------',
    'Monster Level: 82'
  ].join('\n')
  const mapItem = parseItemText(mapText)
  assert.ok(mapItem)
  assert.equal(mapItem.mapTier, 15)
  assert.equal(mapItem.rarity, 'Normal')

  const matcher = new StatMatcher([
    { id: 'local_ar_life', text: '+# to Armour (Local)\n+# to maximum Life', type: 'fractured' }
  ])
  const matched = matcher.matchModifier({
    raw: '+35 to Armour +25 to maximum Life',
    display: '+35 to Armour +25 to maximum Life',
    template: '+# to Armour +# to maximum Life',
    values: [35, 25],
    kind: 'fractured',
    tier: 1
  })
  assert.equal(matched.statId, 'local_ar_life')
  assert.equal(matched.enabled, true)

  assert.equal(calcDefaultMinFilter([48], undefined, 1), 45)
})

test('parses Skill Gem without bogus description mods, Eldritch influenced gloves with all explicit mods, and socket colors', () => {
  const gemText = [
    'Item Class: Skill Gems',
    'Rarity: Gem',
    "Battlemage's Cry",
    '--------',
    'Warcry, Critical, Trigger, AoE, Duration',
    'Level: 1',
    'Quality: +14% (augmented)',
    '--------',
    'Additional Effects From Quality:',
    '28(0-40)% increased Cooldown Recovery Rate'
  ].join('\n')
  const gem = parseItemText(gemText)
  assert.ok(gem)
  assert.equal(gem.rarity, 'Gem')
  assert.equal(gem.gemLevel, 1)
  assert.equal(gem.quality, 14)
  assert.equal(gem.modifiers.length, 0)

  const eldritchGloves = [
    'Item Class: Gloves',
    'Rarity: Rare',
    'Phoenix Hand',
    'Goliath Gauntlets',
    '--------',
    'Quality: +20% (augmented)',
    'Armour: 211 (augmented)',
    '--------',
    'Sockets: W-W-R-G ',
    '--------',
    'Item Level: 84',
    '--------',
    '{ Searing Exarch Implicit Modifier (Lesser) — Damage, Minion }',
    'Minions deal 16(14-16)% increased Damage',
    '{ Eater of Worlds Implicit Modifier (Grand) — Damage, Physical, Elemental, Lightning }',
    '20% of Physical Damage Converted to Lightning Damage',
    '--------',
    '{ Prefix Modifier "Athlete\'s" (Tier: 1) — Life }',
    '+128(115-129) to maximum Life',
    '{ Suffix Modifier "of the Volcano" (Tier: 3) — Elemental, Fire, Resistance }',
    '+39(36-41)% to Fire Resistance',
    '{ Master Crafted Suffix Modifier "of Craft" (Rank: 3) — Attack }',
    '+213(151-220) to Accuracy Rating',
    'Searing Exarch Item',
    'Eater of Worlds Item'
  ].join('\n')
  const gloves = parseItemText(eldritchGloves)
  assert.ok(gloves)
  assert.equal(gloves.sockets, 4)
  assert.deepEqual(gloves.socketColors, { r: 1, g: 1, b: 0, w: 2 })
  assert.equal(gloves.influences?.length, 2)
  assert.equal(gloves.modifiers.length, 5)
})
