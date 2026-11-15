import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_CHAT_MACROS, DEFAULT_CONFIG, type AppConfig } from '../shared/types'

export class ConfigStore {
  private readonly filePath: string
  private current: AppConfig

  constructor () {
    const dir = app.getPath('userData')
    this.filePath = path.join(dir, 'config.json')
    this.current = this.load()
  }

  get (): AppConfig {
    return {
      ...this.current,
      chatMacros: this.current.chatMacros.map((m) => ({ ...m }))
    }
  }

  save (partial: Partial<AppConfig>): AppConfig {
    this.current = {
      ...this.current,
      ...partial,
      chatMacros: partial.chatMacros
        ? partial.chatMacros.map((m) => ({ ...m }))
        : this.current.chatMacros
    }
    const hideout = this.current.chatMacros.find((m) => m.id === 'hideout')
    if (hideout) {
      this.current.hideoutHotkey = hideout.hotkey
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify(this.current, null, 2), 'utf8')
    return this.get()
  }

  private load (): AppConfig {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<AppConfig>
      const merged: AppConfig = {
        ...DEFAULT_CONFIG,
        ...parsed,
        chatMacros: Array.isArray(parsed.chatMacros) && parsed.chatMacros.length > 0
          ? parsed.chatMacros
          : DEFAULT_CHAT_MACROS.map((m) =>
              m.id === 'hideout' && parsed.hideoutHotkey
                ? { ...m, hotkey: parsed.hideoutHotkey }
                : { ...m }
            )
      }
      return merged
    } catch {
      return {
        ...DEFAULT_CONFIG,
        chatMacros: DEFAULT_CHAT_MACROS.map((m) => ({ ...m }))
      }
    }
  }
}
