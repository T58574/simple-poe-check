import { app } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { classifyStashItem, type RawStashItem } from '../shared/stashValuation'
import type {
  PricedStashItem,
  StashAuthStatus,
  StashSnapshot,
  StashTabInfo
} from '../shared/types'
import type { ConfigStore } from './config'
import type { PoeApiClient } from './poeApi'

const MAX_STORED_SNAPSHOTS = 100

interface CharacterWindowStashResponse {
  numTabs?: number
  tabs?: Array<{
    n: string
    i: number
    id: string
    type: string
    colour?: { r: number; g: number; b: number }
  }>
  items?: RawStashItem[]
  error?: { code: number; message: string }
}

export class StashService {
  private readonly snapshotsPath: string
  private snapshots: StashSnapshot[] = []

  constructor (
    private readonly configStore: ConfigStore,
    private readonly poeApi: PoeApiClient
  ) {
    this.snapshotsPath = path.join(app.getPath('userData'), 'stash-snapshots.json')
    this.snapshots = this.loadSnapshots()
  }

  getAuthStatus (): StashAuthStatus {
    const cfg = this.configStore.get()
    const hasSessId = cfg.poeSessId.trim().length > 0
    return {
      authenticated: hasSessId,
      accountName: cfg.accountName || '',
      hasSessId
    }
  }

  async setSession (poeSessId: string, accountName?: string): Promise<StashAuthStatus> {
    const cleanSess = poeSessId.trim()
    if (!cleanSess) {
      throw new Error('POESESSID cannot be empty.')
    }
    this.configStore.save({
      poeSessId: cleanSess,
      ...(accountName !== undefined ? { accountName: accountName.trim() } : {})
    })
    if (!accountName?.trim()) {
      await this.resolveAccountName().catch(() => '')
    }
    return this.getAuthStatus()
  }

  async logout (): Promise<StashAuthStatus> {
    this.configStore.save({ poeSessId: '', accountName: '' })
    return this.getAuthStatus()
  }

  async resolveAccountName (): Promise<string> {
    const cfg = this.configStore.get()
    if (!cfg.poeSessId.trim()) {
      throw new Error('POESESSID is not set. Please sign in first.')
    }

    try {
      const profile = await this.poeApi.fetchPoeApi<{ name?: string }>(
        'https://www.pathofexile.com/api/profile',
        'stash-profile'
      )
      if (profile?.name) {
        this.configStore.save({ accountName: profile.name })
        return profile.name
      }
    } catch {
      // Fallback to get-account-name or user-provided name
    }

    if (cfg.accountName.trim()) {
      return cfg.accountName.trim()
    }
    throw new Error('Could not resolve PoE account name. Enter your Account Name in Settings.')
  }

  async getStashTabs (): Promise<StashTabInfo[]> {
    const cfg = this.configStore.get()
    if (!cfg.poeSessId.trim()) {
      throw new Error('Not signed in. Click "Sign in" or paste POESESSID in Settings.')
    }
    const accountName = cfg.accountName.trim() || (await this.resolveAccountName())
    const data = await this.fetchTabResponse(cfg.league, cfg.realm, accountName, 0, true)
    return mapTabs(data)
  }

