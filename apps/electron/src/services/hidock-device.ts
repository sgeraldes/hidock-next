/**
 * HiDock Device Service
 * High-level service for interacting with HiDock devices
 */

import {
  JensenDevice,
  getJensenDevice,
  DeviceModel,
  DeviceInfo,
  FileInfo,
  CardInfo,
  DeviceSettings,
  RealtimeSettings,
  RealtimeData,
  BatteryStatus,
  BluetoothStatus
} from './jensen'

export interface HiDockRecording {
  id: string
  filename: string
  size: number
  duration: number
  dateCreated: Date
  version: number
  signature: string
}

export interface HiDockDeviceState {
  connected: boolean
  model: DeviceModel
  serialNumber: string | null
  firmwareVersion: string | null
  storage: {
    used: number
    capacity: number
    freePercent: number
  } | null
  settings: DeviceSettings | null
  recordingCount: number
}

export interface DownloadProgress {
  filename: string
  bytesReceived: number
  totalBytes: number
  percent: number
}

export type ConnectionStep =
  | 'idle'
  | 'requesting'
  | 'opening'
  | 'getting-info'
  | 'getting-storage'
  | 'getting-settings'
  | 'syncing-time'
  | 'counting-files'
  | 'ready'
  | 'error'

export interface ConnectionStatus {
  step: ConnectionStep
  message: string
  progress?: number // 0-100
}

type ConnectionListener = (connected: boolean) => void
type ProgressListener = (progress: DownloadProgress) => void
type StatusListener = (status: ConnectionStatus) => void
type StateChangeListener = (state: HiDockDeviceState) => void

// Activity log entry for debugging USB communication
export interface ActivityLogEntry {
  timestamp: Date
  type: 'info' | 'success' | 'error' | 'usb-out' | 'usb-in'
  message: string
  details?: string
}

const MAX_LOG_ENTRIES = 100 // Maximum activity log entries to keep in memory

type ActivityListener = (entry: ActivityLogEntry) => void

class HiDockDeviceService {
  private jensen: JensenDevice
  private state: HiDockDeviceState = {
    connected: false,
    model: 'unknown',
    serialNumber: null,
    firmwareVersion: null,
    storage: null,
    settings: null,
    recordingCount: 0
  }

  private connectionListeners: Set<ConnectionListener> = new Set()
  private progressListeners: Set<ProgressListener> = new Set()
  private statusListeners: Set<StatusListener> = new Set()
  private activityListeners: Set<ActivityListener> = new Set()
  private stateChangeListeners: Set<StateChangeListener> = new Set()
  private autoConnectInterval: number | null = null
  private connectionStatus: ConnectionStatus = { step: 'idle', message: 'Not connected' }
  private autoConnectEnabled: boolean = true // Can be disabled by user action
  private userInitiatedDisconnect: boolean = false // Track if user clicked disconnect

  // Persisted activity log - survives page navigation
  private activityLog: ActivityLogEntry[] = []

  // Recording list cache - avoid re-fetching from device if count unchanged
  private cachedRecordings: HiDockRecording[] | null = null
  private cachedRecordingCount: number = -1

  // Auto-connect configuration (loaded from main process config)
  // IMPORTANT: Default to false until config is loaded to prevent unwanted auto-connect
  private autoConnectConfig = {
    enabled: false, // Master switch for auto-connect - default false until config loaded
    intervalMs: 5000, // How often to check for device
    connectOnStartup: false // Whether to auto-connect when app starts - default false until config loaded
  }

  // Track if config has been loaded from main process
  private configLoaded: boolean = false
  private configLoadPromise: Promise<void> | null = null

  constructor() {
    this.jensen = getJensenDevice()

    // Set up connection callbacks
    this.jensen.onconnect = () => {
      this.handleConnect()
    }

    this.jensen.ondisconnect = () => {
      this.handleDisconnect()
    }

    // Load saved auto-connect config from main process (async)
    // Store the promise so initAutoConnect can await it
    this.configLoadPromise = this.loadAutoConnectConfig()

    // Log initial state (will show cached value until config loads)
    this.logActivity('info', 'Device service initialized', 'Loading config from main process...')
  }

