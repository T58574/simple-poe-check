<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { calcDefaultMinFilter } from '@shared/statMatcher'
import StashWorkspace from './components/StashWorkspace.vue'
import {
  DEFAULT_CONFIG,
  type AppConfig,
  type ChatMacro,
  type OverlayStatePayload,
  type PriceCheckResult,
  type PriceListing,
  type TradeSearchRequest,
  type TradeStatusOption
} from '@shared/types'

const isDetached = new URLSearchParams(window.location.search).get('detached') === '1'
const overlayVisible = ref(isDetached)
const overlayMode = ref<'price-check' | 'app' | 'settings'>(isDetached ? 'app' : 'price-check')
const posX = ref(40)
const posY = ref(0)
const loading = ref(false)
const result = ref<PriceCheckResult | null>(null)
const showSettings = ref(false)
const config = ref<AppConfig>({ ...DEFAULT_CONFIG })
const leagues = ref<string[]>(['Standard', 'Hardcore'])
const statusMessage = ref('')
const copiedIdx = ref<number | null>(null)

// Filter state for current item
const tradeStatus = ref<TradeStatusOption>('available')
const useBaseType = ref(false)
const useIlvl = ref(false)
const useLinks = ref(false)
const useCorrupted = ref(false)
const useQuality = ref(false)

const enabledMods = ref<Set<number>>(new Set())
const modMins = reactive<Record<number, number | undefined>>({})

const weaponEnabled = reactive({ dps: false, pdps: false, aps: false, crit: false })
const weaponMins = reactive<{ dps?: number; pdps?: number; aps?: number; crit?: number }>({})

const armourEnabled = reactive({ ar: false, ev: false, es: false })
const armourMins = reactive<{ ar?: number; ev?: number; es?: number }>({})

let autoSearchTimer: ReturnType<typeof setTimeout> | null = null
let unsubResult: (() => void) | null = null
let unsubLoading: (() => void) | null = null
let unsubOverlay: (() => void) | null = null

const rarityClass = computed(() =>
  result.value ? `rarity-${result.value.item.rarity}` : ''
)

const cardStyle = computed(() => {
  if (overlayMode.value === 'settings' || showSettings.value) {
    return {}
  }
  return {
    left: `${posX.value}px`,
    top: `${posY.value}px`,
    width: `${config.value.overlayWidth}px`,
    height: '100vh',
    maxHeight: '100vh'
  }
})

function syncFiltersFromResult (res: PriceCheckResult): void {
  const item = res.item
  tradeStatus.value = config.value.tradeStatus ?? 'available'
  useBaseType.value = item.rarity === 'Unique' || !item.tradeCategory
  useIlvl.value = false
  useLinks.value = item.maxLinks >= 5
  useCorrupted.value = false
  useQuality.value = item.rarity === 'Gem' && (item.quality ?? 0) >= 20

  weaponEnabled.dps = false
  weaponEnabled.pdps = false
  weaponEnabled.aps = false
  weaponEnabled.crit = false
  if (item.weapon) {
    weaponEnabled.dps = item.weapon.totalDps > 0
    weaponMins.dps = Math.floor(item.weapon.totalDps * 0.9)
    weaponMins.pdps = Math.floor(item.weapon.physicalDps * 0.9)
    weaponMins.aps = Number((item.weapon.aps * 0.95).toFixed(2))
    weaponMins.crit = Number((item.weapon.crit * 0.95).toFixed(1))
  }

  armourEnabled.ar = false
  armourEnabled.ev = false
  armourEnabled.es = false
  if (item.armour) {
    armourMins.ar = Math.floor(item.armour.armour * 0.85)
    armourMins.ev = Math.floor(item.armour.evasion * 0.85)
    armourMins.es = Math.floor(item.armour.energyShield * 0.85)
  }

  const nextMods = new Set<number>()
  for (const key of Object.keys(modMins)) {
    delete modMins[Number(key)]
  }
  res.matchedMods.forEach((m, idx) => {
    if (m.modifier.values.length > 0) {
      modMins[idx] = calcDefaultMinFilter(m.modifier.values, undefined, m.modifier.tier)
    }
    if (!item.weapon && m.enabled && m.statId && nextMods.size < 3) {
      nextMods.add(idx)
    }
  })
  enabledMods.value = nextMods
}

