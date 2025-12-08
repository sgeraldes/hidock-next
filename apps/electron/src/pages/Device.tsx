import { useState, useEffect, useCallback, useRef } from 'react'
import { Usb, Download, RefreshCw, HardDrive, Mic, Trash2, AlertCircle, Radio, Battery, Bluetooth, Play, Pause, Square, X, Terminal, ChevronDown, ChevronUp, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  getHiDockDeviceService,
  HiDockDeviceState,
  HiDockRecording,
  DownloadProgress,
  ConnectionStatus,
  BatteryStatus,
  ActivityLogEntry
} from '@/services/hidock-device'
import { formatDuration } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'

const CONNECTION_TIMEOUT_MS = 15000 // 15 second timeout
const MAX_LOG_ENTRIES = 100 // Maximum activity log entries to keep

export function Device() {
  // Initialize state directly from service to avoid flash of wrong state
  const deviceService = getHiDockDeviceService()
  const [deviceState, setDeviceState] = useState<HiDockDeviceState>(() => deviceService.getState())
  const [connecting, setConnecting] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    step: 'idle',
    message: 'Not connected'
  })
  const [recordings, setRecordings] = useState<HiDockRecording[]>([])
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Connection timing state
  const [connectionStartTime, setConnectionStartTime] = useState<number | null>(null)
  const [connectionElapsed, setConnectionElapsed] = useState(0)
  const connectionTimeoutRef = useRef<number | null>(null)
  const connectionTimerRef = useRef<number | null>(null)

  // Realtime streaming state
  const [realtimeActive, setRealtimeActive] = useState(false)
  const [realtimePaused, setRealtimePaused] = useState(false)
  const [realtimeDataOffset, setRealtimeDataOffset] = useState(0)
  const [realtimeDataReceived, setRealtimeDataReceived] = useState(0)
  const realtimeIntervalRef = useRef<number | null>(null)

  // P1-specific state
  const [batteryStatus, setBatteryStatus] = useState<BatteryStatus | null>(null)
  const [bluetoothScanning, setBluetoothScanning] = useState(false)

  // File list loading state
  const [loadingRecordings, setLoadingRecordings] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState<{ filesLoaded: number; expectedFiles: number } | null>(null)

  // Synced files tracking
  const [syncedFilenames, setSyncedFilenames] = useState<Set<string>>(new Set())

  // Auto-connect configuration state
  const [autoConnectConfig, setAutoConnectConfig] = useState(() => deviceService.getAutoConnectConfig())

  // Activity log state - initialize from service for persistence across page navigation
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>(() => deviceService.getActivityLog())
  const [logExpanded, setLogExpanded] = useState(true)
  const logContainerRef = useRef<HTMLDivElement>(null)

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
    setConnectionStartTime(null)
    setConnectionElapsed(0)
  }, [])

  // Cancel connection attempt
  const handleCancelConnection = useCallback(() => {
    clearConnectionTimers()
    setConnecting(false)
    setError('Connection cancelled')
    deviceService.stopAutoConnect()
  }, [clearConnectionTimers, deviceService])

  // Set up listeners
  useEffect(() => {
    // Sync connection status from service (deviceState is already initialized via useState)
    setConnectionStatus(deviceService.getConnectionStatus())

    // Load synced filenames from database
    const loadSyncedFilenames = async () => {
      try {
        const filenames = await window.electronAPI.syncedFiles.getFilenames()
        setSyncedFilenames(new Set(filenames))
        console.log(`[Device.tsx] Loaded ${filenames.length} synced filenames`)
      } catch (e) {
        console.error('[Device.tsx] Failed to load synced filenames:', e)
      }
    }
    loadSyncedFilenames()

    // Load additional data if already connected
    const loadInitialData = async () => {
      console.log('[Device.tsx] loadInitialData called, isConnected:', deviceService.isConnected())
      if (deviceService.isConnected()) {
        console.log('[Device.tsx] Device already connected, loading recordings...')
        try {
          const recs = await deviceService.listRecordings()
          console.log(`[Device.tsx] loadInitialData got ${recs.length} recordings`)
          setRecordings(recs)
          if (deviceService.isP1Device()) {
            console.log('[Device.tsx] P1 device detected, loading battery status...')
            const status = await deviceService.getBatteryStatus()
            setBatteryStatus(status)
          }
        } catch (e) {
          console.error('[Device.tsx] Failed to load initial data:', e)
        }
      } else {
        console.log('[Device.tsx] Device not connected, skipping initial data load')
      }
    }
    loadInitialData()

    // Subscribe to state changes for real-time UI updates
    const unsubscribeState = deviceService.onStateChange((state) => {
      setDeviceState(state)
    })

    // Subscribe to connection changes
    const unsubscribe = deviceService.onConnectionChange((connected) => {
      console.log('[Device.tsx] Connection change:', connected)
      setConnecting(false)
      clearConnectionTimers() // Clear timers on connection change
      if (connected) {
        console.log('[Device.tsx] Device connected, loading recordings...')
        setError(null) // Clear any previous errors
        loadRecordings()
        // Load P1-specific data
        if (deviceService.isP1Device()) {
          console.log('[Device.tsx] P1 device, loading battery status...')
          loadBatteryStatus()
        }
      } else {
        console.log('[Device.tsx] Device disconnected, clearing state...')
        setRecordings([])
        setBatteryStatus(null)
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
      setDownloadProgress(progress)
    })

    const unsubscribeStatus = deviceService.onStatusChange((status) => {
      setConnectionStatus(status)
      // Update connecting state based on status step
      const isConnecting = !['idle', 'ready', 'error'].includes(status.step)
      setConnecting(isConnecting)

      // Show errors from connection status
      if (status.step === 'error') {
        setError(status.message)
        clearConnectionTimers()
      }
    })

    // Subscribe to activity log
    const unsubscribeActivity = deviceService.onActivity((entry) => {
      setActivityLog((prev) => {
        const newLog = [...prev, entry]
        // Keep only the last MAX_LOG_ENTRIES
        if (newLog.length > MAX_LOG_ENTRIES) {
          return newLog.slice(-MAX_LOG_ENTRIES)
        }
        return newLog
      })
      // Auto-scroll to bottom
      if (logContainerRef.current) {
        setTimeout(() => {
          if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
          }
        }, 10)
      }
    })

    // NOTE: We do NOT start auto-connect here. Auto-connect is managed at the app level.
    // Starting it here would reset user's disconnect decision when navigating pages.

    return () => {
      unsubscribeState()
      unsubscribe()
      unsubscribeProgress()
      unsubscribeStatus()
      unsubscribeActivity()
      clearConnectionTimers()
      // Clean up realtime interval
      if (realtimeIntervalRef.current) {
        clearInterval(realtimeIntervalRef.current)
      }
    }
  }, [clearConnectionTimers])

  const loadRecordings = useCallback(async (forceRefresh: boolean = false) => {
    console.log('[Device.tsx] loadRecordings called, forceRefresh:', forceRefresh)
    setLoadingRecordings(true)
    setLoadingProgress(null)
    try {
      console.log('[Device.tsx] Calling deviceService.listRecordings...')
      const recs = await deviceService.listRecordings((filesLoaded, expectedFiles) => {
        console.log(`[Device.tsx] Loading progress: ${filesLoaded}/${expectedFiles} files`)
        setLoadingProgress({ filesLoaded, expectedFiles })
      }, forceRefresh)
      console.log(`[Device.tsx] Received ${recs.length} recordings:`, recs)
      setRecordings(recs)
    } catch (e) {
      console.error('[Device.tsx] Failed to load recordings:', e)
    } finally {
      setLoadingRecordings(false)
      setLoadingProgress(null)
    }
  }, [deviceService])

  const handleConnect = async () => {
    setConnecting(true)
    setError(null)

    // Start timing
    const startTime = Date.now()
    setConnectionStartTime(startTime)
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
      // Filter out already synced files
      const toSync = recordings.filter((rec) => !syncedFilenames.has(rec.filename))
      console.log(`[Device.tsx] Syncing ${toSync.length} files (${recordings.length - toSync.length} already synced)`)

      if (toSync.length === 0) {
        console.log('[Device.tsx] All files already synced')
        return
      }

      for (const recording of toSync) {
        // Check connection before each download in case device was disconnected
        if (!deviceService.isConnected()) {
          setError('Device disconnected during sync.')
          break
        }
        setDownloading(recording.id)
        await deviceService.downloadRecordingToFile(
          recording.filename,
          recording.size,
          '' // Will be determined by storage service
        )
        // Update synced filenames after successful download
        setSyncedFilenames((prev) => new Set([...prev, recording.filename]))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncing(false)
      setDownloading(null)
      setDownloadProgress(null)
    }
  }

  const handleDownloadRecording = async (recording: HiDockRecording) => {
    // Validate connection
    if (!deviceService.isConnected()) {
      setError('Device not connected. Please connect your HiDock first.')
      return
    }

    setDownloading(recording.id)
    setError(null)

    try {
      await deviceService.downloadRecordingToFile(recording.filename, recording.size, '')
      // Update synced filenames after successful download
      setSyncedFilenames((prev) => new Set([...prev, recording.filename]))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setDownloading(null)
      setDownloadProgress(null)
    }
  }

  const handleDeleteRecording = async (recording: HiDockRecording) => {
    // Validate connection
    if (!deviceService.isConnected()) {
      setError('Device not connected. Please connect your HiDock first.')
      return
    }

    const confirmed = window.confirm(`Delete "${recording.filename}"?`)
    if (!confirmed) return

    try {
      await deviceService.deleteRecording(recording.filename)
      await loadRecordings()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const handleAutoRecordToggle = async (enabled: boolean) => {
    try {
      await deviceService.setAutoRecord(enabled)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update setting')
    }
  }

  const handleAutoConnectToggle = (enabled: boolean) => {
    deviceService.setAutoConnectConfig({ enabled })
    setAutoConnectConfig(deviceService.getAutoConnectConfig())
    // If enabling and not connected, start auto-connect
    if (enabled && !deviceState.connected) {
      deviceService.startAutoConnect()
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
        const data = await deviceService.getRealtimeData(realtimeDataOffset)
        if (data && data.data) {
          setRealtimeDataReceived((prev) => prev + data.data.length)
          setRealtimeDataOffset((prev) => prev + data.data.length)
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
      // Scan runs for 30 seconds on device
      setTimeout(() => {
        setBluetoothScanning(false)
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
        <h1 className="text-2xl font-bold">HiDock Device</h1>
        <p className="text-sm text-muted-foreground">Connect and sync recordings from your HiDock</p>
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
                        Connect your HiDock device via USB to sync recordings
                      </p>
                      <Button onClick={handleConnect} disabled={connecting}>
                        <Usb className="h-4 w-4 mr-2" />
                        Connect Device
                      </Button>
                      <div className="mt-6 pt-4 border-t">
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
                          <p className="text-xs text-muted-foreground mt-2 text-center">
                            Will automatically connect to previously authorized devices
                          </p>
                        )}
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
                    <Button variant="outline" size="sm" onClick={handleDisconnect}>
                      Disconnect
                    </Button>
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
                              {formatBytes(deviceState.storage.used)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              of {formatBytes(deviceState.storage.capacity)} used
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
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          <span className="text-sm">Loading...</span>
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
                  {deviceState.settings && (
                    <div className="p-4 border rounded-lg">
                      <p className="font-medium mb-3">Device Settings</p>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="auto-record">Auto-record meetings</Label>
                        <Switch
                          id="auto-record"
                          checked={deviceState.settings.autoRecord}
                          onCheckedChange={handleAutoRecordToggle}
                        />
                      </div>
                    </div>
                  )}

                  {/* Sync button */}
                  {(() => {
                    const unsyncedCount = recordings.filter((r) => !syncedFilenames.has(r.filename)).length
                    const allSynced = unsyncedCount === 0 && recordings.length > 0
                    return (
                      <Button
                        className="w-full"
                        onClick={handleSyncAll}
                        disabled={syncing || recordings.length === 0 || allSynced}
                        variant={allSynced ? 'secondary' : 'default'}
                      >
                        {syncing ? (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                            Syncing... {downloadProgress && `(${downloadProgress.percent.toFixed(0)}%)`}
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
                    )
                  })()}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recordings list - always show when connected */}
          {deviceState.connected && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>
                    Recordings on Device
                    {loadingRecordings && loadingProgress && (
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        ({loadingProgress.filesLoaded}/{loadingProgress.expectedFiles} files)
                      </span>
                    )}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => loadRecordings(true)} disabled={loadingRecordings} title="Refresh from device">
                    <RefreshCw className={`h-4 w-4 ${loadingRecordings ? 'animate-spin' : ''}`} />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {/* Show loading state during initialization or while loading recordings */}
                  {(loadingRecordings || (recordings.length === 0 && connectionStatus.step !== 'ready')) && recordings.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
                      <p>{loadingRecordings ? 'Loading file list from device...' : 'Initializing device...'}</p>
                      {loadingProgress && (
                        <div className="mt-3 max-w-md mx-auto space-y-2">
                          <Progress
                            value={loadingProgress.expectedFiles > 0
                              ? (loadingProgress.filesLoaded / loadingProgress.expectedFiles) * 100
                              : 0
                            }
                            className="h-2"
                          />
                          <p className="text-sm">
                            {loadingProgress.filesLoaded} / {loadingProgress.expectedFiles} files
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Show empty state when ready but no recordings */}
                  {!loadingRecordings && recordings.length === 0 && connectionStatus.step === 'ready' && deviceState.recordingCount === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      <Mic className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No recordings on device</p>
                    </div>
                  )}
                  {recordings.map((rec) => {
                    const isSynced = syncedFilenames.has(rec.filename)
                    return (
                      <div
                        key={rec.id}
                        className={`flex items-center justify-between p-3 border rounded-lg ${isSynced ? 'bg-green-50 dark:bg-green-950/30' : ''}`}
                      >
                        <div className="flex items-center gap-3">
                          <Mic className={`h-4 w-4 ${isSynced ? 'text-green-600' : 'text-muted-foreground'}`} />
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-sm">{rec.filename}</p>
                              {isSynced && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded">
                                  <Check className="h-3 w-3" />
                                  Synced
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {formatBytes(rec.size)} • {formatDuration(rec.duration)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {downloading === rec.id && downloadProgress ? (
                            <div className="text-xs text-muted-foreground">
                              {downloadProgress.percent.toFixed(0)}%
                            </div>
                          ) : (
                            <>
                              {isSynced ? (
                                <div className="h-9 w-9 flex items-center justify-center" title="Already synced">
                                  <Check className="h-4 w-4 text-green-600" />
                                </div>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDownloadRecording(rec)}
                                  disabled={!!downloading}
                                  title="Download to local storage"
                                >
                                  <Download className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteRecording(rec)}
                                disabled={!!downloading}
                                title="Delete from device"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}

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

          {/* Activity Log */}
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
                      deviceService.clearActivityLog()
                      setActivityLog([])
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
                      No activity yet. Connect a device to see USB communication.
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

          {/* Instructions */}
          <Card>
            <CardHeader>
              <CardTitle>Getting Started</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <h3 className="font-medium">1. Connect your HiDock</h3>
                <p className="text-sm text-muted-foreground">
                  Plug in your HiDock device via USB cable and click "Connect Device"
                </p>
              </div>
              <div className="space-y-2">
                <h3 className="font-medium">2. Sync recordings</h3>
                <p className="text-sm text-muted-foreground">
                  Download recordings to your computer for transcription and storage
                </p>
              </div>
              <div className="space-y-2">
                <h3 className="font-medium">3. Auto-transcribe</h3>
                <p className="text-sm text-muted-foreground">
                  Recordings are automatically transcribed and linked to calendar meetings
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
