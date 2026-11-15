<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { DEFAULT_CONFIG, type AppConfig, type PriceCheckResult } from '@shared/types'

const loading = ref(false)
const result = ref<PriceCheckResult | null>(null)
const showSettings = ref(false)
const config = ref<AppConfig>({ ...DEFAULT_CONFIG })
const leagues = ref<string[]>(['Standard', 'Hardcore'])
const enabledStatIds = ref<Set<string>>(new Set())
const statusMessage = ref('')

let unsubResult: (() => void) | null = null
let unsubLoading: (() => void) | null = null

const rarityClass = computed(() =>
  result.value ? `rarity-${result.value.item.rarity}` : ''
)

function syncEnabledMods (res: PriceCheckResult): void {
  const next = new Set<string>()
  for (const mod of res.matchedMods) {
    if (mod.enabled && mod.statId) {
      next.add(mod.statId)
    }
  }
  enabledStatIds.value = next
}

function toggleMod (statId: string | null): void {
  if (!statId) return
  const next = new Set(enabledStatIds.value)
  if (next.has(statId)) {
    next.delete(statId)
  } else {
    next.add(statId)
  }
  enabledStatIds.value = next
}

async function runCustomTradeSearch (): Promise<void> {
  if (!result.value) return
  loading.value = true
  try {
    const filters = result.value.matchedMods
      .filter((m) => m.statId && enabledStatIds.value.has(m.statId))
      .map((m) => ({
        statId: m.statId!,
        min: m.modifier.values.length > 0 ? Math.floor(m.modifier.values[0] * 0.85) : undefined
      }))

    const updated = await window.poeCheck.searchTrade({
      item: result.value.item,
      filters,
      useLinks: result.value.item.maxLinks >= 5
    })
    result.value = updated
  } finally {
    loading.value = false
  }
}

async function openSettings (): Promise<void> {
  showSettings.value = !showSettings.value
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

function hide (): void {
  window.poeCheck.hideOverlay()
}

onMounted(async () => {
  config.value = await window.poeCheck.getConfig()
  unsubLoading = window.poeCheck.onPriceCheckLoading((isLoading) => {
    loading.value = isLoading
    if (isLoading) showSettings.value = false
  })
  unsubResult = window.poeCheck.onPriceCheckResult((res) => {
    result.value = res
    syncEnabledMods(res)
  })
})

onUnmounted(() => {
  unsubResult?.()
  unsubLoading?.()
})
</script>

<template>
  <div class="card">
    <header class="topbar">
      <div class="title-block">
        <div v-if="showSettings" class="item-name">Settings</div>
        <template v-else-if="result">
          <div class="item-name" :class="rarityClass">{{ result.item.name }}</div>
          <div class="item-sub">
            {{ result.item.baseType }}
            <span v-if="result.item.ilvl"> · iLvl {{ result.item.ilvl }}</span>
            <span v-if="result.item.maxLinks >= 5"> · {{ result.item.maxLinks }}L</span>
          </div>
        </template>
        <div v-else class="item-name">Simple PoE Check</div>
      </div>

      <div class="actions">
        <button @click="openSettings">{{ showSettings ? 'Back' : 'Settings' }}</button>
        <button @click="hide">✕</button>
      </div>
    </header>

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
          <button @click="refreshCache">Refresh League Cache</button>
          <span v-if="statusMessage" class="item-sub">{{ statusMessage }}</span>
        </div>
      </section>

      <div v-else-if="loading" class="empty-state">Checking prices...</div>

      <template v-else-if="result">
        <div v-if="result.error" class="error-box">{{ result.error }}</div>

        <div v-if="result.source === 'ninja' && result.chaosValue !== undefined" class="price-banner">
          <div>
            <div class="price-main">{{ result.chaosValue }} c</div>
            <div v-if="result.divineValue" class="price-sub">~{{ result.divineValue }} div</div>
          </div>
          <span class="item-sub">poe.ninja</span>
        </div>

        <div v-if="result.matchedMods.length > 0">
          <div class="section-label">Modifiers</div>
          <div class="mod-list">
            <label
              v-for="(mod, idx) in result.matchedMods"
              :key="idx"
              class="mod-row"
              :class="{ unmatched: !mod.statId }"
            >
              <input
                type="checkbox"
                :disabled="!mod.statId"
                :checked="mod.statId ? enabledStatIds.has(mod.statId) : false"
                @change="toggleMod(mod.statId)"
              />
              <span>{{ mod.modifier.raw }}</span>
            </label>
          </div>
          <div class="actions" style="margin-top: 8px">
            <button class="primary" @click="runCustomTradeSearch">Search Trade</button>
            <a
              v-if="result.tradeUrl"
              :href="result.tradeUrl"
              target="_blank"
              style="color: var(--accent); font-size: 12px; align-self: center; margin-left: 6px"
            >
              Open on Trade ({{ result.totalResults ?? 0 }})
            </a>
          </div>
        </div>

        <div v-if="result.listings.length > 0">
          <div class="section-label">Trade Listings</div>
          <div class="listings">
            <div v-for="(l, idx) in result.listings" :key="idx" class="listing-row">
              <span class="listing-price">{{ l.amount }} {{ l.currency }}</span>
              <span class="listing-meta">{{ l.accountName }}</span>
            </div>
          </div>
        </div>
        <div v-else-if="result.source === 'trade' && !result.error" class="empty-state">
          No matching listings found.
        </div>
      </template>

      <div v-else class="empty-state">
        Hover an item in Path of Exile and press <b>{{ config.priceCheckHotkey }}</b>.<br />
        Press <b>{{ config.hideoutHotkey }}</b> for /hideout.
      </div>
    </main>
  </div>
</template>