function scheduleAutoSearch (): void {
  if (!config.value.autoSearchOnFilterChange || !result.value) return
  if (autoSearchTimer) clearTimeout(autoSearchTimer)
  autoSearchTimer = setTimeout(() => {
    void runSearch()
  }, 350)
}

function toggleMod (idx: number, statId: string | null): void {
  if (!statId) return
  const next = new Set(enabledMods.value)
  if (next.has(idx)) {
    next.delete(idx)
  } else {
    next.add(idx)
  }
  enabledMods.value = next
  scheduleAutoSearch()
}

async function runSearch (): Promise<void> {
  if (autoSearchTimer) {
    clearTimeout(autoSearchTimer)
    autoSearchTimer = null
  }
  if (!result.value) return
  loading.value = true
  try {
    const filters = result.value.matchedMods
      .map((m, idx) => ({ m, idx }))
      .filter(({ m, idx }) => m.statId && enabledMods.value.has(idx))
      .map(({ m, idx }) => ({
        statId: m.statId!,
        min: modMins[idx]
      }))

    const weaponFilters: TradeSearchRequest['weaponFilters'] = {}
    if (weaponEnabled.dps && weaponMins.dps) weaponFilters.dps = { min: weaponMins.dps }
    if (weaponEnabled.pdps && weaponMins.pdps) weaponFilters.pdps = { min: weaponMins.pdps }
    if (weaponEnabled.aps && weaponMins.aps) weaponFilters.aps = { min: weaponMins.aps }
    if (weaponEnabled.crit && weaponMins.crit) weaponFilters.crit = { min: weaponMins.crit }

    const armourFilters: TradeSearchRequest['armourFilters'] = {}
    if (armourEnabled.ar && armourMins.ar) armourFilters.ar = { min: armourMins.ar }
    if (armourEnabled.ev && armourMins.ev) armourFilters.ev = { min: armourMins.ev }
    if (armourEnabled.es && armourMins.es) armourFilters.es = { min: armourMins.es }

    const updated = await window.poeCheck.searchTrade({
      item: JSON.parse(JSON.stringify(result.value.item)),
      filters,
      status: tradeStatus.value,
      useBaseType: useBaseType.value,
      useIlvl: useIlvl.value,
      useLinks: useLinks.value,
      useCorrupted: useCorrupted.value,
      useQuality: useQuality.value,
      weaponFilters: Object.keys(weaponFilters).length > 0 ? weaponFilters : undefined,
      armourFilters: Object.keys(armourFilters).length > 0 ? armourFilters : undefined
    })
    result.value = updated
  } catch (err) {
    if (result.value) {
      result.value = {
        ...result.value,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  } finally {
    loading.value = false
  }
}

async function openSettings (forceOpen?: boolean): Promise<void> {
  showSettings.value = forceOpen !== undefined ? forceOpen : !showSettings.value
  if (showSettings.value) {
    try {
      const fetched = await window.poeCheck.getLeagues()
      if (fetched.length > 0) leagues.value = fetched
    } catch {
      // Keep fallback leagues
    }
  }
}

async function saveSettings (): Promise<void> {
  config.value = await window.poeCheck.saveConfig(JSON.parse(JSON.stringify(config.value)))
  statusMessage.value = 'Saved'
  setTimeout(() => { statusMessage.value = '' }, 1500)
}

async function refreshCache (): Promise<void> {
  statusMessage.value = 'Updating...'
  try {
    await window.poeCheck.refreshCache()
    statusMessage.value = 'Cache updated'
  } catch {
    statusMessage.value = 'Update failed'
  }
  setTimeout(() => { statusMessage.value = '' }, 2000)
}

function captureHotkey (e: KeyboardEvent, onCaptured: (combo: string) => void): void {
  e.preventDefault()
  e.stopPropagation()
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return

  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  let key = e.key
  if (key === ' ') key = 'Space'
  else if (key.length === 1) key = key.toUpperCase()
  else if (key.startsWith('Arrow')) key = key.slice('Arrow'.length)

  parts.push(key)
  onCaptured(parts.join('+'))
}

function addMacro (): void {
  const macros: ChatMacro[] = [...config.value.chatMacros]
  macros.push({
    id: `macro-${Date.now()}`,
    label: 'Custom',
    hotkey: '',
    command: '/',
    send: true
  })
  config.value.chatMacros = macros
}

function removeMacro (idx: number): void {
  config.value.chatMacros = config.value.chatMacros.filter((_, i) => i !== idx)
}

async function copyWhisper (listing: PriceListing, idx: number): Promise<void> {
  if (!result.value) return
  const itemLabel = result.value.item.name !== result.value.item.baseType
    ? `${result.value.item.name} ${result.value.item.baseType}`
    : result.value.item.baseType
  const msg = `@${listing.accountName} Hi, I would like to buy your ${itemLabel} listed for ${listing.amount} ${listing.currency} in ${config.value.league}`
  try {
    await navigator.clipboard.writeText(msg)
    copiedIdx.value = idx
    setTimeout(() => {
      if (copiedIdx.value === idx) copiedIdx.value = null
    }, 1200)
  } catch {
    // Ignore clipboard write failure in restricted contexts
  }
}

function openTradeInBrowser (): void {
  if (result.value?.tradeUrl) {
    window.poeCheck.openExternal(result.value.tradeUrl)
  }
}

async function handleWorkspaceSaveConfig (partial: Partial<AppConfig>): Promise<void> {
  const saved = await window.poeCheck.saveConfig(JSON.parse(JSON.stringify(partial)))
  config.value = saved
  tradeStatus.value = saved.tradeStatus ?? 'available'
}

async function handleWorkspaceRefreshCache (): Promise<void> {
  await window.poeCheck.refreshCache()
}

function hide (): void {
  if (isDetached) {
    window.close()
    return
  }
  window.poeCheck.hideOverlay()
}

function formatAge (iso: string): string {
  if (!iso) return ''
  const diffSec = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000))
  if (diffSec < 60) return `${diffSec}s`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  return `${Math.floor(diffHr / 24)}d`
}

