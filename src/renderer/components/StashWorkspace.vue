<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  buildBulkListings,
  computeSnapshotDiff,
  formatBulkText
} from '@shared/stashValuation'
import type {
  AppConfig,
  ChatMacro,
  StashAuthStatus,
  StashSnapshot,
  StashTabInfo,
  TradeStatusOption
} from '@shared/types'

const props = defineProps<{
  config: AppConfig
  leagues: string[]
  detached?: boolean
  initialSection?: 'stash' | 'farm' | 'bulk' | 'settings'
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save-config', partial: Partial<AppConfig>): void
  (e: 'refresh-cache'): void
}>()

type Section = 'stash' | 'farm' | 'bulk' | 'settings'
const activeSection = ref<Section>(props.initialSection ?? 'stash')

const auth = ref<StashAuthStatus>({ authenticated: false, accountName: '', hasSessId: false })
const tabs = ref<StashTabInfo[]>([])
const snapshots = ref<StashSnapshot[]>([])
const selectedSnapshotId = ref<string>('')
const baselineSnapshotId = ref<string>('')
const compareSnapshotId = ref<string>('')

const busyAuth = ref(false)
const showAuthBox = ref(false)
const authSessInput = ref('')
const authAccountInput = ref('')
const busyTabs = ref(false)
const busySnap = ref(false)
const statusText = ref('')
const errorText = ref('')

// Stash filters & sorting
type SortKey = 'name' | 'tabName' | 'stackSize' | 'unitChaos' | 'totalChaos'
const itemQuery = ref('')
const itemCategory = ref('All')
const itemTabFilter = ref('All')
const sortBy = ref<SortKey>('totalChaos')
const sortDir = ref<'asc' | 'desc'>('desc')
const copiedItemId = ref<string | null>(null)

// Bulk filters
const bulkCategory = ref('All')
const bulkMultiplier = ref(100)
const bulkCopied = ref(false)

// Local settings draft
const draft = ref<AppConfig>({ ...props.config, chatMacros: props.config.chatMacros.map((m) => ({ ...m })) })

watch(
  () => props.config,
  (next) => {
    draft.value = { ...next, chatMacros: next.chatMacros.map((m) => ({ ...m })) }
  },
  { deep: true }
)

const currentSnapshot = computed(() => {
  if (snapshots.value.length === 0) return null
  return snapshots.value.find((s) => s.id === selectedSnapshotId.value) ?? snapshots.value[0]
})

const categories = computed(() => {
  const set = new Set<string>(['All'])
  for (const item of currentSnapshot.value?.items ?? []) {
    set.add(item.category)
  }
  return Array.from(set)
})

const snapshotTabs = computed(() => {
  const set = new Set<string>(['All'])
  for (const item of currentSnapshot.value?.items ?? []) {
    set.add(item.tabName)
  }
  return Array.from(set)
})

const filteredItems = computed(() => {
  const snap = currentSnapshot.value
  if (!snap) return []
  const q = itemQuery.value.trim().toLowerCase()
  const minChaos = props.config.minItemChaos ?? 0
  const filtered = snap.items.filter((item) => {
    if (minChaos > 0 && item.totalChaos < minChaos) return false
    if (itemCategory.value !== 'All' && item.category !== itemCategory.value) return false
    if (itemTabFilter.value !== 'All' && item.tabName !== itemTabFilter.value) return false
    if (q && !item.name.toLowerCase().includes(q) && !item.tabName.toLowerCase().includes(q)) return false
    return true
  })

  const dir = sortDir.value === 'asc' ? 1 : -1
  return [...filtered].sort((a, b) => {
    switch (sortBy.value) {
      case 'name':
        return a.name.localeCompare(b.name) * dir
      case 'tabName':
        return a.tabName.localeCompare(b.tabName) * dir
      case 'stackSize':
        return (a.stackSize - b.stackSize) * dir
      case 'unitChaos':
        return (a.unitChaos - b.unitChaos) * dir
      case 'totalChaos':
      default:
        return (a.totalChaos - b.totalChaos) * dir
    }
  })
})