  async takeSnapshot (requestedTabIds?: string[]): Promise<StashSnapshot> {
    const cfg = this.configStore.get()
    if (!cfg.poeSessId.trim()) {
      throw new Error('Not signed in. Click "Sign in" or paste POESESSID in Settings.')
    }

    await this.poeApi.ensureNinjaLoaded()
    const accountName = cfg.accountName.trim() || (await this.resolveAccountName())

    const firstTabData = await this.fetchTabResponse(cfg.league, cfg.realm, accountName, 0, true)
    const allTabs = mapTabs(firstTabData)
    if (allTabs.length === 0) {
      throw new Error('No stash tabs found for this league.')
    }

    const targetIds = requestedTabIds && requestedTabIds.length > 0
      ? requestedTabIds
      : cfg.selectedStashTabIds.length > 0
        ? cfg.selectedStashTabIds
        : allTabs.slice(0, 3).map((t) => t.id)

    const selectedTabs = allTabs.filter((t) => targetIds.includes(t.id))
    const tabsToScan = selectedTabs.length > 0 ? selectedTabs : allTabs.slice(0, 1)

    const pricedItems: PricedStashItem[] = []
    const tabSummaries: StashSnapshot['tabs'] = []
    const divineRate = this.poeApi.getDivineChaosRate()

    for (const tab of tabsToScan) {
      const tabData = tab.index === 0
        ? firstTabData
        : await this.fetchTabResponse(cfg.league, cfg.realm, accountName, tab.index, false)

      const rawItems = tabData.items ?? []
      let tabChaos = 0

      for (const raw of rawItems) {
        const stackSize = raw.stackSize ?? 1
        const { category, rarity, links } = classifyStashItem(raw)
        const { unitChaos, key } = this.poeApi.priceRawStashItem(raw)
        const totalChaos = Number((unitChaos * stackSize).toFixed(1))
        const displayName = raw.name ? `${raw.name} ${raw.typeLine}`.trim() : raw.typeLine

        tabChaos += totalChaos
        pricedItems.push({
          id: raw.id,
          key,
          name: displayName,
          baseType: raw.baseType || raw.typeLine,
          typeLine: raw.typeLine,
          icon: raw.icon || '',
          stackSize,
          unitChaos: Number(unitChaos.toFixed(2)),
          totalChaos,
          tabId: tab.id,
          tabName: tab.name,
          category,
          rarity,
          frameType: raw.frameType ?? 0,
          links,
          corrupted: Boolean(raw.corrupted)
        })
      }

      tabSummaries.push({
        id: tab.id,
        name: tab.name,
        totalChaos: Number(tabChaos.toFixed(1)),
        itemCount: rawItems.length
      })
    }

    const totalChaos = Number(
      tabSummaries.reduce((sum, t) => sum + t.totalChaos, 0).toFixed(1)
    )
    const totalDivine = divineRate > 0 ? Number((totalChaos / divineRate).toFixed(2)) : 0

    const snapshot: StashSnapshot = {
      id: crypto.randomUUID(),
      league: cfg.league,
      createdAt: Date.now(),
      totalChaos,
      totalDivine,
      divineRate,
      tabs: tabSummaries,
      items: pricedItems.sort((a, b) => b.totalChaos - a.totalChaos)
    }

    this.snapshots.unshift(snapshot)
    if (this.snapshots.length > MAX_STORED_SNAPSHOTS) {
      this.snapshots = this.snapshots.slice(0, MAX_STORED_SNAPSHOTS)
    }
    this.saveSnapshots()
    return snapshot
  }

  getSnapshots (league?: string): StashSnapshot[] {
    if (!league) return this.snapshots
    return this.snapshots.filter((s) => s.league === league)
  }

  deleteSnapshot (id: string): StashSnapshot[] {
    this.snapshots = this.snapshots.filter((s) => s.id !== id)
    this.saveSnapshots()
    return this.snapshots
  }

  private async fetchTabResponse (
    league: string,
    realm: string,
    accountName: string,
    tabIndex: number,
    includeTabs: boolean
  ): Promise<CharacterWindowStashResponse> {
    const params = new URLSearchParams({
      league,
      realm,
      accountName,
      tabs: includeTabs ? '1' : '0',
      tabIndex: String(tabIndex)
    })
    const url = `https://www.pathofexile.com/character-window/get-stash-items?${params.toString()}`
    const res = await this.poeApi.fetchPoeApi<CharacterWindowStashResponse>(url, 'stash-api')
    if (res.error) {
      throw new Error(`PoE Stash API (${res.error.code}): ${res.error.message}`)
    }
    return res
  }

  private loadSnapshots (): StashSnapshot[] {
    try {
      const raw = fs.readFileSync(this.snapshotsPath, 'utf8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as StashSnapshot[]) : []
    } catch {
      return []
    }
  }

  private saveSnapshots (): void {
    try {
      fs.mkdirSync(path.dirname(this.snapshotsPath), { recursive: true })
      fs.writeFileSync(this.snapshotsPath, JSON.stringify(this.snapshots), 'utf8')
    } catch {
      // Ignore snapshot persistence errors
    }
  }
}

function mapTabs (res: CharacterWindowStashResponse): StashTabInfo[] {
  return (res.tabs ?? []).map((t) => ({
    id: t.id,
    name: t.n,
    index: t.i,
    type: t.type,
    colour: t.colour
  }))
}