onMounted(async () => {
  config.value = await window.poeCheck.getConfig()
  tradeStatus.value = config.value.tradeStatus ?? 'available'
  if (isDetached) {
    void window.poeCheck.getLeagues().then((l) => {
      if (l.length > 0) leagues.value = l
    }).catch(() => undefined)
  }
  unsubOverlay = window.poeCheck.onOverlayState((state: OverlayStatePayload) => {
    overlayVisible.value = state.visible
    if (state.mode) overlayMode.value = state.mode
    if (state.mode === 'app' || state.mode === 'settings') {
      showSettings.value = false
      void window.poeCheck.getLeagues().then((l) => {
        if (l.length > 0) leagues.value = l
      }).catch(() => undefined)
    } else if (state.mode === 'price-check') {
      showSettings.value = false
    }
    if (state.x !== undefined) posX.value = state.x
    if (state.y !== undefined) posY.value = state.y
  })
  unsubLoading = window.poeCheck.onPriceCheckLoading((isLoading) => {
    loading.value = isLoading
    if (isLoading) showSettings.value = false
  })
  unsubResult = window.poeCheck.onPriceCheckResult((res) => {
    result.value = res
    syncFiltersFromResult(res)
  })
})

onUnmounted(() => {
  if (autoSearchTimer) clearTimeout(autoSearchTimer)
  unsubOverlay?.()
  unsubResult?.()
  unsubLoading?.()
})
</script>

