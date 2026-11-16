import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type AppConfig,
  type OverlayStatePayload,
  type PriceCheckResult,
  type RateLimitOverview,
  type StashAuthStatus,
  type StashSnapshot,
  type StashTabInfo,
  type TradeSearchRequest
} from '../shared/types'

export interface PoeCheckApi {
  onPriceCheckResult: (cb: (result: PriceCheckResult) => void) => () => void
  onPriceCheckLoading: (cb: (loading: boolean) => void) => () => void
  onOverlayState: (cb: (state: OverlayStatePayload) => void) => () => void
  searchTrade: (req: TradeSearchRequest) => Promise<PriceCheckResult>
  hideOverlay: () => void
  openExternal: (url: string) => void
  getConfig: () => Promise<AppConfig>
  saveConfig: (partial: Partial<AppConfig>) => Promise<AppConfig>
  getLeagues: () => Promise<string[]>
  refreshCache: () => Promise<void>
  getRateLimitStatus: () => Promise<RateLimitOverview>
  stashAuthLogin: (poeSessId: string, accountName?: string) => Promise<StashAuthStatus>
  stashAuthLogout: () => Promise<StashAuthStatus>
  stashAuthStatus: () => Promise<StashAuthStatus>
  stashGetTabs: () => Promise<StashTabInfo[]>
  stashTakeSnapshot: (tabIds?: string[]) => Promise<StashSnapshot>
  stashGetSnapshots: (league?: string) => Promise<StashSnapshot[]>
  stashDeleteSnapshot: (id: string) => Promise<StashSnapshot[]>
  popOutApp: () => void
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
  onOverlayState (cb) {
    const listener = (_: Electron.IpcRendererEvent, state: OverlayStatePayload) => cb(state)
    ipcRenderer.on(IPC_CHANNELS.OVERLAY_STATE, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.OVERLAY_STATE, listener)
  },
  searchTrade: (req) => ipcRenderer.invoke(IPC_CHANNELS.SEARCH_TRADE, JSON.parse(JSON.stringify(req))),
  hideOverlay: () => ipcRenderer.send(IPC_CHANNELS.HIDE_OVERLAY),
  openExternal: (url) => ipcRenderer.send(IPC_CHANNELS.OPEN_EXTERNAL, url),
  getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.GET_CONFIG),
  saveConfig: (partial) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_CONFIG, JSON.parse(JSON.stringify(partial))),
  getLeagues: () => ipcRenderer.invoke(IPC_CHANNELS.GET_LEAGUES),
  refreshCache: () => ipcRenderer.invoke(IPC_CHANNELS.REFRESH_CACHE),
  getRateLimitStatus: () => ipcRenderer.invoke(IPC_CHANNELS.RATE_LIMIT_STATUS),
  stashAuthLogin: (poeSessId, accountName) =>
    ipcRenderer.invoke(IPC_CHANNELS.STASH_AUTH_LOGIN, { poeSessId, accountName }),
  stashAuthLogout: () => ipcRenderer.invoke(IPC_CHANNELS.STASH_AUTH_LOGOUT),
  stashAuthStatus: () => ipcRenderer.invoke(IPC_CHANNELS.STASH_AUTH_STATUS),
  stashGetTabs: () => ipcRenderer.invoke(IPC_CHANNELS.STASH_GET_TABS),
  stashTakeSnapshot: (tabIds) =>
    ipcRenderer.invoke(IPC_CHANNELS.STASH_TAKE_SNAPSHOT, tabIds ? JSON.parse(JSON.stringify(tabIds)) : undefined),
  stashGetSnapshots: (league) => ipcRenderer.invoke(IPC_CHANNELS.STASH_GET_SNAPSHOTS, league),
  stashDeleteSnapshot: (id) => ipcRenderer.invoke(IPC_CHANNELS.STASH_DELETE_SNAPSHOT, id),
  popOutApp: () => ipcRenderer.send(IPC_CHANNELS.STASH_POP_OUT)
}

contextBridge.exposeInMainWorld('poeCheck', api)
