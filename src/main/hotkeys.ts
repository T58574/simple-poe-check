import { clipboard } from 'electron'
import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi'
import type { AppConfig } from '../shared/types'

interface ParsedShortcut {
  ctrl: boolean
  alt: boolean
  shift: boolean
  keycode: number
}

const KEY_NAME_MAP: Record<string, number> = {
  A: UiohookKey.A,
  B: UiohookKey.B,
  C: UiohookKey.C,
  D: UiohookKey.D,
  E: UiohookKey.E,
  F: UiohookKey.F,
  G: UiohookKey.G,
  H: UiohookKey.H,
  I: UiohookKey.I,
  J: UiohookKey.J,
  K: UiohookKey.K,
  L: UiohookKey.L,
  M: UiohookKey.M,
  N: UiohookKey.N,
  O: UiohookKey.O,
  P: UiohookKey.P,
  Q: UiohookKey.Q,
  R: UiohookKey.R,
  S: UiohookKey.S,
  T: UiohookKey.T,
  U: UiohookKey.U,
  V: UiohookKey.V,
  W: UiohookKey.W,
  X: UiohookKey.X,
  Y: UiohookKey.Y,
  Z: UiohookKey.Z,
  F1: UiohookKey.F1,
  F2: UiohookKey.F2,
  F3: UiohookKey.F3,
  F4: UiohookKey.F4,
  F5: UiohookKey.F5,
  F6: UiohookKey.F6,
  F7: UiohookKey.F7,
  F8: UiohookKey.F8,
  F9: UiohookKey.F9,
  F10: UiohookKey.F10,
  F11: UiohookKey.F11,
  F12: UiohookKey.F12,
  ESCAPE: UiohookKey.Escape,
  ESC: UiohookKey.Escape,
  SPACE: UiohookKey.Space
}

export function parseShortcut (combo: string): ParsedShortcut | null {
  const parts = combo.split('+').map((p) => p.trim().toUpperCase()).filter(Boolean)
  if (parts.length === 0) return null

  let ctrl = false
  let alt = false
  let shift = false
  let keycode = 0

  for (const part of parts) {
    if (part === 'CTRL' || part === 'CONTROL') {
      ctrl = true
    } else if (part === 'ALT') {
      alt = true
    } else if (part === 'SHIFT') {
      shift = true
    } else if (KEY_NAME_MAP[part] !== undefined) {
      keycode = KEY_NAME_MAP[part]
    }
  }

  return keycode ? { ctrl, alt, shift, keycode } : null
}

function matchesShortcut (e: UiohookKeyboardEvent, s: ParsedShortcut | null): boolean {
  if (!s) return false
  return (
    e.keycode === s.keycode &&
    e.ctrlKey === s.ctrl &&
    e.altKey === s.alt &&
    e.shiftKey === s.shift
  )
}

function delay (ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class HotkeyManager {
  private started = false
  private busy = false

  constructor (
    private readonly getConfig: () => AppConfig,
    private readonly isGameActive: () => boolean,
    private readonly isOverlayOpen: () => boolean,
    private readonly onPriceCheckText: (text: string) => void,
    private readonly onCloseOverlay: () => void
  ) {}

  start (): void {
    if (this.started) return
    this.started = true

    uIOhook.on('keydown', (e) => {
      const cfg = this.getConfig()

      if (this.isOverlayOpen() && matchesShortcut(e, parseShortcut(cfg.closeHotkey))) {
        this.onCloseOverlay()
        return
      }

      if (!this.isGameActive() || this.busy) return

      if (matchesShortcut(e, parseShortcut(cfg.priceCheckHotkey))) {
        void this.triggerPriceCheck()
      } else if (matchesShortcut(e, parseShortcut(cfg.hideoutHotkey))) {
        void this.triggerHideout()
      }
    })

    uIOhook.start()
  }

  stop (): void {
    if (!this.started) return
    this.started = false
    uIOhook.stop()
  }

  private async triggerPriceCheck (): Promise<void> {
    this.busy = true
    const prevClipboard = clipboard.readText()
    try {
      clipboard.writeText('')
      uIOhook.keyTap(UiohookKey.C, [UiohookKey.Ctrl])
      await delay(75)
      const itemText = clipboard.readText()
      if (itemText.trim().length > 0) {
        this.onPriceCheckText(itemText)
      }
    } finally {
      setTimeout(() => {
        clipboard.writeText(prevClipboard)
        this.busy = false
      }, 150)
    }
  }

  private async triggerHideout (): Promise<void> {
    this.busy = true
    const prevClipboard = clipboard.readText()
    try {
      clipboard.writeText('/hideout')
      uIOhook.keyTap(UiohookKey.Enter)
      await delay(25)
      uIOhook.keyTap(UiohookKey.V, [UiohookKey.Ctrl])
      await delay(25)
      uIOhook.keyTap(UiohookKey.Enter)
    } finally {
      setTimeout(() => {
        clipboard.writeText(prevClipboard)
        this.busy = false
      }, 200)
    }
  }
}
