/**
 * useDeviceSubscriptions - Device state/status/activity subscriptions and auto-sync trigger.
 *
 * Extracted from OperationController Phase 2+3A decomposition.
 * Owns: device state/status subscriptions, activity log forwarding,
 * auto-sync on device ready, and initial auto-sync for pre-connected devices.
 */

import { useEffect, useRef } from 'react'
import { getHiDockDeviceService } from '@/services/hidock-device'
import { useAppStore } from '@/store/useAppStore'
import { useUIStore } from '@/store'
import { checkAutoSyncAllowed, waitForConfig, waitForDeviceReady } from '@/utils/autoSyncGuard'

// QA Logging helper - respects user's QA Logs toggle
function shouldLogQa(): boolean {
  const IS_PROD = import.meta.env.PROD
  if (!IS_PROD) return true // Always log in dev
  try {
    return useUIStore.getState().qaLogsEnabled
  } catch {
    return false
  }
}

export function useDeviceSubscriptions() {
  const deviceService = getHiDockDeviceService()
  const deviceSubscriptionsInitialized = useRef(false)
  const autoSyncTriggeredRef = useRef(false)

  const setDeviceState = useAppStore((s) => s.setDeviceState)
  const setConnectionStatus = useAppStore((s) => s.setConnectionStatus)
  const addActivityLogEntry = useAppStore((s) => s.addActivityLogEntry)
  const setDeviceSyncState = useAppStore((s) => s.setDeviceSyncState)

  // ---- Device state subscriptions (guarded for single subscription) ----

  useEffect(() => {
    if (deviceSubscriptionsInitialized.current) return
    deviceSubscriptionsInitialized.current = true

    if (shouldLogQa()) console.log('[useDeviceSubscriptions] Subscribing to device state')

    // Get initial device state and update store
    const initialState = deviceService.getState()
    const initialStatus = deviceService.getConnectionStatus()
    setDeviceState(initialState)
    setConnectionStatus(initialStatus)

    // Subscribe to device state changes
    const unsubStateChange = deviceService.onStateChange((state) => {
      if (shouldLogQa()) console.log('[useDeviceSubscriptions] Device state changed:', state)
      setDeviceState(state)
    })

    // Subscribe to connection status changes
    const unsubStatusChange = deviceService.onStatusChange(async (status) => {
      if (shouldLogQa()) console.log('[useDeviceSubscriptions] Connection status changed:', status)
      setConnectionStatus(status)

      // AUTO-SYNC TRIGGER: Only when status becomes 'ready'
      if (status.step !== 'ready') return
      if (autoSyncTriggeredRef.current) return

      const { allowed, reason } = checkAutoSyncAllowed()
      if (!allowed) {
        if (shouldLogQa()) console.log(`[useDeviceSubscriptions] Auto-sync skipped on ready: ${reason}`)
        return
      }

      autoSyncTriggeredRef.current = true
      if (shouldLogQa()) console.log('[useDeviceSubscriptions] Auto-sync triggered on device ready')

      const recordings = deviceService.getCachedRecordings()
      if (recordings.length > 0) {
        // DL-06 FIX: Use proper reconciliation logic from download service instead of simple filename matching
        const reconcileResults = await window.electronAPI.downloadService.getFilesToSync(
          recordings.map(rec => ({
            filename: rec.filename,
            size: rec.size,
            duration: rec.duration,
            dateCreated: rec.dateCreated
          }))
        )
        const toSync = reconcileResults.filter(result => !result.skipReason)
        if (toSync.length > 0) {
          if (shouldLogQa()) console.log(`[QA-MONITOR][Operation] Auto-sync on ready: ${toSync.length} files to download`)
          deviceService.log('info', 'Auto-sync triggered', `${toSync.length} new recordings to download`)

          const filesToQueue = toSync.map(rec => ({
            filename: rec.filename,
            size: rec.size,
            dateCreated: rec.dateCreated?.toISOString()
          }))
          await window.electronAPI.downloadService.startSession(filesToQueue)
          setDeviceSyncState({
            deviceSyncing: true,
            deviceSyncProgress: { total: toSync.length, current: 0 },
            deviceFileDownloading: toSync[0]?.filename ?? null
          })
        } else {
          deviceService.log('success', 'All files synced', 'No new recordings to download')
        }
      }
    })

    // Subscribe to activity log
    const unsubActivity = deviceService.onActivity((entry) => {
      addActivityLogEntry(entry)
    })

    return () => {
      if (shouldLogQa()) console.log('[useDeviceSubscriptions] Unsubscribing from device state')
      unsubStateChange()
      unsubStatusChange()
      unsubActivity()
      deviceSubscriptionsInitialized.current = false
    }
  }, [deviceService, setDeviceState, setConnectionStatus, addActivityLogEntry])

  // ---- Initial auto-sync for pre-connected devices ----

  useEffect(() => {
    const isElectron = !!window.electronAPI?.downloadService

    const checkInitialAutoSync = async () => {
      if (!isElectron) return

      const configLoaded = await waitForConfig(10000)
      if (!configLoaded) {
        if (shouldLogQa()) console.log('[useDeviceSubscriptions] Config load timeout, skipping auto-sync')
        return
      }

      const deviceReady = await waitForDeviceReady(60000)
      if (!deviceReady) {
        if (shouldLogQa()) console.log('[useDeviceSubscriptions] Device not ready, skipping auto-sync')
        return
      }

      const { allowed, reason } = checkAutoSyncAllowed()
      if (!allowed) {
        if (shouldLogQa()) console.log(`[useDeviceSubscriptions] Auto-sync skipped: ${reason}`)
        deviceService.log('info', 'Auto-sync skipped', reason)
        return
      }

      if (autoSyncTriggeredRef.current) return

      autoSyncTriggeredRef.current = true
      if (shouldLogQa()) console.log('[useDeviceSubscriptions] Initial auto-sync check (device pre-connected)')

      const recordings = deviceService.getCachedRecordings()
      if (recordings.length > 0) {
        // DL-06 FIX: Use proper reconciliation logic from download service instead of simple filename matching
        const reconcileResults = await window.electronAPI.downloadService.getFilesToSync(
          recordings.map(rec => ({
            filename: rec.filename,
            size: rec.size,
            duration: rec.duration,
            dateCreated: rec.dateCreated
          }))
        )
        const toSync = reconcileResults.filter(result => !result.skipReason)
        if (toSync.length > 0) {
          if (shouldLogQa()) console.log(`[QA-MONITOR][Operation] Initial auto-sync: ${toSync.length} files to download`)
          deviceService.log('info', 'Auto-sync triggered', `${toSync.length} new recordings to download`)

          const filesToQueue = toSync.map(rec => ({
            filename: rec.filename,
            size: rec.size,
            dateCreated: rec.dateCreated?.toISOString()
          }))
          await window.electronAPI.downloadService.startSession(filesToQueue)
          setDeviceSyncState({
            deviceSyncing: true,
            deviceSyncProgress: { total: toSync.length, current: 0 },
            deviceFileDownloading: toSync[0]?.filename ?? null
          })
        } else {
          deviceService.log('success', 'All files synced', 'No new recordings to download')
        }
      }
    }
    checkInitialAutoSync()

    // Reset auto-sync flag on disconnect so it re-triggers on reconnect
    const unsubDeviceDisconnect = deviceService.onStateChange((deviceState) => {
      if (!deviceState.connected) {
        autoSyncTriggeredRef.current = false
      }
    })

    return () => {
      unsubDeviceDisconnect()
    }
  }, [deviceService, setDeviceSyncState])
}
