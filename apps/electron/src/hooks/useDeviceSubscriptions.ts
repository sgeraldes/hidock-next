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
import { shouldLogQa } from '@/services/qa-monitor'
import { checkAutoSyncAllowed, waitForConfig, waitForDeviceReady } from '@/utils/autoSyncGuard'

export function useDeviceSubscriptions() {
  const deviceService = getHiDockDeviceService()
  const deviceSubscriptionsInitialized = useRef(false)
  const autoSyncTriggeredRef = useRef(false)
  const syncDebounceTimerRef = useRef<NodeJS.Timeout | null>(null) // spec-007: debounce timer

  const setDeviceState = useAppStore((s) => s.setDeviceState)
  const setConnectionStatus = useAppStore((s) => s.setConnectionStatus)
  const addActivityLogEntry = useAppStore((s) => s.addActivityLogEntry)
  const setDeviceSyncState = useAppStore((s) => s.setDeviceSyncState)

  // SM-M02: Use refs for store actions to prevent stale closures in long-lived subscriptions.
  // The deviceSubscriptionsInitialized guard means the effect won't re-run when these
  // action references change, so storing them in refs ensures the callbacks always use
  // the latest function reference.
  const setDeviceStateRef = useRef(setDeviceState)
  setDeviceStateRef.current = setDeviceState
  const setConnectionStatusRef = useRef(setConnectionStatus)
  setConnectionStatusRef.current = setConnectionStatus
  const addActivityLogEntryRef = useRef(addActivityLogEntry)
  addActivityLogEntryRef.current = addActivityLogEntry
  const setDeviceSyncStateRef = useRef(setDeviceSyncState)
  setDeviceSyncStateRef.current = setDeviceSyncState

  // ---- Device state subscriptions (guarded for single subscription) ----

  useEffect(() => {
    if (deviceSubscriptionsInitialized.current) return
    deviceSubscriptionsInitialized.current = true

    if (shouldLogQa()) console.log('[useDeviceSubscriptions] Subscribing to device state')

    // Get initial device state and update store
    const initialState = deviceService.getState()
    const initialStatus = deviceService.getConnectionStatus()
    setDeviceStateRef.current(initialState)
    setConnectionStatusRef.current(initialStatus)

    // Subscribe to device state changes
    const unsubStateChange = deviceService.onStateChange((state) => {
      if (shouldLogQa()) console.log('[useDeviceSubscriptions] Device state changed:', state)
      setDeviceStateRef.current(state)
    })

    // Subscribe to connection status changes
    const unsubStatusChange = deviceService.onStatusChange(async (status) => {
      if (shouldLogQa()) console.log('[useDeviceSubscriptions] Connection status changed:', status)
      setConnectionStatusRef.current(status)

      // spec-007: Cancel downloads on disconnect
      if (status.step === 'disconnected' && window.electronAPI?.downloadService) {
        const cancelled = await window.electronAPI.downloadService.cancelActive('Device disconnected')
        if (cancelled > 0) {
          if (shouldLogQa()) console.log(`[useDeviceSubscriptions] Cancelled ${cancelled} downloads due to disconnect`)
          deviceService.log('info', 'Downloads cancelled', `${cancelled} active downloads cancelled due to disconnect`)
        }
      }

      // AUTO-SYNC TRIGGER: Only when status becomes 'ready'
      if (status.step !== 'ready') return
      if (autoSyncTriggeredRef.current) return

      const { allowed, reason } = checkAutoSyncAllowed()
      if (!allowed) {
        if (shouldLogQa()) console.log(`[useDeviceSubscriptions] Auto-sync skipped on ready: ${reason}`)
        return
      }

      // spec-007: Clear existing debounce timer
      if (syncDebounceTimerRef.current) {
        clearTimeout(syncDebounceTimerRef.current)
        if (shouldLogQa()) console.log('[useDeviceSubscriptions] Cleared previous sync debounce timer')
      }

      // spec-007: Debounce sync by 2 seconds
      syncDebounceTimerRef.current = setTimeout(async () => {
        try {
          autoSyncTriggeredRef.current = true
          if (shouldLogQa()) console.log('[useDeviceSubscriptions] Auto-sync triggered after 2s debounce')

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
              setDeviceSyncStateRef.current({
                deviceSyncing: true,
                deviceSyncProgress: { total: toSync.length, current: 0 },
                deviceFileDownloading: toSync[0]?.filename ?? null
              })
            } else {
              deviceService.log('success', 'All files synced', 'No new recordings to download')
            }
          }
        } catch (error) {
          console.error('[useDeviceSubscriptions] Auto-sync failed:', error)
        } finally {
          syncDebounceTimerRef.current = null
        }
      }, 2000) // spec-007: 2 second debounce
    })

    // Subscribe to activity log (renderer-side: device service events)
    const unsubActivity = deviceService.onActivity((entry) => {
      addActivityLogEntryRef.current(entry)
    })

    // Subscribe to activity log (main-process bridge: transcription, calendar, download)
    // These services run in the main process and cannot call deviceService.log() directly.
    let unsubMainActivity: (() => void) | null = null
    if (window.electronAPI?.onActivityLogEntry) {
      unsubMainActivity = window.electronAPI.onActivityLogEntry((entry) => {
        addActivityLogEntryRef.current({
          type: entry.type as any,
          message: entry.message,
          details: entry.details,
          timestamp: new Date(entry.timestamp)
        })
      })
    }

    return () => {
      if (shouldLogQa()) console.log('[useDeviceSubscriptions] Unsubscribing from device state')
      // spec-007: Clear debounce timer on cleanup
      if (syncDebounceTimerRef.current) {
        clearTimeout(syncDebounceTimerRef.current)
        syncDebounceTimerRef.current = null
      }
      unsubStateChange()
      unsubStatusChange()
      unsubActivity()
      unsubMainActivity?.()
      // SM-001: Do NOT reset deviceSubscriptionsInitialized.current here.
      // StrictMode does mount → cleanup → mount; resetting allows double subscription.
      // When the component truly unmounts and remounts, React creates a NEW ref(false).
    }
  // SM-M02: Dependencies are stable (deviceService is singleton), refs handle action freshness
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceService])

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
          // SM-M02: Use ref to avoid stale closure
          setDeviceSyncStateRef.current({
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
  // SM-M02: Dependencies are stable (deviceService is singleton), refs handle action freshness
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceService])
}
