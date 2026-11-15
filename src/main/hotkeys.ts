import { clipboard } from 'electron'
import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi'
import type { AppConfig, ChatMacro } from '../shared/types'

export interface ParsedShortcut {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  keycode: number
}

const KEY_NAME_MAP: Record<string, number> = {
  '0': UiohookKey[0],
  '1': UiohookKey[1],
  '2': UiohookKey[2],
  '3': UiohookKey[3],
  '4': UiohookKey[4],
  '5': UiohookKey[5],
  '6': UiohookKey[6],
  '7': UiohookKey[7],
  '8': UiohookKey[8],
  '9': UiohookKey[9],
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
  SPACE: UiohookKey.Space,
  TAB: UiohookKey.Tab,
  ENTER: UiohookKey.Enter,
  BACKSPACE: UiohookKey.Backspace,
  INSERT: UiohookKey.Insert,
  DELETE: UiohookKey.Delete,
  HOME: UiohookKey.Home,
  END: UiohookKey.End,
  PAGEUP: UiohookKey.PageUp,
  PAGEDOWN: UiohookKey.PageDown,
  UP: UiohookKey.ArrowUp,
  DOWN: UiohookKey.ArrowDown,
  LEFT: UiohookKey.ArrowLeft,
  RIGHT: UiohookKey.ArrowRight,
  '`': UiohookKey.Backquote,
  '~': UiohookKey.Backquote,
  BACKQUOTE: UiohookKey.Backquote,
  '-': UiohookKey.Minus,
  MINUS: UiohookKey.Minus,
  '=': UiohookKey.Equal,
  EQUAL: UiohookKey.Equal,
  '[': UiohookKey.BracketLeft,
  ']': UiohookKey.BracketRight,
  '\\': UiohookKey.Backslash,
  ';': UiohookKey.Semicolon,
  '\'': UiohookKey.Quote,
  ',': UiohookKey.Comma,
  '.': UiohookKey.Period,
  '/': UiohookKey.Slash,
  NUMPAD0: UiohookKey.Numpad0,
  NUMPAD1: UiohookKey.Numpad1,
  NUMPAD2: UiohookKey.Numpad2,
  NUMPAD3: UiohookKey.Numpad3,
  NUMPAD4: UiohookKey.Numpad4,
  NUMPAD5: UiohookKey.Numpad5,
  NUMPAD6: UiohookKey.Numpad6,
  NUMPAD7: UiohookKey.Numpad7,
  NUMPAD8: UiohookKey.Numpad8,
  NUMPAD9: UiohookKey.Numpad9
}

const POLL_DELAY_MS = 40
const POLL_TIMEOUT_MS = 500
const CLIPBOARD_RESTORE_MS = 140
const AUTO_CLEAR_PREFIXES = new Set(['#', '%', '@', '$', '&', '/'])

export function parseShortcut (combo: string): ParsedShortcut | null {
  const parts = combo.split('+').map((p) => p.trim().toUpperCase()).filter(Boolean)
  if (parts.length === 0) return null

  let ctrl = false
  let alt = false
  let shift = false
  let meta = false
  let keycode = 0

  for (const part of parts) {
    if (part === 'CTRL' || part === 'CONTROL') {
      ctrl = true
    } else if (part === 'ALT') {
      alt = true
    } else if (part === 'SHIFT') {
      shift = true
    } else if (part === 'META' || part === 'WIN' || part === 'CMD' || part === 'SUPER') {
      meta = true
    } else if (KEY_NAME_MAP[part] !== undefined) {
      keycode = KEY_NAME_MAP[part]
    }
  }

  return keycode ? { ctrl, alt, shift, meta, keycode } : null
}

function matchesShortcut (e: UiohookKeyboardEvent, s: ParsedShortcut | null): boolean {
  if (!s) return false
  return (
    e.keycode === s.keycode &&
    e.ctrlKey === s.ctrl &&
    e.altKey === s.alt &&
    e.shiftKey === s.shift &&
    e.metaKey === s.meta
  )
}

function isPoeItemText (text: string): boolean {
  return text.startsWith('Item Class:') || text.includes('\nRarity:') || text.startsWith('Rarity:')
}

