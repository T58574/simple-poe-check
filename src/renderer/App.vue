<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import {
  DEFAULT_CONFIG,
  type AppConfig,
  type OverlayStatePayload,
  type PriceCheckResult,
  type TradeSearchRequest
} from '@shared/types'

const overlayVisible = ref(false)
const overlayMode = ref<'price-check' | 'settings'>('price-check')
const posX = ref(40)
const posY = ref(40)
const loading = ref(false)
const result = ref<PriceCheckResult | null>(null)
const showSettings = ref(false)
const config = ref<AppConfig>({ ...DEFAULT_CONFIG })
const leagues = ref<string[]>(['Standard', 'Hardcore'])
const statusMessage = ref('')

// Filter state for current item
const useBaseType = ref(false)
const useIlvl = ref(false)
const useLinks = ref(false)
const useCorrupted = ref(false)

const enabledMods = ref<Set<number>>(new Set())
const modMins = reactive<Record<number, number | undefined>>({})

const weaponEnabled = reactive({ dps: false, pdps: false, aps: false, crit: false })
const weaponMins = reactive<{ dps?: number; pdps?: number; aps?: number; crit?: number }>({})

const armourEnabled = reactive({ ar: false, ev: false, es: false })
const armourMins = reactive<{ ar?: number; ev?: number; es?: number }>({})

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
    top: '0px',
    width: `${config.value.overlayWidth}px`
  }
})

function syncFiltersFromResult (res: PriceCheckResult): void {
  const item = res.item
  useBaseType.value = item.rarity === 'Unique' || !item.tradeCategory
  useIlvl.value = false
  useLinks.value = item.maxLinks >= 5
  useCorrupted.value = false

  // Reset weapon
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

  // Reset armour
  armourEnabled.ar = false
  armourEnabled.ev = false
  armourEnabled.es = false
  if (item.armour) {
    armourMins.ar = Math.floor(item.armour.armour * 0.85)
    armourMins.ev = Math.floor(item.armour.evasion * 0.85)
    armourMins.es = Math.floor(item.armour.energyShield * 0.85)
  }

  // Reset mods
  const nextMods = new Set<number>()
  for (const key of Object.keys(modMins)) {
    delete modMins[Number(key)]
  }
  res.matchedMods.forEach((m, idx) => {
    if (m.modifier.values.length > 0) {
      modMins[idx] = Math.floor(m.modifier.values[0] * 0.85)
    }
    if (!item.weapon && m.enabled && m.statId && nextMods.size < 3) {
      nextMods.add(idx)
    }
  })
  enabledMods.value = nextMods
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
}

async function runSearch (): Promise<void> {
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
      item: result.value.item,
      filters,
      useBaseType: useBaseType.value,
      useIlvl: useIlvl.value,
      useLinks: useLinks.value,
      useCorrupted: useCorrupted.value,
      weaponFilters: Object.keys(weaponFilters).length > 0 ? weaponFilters : undefined,
      armourFilters: Object.keys(armourFilters).length > 0 ? armourFilters : undefined
    })
    result.value = updated
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
  config.value = await window.poeCheck.saveConfig({ ...config.value })
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

function openTradeInBrowser (): void {
  if (result.value?.tradeUrl) {
    window.poeCheck.openExternal(result.value.tradeUrl)
  }
}

