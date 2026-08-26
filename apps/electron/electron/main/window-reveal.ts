import type { BrowserWindow } from 'electron'

export type WindowRevealReason = 'ready-to-show' | 'did-finish-load' | 'timeout'

export interface WindowRevealOptions {
  closeSplash: () => void
  /** Last-resort bound: a renderer load problem must never leave the splash up forever. */
  timeoutMs?: number
  log?: (message: string) => void
}

/**
 * Reveal the main window on the first reliable renderer-ready signal.
 *
 * Electron can emit `did-finish-load` without subsequently emitting
 * `ready-to-show` (notably during dev-server reloads). Waiting exclusively for
 * `ready-to-show` therefore leaves a fully loaded app permanently hidden behind
 * a 100% splash. The timeout is deliberately a reveal fallback, never a signal
 * to start background work while the application is still hidden.
 */
export function revealMainWindow(
  window: BrowserWindow,
  options: WindowRevealOptions
): Promise<WindowRevealReason | null> {
  const timeoutMs = options.timeoutMs ?? 8_000

  return new Promise((resolve) => {
    let settled = false
    // Assigned at the end of this scope but read earlier through the settle()
    // closure, so it cannot be const.
    // eslint-disable-next-line prefer-const
    let timer: ReturnType<typeof setTimeout> | undefined

    const settle = (reason: WindowRevealReason | null): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(reason)
    }

    const reveal = (reason: WindowRevealReason): void => {
      if (settled || window.isDestroyed()) {
        if (window.isDestroyed()) settle(null)
        return
      }

      // Show first, then close the always-on-top splash. This avoids exposing
      // the desktop between the two native-window operations.
      if (!window.isVisible()) window.show()
      options.closeSplash()
      options.log?.(`[Startup] Main window revealed via ${reason}`)
      settle(reason)
    }

    window.once('ready-to-show', () => reveal('ready-to-show'))
    window.webContents.once('did-finish-load', () => reveal('did-finish-load'))
    window.once('closed', () => settle(null))
    timer = setTimeout(() => reveal('timeout'), timeoutMs)
  })
}
