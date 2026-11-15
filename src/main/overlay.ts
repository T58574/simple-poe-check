import { BrowserWindow, screen } from 'electron'
import { OverlayController } from 'electron-overlay-window'
import path from 'node:path'

export class OverlayWindowManager {
  private win: BrowserWindow | null = null
  private gameActive = false
  private overlayVisible = false
  private attached = false

  get isGameActive (): boolean {
    return this.gameActive
  }

  get isVisible (): boolean {
    return this.overlayVisible
  }

  create (gameTitle: string, devServerUrl?: string): BrowserWindow {
    this.win = new BrowserWindow({
      width: 440,
      height: 580,
      transparent: true,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      show: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    if (devServerUrl) {
      void this.win.loadURL(devServerUrl)
    } else {
      void this.win.loadFile(path.join(__dirname, '../dist-renderer/index.html'))
    }

    this.win.setIgnoreMouseEvents(true, { forward: true })

    if (!this.attached) {
      OverlayController.events.on('focus', () => {
        this.gameActive = true
      })
      OverlayController.events.on('blur', () => {
        this.gameActive = false
      })
      OverlayController.attachByTitle(this.win, gameTitle)
      this.attached = true
    }

    return this.win
  }

  showAtCursor (width: number, height: number): void {
    if (!this.win) return
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor).workArea

    const x = Math.min(Math.max(cursor.x + 16, display.x), display.x + display.width - width)
    const y = Math.min(Math.max(cursor.y - 24, display.y), display.y + display.height - height)

    this.win.setBounds({ x, y, width, height })
    this.win.setIgnoreMouseEvents(false)
    this.win.showInactive()
    this.overlayVisible = true
  }

  showStandalone (): void {
    if (!this.win) return
    this.win.setIgnoreMouseEvents(false)
    this.win.center()
    this.win.show()
    this.win.focus()
    this.overlayVisible = true
  }

  hide (): void {
    if (!this.win) return
    this.win.setIgnoreMouseEvents(true, { forward: true })
    this.win.hide()
    this.overlayVisible = false
    if (this.attached) {
      OverlayController.focusTarget()
    }
  }

  send (channel: string, payload: unknown): void {
    this.win?.webContents.send(channel, payload)
  }
}