function toggleSort (col: SortKey): void {
  if (sortBy.value === col) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = col
    sortDir.value = col === 'name' || col === 'tabName' ? 'asc' : 'desc'
  }
}

function sortArrow (col: SortKey): string {
  if (sortBy.value !== col) return ''
  return sortDir.value === 'asc' ? ' ▲' : ' ▼'
}

function formatDiv (chaos: number, rate: number): string {
  if (!rate || rate <= 0 || chaos <= 0) return '-'
  const val = chaos / rate
  return val >= 0.01 ? val.toFixed(2) : '<0.01'
}

function popOut (): void {
  window.poeCheck.popOutApp()
}

function copyItemName (name: string, key: string): void {
  void navigator.clipboard.writeText(name)
  copiedItemId.value = key
  setTimeout(() => {
    if (copiedItemId.value === key) copiedItemId.value = null
  }, 1200)
}

const farmSummary = computed(() => {
  if (snapshots.value.length < 2) return null
  const curr = snapshots.value.find((s) => s.id === compareSnapshotId.value) ?? snapshots.value[0]
  const base = snapshots.value.find((s) => s.id === baselineSnapshotId.value) ?? snapshots.value[1]
  if (!curr || !base || curr.id === base.id) return null
  return computeSnapshotDiff(base, curr)
})

const bulkItems = computed(() => {
  if (!currentSnapshot.value) return []
  return buildBulkListings(
    currentSnapshot.value,
    props.config.bulkMinChaos ?? 10,
    bulkCategory.value
  )
})

const bulkTotalChaos = computed(() =>
  Math.round(bulkItems.value.reduce((acc, i) => acc + i.totalChaos * (bulkMultiplier.value / 100), 0))
)

async function loadInitial (): Promise<void> {
  try {
    auth.value = await window.poeCheck.stashAuthStatus()
    const list = await window.poeCheck.stashGetSnapshots(props.config.league)
    snapshots.value = list
    if (list.length > 0) {
      selectedSnapshotId.value = list[0].id
      compareSnapshotId.value = list[0].id
      baselineSnapshotId.value = list[Math.min(1, list.length - 1)].id
    }
    if (auth.value.authenticated) {
      await loadTabs(true)
    }
  } catch (err) {
    errorText.value = err instanceof Error ? err.message : 'Failed to load stash data'
  }
}

function openBrowserSignIn (): void {
  errorText.value = ''
  window.poeCheck.openExternal('https://www.pathofexile.com/login')
  showAuthBox.value = true
  authSessInput.value = draft.value.poeSessId || ''
  authAccountInput.value = draft.value.accountName || ''
  statusText.value = 'Browser opened. Copy POESESSID from DevTools -> Application -> Cookies and paste below.'
}

async function submitSession (): Promise<void> {
  if (!authSessInput.value.trim()) {
    errorText.value = 'Paste POESESSID first.'
    return
  }
  busyAuth.value = true
  errorText.value = ''
  try {
    auth.value = await window.poeCheck.stashAuthLogin(
      authSessInput.value.trim(),
      authAccountInput.value.trim() || undefined
    )
    draft.value = await window.poeCheck.getConfig()
    showAuthBox.value = false
    statusText.value = auth.value.accountName
      ? `Signed in as ${auth.value.accountName}`
      : 'Session saved'
    await loadTabs(true)
  } catch (err) {
    errorText.value = err instanceof Error ? err.message : 'Sign-in failed'
  } finally {
    busyAuth.value = false
  }
}

async function signOut (): Promise<void> {
  busyAuth.value = true
  errorText.value = ''
  try {
    auth.value = await window.poeCheck.stashAuthLogout()
    tabs.value = []
    draft.value.poeSessId = ''
    draft.value.accountName = ''
    statusText.value = 'Signed out'
  } finally {
    busyAuth.value = false
  }
}