  // Load auto-connect config from main process config file
  private async loadAutoConnectConfig(): Promise<void> {
    try {
      console.log('[HiDockDevice] Loading config from main process...')

      // Wait a small amount for electronAPI to be available (may not be ready immediately)
      let attempts = 0
      const maxAttempts = 10
      while (!window.electronAPI?.config?.get && attempts < maxAttempts) {
        console.log(`[HiDockDevice] Waiting for electronAPI... attempt ${attempts + 1}/${maxAttempts}`)
        await new Promise((resolve) => setTimeout(resolve, 100))
        attempts++
      }

      // Use Electron IPC to get config from main process
      if (window.electronAPI?.config?.get) {
        console.log('[HiDockDevice] electronAPI available, fetching config...')
        const config = await window.electronAPI.config.get()
        console.log('[HiDockDevice] Config received:', JSON.stringify(config?.device))

        if (config?.device) {
          // Use explicit boolean check - undefined/null defaults to false (safe default)
          this.autoConnectConfig.enabled = config.device.autoConnect === true
          this.autoConnectConfig.connectOnStartup = config.device.autoConnect === true
          this.configLoaded = true
          console.log(`[HiDockDevice] Config loaded: autoConnect = ${this.autoConnectConfig.enabled}`)
          this.logActivity('info', 'Config loaded', `Auto-connect: ${this.autoConnectConfig.enabled ? 'enabled' : 'disabled'}`)
        } else {
          console.warn('[HiDockDevice] Config loaded but device section missing, defaulting to disabled')
          this.configLoaded = true // Mark as loaded even without device section
        }
      } else {
        console.warn('[HiDockDevice] electronAPI.config not available after waiting, auto-connect will be disabled')
        this.configLoaded = true // Mark as loaded to prevent infinite waiting
      }
    } catch (error) {
      console.error('[HiDockDevice] Failed to load auto-connect config:', error)
      this.configLoaded = true // Mark as loaded to prevent infinite waiting
    }
  }

  // Save auto-connect config to main process config file
  private async saveAutoConnectConfig(): Promise<void> {
    try {
      // Use Electron IPC to save config to main process
      if (window.electronAPI?.config?.updateSection) {
        await window.electronAPI.config.updateSection('device', {
          autoConnect: this.autoConnectConfig.enabled
        })
        this.logActivity('info', 'Config saved', `Auto-connect: ${this.autoConnectConfig.enabled ? 'enabled' : 'disabled'}`)
      } else {
        console.warn('electronAPI.config.updateSection not available')
      }
    } catch (error) {
      console.error('Failed to save auto-connect config:', error)
    }
  }

  // Get auto-connect configuration
  getAutoConnectConfig(): { enabled: boolean; intervalMs: number; connectOnStartup: boolean } {
    return { ...this.autoConnectConfig }
  }

  // Update auto-connect configuration
  setAutoConnectConfig(config: Partial<{ enabled: boolean; intervalMs: number; connectOnStartup: boolean }>): void {
    const wasEnabled = this.autoConnectConfig.enabled
    this.autoConnectConfig = { ...this.autoConnectConfig, ...config }

    // Save to main process config file (async but we don't wait)
    this.saveAutoConnectConfig()

    this.logActivity('info', 'Auto-connect config updated', JSON.stringify(this.autoConnectConfig))

    // If disabling auto-connect, stop the interval
    if (wasEnabled && !this.autoConnectConfig.enabled) {
      this.stopAutoConnect()
    }
  }

  // Start auto-connect polling (silent - no UI updates)
  // NOTE: This does NOT reset userInitiatedDisconnect - that's only reset by explicit user connect action
  startAutoConnect(intervalMs?: number): void {
    // Check if auto-connect is globally enabled
    if (!this.autoConnectConfig.enabled) {
      this.logActivity('info', 'Auto-connect disabled in config')
      return
    }

    // Don't start if user explicitly disconnected
    if (this.userInitiatedDisconnect) {
      this.logActivity('info', 'Auto-connect skipped - user disconnected')
      return
    }

    // Don't start multiple intervals
    if (this.autoConnectInterval) return

    const interval = intervalMs ?? this.autoConnectConfig.intervalMs
    this.autoConnectEnabled = true
    this.logActivity('info', `Auto-connect started (interval: ${interval}ms)`)

    // Try immediately (silent) only if not user-disconnected
    if (!this.userInitiatedDisconnect) {
      this.tryConnectSilent()
    }

    // Then poll
    this.autoConnectInterval = window.setInterval(() => {
      // Don't auto-connect if user explicitly disconnected or disabled
      if (!this.state.connected && this.autoConnectEnabled && !this.userInitiatedDisconnect && this.autoConnectConfig.enabled) {
        this.tryConnectSilent()
      }
    }, interval)
  }

