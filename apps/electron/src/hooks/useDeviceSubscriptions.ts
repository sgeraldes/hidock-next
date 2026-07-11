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
import { requestScopedDownloads, drainDownloadQueue } from '@/hooks/useDownloadOrchestrator'

/**
 * Defect B (auto-download not triggering on connect): decide whether the auto-sync
 * trigger may latch (it fires at most once per connect). We must only latch once we
 * actually hold a device file list to act on. The device emits 'ready' BEFORE the
 * file-list scan (handleConnect fetches info/storage/settings/time only). If we
 * latched on that first 'ready' — when the list is still empty — the later 'ready'
 * fired after the scan would be skipped by the once-guard, so auto-download would
 * never queue the device files.
 *   - recordings available            → latch (we can reconcile now)
 *   - device genuinely reports 0 files → latch (nothing to sync, safe)
 *   - list empty but device has files  → DON'T latch (scan not ready; retry next 'ready')
 */
export function shouldLatchAutoSync(recordingsLength: number, deviceRecordingCount: number): boolean {
  if (recordingsLength > 0) return true
  return deviceRecordingCount <= 0
}

export function useDeviceSubscriptions() {
  const deviceService = getHiDockDeviceService()
  const deviceSubscriptionsInitialized = useRef(false)
  const autoSyncTriggeredRef = useRef(false)
  const syncDebounceTimerRef = useRef<NodeJS.Timeout | null>(null) // spec-007: debounce timer

  const setDeviceState = useAppStore((s) => s.setDeviceState)
  const setConnectionStatus = useAppStore((s) => s.setConnectionStatus)
  const addActivityLogEntry = useAppStore((s) => s.addActivityLogEntry)
  const setDeviceSyncState = useAppStore((s) => s.setDeviceSyncState)
  const setDeviceRecording = useAppStore((s) => s.setDeviceRecording)
  const setActiveRecordingFilename = useAppStore((s) => s.setActiveRecordingFilename)

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

      // DL-008: 'disconnected' is not a valid ConnectionStep — device goes to 'idle' on disconnect
      if (status.step === 'idle' && !deviceService.isConnected() && window.electronAPI?.downloadService) {
        const cancelled = await window.electronAPI.downloadService.cancelActive('Device disconnected')
        if (cancelled > 0) {
          if (shouldLogQa()) console.log(`[useDeviceSubscriptions] Cancelled ${cancelled} downloads due to disconnect`)
          deviceService.log('info', 'Downloads cancelled', `${cancelled} active downloads cancelled due to disconnect`)
        }
      }

      // AUTO-SYNC TRIGGER: Only when status becomes 'ready'
      if (status.step !== 'ready') return
      if (autoSyncTriggeredRef.current) return

      // NOTE: we no longer bail here when auto-download is off. Even with the toggle
      // off, a device-only file the user explicitly queued while disconnected (defect A)
      // must fire on connect. The work-check (auto-download OR queued downloads) happens
      // inside the debounce so we never run an unnecessary file-list scan.

      // spec-007: Clear existing debounce timer
      if (syncDebounceTimerRef.current) {
        clearTimeout(syncDebounceTimerRef.current)
        if (shouldLogQa()) console.log('[useDeviceSubscriptions] Cleared previous sync debounce timer')
      }

      // spec-007: Debounce sync by 2 seconds
      syncDebounceTimerRef.current = setTimeout(async () => {
        try {
          if (shouldLogQa()) console.log('[useDeviceSubscriptions] Auto-sync triggered after 2s debounce')

          // Is there anything to do? auto-download reconcile OR already-queued downloads.
          const { allowed } = checkAutoSyncAllowed()
          let pendingFilenames: string[] = []
          try {
            const dl = await window.electronAPI.downloadService.getState()
            pendingFilenames = dl.queue
              .filter((i: { status: string }) => i.status === 'pending')
              .map((i: { filename: string }) => i.filename)
          } catch { /* treat as none */ }
          const hasPendingDownloads = pendingFilenames.length > 0

          if (!allowed && !hasPendingDownloads) {
            // Nothing to do — do NOT latch, so a later config change / queued download
            // can still trigger on a subsequent 'ready'.
            return
          }

          // Latch before a file-list request. listRecordings can synchronously publish
          // status changes while the scan is in flight; those must not schedule a
          // second auto-sync for the same connection.
          autoSyncTriggeredRef.current = true

          // BUG-007 FIX: File list may not be cached yet after handleConnect (it only
          // gets device info/storage/settings/time). Fetch it now so auto-sync has data.
          let recordings = deviceService.getCachedRecordings()
          if (recordings.length === 0 && deviceService.getState().recordingCount > 0) {
            if (shouldLogQa()) console.log('[useDeviceSubscriptions] No cached recordings, fetching file list first...')
            deviceService.log('info', 'Fetching file list', `${deviceService.getState().recordingCount} files expected`)
            try {
              recordings = await deviceService.listRecordings()
            } catch (listError) {
              console.error('[useDeviceSubscriptions] Failed to fetch file list:', listError)
              deviceService.log('error', 'File list fetch failed', listError instanceof Error ? listError.message : 'Unknown error')
              // HIGH-3: the latch is a re-entrancy guard for an ACTIVE attempt, not a
              // permanent one-per-connect flag. This attempt failed, so release it —
              // otherwise a single bad scan disables auto-sync until disconnect.
              autoSyncTriggeredRef.current = false
              return
            }
          }

          // If the scan has not produced data, stop this connection's sync attempt.
          if (!shouldLatchAutoSync(recordings.length, deviceService.getState().recordingCount)) {
            if (shouldLogQa()) console.log('[useDeviceSubscriptions] File list not ready yet — will retry on next ready')
            // HIGH-3: unusable list (scan not ready) — release the latch so the next
            // 'ready' (after the scan completes) can retry, as the log message promises.
            autoSyncTriggeredRef.current = false
            return
          }
          // Auto-download reconcile — only when the user enabled it.
          if (allowed && recordings.length > 0) {
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
              // Slice 1: register scope so the orchestrator downloads these even
              // if auto-download is off (auto-sync is an explicit "download all to-sync").
              requestScopedDownloads(filesToQueue.map(f => f.filename))
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

          // Defect A: drain already-queued (scoped) pending downloads regardless of the
          // auto-download toggle — the user explicitly asked for these while disconnected.
          // Safe here: the file-list scan above has completed, so the download loop won't
          // collide with it on the USB bus.
          if (hasPendingDownloads) {
            if (shouldLogQa()) console.log('[useDeviceSubscriptions] Draining queued downloads on connect')
            // Re-register scope so items persisted across an app restart (in-memory scope
            // lost) still process when auto-download is off. These were only ever queued by
            // an explicit user action, so honoring them on connect is the intended behavior.
            requestScopedDownloads(pendingFilenames)
            drainDownloadQueue()
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

  // ---- Live-recording signal (CMD 18 poll → jensen:recording-changed push) ----
  //
  // The main process polls the device for its in-progress recording and pushes
  // { recording: filename|null } on change. Mirror it into the store so the Today
  // page can show the live "Recording now" card and attribution UI. Also clears on
  // device disconnect (the main-process poll broadcasts null, and we defensively
  // clear on the disconnect event too).
  useEffect(() => {
    const onRecordingChanged = window.electronAPI?.jensen?.onRecordingChanged
    const onDisconnect = window.electronAPI?.jensen?.onDisconnect
    if (!onRecordingChanged) return

    const unsubRecording = onRecordingChanged((data) => {
      const filename = data?.recording ?? null
      if (shouldLogQa()) console.log('[useDeviceSubscriptions] Recording-changed:', filename)
      setDeviceRecording(!!filename)
      setActiveRecordingFilename(filename)
    })

    const unsubDisc = onDisconnect?.(() => {
      setDeviceRecording(false)
      setActiveRecordingFilename(null)
    })

    return () => {
      unsubRecording()
      unsubDisc?.()
    }
  }, [setDeviceRecording, setActiveRecordingFilename])

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

      // Claim this connection's auto-sync before listRecordings can publish any
      // intermediate status updates and re-enter the status-change path.
      autoSyncTriggeredRef.current = true

      if (shouldLogQa()) console.log('[useDeviceSubscriptions] Initial auto-sync check (device pre-connected)')

      let recordings = deviceService.getCachedRecordings()
      if (recordings.length === 0 && deviceService.getState().recordingCount > 0) {
        if (shouldLogQa()) console.log('[useDeviceSubscriptions] No cached recordings for initial sync, fetching file list...')
        deviceService.log('info', 'Fetching file list', `${deviceService.getState().recordingCount} files expected`)
        try {
          recordings = await deviceService.listRecordings()
        } catch (listError) {
          console.error('[useDeviceSubscriptions] Initial file list fetch failed:', listError)
          // HIGH-3: release the latch on a failed scan so the status-change trigger
          // (or a later retry) can re-attempt for this connection.
          autoSyncTriggeredRef.current = false
          return
        }
      }

      // Stop if the scan did not produce a usable list for this connection.
      if (!shouldLatchAutoSync(recordings.length, deviceService.getState().recordingCount)) {
        if (shouldLogQa()) console.log('[useDeviceSubscriptions] Initial file list not ready yet — deferring to status-change trigger')
        // HIGH-3: unusable list — release the latch so the status-change 'ready'
        // trigger can retry once the scan actually completes.
        autoSyncTriggeredRef.current = false
        return
      }
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
          // Slice 1: register scope (explicit auto-sync set) — see note above.
          requestScopedDownloads(filesToQueue.map(f => f.filename))
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