async function loadTabs (silent = false): Promise<void> {
  busyTabs.value = true
  if (!silent) errorText.value = ''
  try {
    tabs.value = await window.poeCheck.stashGetTabs()
  } catch (err) {
    if (!silent) {
      errorText.value = err instanceof Error ? err.message : 'Failed to fetch stash tabs'
    }
  } finally {
    busyTabs.value = false
  }
}

function toggleTabSelection (tabId: string): void {
  const current = new Set(props.config.selectedStashTabIds ?? [])
  if (current.has(tabId)) {
    current.delete(tabId)
  } else {
    current.add(tabId)
  }
  const next = Array.from(current)
  draft.value.selectedStashTabIds = next
  emit('save-config', { selectedStashTabIds: next })
}

async function takeSnapshot (): Promise<void> {
  busySnap.value = true
  errorText.value = ''
  statusText.value = 'Scanning selected tabs and pricing via poe.ninja...'
  try {
    const plainTabIds = [...(props.config.selectedStashTabIds ?? [])]
    const snap = await window.poeCheck.stashTakeSnapshot(plainTabIds)
    snapshots.value = [snap, ...snapshots.value]
    selectedSnapshotId.value = snap.id
    if (snapshots.value.length >= 2 && !baselineSnapshotId.value) {
      baselineSnapshotId.value = snapshots.value[1].id
    }
    compareSnapshotId.value = snap.id
    statusText.value = `Snapshot saved: ${snap.totalChaos.toLocaleString()}c (${snap.totalDivine} div)`
  } catch (err) {
    errorText.value = err instanceof Error ? err.message : 'Snapshot failed'
    statusText.value = ''
  } finally {
    busySnap.value = false
  }
}

async function startFarmSession (): Promise<void> {
  await takeSnapshot()
  if (snapshots.value.length > 0) {
    baselineSnapshotId.value = snapshots.value[0].id
    compareSnapshotId.value = snapshots.value[0].id
    statusText.value = 'Farm session baseline recorded. Run maps, then take another snapshot.'
  }
}

async function deleteSnap (id: string): Promise<void> {
  snapshots.value = await window.poeCheck.stashDeleteSnapshot(id)
  if (selectedSnapshotId.value === id) {
    selectedSnapshotId.value = snapshots.value[0]?.id ?? ''
  }
}

function copyBulk (): void {
  const text = formatBulkText(
    bulkItems.value,
    currentSnapshot.value?.divineRate ?? 0,
    bulkMultiplier.value
  )
  if (!text) return
  void navigator.clipboard.writeText(text)
  bulkCopied.value = true
  setTimeout(() => {
    bulkCopied.value = false
  }, 1600)
}

function addMacro (): void {
  draft.value.chatMacros.push({
    id: `macro-${Date.now()}`,
    label: 'Macro',
    hotkey: '',
    command: '',
    send: true
  })
}

function removeMacro (idx: number): void {
  draft.value.chatMacros.splice(idx, 1)
}

function saveSettings (): void {
  const payload: Partial<AppConfig> = {
    league: draft.value.league,
    gameWindowTitle: draft.value.gameWindowTitle,
    priceCheckHotkey: draft.value.priceCheckHotkey,
    toggleAppHotkey: draft.value.toggleAppHotkey,
    closeHotkey: draft.value.closeHotkey,
    tradeStatus: draft.value.tradeStatus as TradeStatusOption,
    poeSessId: draft.value.poeSessId.trim(),
    accountName: draft.value.accountName.trim(),
    minItemChaos: Number(draft.value.minItemChaos) || 0,
    bulkMinChaos: Number(draft.value.bulkMinChaos) || 10,
    autoSearchOnFilterChange: draft.value.autoSearchOnFilterChange,
    restoreClipboard: draft.value.restoreClipboard,
    ninjaCacheTtlMinutes: Number(draft.value.ninjaCacheTtlMinutes) || 60,
    tradeCacheTtlMinutes: Number(draft.value.tradeCacheTtlMinutes) || 5,
    chatMacros: draft.value.chatMacros.map((m: ChatMacro) => ({ ...m }))
  }
  emit('save-config', payload)
  auth.value = {
    authenticated: payload.poeSessId!.length > 0,
    accountName: payload.accountName ?? '',
    hasSessId: payload.poeSessId!.length > 0
  }
  statusText.value = 'Settings saved'
}

