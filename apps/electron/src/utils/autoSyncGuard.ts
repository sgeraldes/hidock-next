import { useAppStore } from '@/store/useAppStore'
import { getHiDockDeviceService } from '@/services/hidock-device'

export interface AutoSyncResult {
  allowed: boolean
  reason: string
}

/**
 * Check if auto-sync should be allowed.
 * Returns allowed=true only when ALL conditions are met:
 * 1. Config is loaded (not defaulted)
 * 2. Auto-download is explicitly enabled in config
 * 3. Device is connected AND fully initialized (step === 'ready')
 */
export function checkAutoSyncAllowed(): AutoSyncResult {
  const store = useAppStore.getState()
  const deviceService = getHiDockDeviceService()

  // Guard 1: Config must be loaded
  if (!store.configReady) {
    return { allowed: false, reason: 'Config not loaded yet' }
  }

  // Guard 2: Config must exist
  if (!store.config) {
    return { allowed: false, reason: 'Config unavailable' }
  }

  // Guard 3: Auto-download must be EXPLICITLY enabled (no defaulting to true)
  const autoDownloadSetting = store.config.device?.autoDownload
  if (autoDownloadSetting !== true) {
    return {
      allowed: false,
      reason: `Auto-download disabled (value: ${autoDownloadSetting})`
    }
  }

  // Guard 4: Device must be connected
  if (!deviceService.isConnected()) {
    return { allowed: false, reason: 'Device not connected' }
  }

  // Guard 5: Device must be fully initialized
  if (!deviceService.isInitialized()) {
    return { allowed: false, reason: 'Device not fully initialized' }
  }

  // Guard 6: Connection status must be 'ready'
  const status = deviceService.getConnectionStatus()
  if (status.step !== 'ready') {
    return {
      allowed: false,
      reason: `Device in ${status.step} state, waiting for ready`
    }
  }

  return { allowed: true, reason: 'All preconditions met' }
}

/**
 * Wait for config to be loaded with timeout.
 */
export async function waitForConfig(timeoutMs: number = 5000): Promise<boolean> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    const { configReady } = useAppStore.getState()
    if (configReady) return true
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  return false
}

/**
 * Wait for device to be fully ready with timeout.
 */
export async function waitForDeviceReady(timeoutMs: number = 60000): Promise<boolean> {
  const deviceService = getHiDockDeviceService()
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    if (!deviceService.isConnected()) return false

    const status = deviceService.getConnectionStatus()
    if (status.step === 'ready') return true
    if (status.step === 'error') return false

    await new Promise(resolve => setTimeout(resolve, 200))
  }

  return false
}
