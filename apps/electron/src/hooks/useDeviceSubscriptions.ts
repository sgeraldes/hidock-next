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
import { checkAutoSyncAllowed, waitForConfig, waitForDeviceReady } from '@/utils/autoSyncGuard'

const DEBUG = import.meta.env.DEV

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

    if (DEBUG) console.log('[useDeviceSubscriptions] Subscribing to device state')

    // Get initial device state and update store
    const initialState = deviceService.getState()
    const initialStatus = deviceService.getConnectionStatus()
    setDeviceState(initialState)
    setConnectionStatus(initialStatus)

    // Subscribe to device state changes
    const unsubStateChange = deviceService.onStateChange((state) => {
      if (DEBUG) console.log('[useDeviceSubscriptions] Device state changed:', state)
      setDeviceState(state)
    })

    // Subscribe to connection status changes
    const unsubStatusChange = deviceService.onStatusChange(async (status) => {
      if (DEBUG) console.log('[useDeviceSubscriptions] Connection status changed:', status)
      setConnectionStatus(status)

      // AUTO-SYNC TRIGGER: Only when status becomes 'ready'
      if (status.step !== 'ready') return
      if (autoSyncTriggeredRef.current) return

      const { allowed, reason } = checkAutoSyncAllowed()
      if (!allowed) {
        if (DEBUG) console.log(`[useDeviceSubscriptions] Auto-sync skipped on ready: ${reason}`)
        return
      }

      autoSyncTriggeredRef.current = true
      if (DEBUG) console.log('[useDeviceSubscriptions] Auto-sync triggered on device ready')

      const recordings = deviceService.getCachedRecordings()
      if (recordings.length > 0) {
        const syncedFilenames = await window.electronAPI.syncedFiles.getFilenames()
        const syncedSet = new Set(syncedFilenames)
        // TODO (DL-06): Simple filename matching is insufficient for sync detection.
        // Device files may be renamed during download (.hda -> .wav), and different
        // recordings could theoretically share filenames across format/re-record cycles.
        // Should use file hash or size+date combo for reliable matching. Don't change
        // the logic yet as it could break sync — needs careful migration plan.
        const toSync = recordings.filter(rec => !syncedSet.has(rec.filename))
        if (toSync.length > 0) {
          if (DEBUG) console.log(`[QA-MONITOR][Operation] Auto-sync on ready: ${toSync.length} files to download`)
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
      if (DEBUG) console.log('[useDeviceSubscriptions] Unsubscribing from device state')
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
        if (DEBUG) console.log('[useDeviceSubscriptions] Config load timeout, skipping auto-sync')
        return
      }

      const deviceReady = await waitForDeviceReady(60000)
      if (!deviceReady) {
        if (DEBUG) console.log('[useDeviceSubscriptions] Device not ready, skipping auto-sync')
        return
      }

      const { allowed, reason } = checkAutoSyncAllowed()
      if (!allowed) {
        if (DEBUG) console.log(`[useDeviceSubscriptions] Auto-sync skipped: ${reason}`)
        deviceService.log('info', 'Auto-sync skipped', reason)
        return
      }

      if (autoSyncTriggeredRef.current) return

      autoSyncTriggeredRef.current = true
      if (DEBUG) console.log('[useDeviceSubscriptions] Initial auto-sync check (device pre-connected)')

      const recordings = deviceService.getCachedRecordings()
      if (recordings.length > 0) {
        const syncedFilenames = await window.electronAPI.syncedFiles.getFilenames()
        const syncedSet = new Set(syncedFilenames)
        // TODO (DL-06): Same filename matching limitation as above — see DL-06 comment.
        const toSync = recordings.filter(rec => !syncedSet.has(rec.filename))
        if (toSync.length > 0) {
          if (DEBUG) console.log(`[QA-MONITOR][Operation] Initial auto-sync: ${toSync.length} files to download`)
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