function delay (ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function releaseHeldModifiers (e: UiohookKeyboardEvent, keycodeToRelease?: number): void {
  if (keycodeToRelease) {
    uIOhook.keyToggle(keycodeToRelease, 'up')
  }
  if (e.ctrlKey) {
    uIOhook.keyToggle(UiohookKey.Ctrl, 'up')
    uIOhook.keyToggle(UiohookKey.CtrlRight, 'up')
  }
  if (e.altKey) {
    uIOhook.keyToggle(UiohookKey.Alt, 'up')
    uIOhook.keyToggle(UiohookKey.AltRight, 'up')
  }
  if (e.shiftKey) {
    uIOhook.keyToggle(UiohookKey.Shift, 'up')
    uIOhook.keyToggle(UiohookKey.ShiftRight, 'up')
  }
  if (e.metaKey) {
    uIOhook.keyToggle(UiohookKey.Meta, 'up')
    uIOhook.keyToggle(UiohookKey.MetaRight, 'up')
  }
}

export class HotkeyManager {
  private started = false
  private busy = false
  private readonly shortcutCache = new Map<string, ParsedShortcut | null>()

  constructor (
    private readonly getConfig: () => AppConfig,
    private readonly isGameActive: () => boolean,
    private readonly isOverlayOpen: () => boolean,
    private readonly onPriceCheckText: (text: string) => void,
    private readonly onCloseOverlay: () => void,
    private readonly onToggleApp: () => void
  ) {}

  start (): void {
    if (this.started) return
    this.started = true

    uIOhook.on('keydown', (e) => {
      const cfg = this.getConfig()

      if (matchesShortcut(e, this.getParsed(cfg.toggleAppHotkey))) {
        if (this.isOverlayOpen() || this.isGameActive()) {
          this.onToggleApp()
          return
        }
      }

      if (this.isOverlayOpen()) {
        if (matchesShortcut(e, this.getParsed(cfg.closeHotkey))) {
          this.onCloseOverlay()
          return
        }
        if (matchesShortcut(e, this.getParsed(cfg.priceCheckHotkey)) && !this.busy) {
          this.onCloseOverlay()
          void this.triggerPriceCheck(e, true)
          return
        }
      }

      if (!this.isGameActive() || this.busy) return

      if (matchesShortcut(e, this.getParsed(cfg.priceCheckHotkey))) {
        void this.triggerPriceCheck(e, false)
        return
      }

      const macros = cfg.chatMacros ?? []
      for (const macro of macros) {
        if (macro.hotkey && matchesShortcut(e, this.getParsed(macro.hotkey))) {
          void this.triggerChatMacro(e, macro)
          return
        }
      }

      // Fallback if legacy hideoutHotkey is not in chatMacros
      if (
        macros.length === 0 &&
        cfg.hideoutHotkey &&
        matchesShortcut(e, this.getParsed(cfg.hideoutHotkey))
      ) {
        void this.triggerChatMacro(e, {
          id: 'hideout',
          label: 'Hideout',
          hotkey: cfg.hideoutHotkey,
          command: '/hideout',
          send: true
        })
      }
    })

    uIOhook.start()
  }

  stop (): void {
    if (!this.started) return
    this.started = false
    uIOhook.stop()
  }

  private getParsed (combo: string): ParsedShortcut | null {
    const key = combo.trim()
    if (!key) return null
    let cached = this.shortcutCache.get(key)
    if (cached === undefined) {
      cached = parseShortcut(key)
      this.shortcutCache.set(key, cached)
    }
    return cached
  }

  private async triggerPriceCheck (e: UiohookKeyboardEvent, afterOverlayClose: boolean): Promise<void> {
    this.busy = true
    const cfg = this.getConfig()
    const prevClipboard = clipboard.readText()
    const sentinel = process.platform === 'linux' || isPoeItemText(prevClipboard)
      ? `__SPC_EMPTY_${Date.now()}`
      : ''

    try {
      if (afterOverlayClose) {
        await delay(35)
      }
      releaseHeldModifiers(e, e.keycode)
      await delay(10)

      clipboard.writeText(sentinel)
      uIOhook.keyTap(UiohookKey.C, [UiohookKey.Ctrl])

      let itemText = ''
      let elapsed = 0
      while (elapsed < POLL_TIMEOUT_MS) {
        await delay(POLL_DELAY_MS)
        elapsed += POLL_DELAY_MS
        const current = clipboard.readText()
        if (current !== sentinel && isPoeItemText(current)) {
          itemText = current
          break
        }
      }

      if (itemText.trim().length > 0) {
        this.onPriceCheckText(itemText)
      }
    } finally {
      setTimeout(() => {
        if (cfg.restoreClipboard) {
          clipboard.writeText(prevClipboard)
        }
        this.busy = false
      }, CLIPBOARD_RESTORE_MS)
    }
  }

  private async triggerChatMacro (e: UiohookKeyboardEvent, macro: ChatMacro): Promise<void> {
    this.busy = true
    const cfg = this.getConfig()
    const prevClipboard = clipboard.readText()

    try {
      releaseHeldModifiers(e, e.keycode)
      await delay(10)

      let text = macro.command
      let shouldPaste = true
      if (text.startsWith('@last')) {
        text = text.slice('@last'.length).trimStart()
        uIOhook.keyTap(UiohookKey.Enter, [UiohookKey.Ctrl])
        if (text.length > 0) {
          clipboard.writeText(text)
        } else {
          shouldPaste = false
        }
      } else {
        clipboard.writeText(text)
        uIOhook.keyTap(UiohookKey.Enter)
        await delay(20)
        if (text.length > 0 && !AUTO_CLEAR_PREFIXES.has(text[0])) {
          uIOhook.keyTap(UiohookKey.A, [UiohookKey.Ctrl])
          await delay(10)
        }
      }

      if (shouldPaste) {
        await delay(20)
        uIOhook.keyTap(UiohookKey.V, [UiohookKey.Ctrl])
      }

      if (macro.send) {
        await delay(20)
        uIOhook.keyTap(UiohookKey.Enter)
      }
    } finally {
      setTimeout(() => {
        if (cfg.restoreClipboard) {
          clipboard.writeText(prevClipboard)
        }
        this.busy = false
      }, CLIPBOARD_RESTORE_MS)
    }
  }
}