<template>
  <div v-if="overlayVisible" class="backdrop" @click.self="hide">
    <StashWorkspace
      v-if="overlayMode === 'app' || overlayMode === 'settings'"
      :config="config"
      :leagues="leagues"
      :detached="isDetached"
      :initial-section="overlayMode === 'settings' ? 'settings' : 'stash'"
      @close="hide"
      @save-config="handleWorkspaceSaveConfig"
      @refresh-cache="handleWorkspaceRefreshCache"
    />
    <div
      v-else
      class="card"
      :class="{ centered: showSettings }"
      :style="cardStyle"
    >
      <header class="topbar">
        <div class="topbar-left">
          <span class="league-title">{{ showSettings ? 'Settings' : config.league }}</span>
          <span v-if="!showSettings && result?.rateLimit" class="rate-pill">
            API {{ result.rateLimit.remaining }}/{{ result.rateLimit.max }}
          </span>
        </div>
        <div class="actions">
          <button class="icon-btn" @click="openSettings()">
            {{ showSettings ? 'Back' : 'Settings' }}
          </button>
          <button class="icon-btn" @click="hide">Close</button>
        </div>
      </header>

      <div v-if="!showSettings && result" class="item-header">
        <div class="item-title-row">
          <div class="item-name" :class="rarityClass">
            {{ result.item.name }}
            <span v-if="result.item.name !== result.item.baseType" class="item-base">
              {{ result.item.baseType }}
            </span>
          </div>
          <span class="badge" :class="{ corrupted: result.item.corrupted }">
            {{ result.item.corrupted ? 'Corrupted' : 'Clean' }}
          </span>
        </div>

        <div class="pill-row">
          <span v-if="result.item.itemClass" class="pill static">{{ result.item.itemClass }}</span>
          <label v-if="result.item.tradeCategory && result.item.rarity !== 'Unique' && result.item.rarity !== 'Magic'" class="pill" :class="{ active: useBaseType }">
            <input v-model="useBaseType" type="checkbox" hidden @change="scheduleAutoSearch" />
            Base
          </label>
          <label v-if="result.item.ilvl" class="pill" :class="{ active: useIlvl }">
            <input v-model="useIlvl" type="checkbox" hidden @change="scheduleAutoSearch" />
            iLvl {{ result.item.ilvl }}
          </label>
          <label v-if="result.item.maxLinks >= 5" class="pill" :class="{ active: useLinks }">
            <input v-model="useLinks" type="checkbox" hidden @change="scheduleAutoSearch" />
            {{ result.item.maxLinks }}L
          </label>
          <label v-if="result.item.quality && result.item.quality > 0" class="pill" :class="{ active: useQuality }">
            <input v-model="useQuality" type="checkbox" hidden @change="scheduleAutoSearch" />
            Q{{ result.item.quality }}%
          </label>
          <label class="pill" :class="{ active: useCorrupted }">
            <input v-model="useCorrupted" type="checkbox" hidden @change="scheduleAutoSearch" />
            Corrupt
          </label>
          <select v-model="tradeStatus" class="status-select" @change="scheduleAutoSearch">
            <option value="available">Available</option>
            <option value="securable">Instant Only</option>
            <option value="online">Online</option>
            <option value="any">Any</option>
          </select>
        </div>
      </div>

      <main class="body">
        <section v-if="showSettings" class="settings-form">
          <div class="settings-grid">
            <div class="field">
              <label>League</label>
              <select v-model="config.league">
                <option v-for="l in leagues" :key="l" :value="l">{{ l }}</option>
              </select>
            </div>

            <div class="field">
              <label>Default Trade Status</label>
              <select v-model="config.tradeStatus">
                <option value="available">Available (Instant + Online)</option>
                <option value="securable">Instant Buyout Only</option>
                <option value="online">In-Person Online</option>
                <option value="any">Any (incl. Offline)</option>
              </select>
            </div>

            <div class="field">
              <label>Price Check Hotkey</label>
              <input
                :value="config.priceCheckHotkey"
                readonly
                placeholder="Press keys..."
                @keydown="captureHotkey($event, (c) => (config.priceCheckHotkey = c))"
              />
            </div>

            <div class="field">
              <label>Close Overlay Hotkey</label>
              <input
                :value="config.closeHotkey"
                readonly
                placeholder="Press keys..."
                @keydown="captureHotkey($event, (c) => (config.closeHotkey = c))"
              />
            </div>

            <div class="field">
              <label>Overlay Max Height (px)</label>
              <input v-model.number="config.overlayMaxHeight" type="number" min="360" max="1200" />
            </div>

            <div class="field">
              <label>POESESSID (optional, for CF/private)</label>
              <input v-model="config.poeSessId" type="password" placeholder="Optional cookie" />
            </div>
          </div>

          <div class="toggle-row">
            <label class="checkbox-label">
              <input v-model="config.autoSearchOnFilterChange" type="checkbox" />
              Auto-search on filter change
            </label>
            <label class="checkbox-label">
              <input v-model="config.restoreClipboard" type="checkbox" />
              Restore clipboard
            </label>
          </div>

          <div class="macros-section">
            <div class="macros-header">
              <span>Chat Macros</span>
              <button type="button" class="icon-btn" @click="addMacro">+ Add</button>
            </div>
            <div v-for="(macro, idx) in config.chatMacros" :key="macro.id" class="macro-row">
              <input v-model="macro.label" class="macro-label" placeholder="Label" />
              <input
                :value="macro.hotkey"
                readonly
                class="macro-hotkey"
                placeholder="Key"
                @keydown="captureHotkey($event, (c) => (macro.hotkey = c))"
              />
              <input v-model="macro.command" class="macro-cmd" placeholder="/hideout" />
              <label class="checkbox-label" title="Press Enter automatically">
                <input v-model="macro.send" type="checkbox" />
                Send
              </label>
              <button type="button" class="icon-btn" @click="removeMacro(idx)">x</button>
            </div>
          </div>

          <div class="actions">
            <button class="primary" @click="saveSettings">Save Config</button>
            <button @click="refreshCache">Refresh Cache</button>
            <span v-if="statusMessage" class="price-sub">{{ statusMessage }}</span>
          </div>
        </section>

        <template v-else-if="result">
          <div class="mods-scroll">
            <div v-if="result.error" class="error-box">{{ result.error }}</div>
            <div v-if="result.ninjaVariantNote" class="warn-box">{{ result.ninjaVariantNote }}</div>

            <div v-if="result.source === 'ninja' && result.chaosValue !== undefined" class="price-banner">
              <div>
                <div class="price-main">{{ result.chaosValue }} c</div>
                <div v-if="result.item.stackSize && result.item.stackSize > 1" class="price-sub">
                  {{ result.item.stackSize }}x = {{ Number((result.chaosValue * result.item.stackSize).toFixed(1)) }} c
                </div>
                <div v-if="result.divineValue" class="price-sub">{{ result.divineValue }} div</div>
              </div>
              <span class="price-sub">poe.ninja</span>
            </div>

            <div v-else-if="result.source === 'trade' && result.summary" class="price-banner">
              <div class="summary-pair">
                <div>
                  <span class="price-sub">Min</span>
                  <div class="price-main">{{ result.summary.minChaos }} c</div>
                  <div v-if="result.summary.minDivine" class="price-sub">{{ result.summary.minDivine }} div</div>
                </div>
                <div>
                  <span class="price-sub">Median</span>
                  <div class="price-secondary">{{ result.summary.medianChaos }} c</div>
                  <div v-if="result.summary.medianDivine" class="price-sub">{{ result.summary.medianDivine }} div</div>
                </div>
              </div>
              <span class="price-sub">{{ result.summary.instantCount }} instant</span>
            </div>

            <!-- Weapon computed stats -->
            <div v-if="result.item.weapon" class="mod-list">
              <div class="mod-row" :class="{ checked: weaponEnabled.dps }">
                <label class="mod-left">
                  <input v-model="weaponEnabled.dps" type="checkbox" @change="scheduleAutoSearch" />
                  <span class="mod-text">
                    Total DPS: <b>{{ result.item.weapon.totalDps }}</b>
                    <span v-if="result.item.weapon.q20TotalDps" class="q20-note">
                      (Q20: {{ result.item.weapon.q20TotalDps }})
                    </span>
                  </span>
                </label>
                <div class="mod-inputs">
                  <input v-model.number="weaponMins.dps" type="number" class="num-input" @change="scheduleAutoSearch" />
                </div>
              </div>

              <div v-if="result.item.weapon.physicalDps > 0" class="mod-row" :class="{ checked: weaponEnabled.pdps }">
                <label class="mod-left">
                  <input v-model="weaponEnabled.pdps" type="checkbox" @change="scheduleAutoSearch" />
                  <span class="mod-text">
                    Physical DPS: <b>{{ result.item.weapon.physicalDps }}</b>
                    <span v-if="result.item.weapon.q20PhysicalDps" class="q20-note">
                      (Q20: {{ result.item.weapon.q20PhysicalDps }})
                    </span>
                  </span>
                </label>
                <div class="mod-inputs">
                  <input v-model.number="weaponMins.pdps" type="number" class="num-input" @change="scheduleAutoSearch" />
                </div>
              </div>

              <div class="mod-row" :class="{ checked: weaponEnabled.aps }">
                <label class="mod-left">
                  <input v-model="weaponEnabled.aps" type="checkbox" @change="scheduleAutoSearch" />
                  <span class="mod-text">Attacks/s: <b>{{ result.item.weapon.aps }}</b></span>
                </label>
                <div class="mod-inputs">
                  <input v-model.number="weaponMins.aps" type="number" step="0.01" class="num-input" @change="scheduleAutoSearch" />
                </div>
              </div>

              <div v-if="result.item.weapon.crit > 0" class="mod-row" :class="{ checked: weaponEnabled.crit }">
                <label class="mod-left">
                  <input v-model="weaponEnabled.crit" type="checkbox" @change="scheduleAutoSearch" />
                  <span class="mod-text">Crit: <b>{{ result.item.weapon.crit }}%</b></span>
                </label>
                <div class="mod-inputs">
                  <input v-model.number="weaponMins.crit" type="number" step="0.1" class="num-input" @change="scheduleAutoSearch" />
                </div>
              </div>
            </div>

            <!-- Armour computed stats -->
            <div v-if="result.item.armour" class="mod-list">
              <div v-if="result.item.armour.armour > 0" class="mod-row" :class="{ checked: armourEnabled.ar }">
                <label class="mod-left">
                  <input v-model="armourEnabled.ar" type="checkbox" @change="scheduleAutoSearch" />
                  <span class="mod-text">
                    Armour: <b>{{ result.item.armour.armour }}</b>
                    <span v-if="result.item.armour.q20Armour" class="q20-note">(Q20: {{ result.item.armour.q20Armour }})</span>
                  </span>
                </label>
                <input v-model.number="armourMins.ar" type="number" class="num-input" @change="scheduleAutoSearch" />
              </div>
              <div v-if="result.item.armour.evasion > 0" class="mod-row" :class="{ checked: armourEnabled.ev }">
                <label class="mod-left">
                  <input v-model="armourEnabled.ev" type="checkbox" @change="scheduleAutoSearch" />
                  <span class="mod-text">
                    Evasion: <b>{{ result.item.armour.evasion }}</b>
                    <span v-if="result.item.armour.q20Evasion" class="q20-note">(Q20: {{ result.item.armour.q20Evasion }})</span>
                  </span>
                </label>
                <input v-model.number="armourMins.ev" type="number" class="num-input" @change="scheduleAutoSearch" />
              </div>
              <div v-if="result.item.armour.energyShield > 0" class="mod-row" :class="{ checked: armourEnabled.es }">
                <label class="mod-left">
                  <input v-model="armourEnabled.es" type="checkbox" @change="scheduleAutoSearch" />
                  <span class="mod-text">
                    Energy Shield: <b>{{ result.item.armour.energyShield }}</b>
                    <span v-if="result.item.armour.q20EnergyShield" class="q20-note">(Q20: {{ result.item.armour.q20EnergyShield }})</span>
                  </span>
                </label>
                <input v-model.number="armourMins.es" type="number" class="num-input" @change="scheduleAutoSearch" />
              </div>
            </div>

            <!-- Modifiers -->
            <div v-if="result.matchedMods.length > 0" class="mod-list">
              <div
                v-for="(mod, idx) in result.matchedMods"
                :key="idx"
                class="mod-row"
                :class="{
                  checked: enabledMods.has(idx),
                  unmatched: !mod.statId
                }"
              >
                <label class="mod-left">
                  <input
                    type="checkbox"
                    :disabled="!mod.statId"
                    :checked="enabledMods.has(idx)"
                    @change="toggleMod(idx, mod.statId)"
                  />
                  <div class="mod-text-wrap">
                    <span class="mod-text">{{ mod.modifier.display }}</span>
                    <div class="badge-row">
                      <span class="badge" :class="`kind-${mod.modifier.kind}`">
                        {{ mod.modifier.kind }}
                      </span>
                      <span
                        v-if="mod.modifier.tier"
                        class="badge"
                        :class="{ 'tier-top': mod.modifier.tier <= 2 }"
                      >
                        T{{ mod.modifier.tier }}
                      </span>
                    </div>
                  </div>
                </label>
                <div v-if="mod.statId && mod.modifier.values.length > 0" class="mod-inputs">
                  <input
                    v-model.number="modMins[idx]"
                    type="number"
                    class="num-input"
                    @change="scheduleAutoSearch"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- Search & Trade link (pinned) -->
          <div v-if="result.source === 'trade' || result.matchedMods.length > 0" class="search-bar">
            <button class="primary" :disabled="loading" @click="runSearch">
              {{ loading ? 'Searching...' : 'Search' }}
            </button>
            <button v-if="result.tradeUrl" @click="openTradeInBrowser">
              Open Trade ({{ result.totalResults ?? 0 }})
            </button>
          </div>

          <!-- Listings (pinned bottom pane) -->
          <div class="listings-section">
            <div v-if="loading" class="empty-state">Searching PoE Trade...</div>
            <div v-else-if="result.listings.length > 0" class="listings">
              <div v-for="(l, idx) in result.listings" :key="idx" class="listing-row">
                <div class="listing-left">
                  <span class="listing-price">
                    {{ l.amount }} {{ l.currency }}
                  </span>
                  <span v-if="l.chaosAmount && l.currency.toLowerCase() !== 'chaos'" class="price-sub">
                    ({{ l.chaosAmount }}c)
                  </span>
                  <span class="badge" :class="l.isInstantBuyout ? 'kind-instant' : 'kind-inperson'">
                    {{ l.isInstantBuyout ? 'instant' : 'in person' }}
                  </span>
                </div>
                <div class="listing-right">
                  <span class="listing-meta">{{ l.accountName }}</span>
                  <span class="listing-age">{{ formatAge(l.indexed) }}</span>
                  <button class="mini-btn" @click="copyWhisper(l, idx)">
                    {{ copiedIdx === idx ? 'Copied' : 'Whisper' }}
                  </button>
                </div>
              </div>
            </div>
            <div v-else-if="result.source === 'trade' && !result.error" class="empty-state">
              No matching listings found.
            </div>
          </div>
        </template>

        <div v-else class="empty-state">
          Hover an item in Path of Exile and press <b>{{ config.priceCheckHotkey }}</b>.<br />
          Press <b>{{ config.hideoutHotkey }}</b> for /hideout.
        </div>
      </main>
    </div>
  </div>
</template>
