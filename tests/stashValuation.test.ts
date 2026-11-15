import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBulkListings,
  classifyStashItem,
  computeSnapshotDiff,
  formatBulkText
} from '../src/shared/stashValuation'
import type { StashSnapshot } from '../src/shared/types'

test('classifyStashItem identifies scarabs, essences, cards, and 6L uniques', () => {
  assert.equal(
    classifyStashItem({ id: '1', typeLine: 'Polished Legion Scarab', frameType: 5 }).category,
    'Scarab'
  )
  assert.equal(
    classifyStashItem({ id: '2', typeLine: 'Deafening Essence of Greed', frameType: 5 }).category,
    'Essence'
  )
  assert.equal(
    classifyStashItem({ id: '3', typeLine: 'The Doctor', frameType: 6 }).category,
    'Divination Card'
  )
  const uniq = classifyStashItem({
    id: '4',
    name: 'Mageblood',
    typeLine: 'Heavy Belt',
    frameType: 3,
    sockets: [
      { group: 0 }, { group: 0 }, { group: 0 },
      { group: 0 }, { group: 0 }, { group: 0 }
    ]
  })
  assert.equal(uniq.category, 'Unique')
  assert.equal(uniq.links, 6)
})

test('computeSnapshotDiff calculates hourly profit and item deltas', () => {
  const t0 = 1_700_000_000_000
  const base: StashSnapshot = {
    id: 's1',
    league: 'Test',
    createdAt: t0,
    totalChaos: 100,
    totalDivine: 0.5,
    divineRate: 200,
    tabs: [{ id: 't1', name: 'Currency', totalChaos: 100, itemCount: 1 }],
    items: [
      {
        id: 'i1',
        key: 'currency::chaos orb',
        name: 'Chaos Orb',
        baseType: 'Chaos Orb',
        typeLine: 'Chaos Orb',
        icon: '',
        stackSize: 100,
        unitChaos: 1,
        totalChaos: 100,
        tabId: 't1',
        tabName: 'Currency',
        category: 'Currency',
        rarity: 'Currency',
        frameType: 5,
        links: 0,
        corrupted: false
      }
    ]
  }

  const curr: StashSnapshot = {
    ...base,
    id: 's2',
    createdAt: t0 + 1_800_000, // 30 minutes later
    totalChaos: 400,
    totalDivine: 2,
    items: [
      { ...base.items[0], stackSize: 150, totalChaos: 150 },
      {
        id: 'i2',
        key: 'scarab::winged ambush scarab',
        name: 'Winged Ambush Scarab',
        baseType: 'Winged Ambush Scarab',
        typeLine: 'Winged Ambush Scarab',
        icon: '',
        stackSize: 10,
        unitChaos: 25,
        totalChaos: 250,
        tabId: 't1',
        tabName: 'Currency',
        category: 'Scarab',
        rarity: 'Currency',
        frameType: 5,
        links: 0,
        corrupted: false
      }
    ]
  }

  const diff = computeSnapshotDiff(base, curr)
  assert.equal(diff.durationMin, 30)
  assert.equal(diff.deltaChaos, 300)
  assert.equal(diff.chaosPerHour, 600)
  assert.equal(diff.divinePerHour, 3)
  assert.equal(diff.topGains[0].name, 'Winged Ambush Scarab')
  assert.equal(diff.topGains[0].deltaQty, 10)
})

test('buildBulkListings aggregates across tabs and formatBulkText formats output', () => {
  const snap: StashSnapshot = {
    id: 's1',
    league: 'Test',
    createdAt: 1000,
    totalChaos: 250,
    totalDivine: 1.25,
    divineRate: 200,
    tabs: [],
    items: [
      {
        id: 'a',
        key: 'scarab::rust',
        name: 'Rusted Scarab',
        baseType: 'Rusted Scarab',
        typeLine: 'Rusted Scarab',
        icon: '',
        stackSize: 10,
        unitChaos: 5,
        totalChaos: 50,
        tabId: 't1',
        tabName: 'Dump 1',
        category: 'Scarab',
        rarity: 'Currency',
        frameType: 5,
        links: 0,
        corrupted: false
      },
      {
        id: 'b',
        key: 'scarab::rust',
        name: 'Rusted Scarab',
        baseType: 'Rusted Scarab',
        typeLine: 'Rusted Scarab',
        icon: '',
        stackSize: 20,
        unitChaos: 5,
        totalChaos: 100,
        tabId: 't2',
        tabName: 'Dump 2',
        category: 'Scarab',
        rarity: 'Currency',
        frameType: 5,
        links: 0,
        corrupted: false
      }
    ]
  }

  const bulk = buildBulkListings(snap, 20)
  assert.equal(bulk.length, 1)
  assert.equal(bulk[0].quantity, 30)
  assert.equal(bulk[0].totalChaos, 150)
  assert.deepEqual(bulk[0].tabs, ['Dump 1', 'Dump 2'])

  const text = formatBulkText(bulk, 200, 90)
  assert.ok(text.includes('30x Rusted Scarab'))
  assert.ok(text.includes('90% ninja'))
})
