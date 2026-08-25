import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { getStartupState } from './startup-state'

/** Apply switches and profile overrides before Electron's ready event. */
export function configureEarlyStartup(): void {
  const state = getStartupState()
  if (state.earlyConfigurationApplied) return
  state.earlyConfigurationApplied = true

  const devUserDataOverride = process.env.HIDOCK_DEV_USERDATA
  if (devUserDataOverride) {
    app.setPath('userData', devUserDataOverride)
    console.warn(`[DEV] userData overridden to ${devUserDataOverride}`)
  }

  // Electron/Chromium device access switches must be registered before ready.
  app.commandLine.appendSwitch('disable-usb-blocklist')
  if (process.platform === 'win32') {
    app.commandLine.appendSwitch('disable-usb-device-event-log')
    app.commandLine.appendSwitch('device-event-log-level', '3')
  }

  const enableRemoteDebugging = is.dev || process.env.ENABLE_REMOTE_DEBUGGING === 'true'
  if (enableRemoteDebugging) {
    const cdpPort = process.env.HIDOCK_DEV_CDP_PORT || '9222'
    app.commandLine.appendSwitch('remote-debugging-port', cdpPort)
    console.warn(`[SECURITY] Remote debugging enabled on port ${cdpPort}`)
  }
}
