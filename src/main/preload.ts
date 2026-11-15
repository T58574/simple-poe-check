import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type AppConfig, type PriceCheckResult, type TradeSearchRequest } from '../shared/types'

export interface PoeCheckApi {
  onPriceCheckResult: (cb: (result: PriceCheckResult) => void) => () => void
  onPriceCheckLoading: (cb: (loading: boolean) => void) => () => void
  searchTrade: (req: TradeSearchRequest) => Promise<PriceCheckResult>
  hideOverlay: () => void
  getConfig: () => Promise<AppConfig>
  saveConfig: (partial: Partial<AppConfig>) => Promise<AppConfig>
  getLeagues: () => Promise<string[]>
  refreshCache: () => Promise<void>
}

const api: PoeCheckApi = {
  onPriceCheckResult (cb) {
    const listener = (_: Electron.IpcRendererEvent, data: PriceCheckResult) => cb(data)
    ipcRenderer.on(IPC_CHANNELS.PRICE_CHECK_RESULT, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PRICE_CHECK_RESULT, listener)
  },
  onPriceCheckLoading (cb) {
    const listener = (_: Electron.IpcRendererEvent, loading: boolean) => cb(loading)
    ipcRenderer.on(IPC_CHANNELS.PRICE_CHECK_LOADING, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PRICE_CHECK_LOADING, listener)
  },
  searchTrade: (req) => ipcRenderer.invoke(IPC_CHANNELS.SEARCH_TRADE, req),
  hideOverlay: () => ipcRenderer.send(IPC_CHANNELS.HIDE_OVERLAY),
  getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.GET_CONFIG),
  saveConfig: (partial) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_CONFIG, partial),
  getLeagues: () => ipcRenderer.invoke(IPC_CHANNELS.GET_LEAGUES),
  refreshCache: () => ipcRenderer.invoke(IPC_CHANNELS.REFRESH_CACHE)
}

contextBridge.exposeInMainWorld('poeCheck', api)