function onLeagueChange (ev: Event): void {
  const nextLeague = (ev.target as HTMLSelectElement).value
  draft.value.league = nextLeague
  emit('save-config', { league: nextLeague })
  void window.poeCheck.stashGetSnapshots(nextLeague).then((list) => {
    snapshots.value = list
    selectedSnapshotId.value = list[0]?.id ?? ''
  })
}

const busyNinja = ref(false)

async function refreshNinjaPrices (): Promise<void> {
  busyNinja.value = true
  errorText.value = ''
  statusText.value = 'Refreshing poe.ninja prices...'
  try {
    await window.poeCheck.refreshCache()
    emit('refresh-cache')
    statusText.value = 'poe.ninja prices updated'
  } catch (err) {
    errorText.value = err instanceof Error ? err.message : 'Failed to refresh cache'
    statusText.value = ''
  } finally {
    busyNinja.value = false
  }
}

function formatTime (ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function tabColorStyle (tab: StashTabInfo): Record<string, string> {
  if (!tab.colour) return {}
  return {
    borderLeft: `3px solid rgb(${tab.colour.r}, ${tab.colour.g}, ${tab.colour.b})`
  }
}

onMounted(() => {
  void loadInitial()
})
</script>

<template>
  <div class="ws-shell" :class="{ detached: props.detached }">
    <!-- Top Header -->
    <header class="ws-header">
      <div class="ws-brand">
        <span class="ws-brand-dot" />
        <span class="ws-title">Simple PoE Check</span>
        <span v-if="!props.detached" class="ws-shortcut-hint">{{ config.toggleAppHotkey }}</span>
      </div>

      <div class="ws-header-controls">
        <select class="ws-select" :value="config.league" @change="onLeagueChange">
          <option v-for="lg in leagues" :key="lg" :value="lg">{{ lg }}</option>
        </select>

        <template v-if="auth.authenticated">
          <span class="ws-account-pill">
            {{ auth.accountName || 'Session Active' }}
          </span>
          <button class="ws-btn" :disabled="busyAuth" @click="signOut">Sign out</button>
        </template>
        <button v-else class="ws-btn ws-btn-accent" :disabled="busyAuth" @click="openBrowserSignIn">
          Sign in (PoE)
        </button>

        <button class="ws-btn" :disabled="busyNinja" @click="refreshNinjaPrices">
          {{ busyNinja ? 'Refreshing...' : 'Refresh Ninja' }}
        </button>
        <button v-if="!props.detached" class="ws-btn" @click="popOut">Pop Out</button>
        <button class="ws-btn ws-btn-close" @click="emit('close')">Close</button>
      </div>
    </header>

    <!-- Navigation Tabs -->
    <nav class="ws-nav">
      <button
        class="ws-nav-item"
        :class="{ active: activeSection === 'stash' }"
        @click="activeSection = 'stash'"
      >
        Stash &amp; Net Worth
      </button>
      <button
        class="ws-nav-item"
        :class="{ active: activeSection === 'farm' }"
        @click="activeSection = 'farm'"
      >
        Farm Tracker
      </button>
      <button
        class="ws-nav-item"
        :class="{ active: activeSection === 'bulk' }"
        @click="activeSection = 'bulk'"
      >
        Bulk Selling
      </button>
      <button
        class="ws-nav-item"
        :class="{ active: activeSection === 'settings' }"
        @click="activeSection = 'settings'"
      >
        Settings
      </button>
    </nav>

    <!-- Status / Error banner -->
    <div v-if="errorText" class="ws-banner ws-banner-error">{{ errorText }}</div>
    <div v-else-if="statusText" class="ws-banner ws-banner-info">{{ statusText }}</div>

    <!-- Browser POESESSID Paste Bar -->
    <div v-if="showAuthBox" class="ws-auth-box">
      <div class="ws-auth-hint">
        1. Sign in at pathofexile.com in your browser. 2. Open DevTools (F12) &gt; Application &gt; Cookies &gt; POESESSID. 3. Paste below:
      </div>
      <div class="ws-auth-row">
        <input
          v-model="authSessInput"
          type="password"
          class="ws-input ws-auth-sess"
          placeholder="Paste POESESSID..."
        />
        <input
          v-model="authAccountInput"
          type="text"
          class="ws-input"
          placeholder="Account Name (optional)"
        />
        <button class="ws-btn ws-btn-accent" :disabled="busyAuth" @click="submitSession">
          {{ busyAuth ? 'Connecting...' : 'Connect' }}
        </button>
        <button class="ws-btn" @click="showAuthBox = false">Cancel</button>
      </div>
    </div>

    <!-- Main Body -->
    <main class="ws-body">
      <!-- STASH SECTION -->
      <section v-if="activeSection === 'stash'" class="ws-pane">
        <div class="ws-toolbar">
          <div class="ws-metrics">
            <div class="ws-metric">
              <span class="ws-metric-label">Net Worth</span>
              <span class="ws-metric-value accent-orange">
                {{ currentSnapshot ? `${currentSnapshot.totalChaos.toLocaleString()} c` : '0 c' }}
              </span>
            </div>
            <div class="ws-metric">
              <span class="ws-metric-label">In Divines</span>
              <span class="ws-metric-value accent-blue">
                {{ currentSnapshot ? `${currentSnapshot.totalDivine} div` : '0 div' }}
              </span>
            </div>
            <div class="ws-metric">
              <span class="ws-metric-label">Divine Rate</span>
              <span class="ws-metric-value">
                {{ currentSnapshot?.divineRate ? `${Math.round(currentSnapshot.divineRate)} c` : '-' }}
              </span>
            </div>
            <div class="ws-metric">
              <span class="ws-metric-label">Snapshot</span>
              <select
                v-if="snapshots.length > 0"
                v-model="selectedSnapshotId"
                class="ws-select"
              >
                <option v-for="s in snapshots" :key="s.id" :value="s.id">
                  {{ formatTime(s.createdAt) }} — {{ s.totalChaos.toLocaleString() }}c
                </option>
              </select>
              <span v-else class="ws-muted">No snapshots</span>
            </div>
          </div>

          <div class="ws-actions">
            <button class="ws-btn" :disabled="busyTabs || !auth.authenticated" @click="loadTabs(false)">
              {{ busyTabs ? 'Loading...' : 'Sync Tabs' }}
            </button>
            <button
              class="ws-btn ws-btn-accent"
              :disabled="busySnap || !auth.authenticated"
              @click="takeSnapshot()"
            >
              {{ busySnap ? 'Scanning...' : 'Take Snapshot' }}
            </button>
          </div>
        </div>

        <!-- Tab Selector -->
        <div v-if="tabs.length > 0" class="ws-tab-picker">
          <span class="ws-muted">Tabs to scan:</span>
          <div class="ws-tab-chips">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              class="ws-tab-chip"
              :class="{ selected: (config.selectedStashTabIds ?? []).includes(tab.id) }"
              :style="tabColorStyle(tab)"
              @click="toggleTabSelection(tab.id)"
            >
              {{ tab.name }}
            </button>
          </div>
        </div>
        <div v-else-if="!auth.authenticated" class="ws-empty">
          Sign in with your Path of Exile account (or paste POESESSID in Settings) to load your stash tabs.
        </div>

        <!-- Item Filter Bar -->
        <div v-if="currentSnapshot" class="ws-filter-bar">
          <input
            v-model="itemQuery"
            type="text"
            class="ws-input"
            placeholder="Filter items or tab..."
          />
          <select v-model="itemCategory" class="ws-select">
            <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
          </select>
          <select v-model="itemTabFilter" class="ws-select">
            <option v-for="tName in snapshotTabs" :key="tName" :value="tName">
              {{ tName === 'All' ? 'All Tabs' : tName }}
            </option>
          </select>
          <span class="ws-muted">
            {{ filteredItems.length }} items
            <template v-if="(config.minItemChaos ?? 0) > 0"> (min {{ config.minItemChaos }}c)</template>
          </span>
        </div>

        <!-- Priced Items Table -->
        <div v-if="currentSnapshot" class="ws-table-wrap">
          <table class="ws-table">
            <thead>
              <tr>
                <th class="sortable" @click="toggleSort('name')">Item{{ sortArrow('name') }}</th>
                <th>Category</th>
                <th class="sortable" @click="toggleSort('tabName')">Tab{{ sortArrow('tabName') }}</th>
                <th class="num sortable" @click="toggleSort('stackSize')">Qty{{ sortArrow('stackSize') }}</th>
                <th class="num sortable" @click="toggleSort('unitChaos')">Unit (c){{ sortArrow('unitChaos') }}</th>
                <th class="num sortable" @click="toggleSort('totalChaos')">Total (c){{ sortArrow('totalChaos') }}</th>
                <th class="num sortable" @click="toggleSort('totalChaos')">Total (div){{ sortArrow('totalChaos') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in filteredItems" :key="item.id">
                <td class="item-cell">
                  <img v-if="item.icon" :src="item.icon" class="item-icon" alt="" />
                  <span
                    class="item-copy-name"
                    :class="`rarity-${item.rarity}`"
                    title="Click to copy name"
                    @click="copyItemName(item.name, item.id)"
                  >
                    {{ item.name }}
                  </span>
                  <span v-if="copiedItemId === item.id" class="ws-copied-tag">Copied</span>
                </td>
                <td>{{ item.category }}</td>
                <td class="ws-muted">{{ item.tabName }}</td>
                <td class="num">{{ item.stackSize }}</td>
                <td class="num">{{ item.unitChaos }}</td>
                <td class="num accent-orange">{{ item.totalChaos }}</td>
                <td class="num accent-blue">{{ formatDiv(item.totalChaos, currentSnapshot.divineRate) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- FARM TRACKER SECTION -->
      <section v-if="activeSection === 'farm'" class="ws-pane">
        <div class="ws-toolbar">
          <div class="ws-farm-selectors">
            <label class="ws-field-inline">
              <span>Baseline:</span>
              <select v-model="baselineSnapshotId" class="ws-select">
                <option v-for="s in snapshots" :key="s.id" :value="s.id">
                  {{ formatTime(s.createdAt) }} ({{ s.totalChaos.toLocaleString() }}c)
                </option>
              </select>
            </label>
            <label class="ws-field-inline">
              <span>Current:</span>
              <select v-model="compareSnapshotId" class="ws-select">
                <option v-for="s in snapshots" :key="s.id" :value="s.id">
                  {{ formatTime(s.createdAt) }} ({{ s.totalChaos.toLocaleString() }}c)
                </option>
              </select>
            </label>
          </div>

          <div class="ws-actions">
            <button
              class="ws-btn"
              :disabled="busySnap || !auth.authenticated"
              @click="startFarmSession"
            >
              Start Farm Session
            </button>
            <button
              class="ws-btn ws-btn-accent"
              :disabled="busySnap || !auth.authenticated"
              @click="takeSnapshot()"
            >
              {{ busySnap ? 'Scanning...' : 'Update Now' }}
            </button>
          </div>
        </div>

        <div v-if="farmSummary" class="ws-metrics ws-metrics-box">
          <div class="ws-metric">
            <span class="ws-metric-label">Duration</span>
            <span class="ws-metric-value">{{ farmSummary.durationMin }} min</span>
          </div>
          <div class="ws-metric">
            <span class="ws-metric-label">Net Profit</span>
            <span
              class="ws-metric-value"
              :class="farmSummary.deltaChaos >= 0 ? 'accent-green' : 'accent-danger'"
            >
              {{ farmSummary.deltaChaos >= 0 ? '+' : '' }}{{ farmSummary.deltaChaos }} c
              ({{ farmSummary.deltaDivine >= 0 ? '+' : '' }}{{ farmSummary.deltaDivine }} div)
            </span>
          </div>
          <div class="ws-metric">
            <span class="ws-metric-label">Chaos / hr</span>
            <span class="ws-metric-value accent-orange">{{ farmSummary.chaosPerHour }} c/hr</span>
          </div>
          <div class="ws-metric">
            <span class="ws-metric-label">Divine / hr</span>
            <span class="ws-metric-value accent-blue">{{ farmSummary.divinePerHour }} div/hr</span>
          </div>
        </div>

        <div v-if="farmSummary" class="ws-table-wrap">
          <table class="ws-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th class="num">Delta Qty</th>
                <th class="num">Current Qty</th>
                <th class="num">Delta (c)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in farmSummary.topGains" :key="row.key">
                <td class="item-cell">
                  <img v-if="row.icon" :src="row.icon" class="item-icon" alt="" />
                  <span
                    class="item-copy-name"
                    title="Click to copy name"
                    @click="copyItemName(row.name, `farm-${row.key}`)"
                  >
                    {{ row.name }}
                  </span>
                  <span v-if="copiedItemId === `farm-${row.key}`" class="ws-copied-tag">Copied</span>
                </td>
                <td>{{ row.category }}</td>
                <td class="num" :class="row.deltaQty >= 0 ? 'accent-green' : 'accent-danger'">
                  {{ row.deltaQty >= 0 ? '+' : '' }}{{ row.deltaQty }}
                </td>
                <td class="num">{{ row.currentQty }}</td>
                <td class="num" :class="row.deltaChaos >= 0 ? 'accent-green' : 'accent-danger'">
                  {{ row.deltaChaos >= 0 ? '+' : '' }}{{ row.deltaChaos }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="ws-empty">
          Take at least two snapshots (or click "Start Farm Session", run maps, then "Update Now") to measure profit per hour.
        </div>

        <div v-if="snapshots.length > 0" class="ws-snap-history">
          <span class="ws-muted">Saved snapshots:</span>
          <div class="ws-tab-chips">
            <div v-for="s in snapshots.slice(0, 8)" :key="s.id" class="ws-snap-pill">
              <span>{{ formatTime(s.createdAt) }} ({{ Math.round(s.totalChaos) }}c)</span>
              <button class="ws-pill-del" @click="deleteSnap(s.id)">x</button>
            </div>
          </div>
        </div>
      </section>

      <!-- BULK SELLING SECTION -->
      <section v-if="activeSection === 'bulk'" class="ws-pane">
        <div class="ws-toolbar">
          <div class="ws-farm-selectors">
            <label class="ws-field-inline">
              <span>Category:</span>
              <select v-model="bulkCategory" class="ws-select">
                <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
              </select>
            </label>
            <label class="ws-field-inline">
              <span>Min Total (c):</span>
              <input
                v-model.number="draft.bulkMinChaos"
                type="number"
                class="ws-input-sm"
                @change="emit('save-config', { bulkMinChaos: draft.bulkMinChaos })"
              />
            </label>
            <label class="ws-field-inline">
              <span>Price %:</span>
              <select v-model.number="bulkMultiplier" class="ws-select">
                <option :value="85">85%</option>
                <option :value="90">90%</option>
                <option :value="95">95%</option>
                <option :value="100">100%</option>
                <option :value="110">110%</option>
              </select>
            </label>
          </div>

          <div class="ws-actions">
            <span class="ws-metric-value accent-orange">Lot: {{ bulkTotalChaos }}c</span>
            <button class="ws-btn ws-btn-accent" :disabled="bulkItems.length === 0" @click="copyBulk">
              {{ bulkCopied ? 'Copied!' : 'Copy Bulk List' }}
            </button>
          </div>
        </div>

        <div v-if="bulkItems.length > 0" class="ws-table-wrap">
          <table class="ws-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th class="num">Qty</th>
                <th class="num">Unit (c)</th>
                <th class="num">Total (c)</th>
                <th>Tabs</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in bulkItems" :key="item.key">
                <td class="item-cell">
                  <img v-if="item.icon" :src="item.icon" class="item-icon" alt="" />
                  <span
                    class="item-copy-name"
                    title="Click to copy name"
                    @click="copyItemName(item.name, `bulk-${item.key}`)"
                  >
                    {{ item.name }}
                  </span>
                  <span v-if="copiedItemId === `bulk-${item.key}`" class="ws-copied-tag">Copied</span>
                </td>
                <td>{{ item.category }}</td>
                <td class="num">{{ item.quantity }}</td>
                <td class="num">{{ (item.unitChaos * (bulkMultiplier / 100)).toFixed(1) }}</td>
                <td class="num accent-orange">
                  {{ Math.round(item.totalChaos * (bulkMultiplier / 100)) }}
                </td>
                <td class="ws-muted">{{ item.tabs.join(', ') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="ws-empty">
          No bulk items match the current snapshot and minimum chaos filter.
        </div>
      </section>

      <!-- SETTINGS SECTION -->
      <section v-if="activeSection === 'settings'" class="ws-pane ws-settings">
        <div class="ws-settings-grid">
          <label class="ws-setting-field">
            <span>Toggle App Hotkey</span>
            <input v-model="draft.toggleAppHotkey" type="text" class="ws-input" />
          </label>
          <label class="ws-setting-field">
            <span>Price Check Hotkey</span>
            <input v-model="draft.priceCheckHotkey" type="text" class="ws-input" />
          </label>
          <label class="ws-setting-field">
            <span>Close Overlay Hotkey</span>
            <input v-model="draft.closeHotkey" type="text" class="ws-input" />
          </label>
          <label class="ws-setting-field">
            <span>Game Window Title</span>
            <input v-model="draft.gameWindowTitle" type="text" class="ws-input" />
          </label>
          <label class="ws-setting-field">
            <span>Trade Status</span>
            <select v-model="draft.tradeStatus" class="ws-select">
              <option value="available">Available (Instant + In Person)</option>
              <option value="securable">Instant Buyout only</option>
              <option value="online">Online only</option>
              <option value="any">Any</option>
            </select>
          </label>
          <label class="ws-setting-field">
            <span>Account Name (for Stash API)</span>
            <input v-model="draft.accountName" type="text" class="ws-input" placeholder="e.g. ExileName" />
          </label>
          <label class="ws-setting-field">
            <span>Min Item Price in Stash (c, 0 = show all)</span>
            <input v-model.number="draft.minItemChaos" type="number" min="0" step="0.5" class="ws-input" />
          </label>
          <label class="ws-setting-field">
            <span>POESESSID (auto-filled on Sign in, or paste manually)</span>
            <input v-model="draft.poeSessId" type="password" class="ws-input" />
          </label>
        </div>

        <div class="ws-macros">
          <div class="ws-macros-head">
            <span>Chat Macros</span>
            <button class="ws-btn" @click="addMacro">+ Add Macro</button>
          </div>
          <div v-for="(macro, idx) in draft.chatMacros" :key="macro.id" class="ws-macro-row">
            <input v-model="macro.label" type="text" class="ws-input" placeholder="Label" />
            <input v-model="macro.hotkey" type="text" class="ws-input" placeholder="Hotkey" />
            <input v-model="macro.command" type="text" class="ws-input" placeholder="/hideout" />
            <label class="ws-check-inline">
              <input v-model="macro.send" type="checkbox" />
              Send
            </label>
            <button class="ws-btn" @click="removeMacro(idx)">Del</button>
          </div>
        </div>

        <div class="ws-settings-footer">
          <label class="ws-check-inline">
            <input v-model="draft.autoSearchOnFilterChange" type="checkbox" />
            Auto-search on filter change
          </label>
          <label class="ws-check-inline">
            <input v-model="draft.restoreClipboard" type="checkbox" />
            Restore clipboard after check
          </label>
          <button class="ws-btn ws-btn-accent" @click="saveSettings">Save Settings</button>
        </div>
      </section>
    </main>
  </div>
</template>
