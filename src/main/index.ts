import { app, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { parseItemText } from '../shared/itemParser'
import { IPC_CHANNELS, type AppConfig, type TradeSearchRequest } from '../shared/types'
import { ConfigStore } from './config'
import { HotkeyManager } from './hotkeys'
import { OverlayWindowManager } from './overlay'
import { PoeApiClient } from './poeApi'
import { StashService } from './stashService'

let tray: Tray | null = null

function createTrayIcon (): Electron.NativeImage {
  const size = 16
  const buf = Buffer.alloc(size * size * 4)
  // BGRA format for Electron createFromBitmap
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4
      const dx = x - 7.5
      const dy = y - 7.5
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist <= 7.2) {
        const isRing = dist >= 5.2 || (Math.abs(dx) < 1.3 && Math.abs(dy) < 4.0) || (Math.abs(dy) < 1.3 && Math.abs(dx) < 4.0)
        if (isRing) {
          // Gold accent (#e0b35a -> BGRA)
          buf[idx] = 0x5a
          buf[idx + 1] = 0xb3
          buf[idx + 2] = 0xe0
          buf[idx + 3] = 0xff
        } else {
          // Dark slate (#171b22 -> BGRA)
          buf[idx] = 0x22
          buf[idx + 1] = 0x1b
          buf[idx + 2] = 0x17
          buf[idx + 3] = 0xff
        }
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size })
}

function pickDefaultLeague (leagues: string[]): string | null {
  if (leagues.length === 0) return null
  const nonPermanent = leagues.find(
    (l) => !/^(Standard|Hardcore|SSF|Ruthless)/i.test(l)
  )
  return nonPermanent ?? leagues[0]
}

async function main (): Promise<void> {
  await app.whenReady()

  const configStore = new ConfigStore()
  const overlay = new OverlayWindowManager()
  const poeApi = new PoeApiClient(() => configStore.get())
  const stashService = new StashService(configStore, poeApi)

  const devUrl = process.env.VITE_DEV_SERVER_URL
  overlay.create(configStore.get().gameWindowTitle, devUrl)

  const handlePriceCheckText = async (rawText: string): Promise<void> => {
    const item = parseItemText(rawText)
    if (!item) return

    const cfg = configStore.get()
    overlay.showAtCursor(cfg.overlayWidth, cfg.overlayMaxHeight)
    overlay.send(IPC_CHANNELS.PRICE_CHECK_LOADING, true)

    const result = await poeApi.checkItem(item)
    overlay.send(IPC_CHANNELS.PRICE_CHECK_LOADING, false)
    overlay.send(IPC_CHANNELS.PRICE_CHECK_RESULT, result)
  }

  const hotkeys = new HotkeyManager(
    () => configStore.get(),
    () => overlay.isGameActive,
    () => overlay.isVisible,
    (text) => {
      void handlePriceCheckText(text)
    },
    () => overlay.hide(),
    () => overlay.toggleApp()
  )
  hotkeys.start()

  // IPC handlers
  ipcMain.on(IPC_CHANNELS.HIDE_OVERLAY, () => overlay.hide())
  ipcMain.on(IPC_CHANNELS.OPEN_EXTERNAL, (_e, url: string) => {
    if (typeof url === 'string' && url.startsWith('https://')) {
      void shell.openExternal(url)
    }
  })
  ipcMain.handle(IPC_CHANNELS.GET_CONFIG, () => configStore.get())
  ipcMain.handle(IPC_CHANNELS.SAVE_CONFIG, (_e, partial: Partial<AppConfig>) => configStore.save(partial))
  ipcMain.handle(IPC_CHANNELS.GET_LEAGUES, () => poeApi.getLeagues())
  ipcMain.handle(IPC_CHANNELS.REFRESH_CACHE, async () => {
    poeApi.clearSearchCache()
    await Promise.all([
      poeApi.getLeagues(true),
      poeApi.ensureStatsLoaded(true),
      poeApi.ensureNinjaLoaded(true)
    ])
  })
  ipcMain.handle(IPC_CHANNELS.SEARCH_TRADE, (_e, req: TradeSearchRequest) => poeApi.searchTrade(req))
  ipcMain.handle(
    IPC_CHANNELS.STASH_AUTH_LOGIN,
    (_e, payload: { poeSessId: string; accountName?: string }) =>
      stashService.setSession(payload.poeSessId, payload.accountName)
  )
  ipcMain.handle(IPC_CHANNELS.STASH_AUTH_LOGOUT, () => stashService.logout())
  ipcMain.handle(IPC_CHANNELS.STASH_AUTH_STATUS, () => stashService.getAuthStatus())
  ipcMain.handle(IPC_CHANNELS.STASH_GET_TABS, () => stashService.getStashTabs())
  ipcMain.handle(IPC_CHANNELS.STASH_TAKE_SNAPSHOT, (_e, tabIds?: string[]) => stashService.takeSnapshot(tabIds))
  ipcMain.handle(IPC_CHANNELS.STASH_GET_SNAPSHOTS, (_e, league?: string) => stashService.getSnapshots(league))
  ipcMain.handle(IPC_CHANNELS.STASH_DELETE_SNAPSHOT, (_e, id: string) => stashService.deleteSnapshot(id))
  ipcMain.on(IPC_CHANNELS.STASH_POP_OUT, () => overlay.openDetachedApp())

  // Auto-select active challenge league on first run, then warm up caches
  void (async () => {
    try {
      const cfg = configStore.get()
      if (!cfg.leagueInitialized) {
        const leagues = await poeApi.getLeagues()
        const picked = pickDefaultLeague(leagues)
        if (picked) {
          configStore.save({ league: picked, leagueInitialized: true })
        }
      }
      await Promise.all([poeApi.ensureStatsLoaded(), poeApi.ensureNinjaLoaded()])
    } catch {
      // Non-fatal background warmup
    }
  })()

  // Tray
  tray = new Tray(createTrayIcon())
  tray.setToolTip('Simple PoE Check')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Stash Window', click: () => overlay.openDetachedApp() },
      { label: 'Open Overlay Settings', click: () => overlay.showStandalone() },
      {
        label: 'Refresh League Cache',
        click: () => {
          void Promise.all([poeApi.ensureStatsLoaded(true), poeApi.ensureNinjaLoaded(true)])
        }
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
  )
  tray.on('double-click', () => overlay.openDetachedApp())

  app.on('will-quit', () => {
    hotkeys.stop()
  })
}

void main()
