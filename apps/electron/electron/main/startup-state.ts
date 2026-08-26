import type { BrowserWindow } from 'electron'

export interface StartupState {
  earlyConfigurationApplied: boolean
  hasSingleInstanceLock: boolean | null
  runtimeDir: string | null
  splashWindow: BrowserWindow | null
  mainWindow: BrowserWindow | null
}

export function getStartupState(): StartupState {
  const root = globalThis as typeof globalThis & { __HIDOCK_STARTUP_STATE__?: StartupState }
  if (!root.__HIDOCK_STARTUP_STATE__) {
    root.__HIDOCK_STARTUP_STATE__ = {
      earlyConfigurationApplied: false,
      hasSingleInstanceLock: null,
      runtimeDir: null,
      splashWindow: null,
      mainWindow: null
    }
  }
  return root.__HIDOCK_STARTUP_STATE__
}