  // Initialize auto-connect on app startup
  async initAutoConnect(): Promise<void> {
    // Prevent duplicate initialization
    if (this.autoConnectInterval) {
      console.log('[HiDockDevice] initAutoConnect: Already initialized, skipping')
      return
    }

    console.log('[HiDockDevice] initAutoConnect: Waiting for config to load...')

    // Wait for the config load promise to complete
    if (this.configLoadPromise) {
      try {
        await this.configLoadPromise
      } catch (error) {
        console.error('[HiDockDevice] initAutoConnect: Config load promise failed:', error)
      }
    }

    // Double-check with polling if needed (in case promise completed before we awaited it)
    if (!this.configLoaded) {
      console.log('[HiDockDevice] initAutoConnect: Config not yet loaded, waiting...')
      // Wait up to 2 seconds for config to load
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (this.configLoaded) break
      }
    }

    console.log(`[HiDockDevice] initAutoConnect: Config loaded=${this.configLoaded}, enabled=${this.autoConnectConfig.enabled}, connectOnStartup=${this.autoConnectConfig.connectOnStartup}`)
    this.logActivity('info', 'Init auto-connect check', `enabled: ${this.autoConnectConfig.enabled}, connectOnStartup: ${this.autoConnectConfig.connectOnStartup}`)

