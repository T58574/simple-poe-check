import { app, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { parseItemText } from '../shared/itemParser'
import { IPC_CHANNELS, type AppConfig, type TradeSearchRequest } from '../shared/types'
import { ConfigStore } from './config'
import { HotkeyManager } from './hotkeys'
import { OverlayWindowManager } from './overlay'
import { PoeApiClient } from './poeApi'

let tray: Tray | null = null

async function main (): Promise<void> {
  await app.whenReady()

  const configStore = new ConfigStore()
  const overlay = new OverlayWindowManager()
  const poeApi = new PoeApiClient(() => configStore.get())

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
    () => overlay.hide()
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
    await Promise.all([poeApi.ensureStatsLoaded(true), poeApi.ensureNinjaLoaded(true)])
  })
  ipcMain.handle(IPC_CHANNELS.SEARCH_TRADE, (_e, req: TradeSearchRequest) => poeApi.searchTrade(req))

  // Warm up caches in the background
  void poeApi.ensureStatsLoaded().catch(() => undefined)
  void poeApi.ensureNinjaLoaded().catch(() => undefined)

  // Tray
  tray = new Tray(nativeImage.createEmpty())
  tray.setToolTip('Simple PoE Check')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Settings / Overlay', click: () => overlay.showStandalone() },
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

  app.on('will-quit', () => {
    hotkeys.stop()
  })
}

void main()
