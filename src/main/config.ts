import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_CONFIG, type AppConfig } from '../shared/types'

export class ConfigStore {
  private readonly filePath: string
  private current: AppConfig

  constructor () {
    const dir = app.getPath('userData')
    this.filePath = path.join(dir, 'config.json')
    this.current = this.load()
  }

  get (): AppConfig {
    return { ...this.current }
  }

  save (partial: Partial<AppConfig>): AppConfig {
    this.current = { ...this.current, ...partial }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify(this.current, null, 2), 'utf8')
    return this.get()
  }

  private load (): AppConfig {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<AppConfig>
      return { ...DEFAULT_CONFIG, ...parsed }
    } catch {
      return { ...DEFAULT_CONFIG }
    }
  }
}
