import { BrowserWindow, dialog, screen } from 'electron'
import { OVERLAY_WINDOW_OPTS, OverlayController, type AttachEvent } from 'electron-overlay-window'
import path from 'node:path'
import { IPC_CHANNELS, type OverlayStatePayload } from '../shared/types'

export class OverlayWindowManager {
  private win: BrowserWindow | null = null
  private gameActive = false
  private overlayVisible = false
  private attached = false
  private adminWarned = false

  get isGameActive (): boolean {
    return this.gameActive
  }

  get isVisible (): boolean {
    return this.overlayVisible
  }

  create (gameTitle: string, devServerUrl?: string): BrowserWindow {
    this.win = new BrowserWindow({
      ...OVERLAY_WINDOW_OPTS,
      width: 800,
      height: 600,
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

    this.win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && this.overlayVisible) {
        event.preventDefault()
        process.nextTick(() => this.hide())
      }
    })

    if (!this.attached) {
      OverlayController.events.on('attach', (e: AttachEvent) => {
        if (e.hasAccess === false && !this.adminWarned) {
          this.adminWarned = true
          dialog.showErrorBox(
            'Simple PoE Check - Administrator Rights Required',
            'Path of Exile is running with administrator rights.\n\nPlease restart Simple PoE Check as Administrator so the overlay can attach.'
          )
        }
      })
      OverlayController.events.on('focus', () => {
        this.gameActive = true
        if (this.overlayVisible) {
          this.overlayVisible = false
          this.sendState({ visible: false })
        }
      })
      OverlayController.events.on('blur', () => {
        this.gameActive = false
      })
      OverlayController.attachByTitle(this.win, gameTitle)
      this.attached = true
    }

    return this.win
  }

  showAtCursor (width: number, _height: number): void {
    if (!this.win) return
    const cursor = screen.getCursorScreenPoint()
    const target = OverlayController.targetBounds
    const bounds = target.width > 0 && target.height > 0
      ? target
      : screen.getDisplayNearestPoint(cursor).workArea

    const cursorRelX = cursor.x - bounds.x
    const dockLeft = cursorRelX > bounds.width / 2
    const x = dockLeft ? 0 : Math.max(0, bounds.width - width)

    this.overlayVisible = true
    this.sendState({ visible: true, mode: 'price-check', x, y: 0 })
    if (this.attached) {
      this.gameActive = false
      OverlayController.activateOverlay()
    } else {
      this.win.show()
      this.win.focus()
    }
  }

  showStandalone (): void {
    if (!this.win) return
    this.overlayVisible = true
    this.sendState({ visible: true, mode: 'settings' })
    if (this.attached) {
      this.gameActive = false
      OverlayController.activateOverlay()
    } else {
      this.win.center()
      this.win.show()
      this.win.focus()
    }
  }

  hide (): void {
    if (!this.win) return
    this.overlayVisible = false
    this.sendState({ visible: false })
    if (this.attached) {
      OverlayController.focusTarget()
      this.gameActive = true
    } else {
      this.win.hide()
    }
  }

  send (channel: string, payload: unknown): void {
    this.win?.webContents.send(channel, payload)
  }

  private sendState (state: OverlayStatePayload): void {
    this.send(IPC_CHANNELS.OVERLAY_STATE, state)
  }
}
