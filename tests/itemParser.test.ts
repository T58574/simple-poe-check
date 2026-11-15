import assert from 'node:assert/strict'
import test from 'node:test'
import { parseItemText } from '../src/shared/itemParser'
import { StatMatcher } from '../src/shared/statMatcher'

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
