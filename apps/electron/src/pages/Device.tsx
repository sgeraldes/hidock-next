import { useState, useEffect, useCallback, useRef } from 'react'
import { Usb, Download, RefreshCw, HardDrive, Mic, AlertCircle, Radio, Battery, Bluetooth, Play, Pause, Square, X, Terminal, ChevronDown, ChevronUp, Check, Copy, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  getHiDockDeviceService,
  BatteryStatus
} from '@/services/hidock-device'
import { Progress } from '@/components/ui/progress'
import { toast } from '@/components/ui/toaster'
import { useAppStore } from '@/store/useAppStore'
import { hasDeviceFile, type DeviceOnlyRecording, type BothLocationsRecording } from '@/types/unified-recording'
import { useUnifiedRecordings } from '@/hooks/useUnifiedRecordings'
import { cancelDownloads } from '@/hooks/useDownloadOrchestrator'

import { formatEta } from '@/utils/formatters'
import { DeviceFileList } from '@/components/DeviceFileList'

const CONNECTION_TIMEOUT_MS = 15000 // 15 second timeout
const DEBUG_DEVICE_UI = false // Enable verbose UI logging

export function Device() {
  // TODO (DL-05/DV-08): Dual syncing state causes UI flicker. `storeSyncing` (from useAppStore)
  // tracks the download orchestrator's sync state, while `syncing` (local useState) tracks
  // the Device page's manual sync button state. Both are used in the UI conditionals (line ~977),
  // causing the sync button to flicker between states when one updates before the other.
  // The fix requires unifying these into a single source of truth, but that needs careful
  // coordination between useDownloadOrchestrator and the Device page's manual sync flow.
  const storeSyncing = useAppStore(state => state.deviceSyncing)
  const deviceState = useAppStore(state => state.deviceState)
  const connectionStatus = useAppStore(state => state.connectionStatus)
  const activityLog = useAppStore(state => state.activityLog)
  const setDeviceSyncState = useAppStore(state => state.setDeviceSyncState)
  const deviceSyncProgress = useAppStore(state => state.deviceSyncProgress)
  const deviceSyncEta = useAppStore(state => state.deviceSyncEta)

  // Initialize service
  const deviceService = getHiDockDeviceService()
  const { recordings, loading: loadingRecordings } = useUnifiedRecordings()
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [connectionElapsed, setConnectionElapsed] = useState(0)
  const connectionTimeoutRef = useRef<number | null>(null)
  const connectionTimerRef = useRef<number | null>(null)

  // Realtime streaming state
  const [realtimeActive, setRealtimeActive] = useState(false)
  const [realtimePaused, setRealtimePaused] = useState(false)
  // DV-09: Offset state is kept in sync for potential future UI use; polling reads from ref
  const [, setRealtimeDataOffset] = useState(0)
  const [realtimeDataReceived, setRealtimeDataReceived] = useState(0)
  const realtimeIntervalRef = useRef<number | null>(null)
  // DV-09: Ref to track current offset for use in interval callback (avoids stale closure)
  const realtimeDataOffsetRef = useRef(0)

  // P1-specific state
  const [batteryStatus, setBatteryStatus] = useState<BatteryStatus | null>(null)
  const [bluetoothScanning, setBluetoothScanning] = useState(false)
  // DV-10: Ref to track Bluetooth scan timeout for cleanup on unmount
  const btScanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // File list loading state is now managed by useUnifiedRecordings hook

  // Synced files tracking
  const [syncedFilenames, setSyncedFilenames] = useState<Set<string>>(new Set())

  // Failed downloads tracking for retry button
  const [failedDownloadCount, setFailedDownloadCount] = useState(0)

  // Auto-connect configuration state
  const [autoConnectConfig, setAutoConnectConfig] = useState(() => deviceService.getAutoConnectConfig())

  // Auto-download and auto-transcribe configuration state
  const [autoDownload, setAutoDownload] = useState<boolean | null>(null)
  const [autoTranscribe, setAutoTranscribe] = useState<boolean | null>(null)

  // Activity log UI state
  const [logExpanded, setLogExpanded] = useState(true)
  const logContainerRef = useRef<HTMLDivElement>(null)

  // Track if auto-sync has been triggered for this connection session (prevents duplicate triggers)
  const autoSyncTriggeredRef = useRef(false)

  // DV-04: Cancel handler that aborts the in-progress USB transfer AND sets store state
  const cancelDeviceSync = useCallback(() => {
    cancelDownloads() // Aborts the USB transfer via AbortController + sets store state
  }, [])

  // Helper to clean up connection timers
  const clearConnectionTimers = useCallback(() => {
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current)
      connectionTimeoutRef.current = null
    }
    if (connectionTimerRef.current) {
      clearInterval(connectionTimerRef.current)
      connectionTimerRef.current = null
    }
    setConnectionElapsed(0)
  }, [])

  // Cancel connection attempt
  const handleCancelConnection = useCallback(() => {
    clearConnectionTimers()
    setConnecting(false)
    setError('Connection cancelled')
    deviceService.stopAutoConnect()
  }, [clearConnectionTimers, deviceService])

  // Helper to refresh synced filenames (used after syncs complete)
  const refreshSyncedFilenames = useCallback(async () => {
    try {
      const filenames = await window.electronAPI.syncedFiles.getFilenames()
      setSyncedFilenames(new Set(filenames))
      if (DEBUG_DEVICE_UI) console.log(`[Device.tsx] Refreshed ${filenames.length} synced filenames`)
    } catch (e) {
      console.error('[Device.tsx] Failed to refresh synced filenames:', e)
    }
  }, [])

  // Set up listeners
  useEffect(() => {
    // Mounted flag to prevent state updates after unmount
    let mounted = true

    // Load synced filenames from database
    const loadSyncedFilenames = async () => {
      try {
        const filenames = await window.electronAPI.syncedFiles.getFilenames()
        if (mounted) {
          setSyncedFilenames(new Set(filenames))
          if (DEBUG_DEVICE_UI) console.log(`[Device.tsx] Loaded ${filenames.length} synced filenames`)
        }
      } catch (e) {
        console.error('[Device.tsx] Failed to load synced filenames:', e)
      }
    }
    loadSyncedFilenames()

    // Load auto-download, auto-transcribe, and auto-connect settings from config
    // IMPORTANT: This also updates autoConnectConfig because the service loads config async
    // and the initial useState may read the default value before config is loaded
    const loadConfigSettings = async () => {
      try {
        const config = await window.electronAPI.config.get()
        if (mounted) {
          // Auto-connect - must be loaded here because service loads async and
          // useState may have captured the default before config loaded
          if (config?.device?.autoConnect !== undefined) {
            const isEnabled = config.device.autoConnect === true
            setAutoConnectConfig({
              enabled: isEnabled,
              intervalMs: 5000,
              connectOnStartup: isEnabled
            })
          }
          if (config?.device?.autoDownload !== undefined) {
            setAutoDownload(config.device.autoDownload)
          }
          if (config?.transcription?.autoTranscribe !== undefined) {
            setAutoTranscribe(config.transcription.autoTranscribe)
          }
        }
      } catch (e) {
        console.error('[Device.tsx] Failed to load config settings:', e)
      }
    }
    loadConfigSettings()

    // Load initial download service state to check for failed downloads
    const loadDownloadServiceState = async () => {
      try {
        const state = await window.electronAPI.downloadService.getState()
        if (mounted && state?.queue) {
          const failedCount = state.queue.filter((item: { status: string }) => item.status === 'failed').length
          setFailedDownloadCount(failedCount)
        }
      } catch (e) {
        console.error('[Device.tsx] Failed to load download service state:', e)
      }
    }
    loadDownloadServiceState()

    // Listen for download service state updates
    const unsubscribeDownloadService = window.electronAPI.downloadService.onStateUpdate((state: { queue: Array<{ status: string }> }) => {
      if (!mounted) return
      const failedCount = state.queue.filter((item) => item.status === 'failed').length
      setFailedDownloadCount(failedCount)

      // Track completed downloads to refresh sync count
      const completedCount = state.queue.filter((item) => item.status === 'completed').length

      // Also update syncing state when queue is empty or all complete
      const pendingOrDownloading = state.queue.filter((item) => item.status === 'pending' || item.status === 'downloading').length
      if (pendingOrDownloading === 0) {
        setSyncing(false)

        // Refresh synced filenames after downloads complete (sync count fix)
        if (completedCount > 0) {
          refreshSyncedFilenames()
        }
      }
    })

    // Load additional data if already connected (recordings are loaded by useUnifiedRecordings hook)
    const loadInitialData = async () => {
      if (DEBUG_DEVICE_UI) console.log('[Device.tsx] loadInitialData called, isConnected:', deviceService.isConnected())
      if (deviceService.isConnected()) {
        try {
          if (deviceService.isP1Device()) {
            if (DEBUG_DEVICE_UI) console.log('[Device.tsx] P1 device detected, loading battery status...')
            const status = await deviceService.getBatteryStatus()
            if (mounted) setBatteryStatus(status)
          }
        } catch (e) {
          console.error('[Device.tsx] Failed to load initial data:', e)
        }
      } else {
        if (DEBUG_DEVICE_UI) console.log('[Device.tsx] Device not connected, skipping initial data load')
      }
    }
    loadInitialData()

    // Subscribe to connection changes (recordings are managed by useUnifiedRecordings hook)
    const unsubscribe = deviceService.onConnectionChange(async (connected) => {
      if (!mounted) return
      if (DEBUG_DEVICE_UI) console.log('[Device.tsx] Connection change:', connected)
      setConnecting(false)
      clearConnectionTimers() // Clear timers on connection change
      if (connected) {
        if (DEBUG_DEVICE_UI) console.log('[Device.tsx] Device connected')
        setError(null) // Clear any previous errors

        // Load P1-specific data
        if (deviceService.isP1Device()) {
          if (DEBUG_DEVICE_UI) console.log('[Device.tsx] P1 device, loading battery status...')
          loadBatteryStatus()
        }
      } else {
        if (DEBUG_DEVICE_UI) console.log('[Device.tsx] Device disconnected, clearing state...')
        setBatteryStatus(null)
        // Reset auto-sync flag so it triggers on reconnect
        autoSyncTriggeredRef.current = false
        // Clean up realtime streaming
        if (realtimeIntervalRef.current) {
          clearInterval(realtimeIntervalRef.current)
          realtimeIntervalRef.current = null
        }
        setRealtimeActive(false)
        setRealtimePaused(false)
      }
    })

    const unsubscribeProgress = deviceService.onDownloadProgress((progress) => {
      if (mounted) {
        // Update global store for sidebar indicator
        setDeviceSyncState({ deviceFileProgress: progress.percent })
      }
    })

    // NOTE: We do NOT start auto-connect here. Auto-connect is managed at the app level.
    // Starting it here would reset user's disconnect decision when navigating pages.

    // Periodic sync count validation (refresh every 60 seconds to catch external changes)
    const syncCountInterval = setInterval(() => {
      if (mounted) {
        refreshSyncedFilenames()
      }
    }, 60000)

    return () => {
      mounted = false  // Mark as unmounted to prevent state updates
      unsubscribe()
      unsubscribeProgress()
      clearConnectionTimers()
      // Clean up realtime interval
      if (realtimeIntervalRef.current) {
        clearInterval(realtimeIntervalRef.current)
      }
      // Clean up download service listener
      unsubscribeDownloadService()
      // Clean up sync count validation interval
      clearInterval(syncCountInterval)
      // DV-10: Clean up Bluetooth scan timeout
      if (btScanTimeoutRef.current) {
        clearTimeout(btScanTimeoutRef.current)
        btScanTimeoutRef.current = null
      }
    }
  // DV-03: Removed connectionStatus.step/message from deps — they change ~8x per connect.
  // Connection status is tracked in a separate effect below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearConnectionTimers, refreshSyncedFilenames])

  // DV-03: Separate effect for connection status sync — runs when status changes
  // but does NOT tear down and re-create all subscriptions
  useEffect(() => {
    const isConnecting = !['idle', 'ready', 'error'].includes(connectionStatus.step)
    setConnecting(isConnecting)

    if (connectionStatus.step === 'error') {
      setError(connectionStatus.message)
      clearConnectionTimers()
    }
  }, [connectionStatus.step, connectionStatus.message, clearConnectionTimers])

  // Separate effect for auto-scrolling activity log - does NOT trigger re-renders
  useEffect(() => {
    if (activityLog.length > 0 && logContainerRef.current) {
      requestAnimationFrame(() => {
        if (logContainerRef.current) {
          logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
        }
      })
    }
  }, [activityLog.length])

  // Refresh synced filenames when device-accessible recordings change (catches new syncs)
  const deviceRecordingsCount = recordings.filter(rec => hasDeviceFile(rec)).length
  useEffect(() => {
    if (deviceState.connected && deviceRecordingsCount > 0) {
      refreshSyncedFilenames()
    }
  }, [deviceRecordingsCount, deviceState.connected, refreshSyncedFilenames])

  const handleConnect = async () => {
    setConnecting(true)
    setError(null)

    // Start timing
    const startTime = Date.now()
    setConnectionElapsed(0)

    // Update elapsed time every 100ms
    connectionTimerRef.current = window.setInterval(() => {
      setConnectionElapsed(Date.now() - startTime)
    }, 100)

    // Set up timeout
    connectionTimeoutRef.current = window.setTimeout(() => {
      if (!deviceService.isConnected()) {
        clearConnectionTimers()
        setConnecting(false)
        setError('Connection timed out. Make sure your HiDock is connected via USB and not in use by another application.')
      }
    }, CONNECTION_TIMEOUT_MS)

    try {
      const success = await deviceService.connect()
      if (!success) {
        clearConnectionTimers()
        setError('Failed to connect to device. Check if the device is connected and not in use.')
      }
    } catch (e) {
      clearConnectionTimers()
      setError(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      // Don't clear timers here if still connecting - let timeout handle it
      if (deviceService.isConnected()) {
        clearConnectionTimers()
      }
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    await deviceService.disconnect()
    // Sync UI state after disconnect persists config
    setAutoConnectConfig(deviceService.getAutoConnectConfig())
  }

  const handleResetDevice = async () => {
    setError(null)
    try {
      const success = await deviceService.resetDevice()
      if (!success) {
        setError('Device reset failed. Try disconnecting and reconnecting the USB cable.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Device reset failed')
    }
  }

  const handleSyncAll = async () => {
    // Validate connection before starting
    if (!deviceService.isConnected()) {
      setError('Device not connected. Please connect your HiDock first.')
      return
    }

    setSyncing(true)
    setError(null)

    try {
      // Filter to device-accessible recordings only
      const deviceRecordings = recordings.filter(rec => hasDeviceFile(rec))
      // Use download service to determine which files need syncing (handles all reconciliation)
      // Note: dateCreated maps from UnifiedRecording.dateRecorded (same underlying device timestamp)
      // DL-08: Use deviceFilename (actual device name) for sync lookups. Currently filename
      // and deviceFilename are always equal for device recordings, but deviceFilename is
      // the canonical field for device-accessible recordings.
      const filesToCheck = deviceRecordings.map(rec => ({
        filename: (rec as DeviceOnlyRecording | BothLocationsRecording).deviceFilename,
        size: rec.size,
        duration: rec.duration,
        dateCreated: rec.dateRecorded
      }))

      const filesWithStatus = await window.electronAPI.downloadService.getFilesToSync(filesToCheck)
      const toSync = filesWithStatus.filter(f => !f.skipReason)

      if (DEBUG_DEVICE_UI) {
        console.log(`[Device.tsx] handleSyncAll: ${toSync.length} need sync, ${filesWithStatus.length - toSync.length} already synced`)
        // Log skip reasons for debugging
        for (const f of filesWithStatus.filter(f => f.skipReason)) {
          console.log(`  Skipping ${f.filename}: ${f.skipReason}`)
        }
      }

      if (toSync.length === 0) {
        toast({
          title: 'All synced',
          description: 'All recordings are already downloaded',
          variant: 'success'
        })
        setSyncing(false)
        return
      }

      // Queue files to download service - useDownloadOrchestrator will handle actual downloads
      // IMPORTANT: Pass dateCreated to preserve original recording dates from device
      // Note: dateCreated from getFilesToSync is already serialized to ISO string by IPC
      const queuedIds = await window.electronAPI.downloadService.queueDownloads(
        toSync.map(f => ({
          filename: f.filename,
          size: f.size,
          dateCreated: typeof f.dateCreated === 'string' ? f.dateCreated : f.dateCreated?.toISOString()
        }))
      )

      if (queuedIds.length > 0) {
        // Refresh synced filenames to update button count
        await refreshSyncedFilenames()

        toast({
          title: 'Sync started',
          description: `Queued ${queuedIds.length} recording${queuedIds.length !== 1 ? 's' : ''} for download`,
          variant: 'default'
        })
      } else {
        toast({
          title: 'Nothing to sync',
          description: 'All files are already queued or downloaded',
          variant: 'default'
        })
        setSyncing(false)
      }
      // Note: setSyncing(false) is NOT called here for queued files - the download orchestrator will manage sync state
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
      toast({
        title: 'Sync failed',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'error'
      })
      setSyncing(false)
    }
  }

  const handleAutoRecordToggle = async (enabled: boolean) => {
    try {
      // DV-06: Check return value — if false, the setting didn't apply on device
      const success = await deviceService.setAutoRecord(enabled)
      if (!success) {
        toast({
          title: 'Setting not applied',
          description: 'Failed to update auto-record on device. The switch has been reverted.',
          variant: 'error'
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update setting')
      toast({
        title: 'Setting error',
        description: e instanceof Error ? e.message : 'Failed to update auto-record setting',
        variant: 'error'
      })
    }
  }

  const handleAutoConnectToggle = (enabled: boolean) => {
    // DV-11: Sync both enabled and connectOnStartup flags together
    // When user toggles auto-connect, both flags should update so the
    // auto-connect behavior is consistent on startup and during runtime
    deviceService.setAutoConnectConfig({ enabled, connectOnStartup: enabled })
    setAutoConnectConfig(deviceService.getAutoConnectConfig())
    // Setting will take effect on next app startup
  }

  const handleAutoDownloadToggle = async (enabled: boolean) => {
    try {
      await window.electronAPI.config.updateSection('device', { autoDownload: enabled })
      setAutoDownload(enabled)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update auto-download setting')
    }
  }

  const handleAutoTranscribeToggle = async (enabled: boolean) => {
    try {
      await window.electronAPI.config.updateSection('transcription', { autoTranscribe: enabled })
      setAutoTranscribe(enabled)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update auto-transcribe setting')
    }
  }

  // DV-02: Format Storage handler with confirmation
  const [formatting, setFormatting] = useState(false)
  const handleFormatStorage = async () => {
    // Use window.confirm for confirmation since no dialog component exists
    const confirmed = window.confirm(
      'WARNING: This will permanently erase ALL recordings on the device.\n\n' +
      'This action cannot be undone. Are you sure you want to format the device storage?'
    )
    if (!confirmed) return

    setFormatting(true)
    try {
      const success = await deviceService.formatStorage()
      if (success) {
        toast({
          title: 'Storage formatted',
          description: 'All recordings have been erased from the device.',
          variant: 'success'
        })
        // Refresh recordings after format
        const store = useAppStore.getState()
        if (store.invalidateUnifiedRecordings) {
          store.invalidateUnifiedRecordings()
        }
      } else {
        toast({
          title: 'Format failed',
          description: 'Could not format device storage. Please try again.',
          variant: 'error'
        })
      }
    } catch (e) {
      toast({
        title: 'Format error',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'error'
      })
    } finally {
      setFormatting(false)
    }
  }

  const handleRetryFailed = async () => {
    try {
      const count = await window.electronAPI.downloadService.retryFailed()
      if (count > 0) {
        toast({
          title: 'Retrying downloads',
          description: `Re-queued ${count} failed download${count !== 1 ? 's' : ''}`,
          variant: 'default'
        })
        setSyncing(true)
      } else {
        toast({
          title: 'No failed downloads',
          description: 'All downloads completed successfully',
          variant: 'success'
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to retry downloads')
    }
  }

  // ==========================================
  // REALTIME STREAMING HANDLERS
  // ==========================================

  const handleStartRealtime = async () => {
    setError(null)
    try {
      const success = await deviceService.startRealtime()
      if (success) {
        setRealtimeActive(true)
        setRealtimePaused(false)
        setRealtimeDataOffset(0)
        realtimeDataOffsetRef.current = 0
        setRealtimeDataReceived(0)
        // Start polling for realtime data
        startRealtimePolling()
      } else {
        setError('Failed to start realtime streaming')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start realtime streaming')
    }
  }

  const handlePauseRealtime = async () => {
    setError(null)
    try {
      const success = await deviceService.pauseRealtime()
      if (success) {
        setRealtimePaused(true)
        stopRealtimePolling()
      } else {
        setError('Failed to pause realtime streaming')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to pause realtime streaming')
    }
  }

  const handleResumeRealtime = async () => {
    setError(null)
    try {
      const success = await deviceService.startRealtime()
      if (success) {
        setRealtimePaused(false)
        startRealtimePolling()
      } else {
        setError('Failed to resume realtime streaming')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resume realtime streaming')
    }
  }

  const handleStopRealtime = async () => {
    setError(null)
    try {
      await deviceService.stopRealtime()
      setRealtimeActive(false)
      setRealtimePaused(false)
      stopRealtimePolling()
      setRealtimeDataOffset(0)
      realtimeDataOffsetRef.current = 0
      setRealtimeDataReceived(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stop realtime streaming')
    }
  }

  const startRealtimePolling = () => {
    if (realtimeIntervalRef.current) {
      clearInterval(realtimeIntervalRef.current)
    }
    realtimeIntervalRef.current = window.setInterval(async () => {
      try {
        // DV-09: Read offset from ref to get current value, not stale closure
        const data = await deviceService.getRealtimeData(realtimeDataOffsetRef.current)
        if (data && data.data) {
          // Update both ref (for next poll) and state (for UI)
          realtimeDataOffsetRef.current += data.data.length
          setRealtimeDataReceived((prev) => prev + data.data.length)
          setRealtimeDataOffset(realtimeDataOffsetRef.current)
          console.log(`Received ${data.data.length} bytes of realtime audio, rest: ${data.rest}`)
        }
      } catch (e) {
        console.error('Error polling realtime data:', e)
      }
    }, 100) // Poll every 100ms
  }

  const stopRealtimePolling = () => {
    if (realtimeIntervalRef.current) {
      clearInterval(realtimeIntervalRef.current)
      realtimeIntervalRef.current = null
    }
  }

  // ==========================================
  // P1-SPECIFIC HANDLERS
  // ==========================================

  const loadBatteryStatus = async () => {
    try {
      const status = await deviceService.getBatteryStatus()
      setBatteryStatus(status)
    } catch (e) {
      console.error('Failed to load battery status:', e)
    }
  }

  const handleBluetoothScan = async () => {
    setError(null)
    setBluetoothScanning(true)
    try {
      const success = await deviceService.startBluetoothScan(30)
      if (!success) {
        setError('Failed to start Bluetooth scan')
      }
      // DV-10: Track timeout via ref so it can be cleaned up on unmount
      if (btScanTimeoutRef.current) clearTimeout(btScanTimeoutRef.current)
      btScanTimeoutRef.current = setTimeout(() => {
        setBluetoothScanning(false)
        btScanTimeoutRef.current = null
      }, 30000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bluetooth scan failed')
      setBluetoothScanning(false)
    }
  }

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="border-b px-6 py-4">
        <h1 className="text-2xl font-bold">Device Sync</h1>
        <p className="text-sm text-muted-foreground">Manage your HiDock device and sync recordings</p>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Error display */}
          {error && (
            <div className="flex items-center gap-2 p-4 bg-destructive/10 text-destructive rounded-lg">
              <AlertCircle className="h-5 w-5" />
              <p>{error}</p>
              <Button variant="ghost" size="sm" onClick={() => setError(null)} className="ml-auto">
                Dismiss
              </Button>
            </div>
          )}

          {/* Connection Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Usb className="h-5 w-5" />
                Device Connection
              </CardTitle>
              <CardDescription>
                {deviceState.connected
                  ? `${deviceState.model} connected (SN: ${deviceState.serialNumber})`
                  : 'No device connected'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!deviceState.connected ? (
                <div className="text-center py-8">
                  <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                    <Usb className={`h-10 w-10 text-muted-foreground ${connecting ? 'animate-pulse' : ''}`} />
                  </div>
                  {connecting ? (
                    <div className="space-y-3 max-w-sm mx-auto">
                      <p className="text-sm font-medium">{connectionStatus.message}</p>
                      {connectionStatus.progress !== undefined && (
                        <Progress value={connectionStatus.progress} className="h-2" />
                      )}
                      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                        <span>Elapsed: {(connectionElapsed / 1000).toFixed(1)}s</span>
                        <span className="text-muted-foreground/50">|</span>
                        <span>Timeout in {Math.max(0, (CONNECTION_TIMEOUT_MS - connectionElapsed) / 1000).toFixed(0)}s</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Make sure your HiDock is connected via USB...
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCancelConnection}
                        className="mt-2"
                      >
                        <X className="h-4 w-4 mr-2" />
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <>
                      <p className="text-muted-foreground mb-4">
                        Connect your HiDock device via USB to begin syncing recordings
                      </p>
                      <Button onClick={handleConnect} disabled={connecting}>
                        <Usb className="h-4 w-4 mr-2" />
                        Connect Device
                      </Button>
                      <div className="mt-6 pt-4 border-t space-y-3">
                        <div className="flex items-center justify-center gap-3">
                          <Label htmlFor="auto-connect" className="text-sm text-muted-foreground">
                            Auto-connect on startup
                          </Label>
                          <Switch
                            id="auto-connect"
                            checked={autoConnectConfig.enabled}
                            onCheckedChange={handleAutoConnectToggle}
                          />
                        </div>
                        {autoConnectConfig.enabled && (
                          <p className="text-xs text-muted-foreground mt-1 text-center">
                            Will automatically connect to previously authorized devices
                          </p>
                        )}
                        <div className="flex items-center justify-center gap-3">
                          <Label htmlFor="auto-download-disconnected" className="text-sm text-muted-foreground">
                            Auto-download recordings
                          </Label>
                          <Switch
                            id="auto-download-disconnected"
                            checked={autoDownload === true}
                            disabled={autoDownload === null}
                            onCheckedChange={handleAutoDownloadToggle}
                          />
                        </div>
                        <div className="flex items-center justify-center gap-3">
                          <Label htmlFor="auto-transcribe-disconnected" className="text-sm text-muted-foreground">
                            Auto-transcribe recordings
                          </Label>
                          <Switch
                            id="auto-transcribe-disconnected"
                            checked={autoTranscribe === true}
                            disabled={autoTranscribe === null}
                            onCheckedChange={handleAutoTranscribeToggle}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Connected device info */}
                  <div className="flex items-center justify-between p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                      <div>
                        <p className="font-medium capitalize">{deviceState.model.replace('-', ' ')}</p>
                        <p className="text-sm text-muted-foreground">
                          Firmware {deviceState.firmwareVersion}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={handleResetDevice} title="Reset USB connection if device is unresponsive">
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleDisconnect}>
                        Disconnect
                      </Button>
                    </div>
                  </div>

                  {/* Storage and Recording count */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 border rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <HardDrive className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Storage</span>
                      </div>
                      {deviceState.storage ? (
                        deviceState.storage.capacity > 0 ? (
                          <>
                            <p className="text-2xl font-bold">
                              {formatBytes(deviceState.storage.capacity - deviceState.storage.used)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              free of {formatBytes(deviceState.storage.capacity)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {formatBytes(deviceState.storage.used)} used
                            </p>
                            <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary"
                                style={{
                                  width: `${100 - deviceState.storage.freePercent}%`
                                }}
                              />
                            </div>
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Storage info unavailable
                          </p>
                        )
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <RefreshCw className="h-4 w-4 animate-spin" />
                            <span className="text-sm">Loading...</span>
                          </div>
                          <Button variant="ghost" size="sm" onClick={handleResetDevice} className="text-xs">
                            <RotateCcw className="h-3 w-3 mr-1" />
                            Reset if stuck
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="p-4 border rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <Mic className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Recordings</span>
                      </div>
                      <p className="text-2xl font-bold">{deviceState.recordingCount}</p>
                      <p className="text-xs text-muted-foreground">files on device</p>
                    </div>
                  </div>

                  {/* Settings */}
                  {/* TODO(DV-07): Additional device settings (LED brightness, notification sounds,
                      Bluetooth pairing mode) pending Jensen protocol integration. Currently only
                      auto-record is exposed from the device firmware settings. */}
                  <div className="p-4 border rounded-lg">
                    <p className="font-medium mb-3">Device Settings</p>
                    {deviceState.settings && (
                      <div className="flex items-center justify-between mb-3">
                        <Label htmlFor="auto-record">Auto-record meetings</Label>
                        <Switch
                          id="auto-record"
                          checked={deviceState.settings.autoRecord}
                          onCheckedChange={handleAutoRecordToggle}
                        />
                      </div>
                    )}
                    <div className="flex items-center justify-between mb-3">
                      <Label htmlFor="auto-connect-connected" className="text-sm">
                        Auto-connect on startup
                      </Label>
                      <Switch
                        id="auto-connect-connected"
                        checked={autoConnectConfig.enabled}
                        onCheckedChange={handleAutoConnectToggle}
                      />
                    </div>
                    <div className="flex items-center justify-between mb-3">
                      <Label htmlFor="auto-download" className="text-sm">
                        Auto-download recordings
                      </Label>
                      <Switch
                        id="auto-download"
                        checked={autoDownload === true}
                        disabled={autoDownload === null}
                        onCheckedChange={handleAutoDownloadToggle}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="auto-transcribe" className="text-sm">
                        Auto-transcribe recordings
                      </Label>
                      <Switch
                        id="auto-transcribe"
                        checked={autoTranscribe === true}
                        disabled={autoTranscribe === null}
                        onCheckedChange={handleAutoTranscribeToggle}
                      />
                    </div>

                    {/* DV-02: Format Storage button */}
                    <div className="mt-3 pt-3 border-t">
                      <Button
                        variant="destructive"
                        size="sm"
                        className="w-full"
                        onClick={handleFormatStorage}
                        disabled={formatting || storeSyncing}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        {formatting ? 'Formatting...' : 'Format Storage'}
                      </Button>
                      <p className="text-[10px] text-muted-foreground mt-1 text-center">
                        Erases all recordings from device
                      </p>
                    </div>
                  </div>

                  {/* Sync button */}
                  {(() => {
                    // Calculate unsynced count from device-accessible recordings
                    const deviceAccessibleRecordings = recordings.filter(rec => hasDeviceFile(rec))
                    const unsyncedCount = deviceAccessibleRecordings.length > 0
                      ? deviceAccessibleRecordings.filter(r => r.syncStatus === 'not-synced').length
                      : Math.max(0, deviceState.recordingCount - syncedFilenames.size)
                    const allSynced = unsyncedCount === 0 && (deviceAccessibleRecordings.length > 0 || deviceState.recordingCount > 0)
                    const isLoadingList = loadingRecordings && deviceAccessibleRecordings.length === 0

                    return (
                      <>
                        <Button
                          className="w-full"
                          onClick={storeSyncing ? cancelDeviceSync : handleSyncAll}
                          disabled={(!storeSyncing && (syncing || (deviceAccessibleRecordings.length === 0 && !isLoadingList && deviceState.recordingCount === 0) || allSynced || isLoadingList))}
                          variant={storeSyncing ? 'destructive' : (allSynced ? 'secondary' : 'default')}
                        >
                          {storeSyncing ? (
                            <>
                              <X className="h-4 w-4 mr-2" />
                              {deviceSyncProgress ? (
                                <span className="flex flex-col items-start text-left">
                                  <span>Cancel Sync ({deviceSyncProgress.current}/{deviceSyncProgress.total})</span>
                                  {deviceSyncEta && <span className="text-xs opacity-80">{formatEta(deviceSyncEta, true)}</span>}
                                </span>
                              ) : (
                                'Cancel Sync'
                              )}
                            </>
                          ) : syncing ? (
                            <>
                              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                              Starting sync...
                            </>
                          ) : isLoadingList ? (
                            <>
                              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                              Loading File List...
                            </>
                          ) : allSynced ? (
                            <>
                              <Check className="h-4 w-4 mr-2" />
                              All Recordings Synced
                            </>
                          ) : (
                            <>
                              <Download className="h-4 w-4 mr-2" />
                              Sync {unsyncedCount} Recording{unsyncedCount !== 1 ? 's' : ''}
                            </>
                          )}
                        </Button>
                        {/* Retry Failed button - shows when there are failed downloads */}
                        {failedDownloadCount > 0 && (
                          <Button
                            className="w-full mt-2"
                            onClick={handleRetryFailed}
                            variant="outline"
                            disabled={syncing}
                          >
                            <RotateCcw className="h-4 w-4 mr-2" />
                            Retry {failedDownloadCount} Failed Download{failedDownloadCount !== 1 ? 's' : ''}
                          </Button>
                        )}
                      </>
                    )
                  })()}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Device File List - Individual file operations */}
          {deviceState.connected && (
            <DeviceFileList
              recordings={recordings.filter(rec => hasDeviceFile(rec)) as Array<DeviceOnlyRecording | BothLocationsRecording>}
              syncedFilenames={syncedFilenames}
              onRefresh={refreshSyncedFilenames}
            />
          )}

          {/* Activity Log - Always visible, logs work offline too */}
          <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="h-5 w-5" />
                    Activity Log
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        // Format activity log for clipboard
                        const logText = activityLog.map(entry => {
                          const timestamp = entry.timestamp.toLocaleTimeString('en-US', {
                            hour12: false,
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            fractionalSecondDigits: 3
                          })
                          const typeLabel = entry.type === 'usb-out' ? '[OUT]'
                            : entry.type === 'usb-in' ? '[IN]'
                            : entry.type === 'error' ? '[ERR]'
                            : entry.type === 'success' ? '[OK]'
                            : '[INFO]'
                          const details = entry.details ? ` - ${entry.details}` : ''
                          return `${timestamp}\n${typeLabel}\n${entry.message}${details}`
                        }).join('\n')
                        navigator.clipboard.writeText(logText)
                      }}
                      disabled={activityLog.length === 0}
                      title="Copy log to clipboard"
                    >
                      <Copy className="h-4 w-4 mr-1" />
                      Copy
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        // DV-01: Clear both the device service internal log AND the Zustand store
                        deviceService.clearActivityLog()
                        useAppStore.getState().clearActivityLog()
                      }}
                      disabled={activityLog.length === 0}
                    >
                      Clear
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setLogExpanded(!logExpanded)}
                    >
                      {logExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </CardTitle>
                <CardDescription>
                  Real-time USB communication and device operations
                </CardDescription>
              </CardHeader>
              {logExpanded && (
                <CardContent>
                  <div
                    ref={logContainerRef}
                    className="bg-muted/50 rounded-lg p-2 font-mono text-xs max-h-64 overflow-y-auto"
                  >
                    {activityLog.length === 0 ? (
                      <p className="text-muted-foreground text-center py-4">
                        No activity yet. Device operations will appear here.
                      </p>
                    ) : (
                      activityLog.map((entry, index) => (
                        <div
                          key={index}
                          className={`flex items-start gap-2 py-1 border-b border-muted last:border-0 ${
                            entry.type === 'error'
                              ? 'text-red-500'
                              : entry.type === 'success'
                                ? 'text-green-500'
                                : entry.type === 'usb-out'
                                  ? 'text-blue-500'
                                  : entry.type === 'usb-in'
                                    ? 'text-purple-500'
                                    : 'text-muted-foreground'
                          }`}
                        >
                          <span className="text-muted-foreground/60 shrink-0">
                            {entry.timestamp.toLocaleTimeString('en-US', {
                              hour12: false,
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                              fractionalSecondDigits: 3
                            })}
                          </span>
                          <span className="shrink-0 w-12">
                            {entry.type === 'usb-out'
                              ? '[OUT]'
                              : entry.type === 'usb-in'
                                ? '[IN]'
                                : entry.type === 'error'
                                  ? '[ERR]'
                                  : entry.type === 'success'
                                    ? '[OK]'
                                    : '[INFO]'}
                          </span>
                          <span className="flex-1">
                            {entry.message}
                            {entry.details && (
                              <span className="text-muted-foreground/80">
                                {' '}
                                - {entry.details}
                              </span>
                            )}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              )}
            </Card>

          {/* Realtime Streaming - Available on ALL devices */}
          {deviceState.connected && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Radio className="h-5 w-5" />
                  Realtime Audio Streaming
                </CardTitle>
                <CardDescription>
                  Stream live audio from your HiDock device
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Status indicator */}
                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-3 h-3 rounded-full ${
                          realtimeActive
                            ? realtimePaused
                              ? 'bg-yellow-500'
                              : 'bg-red-500 animate-pulse'
                            : 'bg-gray-400'
                        }`}
                      />
                      <div>
                        <p className="font-medium">
                          {realtimeActive
                            ? realtimePaused
                              ? 'Paused'
                              : 'Streaming'
                            : 'Idle'}
                        </p>
                        {realtimeActive && (
                          <p className="text-xs text-muted-foreground">
                            Received: {formatBytes(realtimeDataReceived)}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!realtimeActive ? (
                        <Button onClick={handleStartRealtime} size="sm">
                          <Play className="h-4 w-4 mr-2" />
                          Start
                        </Button>
                      ) : (
                        <>
                          {realtimePaused ? (
                            <Button onClick={handleResumeRealtime} size="sm" variant="outline">
                              <Play className="h-4 w-4 mr-2" />
                              Resume
                            </Button>
                          ) : (
                            <Button onClick={handlePauseRealtime} size="sm" variant="outline">
                              <Pause className="h-4 w-4 mr-2" />
                              Pause
                            </Button>
                          )}
                          <Button onClick={handleStopRealtime} size="sm" variant="destructive">
                            <Square className="h-4 w-4 mr-2" />
                            Stop
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Realtime streaming captures audio directly from the device microphone.
                    Audio data is received via USB at 16kHz 16-bit mono.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* P1-specific features: Battery and Bluetooth */}
          {deviceState.connected && deviceService.isP1Device() && (
            <>
              {/* Battery Status */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Battery className="h-5 w-5" />
                    Battery Status
                  </CardTitle>
                  <CardDescription>
                    P1 device battery information
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-12 h-6 rounded border-2 relative ${
                          batteryStatus
                            ? batteryStatus.batteryLevel > 20
                              ? 'border-green-500'
                              : 'border-red-500'
                            : 'border-gray-400'
                        }`}
                      >
                        <div
                          className={`absolute inset-0.5 rounded-sm ${
                            batteryStatus
                              ? batteryStatus.batteryLevel > 20
                                ? 'bg-green-500'
                                : 'bg-red-500'
                              : 'bg-gray-400'
                          }`}
                          style={{
                            width: `${batteryStatus?.batteryLevel ?? 0}%`
                          }}
                        />
                        <div className="absolute -right-1 top-1/2 -translate-y-1/2 w-1 h-3 bg-current rounded-r" />
                      </div>
                      <div>
                        <p className="font-medium">
                          {batteryStatus ? `${batteryStatus.batteryLevel}%` : 'Loading...'}
                        </p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {batteryStatus?.status ?? 'Unknown'}
                        </p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={loadBatteryStatus}>
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Bluetooth */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bluetooth className="h-5 w-5" />
                    Bluetooth
                  </CardTitle>
                  <CardDescription>
                    Manage Bluetooth connections
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <Bluetooth
                          className={`h-5 w-5 ${
                            bluetoothScanning ? 'text-blue-500 animate-pulse' : 'text-muted-foreground'
                          }`}
                        />
                        <div>
                          <p className="font-medium">
                            {bluetoothScanning ? 'Scanning...' : 'Bluetooth Ready'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {bluetoothScanning
                              ? 'Looking for nearby devices'
                              : 'Tap Scan to find devices'}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleBluetoothScan}
                        disabled={bluetoothScanning}
                      >
                        {bluetoothScanning ? (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                            Scanning
                          </>
                        ) : (
                          'Scan'
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      P1 devices can connect to Bluetooth audio devices for wireless playback.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {/* Instructions - Only show when disconnected */}
          {!deviceState.connected && (
            <Card>
              <CardHeader>
                <CardTitle>How Device Sync Works</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <h3 className="font-medium">1. Connect your device</h3>
                  <p className="text-sm text-muted-foreground">
                    Plug in your HiDock via USB and click "Connect Device" to establish a connection
                  </p>
                </div>
                <div className="space-y-2">
                  <h3 className="font-medium">2. Sync automatically</h3>
                  <p className="text-sm text-muted-foreground">
                    Enable auto-download to automatically sync new recordings when your device connects
                  </p>
                </div>
                <div className="space-y-2">
                  <h3 className="font-medium">3. Auto-transcribe</h3>
                  <p className="text-sm text-muted-foreground">
                    Recordings are automatically transcribed and linked to your calendar meetings
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

export default Device