function hide (): void {
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
  unsubOverlay = window.poeCheck.onOverlayState((state: OverlayStatePayload) => {
    overlayVisible.value = state.visible
    if (state.mode) overlayMode.value = state.mode
    if (state.mode === 'settings') {
      void openSettings(true)
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
  unsubOverlay?.()
  unsubResult?.()
  unsubLoading?.()
})
</script>

<template>
  <div v-if="overlayVisible" class="backdrop" @click.self="hide">
    <div
      class="card"
      :class="{ centered: overlayMode === 'settings' || showSettings }"
      :style="cardStyle"
    >
      <header class="topbar">
        <span class="league-title">{{ showSettings ? 'Settings' : config.league }}</span>
        <div class="actions">
          <button class="icon-btn" @click="openSettings()">
            {{ showSettings ? 'Back' : 'Settings' }}
          </button>
          <button class="icon-btn" @click="hide">✕</button>
        </div>
      </header>

      <div v-if="!showSettings && result" class="item-header">
        <div class="item-title-row">
          <div class="item-name" :class="rarityClass">
            {{ result.item.name }}
            <span v-if="result.item.name !== result.item.baseType" style="font-weight: 400; opacity: 0.75">
              · {{ result.item.baseType }}
            </span>
          </div>
          <span class="badge" :class="{ corrupted: result.item.corrupted }">
            {{ result.item.corrupted ? 'Corrupted' : 'Not Corrupted' }}
          </span>
        </div>

        <div class="pill-row">
          <span v-if="result.item.itemClass" class="pill">{{ result.item.itemClass }}</span>
          <label v-if="result.item.tradeCategory && result.item.rarity !== 'Unique'" class="pill" :class="{ active: useBaseType }">
            <input v-model="useBaseType" type="checkbox" hidden />
            Base item
          </label>
          <label v-if="result.item.ilvl" class="pill" :class="{ active: useIlvl }">
            <input v-model="useIlvl" type="checkbox" hidden />
            iLvl {{ result.item.ilvl }}
          </label>
          <label v-if="result.item.maxLinks >= 5" class="pill" :class="{ active: useLinks }">
            <input v-model="useLinks" type="checkbox" hidden />
            {{ result.item.maxLinks }}L
          </label>
          <label class="pill" :class="{ active: useCorrupted }">
            <input v-model="useCorrupted" type="checkbox" hidden />
            Corrupt filter
          </label>
        </div>
      </div>

      <main class="body">
        <section v-if="showSettings" class="settings-form">
          <div class="field">
            <label>League</label>
            <select v-model="config.league">
              <option v-for="l in leagues" :key="l" :value="l">{{ l }}</option>
            </select>
          </div>

          <div class="field">
            <label>Price Check Hotkey</label>
            <input v-model="config.priceCheckHotkey" placeholder="Ctrl+D" />
          </div>

          <div class="field">
            <label>Hideout Hotkey (/hideout)</label>
            <input v-model="config.hideoutHotkey" placeholder="F5" />
          </div>

          <div class="field">
            <label>Close Overlay Hotkey</label>
            <input v-model="config.closeHotkey" placeholder="Escape" />
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

            <div v-if="result.source === 'ninja' && result.chaosValue !== undefined" class="price-banner">
              <div>
                <div class="price-main">{{ result.chaosValue }} c</div>
                <div v-if="result.divineValue" class="price-sub">~{{ result.divineValue }} div</div>
              </div>
              <span class="price-sub">poe.ninja</span>
            </div>

            <!-- Weapon computed stats -->
            <div v-if="result.item.weapon" class="mod-list">
              <div class="mod-row" :class="{ checked: weaponEnabled.dps }">
                <label class="mod-left">
                  <input v-model="weaponEnabled.dps" type="checkbox" />
                  <span class="mod-text">Total DPS: <b>{{ result.item.weapon.totalDps }}</b></span>
                </label>
                <div class="mod-inputs">
                  <input v-model.number="weaponMins.dps" type="number" class="num-input" />
                </div>
              </div>

              <div v-if="result.item.weapon.physicalDps > 0" class="mod-row" :class="{ checked: weaponEnabled.pdps }">
                <label class="mod-left">
                  <input v-model="weaponEnabled.pdps" type="checkbox" />
                  <span class="mod-text">Physical DPS: <b>{{ result.item.weapon.physicalDps }}</b></span>
                </label>
                <div class="mod-inputs">
                  <input v-model.number="weaponMins.pdps" type="number" class="num-input" />
                </div>
              </div>

              <div class="mod-row" :class="{ checked: weaponEnabled.aps }">
                <label class="mod-left">
                  <input v-model="weaponEnabled.aps" type="checkbox" />
                  <span class="mod-text">Attacks per Second: <b>{{ result.item.weapon.aps }}</b></span>
                </label>
                <div class="mod-inputs">
                  <input v-model.number="weaponMins.aps" type="number" step="0.01" class="num-input" />
                </div>
              </div>

              <div v-if="result.item.weapon.crit > 0" class="mod-row" :class="{ checked: weaponEnabled.crit }">
                <label class="mod-left">
                  <input v-model="weaponEnabled.crit" type="checkbox" />
                  <span class="mod-text">Critical Strike Chance: <b>{{ result.item.weapon.crit }}%</b></span>
                </label>
                <div class="mod-inputs">
                  <input v-model.number="weaponMins.crit" type="number" step="0.1" class="num-input" />
                </div>
              </div>
            </div>

            <!-- Armour computed stats -->
            <div v-if="result.item.armour" class="mod-list">
              <div v-if="result.item.armour.armour > 0" class="mod-row" :class="{ checked: armourEnabled.ar }">
                <label class="mod-left">
                  <input v-model="armourEnabled.ar" type="checkbox" />
                  <span class="mod-text">Armour: <b>{{ result.item.armour.armour }}</b></span>
                </label>
                <input v-model.number="armourMins.ar" type="number" class="num-input" />
              </div>
              <div v-if="result.item.armour.evasion > 0" class="mod-row" :class="{ checked: armourEnabled.ev }">
                <label class="mod-left">
                  <input v-model="armourEnabled.ev" type="checkbox" />
                  <span class="mod-text">Evasion: <b>{{ result.item.armour.evasion }}</b></span>
                </label>
                <input v-model.number="armourMins.ev" type="number" class="num-input" />
              </div>
              <div v-if="result.item.armour.energyShield > 0" class="mod-row" :class="{ checked: armourEnabled.es }">
                <label class="mod-left">
                  <input v-model="armourEnabled.es" type="checkbox" />
                  <span class="mod-text">Energy Shield: <b>{{ result.item.armour.energyShield }}</b></span>
                </label>
                <input v-model.number="armourMins.es" type="number" class="num-input" />
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
                        Tier {{ mod.modifier.tier }}
                      </span>
                    </div>
                  </div>
                </label>
                <div v-if="mod.statId && mod.modifier.values.length > 0" class="mod-inputs">
                  <input v-model.number="modMins[idx]" type="number" class="num-input" />
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
              Trade ({{ result.totalResults ?? 0 }}) ↗
            </button>
          </div>

          <!-- Listings (pinned bottom pane) -->
          <div class="listings-section">
            <div v-if="loading" class="empty-state">Searching PoE Trade...</div>
            <div v-else-if="result.listings.length > 0" class="listings">
              <div v-for="(l, idx) in result.listings" :key="idx" class="listing-row">
                <span class="listing-price">{{ l.amount }} {{ l.currency }}</span>
                <span class="listing-meta">{{ l.accountName }} · {{ formatAge(l.indexed) }}</span>
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