    if (this.autoConnectConfig.enabled && this.autoConnectConfig.connectOnStartup) {
      console.log('[HiDockDevice] initAutoConnect: Starting auto-connect')
      this.startAutoConnect()
    } else {
      console.log('[HiDockDevice] initAutoConnect: Auto-connect disabled, not starting')
    }
  }

  stopAutoConnect(): void {
    if (this.autoConnectInterval) {
      clearInterval(this.autoConnectInterval)
      this.autoConnectInterval = null
      this.logActivity('info', 'Auto-connect stopped')
    }
  }

  // Disable auto-connect (e.g., when user explicitly disconnects)
  disableAutoConnect(): void {
    this.autoConnectEnabled = false
    this.userInitiatedDisconnect = true
    this.stopAutoConnect()
    this.logActivity('info', 'Auto-connect disabled by user')
  }

  // Re-enable auto-connect (e.g., when user clicks connect)
  enableAutoConnect(): void {
    this.autoConnectEnabled = true
    this.userInitiatedDisconnect = false
    this.logActivity('info', 'Auto-connect re-enabled')
  }

  isAutoConnectEnabled(): boolean {
    return this.autoConnectEnabled && !this.userInitiatedDisconnect
  }

  // Silent auto-connect - no UI updates unless successful
  private async tryConnectSilent(): Promise<boolean> {
    if (this.state.connected) return true

    const success = await this.jensen.tryConnect()
    // Note: handleConnect() is called via the onconnect callback in jensen.ts
    // We should NOT call it here to avoid duplicate initialization
    if (success) {
      this.updateStatus('opening', 'Device found, connecting...', 10)
    }
    return success
  }

  // Try to connect to a previously authorized device (with UI feedback)
  async tryConnect(): Promise<boolean> {
    if (this.state.connected) return true

    this.updateStatus('requesting', 'Looking for device...', 5)
    const success = await this.jensen.tryConnect()
    // Note: handleConnect() is called via the onconnect callback in jensen.ts
    // We should NOT call it here to avoid duplicate initialization
    if (!success) {
      this.updateStatus('idle', 'No device found')
    }
    return success
  }

  // Request user to select and connect to a device
  async connect(): Promise<boolean> {
    // Re-enable auto-connect when user explicitly connects
    this.enableAutoConnect()

    this.logActivity('info', 'User initiated connection')
    this.updateStatus('requesting', 'Requesting device access...', 5)
    const success = await this.jensen.connect()
    // Note: handleConnect() is called via the onconnect callback in jensen.ts
    // We should NOT call it here to avoid duplicate initialization
    if (!success) {
      this.updateStatus('idle', 'Connection cancelled or failed')
      this.logActivity('info', 'Connection cancelled or no device selected')
    }
    return success
  }

  // Disconnect from device - this disables auto-connect until user clicks connect again
  async disconnect(): Promise<void> {
    this.logActivity('info', 'User initiated disconnect')
    // Disable auto-connect so we don't immediately reconnect
    this.disableAutoConnect()
    await this.jensen.disconnect()
  }

  isConnected(): boolean {
    return this.state.connected && this.jensen.isConnected()
  }

  getState(): HiDockDeviceState {
    return { ...this.state }
  }

  // Add listeners
  onConnectionChange(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener)
    return () => this.connectionListeners.delete(listener)
  }

  onDownloadProgress(listener: ProgressListener): () => void {
    this.progressListeners.add(listener)
    return () => this.progressListeners.delete(listener)
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    // Immediately notify with current status
    listener(this.connectionStatus)
    return () => this.statusListeners.delete(listener)
  }

  onActivity(listener: ActivityListener): () => void {
    this.activityListeners.add(listener)
    return () => this.activityListeners.delete(listener)
  }

  onStateChange(listener: StateChangeListener): () => void {
    this.stateChangeListeners.add(listener)
    // Immediately notify with current state
    listener({ ...this.state })
    return () => this.stateChangeListeners.delete(listener)
  }

  getConnectionStatus(): ConnectionStatus {
    return { ...this.connectionStatus }
  }

  // Notify all state change listeners
  private notifyStateChange(): void {
    const stateCopy = { ...this.state }
    for (const listener of this.stateChangeListeners) {
      try {
        listener(stateCopy)
      } catch (e) {
        console.error('State change listener error:', e)
      }
    }
  }

  // Log an activity entry, store it, and notify listeners
  private logActivity(type: ActivityLogEntry['type'], message: string, details?: string): void {
    const entry: ActivityLogEntry = {
      timestamp: new Date(),
      type,
      message,
      details
    }

    // Store in persisted log
    this.activityLog.push(entry)
    if (this.activityLog.length > MAX_LOG_ENTRIES) {
      this.activityLog = this.activityLog.slice(-MAX_LOG_ENTRIES)
    }

    // Notify listeners
    for (const listener of this.activityListeners) {
      try {
        listener(entry)
      } catch (e) {
        console.error('Activity listener error:', e)
      }
    }
  }

  // Get all stored activity log entries (for persistence across page navigation)
  getActivityLog(): ActivityLogEntry[] {
    return [...this.activityLog]
  }

  // Clear activity log
  clearActivityLog(): void {
    this.activityLog = []
  }

  // Device operations
  async refreshDeviceInfo(): Promise<DeviceInfo | null> {
    if (!this.isConnected()) return null

    this.logActivity('usb-out', 'CMD: Get Device Info', 'Requesting serial number, firmware version, model')
    const info = await this.jensen.getDeviceInfo()
    if (info) {
      this.state.serialNumber = info.serialNumber
      this.state.firmwareVersion = info.versionCode
      this.state.model = info.model
      this.logActivity('usb-in', 'Device Info Received', `SN: ${info.serialNumber}, FW: ${info.versionCode}, Model: ${info.model}`)
      this.notifyStateChange()
    } else {
      this.logActivity('error', 'Failed to get device info')
    }
    return info
  }

  async refreshStorageInfo(): Promise<CardInfo | null> {
    if (!this.isConnected()) return null

    this.logActivity('usb-out', 'CMD: Get Card Info', 'Requesting storage capacity and usage')
    try {
      const cardInfo = await this.jensen.getCardInfo()
      if (cardInfo) {
        this.state.storage = {
          used: cardInfo.used,
          capacity: cardInfo.capacity,
          freePercent: ((cardInfo.capacity - cardInfo.used) / cardInfo.capacity) * 100
        }
        this.logActivity('usb-in', 'Card Info Received', `Used: ${(cardInfo.used / 1024 / 1024).toFixed(1)}MB / ${(cardInfo.capacity / 1024 / 1024).toFixed(1)}MB`)
        this.notifyStateChange()
        return cardInfo
      } else {
        // Card info not available - could be unsupported firmware or timeout
        this.state.storage = { used: 0, capacity: 0, freePercent: 0 }
        this.logActivity('error', 'Failed to get card info', 'Storage info unavailable - firmware may not support this feature')
        this.notifyStateChange()
        return null
      }
    } catch (error) {
      // Error getting card info - set a default state so UI doesn't stay in loading
      this.state.storage = { used: 0, capacity: 0, freePercent: 0 }
      this.logActivity('error', 'Failed to get card info', error instanceof Error ? error.message : 'Unknown error')
      this.notifyStateChange()
      return null
    }
  }

  async refreshSettings(): Promise<DeviceSettings | null> {
    if (!this.isConnected()) return null

    this.logActivity('usb-out', 'CMD: Get Settings', 'Requesting device settings')
    const settings = await this.jensen.getSettings()
    if (settings) {
      this.state.settings = settings
      this.logActivity('usb-in', 'Settings Received', `Auto-record: ${settings.autoRecord ? 'ON' : 'OFF'}`)
      this.notifyStateChange()
    } else {
      this.logActivity('error', 'Failed to get settings')
    }
    return settings
  }

  async syncTime(): Promise<boolean> {
    if (!this.isConnected()) return false

    const now = new Date()
    this.logActivity('usb-out', 'CMD: Set Time', `Setting device time to ${now.toISOString()}`)
    const result = await this.jensen.setTime(now)
    if (result?.result === 'success') {
      this.logActivity('success', 'Time synced successfully')
    } else {
      this.logActivity('error', 'Failed to sync time')
    }
    return result?.result === 'success'
  }

  async getRecordingCount(): Promise<number> {
    if (!this.isConnected()) return 0

    this.logActivity('usb-out', 'CMD: Get File Count', 'Requesting recording count')
    const result = await this.jensen.getFileCount()
    const count = result?.count ?? 0
    this.state.recordingCount = count
    this.logActivity('usb-in', 'File Count Received', `${count} recordings on device`)
    this.notifyStateChange()
    return count
  }

  async listRecordings(
    onProgress?: (filesFound: number, expectedFiles: number) => void,
    forceRefresh: boolean = false
  ): Promise<HiDockRecording[]> {
    console.log('[HiDockDevice] listRecordings called, connected:', this.isConnected(), 'forceRefresh:', forceRefresh)
    if (!this.isConnected()) {
      console.log('[HiDockDevice] listRecordings: Not connected, returning empty array')
      this.logActivity('error', 'Cannot list files', 'Device not connected')
      return []
    }

    // Use already-known recording count from device init
    const expectedFileCount = this.state.recordingCount || 0

    // Check cache - if recording count hasn't changed AND not forcing refresh, return cached recordings
    if (
      !forceRefresh &&
      this.cachedRecordings !== null &&
      this.cachedRecordingCount === expectedFileCount &&
      expectedFileCount > 0
    ) {
      console.log(`[HiDockDevice] listRecordings: Using cached recordings (${this.cachedRecordings.length} files)`)
      this.logActivity('info', 'Using cached file list', `${this.cachedRecordings.length} files (count unchanged)`)
      // Report instant progress
      onProgress?.(expectedFileCount, expectedFileCount)
      return this.cachedRecordings
    }

    if (forceRefresh) {
      this.logActivity('info', 'Force refresh requested', 'Bypassing cache')
    }

    this.logActivity('usb-out', 'CMD: List Files', `Requesting file list (${expectedFileCount} files expected)`)
    console.log('[HiDockDevice] listRecordings: Calling jensen.listFiles(), expected:', expectedFileCount)

    // Send initial progress immediately so UI shows 0/N
    onProgress?.(0, expectedFileCount)

    // Start interpolated progress animation during device wait
    // Based on ~20 files/second observed rate for large lists, estimate total time
    const estimatedTimeMs = Math.max(2000, (expectedFileCount / 20) * 1000)
    let animationProgress = 0
    let animationCancelled = false
    const animationStartTime = Date.now()

    // Animate progress from 0% to ~90% during the wait period using ease-out curve
    // The real data will take over once it starts arriving
    const animationInterval = setInterval(() => {
      if (animationCancelled) return
      const elapsed = Date.now() - animationStartTime
      // Use ease-out curve: starts fast, slows as it approaches 90%
      const t = Math.min(1, elapsed / estimatedTimeMs)
      const easeOut = 1 - Math.pow(1 - t, 3) // Cubic ease-out
      const targetProgress = easeOut * 0.9 // Cap at 90%
      animationProgress = Math.floor(targetProgress * expectedFileCount)
      console.log(`[HiDockDevice] Animation progress: ${animationProgress}/${expectedFileCount}`)
      onProgress?.(animationProgress, expectedFileCount)
    }, 50) // Update every 50ms for smoother animation

    try {
      const files = await this.jensen.listFiles((filesFound, expectedFiles) => {
        // Only cancel animation when real progress arrives (filesFound > animationProgress)
        // This prevents the initial 0/N callback from killing the animation
        if (filesFound > animationProgress) {
          animationCancelled = true
          clearInterval(animationInterval)
          console.log(`[HiDockDevice] listRecordings progress: ${filesFound}/${expectedFiles} files (real data)`)
          this.logActivity('info', `Fetching file list...`, `${filesFound}/${expectedFiles} files loaded`)
          onProgress?.(filesFound, expectedFiles)
        } else {
          // Log but don't update UI - animation is ahead of real progress
          console.log(`[HiDockDevice] listRecordings progress: ${filesFound}/${expectedFiles} files (animation at ${animationProgress})`)
        }
      }, expectedFileCount)

      // Ensure animation is stopped
      animationCancelled = true
      clearInterval(animationInterval)

      console.log(`[HiDockDevice] listRecordings: Received ${files.length} files`)
      this.logActivity('usb-in', 'File List Received', `${files.length} files found`)

      const recordings = files.map((f) => this.fileInfoToRecording(f))
      console.log('[HiDockDevice] listRecordings: Converted to recordings:', recordings.length)

      // Update cache
      this.cachedRecordings = recordings
      this.cachedRecordingCount = expectedFileCount
      console.log(`[HiDockDevice] listRecordings: Cache updated with ${recordings.length} recordings`)

      return recordings
    } catch (error) {
      // Ensure animation is stopped on error
      animationCancelled = true
      clearInterval(animationInterval)
      console.error('[HiDockDevice] listRecordings error:', error)
      this.logActivity('error', 'Failed to list files', error instanceof Error ? error.message : 'Unknown error')
      return []
    }
  }

  async deleteRecording(filename: string): Promise<boolean> {
    if (!this.isConnected()) return false

    this.logActivity('usb-out', 'CMD: Delete File', `Deleting ${filename}`)
    const result = await this.jensen.deleteFile(filename)
    if (result?.result === 'success') {
      this.logActivity('success', 'File deleted', filename)
      // Invalidate cache since recording count changed
      this.cachedRecordings = null
      this.cachedRecordingCount = -1
    } else {
      this.logActivity('error', 'Failed to delete file', filename)
    }
    return result?.result === 'success'
  }

  async formatStorage(): Promise<boolean> {
    if (!this.isConnected()) return false

    this.logActivity('usb-out', 'CMD: Format Card', 'Formatting device storage')
    const result = await this.jensen.formatCard()
    if (result?.result === 'success') {
      this.logActivity('success', 'Storage formatted')
      // Invalidate cache since all recordings were deleted
      this.cachedRecordings = null
      this.cachedRecordingCount = -1
    } else {
      this.logActivity('error', 'Failed to format storage')
    }
    return result?.result === 'success'
  }

  async setAutoRecord(enabled: boolean): Promise<boolean> {
    if (!this.isConnected()) return false

    this.logActivity('usb-out', 'CMD: Set Auto-Record', `Setting auto-record to ${enabled ? 'ON' : 'OFF'}`)
    const result = await this.jensen.setAutoRecord(enabled)
    if (result?.result === 'success' && this.state.settings) {
      this.state.settings.autoRecord = enabled
      this.logActivity('success', 'Auto-record setting updated')
      this.notifyStateChange()
    } else {
      this.logActivity('error', 'Failed to update auto-record setting')
    }
    return result?.result === 'success'
  }

  async downloadRecording(
    filename: string,
    fileSize: number,
    onData: (chunk: Uint8Array) => void
  ): Promise<boolean> {
    if (!this.isConnected()) return false

    const progress: DownloadProgress = {
      filename,
      bytesReceived: 0,
      totalBytes: fileSize,
      percent: 0
    }

    const success = await this.jensen.downloadFile(
      filename,
      fileSize,
      (chunk) => {
        onData(chunk)
        progress.bytesReceived += chunk.length
        progress.percent = (progress.bytesReceived / fileSize) * 100
        this.notifyProgress(progress)
      },
      (received) => {
        progress.bytesReceived = received
        progress.percent = (received / fileSize) * 100
        this.notifyProgress(progress)
      }
    )

    return success
  }

  // Download recording to a file (via IPC to main process)
  async downloadRecordingToFile(
    filename: string,
    fileSize: number,
    _savePath?: string // Not used, storage service determines path
  ): Promise<boolean> {
    const chunks: Uint8Array[] = []

    const success = await this.downloadRecording(filename, fileSize, (chunk) => {
      chunks.push(chunk)
    })

    if (!success) return false

    // Concatenate all chunks
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
    const combined = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }

    // Save via IPC
    try {
      await window.electronAPI.storage.saveRecording(
        filename,
        Array.from(combined) // Convert to array for IPC
      )
      return true
    } catch (error) {
      console.error('Failed to save recording:', error)
      return false
    }
  }

  // Private methods
  private async handleConnect(): Promise<void> {
    console.log('[HiDockDevice] handleConnect called')
    this.state.connected = true
    this.state.model = this.jensen.getModel()
    this.notifyStateChange()

    this.logActivity('success', 'USB device connected', `Model: ${this.state.model}`)
    console.log(`[HiDockDevice] Connected to ${this.state.model}`)

    try {
      // Step 1: Get device info
      console.log('[HiDockDevice] Step 1: Getting device info...')
      this.updateStatus('getting-info', 'Reading device information...', 20)
      await this.refreshDeviceInfo()
      console.log('[HiDockDevice] Device info:', this.state.serialNumber, this.state.firmwareVersion)

      // Step 2: Get storage info
      console.log('[HiDockDevice] Step 2: Getting storage info...')
      this.updateStatus('getting-storage', 'Reading storage information...', 40)
      await this.refreshStorageInfo()
      console.log('[HiDockDevice] Storage:', this.state.storage)

      // Step 3: Get settings
      console.log('[HiDockDevice] Step 3: Getting settings...')
      this.updateStatus('getting-settings', 'Loading device settings...', 60)
      await this.refreshSettings()
      console.log('[HiDockDevice] Settings:', this.state.settings)

      // Step 4: Count files
      console.log('[HiDockDevice] Step 4: Counting files...')
      this.updateStatus('counting-files', 'Counting recordings...', 80)
      await this.getRecordingCount()
      console.log('[HiDockDevice] Recording count:', this.state.recordingCount)

      // Step 5: Sync time
      console.log('[HiDockDevice] Step 5: Syncing time...')
      this.updateStatus('syncing-time', 'Syncing device time...', 90)
      await this.syncTime()
      console.log('[HiDockDevice] Time synced')

      // Done
      this.updateStatus('ready', 'Device ready', 100)
      this.logActivity('success', 'Device initialization complete')
      console.log('[HiDockDevice] Device initialization complete')
    } catch (error) {
      console.error('[HiDockDevice] Error during device initialization:', error)
      this.logActivity('error', 'Device initialization failed', error instanceof Error ? error.message : 'Unknown error')
      this.updateStatus('error', `Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }

    // Notify listeners
    console.log('[HiDockDevice] Notifying connection listeners')
    this.notifyConnectionChange(true)
  }

  private handleDisconnect(): void {
    this.state.connected = false
    this.state.serialNumber = null
    this.state.firmwareVersion = null
    this.state.storage = null
    this.state.settings = null
    this.state.recordingCount = 0
    // NOTE: Do NOT clear recordings cache on disconnect!
    // Cache survives disconnect/reconnect - will be used if file count matches on reconnect.
    // Cache is only invalidated when:
    // 1. File count changes (detected on reconnect)
    // 2. User clicks "Refresh" button (forceRefresh=true)
    // 3. App restarts (acceptable)
    this.notifyStateChange()
    this.logActivity('info', 'USB device disconnected', 'Recording cache preserved for quick reconnect')
    this.updateStatus('idle', 'Device disconnected')
    this.notifyConnectionChange(false)
  }

  private updateStatus(step: ConnectionStep, message: string, progress?: number): void {
    this.connectionStatus = { step, message, progress }
    this.notifyStatusChange(this.connectionStatus)
  }

  private notifyConnectionChange(connected: boolean): void {
    for (const listener of this.connectionListeners) {
      try {
        listener(connected)
      } catch (e) {
        console.error('Connection listener error:', e)
      }
    }
  }

  private notifyStatusChange(status: ConnectionStatus): void {
    for (const listener of this.statusListeners) {
      try {
        listener(status)
      } catch (e) {
        console.error('Status listener error:', e)
      }
    }
  }

  private notifyProgress(progress: DownloadProgress): void {
    for (const listener of this.progressListeners) {
      try {
        listener(progress)
      } catch (e) {
        console.error('Progress listener error:', e)
      }
    }
  }

  private fileInfoToRecording(file: FileInfo): HiDockRecording {
    return {
      id: file.signature || file.name,
      filename: file.name,
      size: file.length,
      duration: file.duration,
      dateCreated: file.time || new Date(),
      version: file.version,
      signature: file.signature
    }
  }

  // ==========================================
  // REALTIME STREAMING METHODS (All devices)
  // ==========================================

  async getRealtimeSettings(): Promise<RealtimeSettings | null> {
    if (!this.isConnected()) return null
    return this.jensen.getRealtimeSettings()
  }

  async startRealtime(): Promise<boolean> {
    if (!this.isConnected()) return false
    const result = await this.jensen.startRealtime()
    return result?.result === 'success'
  }

  async pauseRealtime(): Promise<boolean> {
    if (!this.isConnected()) return false
    const result = await this.jensen.pauseRealtime()
    return result?.result === 'success'
  }

  async stopRealtime(): Promise<boolean> {
    if (!this.isConnected()) return false
    const result = await this.jensen.stopRealtime()
    return result?.result === 'success'
  }

  async getRealtimeData(offset: number): Promise<RealtimeData | null> {
    if (!this.isConnected()) return null
    return this.jensen.getRealtimeData(offset)
  }

  // ==========================================
  // BATTERY STATUS (P1 devices only)
  // ==========================================

  isP1Device(): boolean {
    return this.jensen.isP1Device()
  }

  async getBatteryStatus(): Promise<BatteryStatus | null> {
    if (!this.isConnected()) return null
    return this.jensen.getBatteryStatus()
  }

  // ==========================================
  // BLUETOOTH METHODS (P1 devices only)
  // ==========================================

  async startBluetoothScan(duration: number = 30): Promise<boolean> {
    if (!this.isConnected()) return false
    const result = await this.jensen.startBluetoothScan(duration)
    return result?.result === 'success'
  }

  async stopBluetoothScan(): Promise<boolean> {
    if (!this.isConnected()) return false
    const result = await this.jensen.stopBluetoothScan()
    return result?.result === 'success'
  }

  async getBluetoothStatus(): Promise<BluetoothStatus | null> {
    if (!this.isConnected()) return null
    return this.jensen.getBluetoothStatus()
  }
}

// Singleton instance
let serviceInstance: HiDockDeviceService | null = null

export function getHiDockDeviceService(): HiDockDeviceService {
  if (!serviceInstance) {
    serviceInstance = new HiDockDeviceService()
  }
  return serviceInstance
}

export { HiDockDeviceService }
export type { RealtimeSettings, RealtimeData, BatteryStatus, BluetoothStatus, ActivityLogEntry }
