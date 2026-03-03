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
import { validateDevicePath } from '../utils/path-validation'
import { withTimeout, isAbortError } from '../utils/timeout'

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
  type: 'info' | 'success' | 'error' | 'usb-out' | 'usb-in' | 'warning'
  message: string
  details?: string
}

const MAX_LOG_ENTRIES = 100 // Maximum activity log entries to keep in memory

// Logging configuration - set to false to reduce console noise
const DEBUG_DEVICE = false // Enable detailed device service logging

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

  // Flag to abort initialization when disconnect is requested
  private initAborted: boolean = false

  // Flag to track if initialization is complete (recordingCount populated)
  private initializationComplete: boolean = false

  // Lock to prevent concurrent listRecordings calls
  private listRecordingsPromise: Promise<HiDockRecording[]> | null = null
  // Synchronous flag to prevent TOCTOU race in listRecordings
  // (set immediately before async work, checked before promise is set)
  private listRecordingsLock: boolean = false

  // AbortController tracking for downloads
  private abortControllers: Map<string, AbortController> = new Map()

  // Debounce: timestamp of last successful listRecordings completion
  private listRecordingsLastCompleted: number = 0
  private static readonly LIST_RECORDINGS_DEBOUNCE_MS = 2000

  // Flag to prevent overlapping auto-connect attempts
  private autoConnectInProgress: boolean = false

  // Synchronous flag to prevent duplicate initAutoConnect (set immediately before any async work)
  // This handles React StrictMode double-invoking effects
  private initAutoConnectStarted: boolean = false

  // FL-09: Timestamp of last 'ready' status notification, used to dedup
  // back-to-back onStatusChange('ready') and onConnectionChange(true) events
  private lastReadyStatusTimestamp: number = 0
  private static readonly READY_DEDUP_MS = 500

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
      const maxAttempts = 20 // Increased to 2 seconds for slower startup
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

  // Start auto-connect - uses browser USB events (no polling!)
  // NOTE: This does NOT reset userInitiatedDisconnect - that's only reset by explicit user connect action
  startAutoConnect(_intervalMs?: number): void {
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

    // Already started or connected
    if (this.autoConnectEnabled || this.state.connected) return

    this.autoConnectEnabled = true
    this.logActivity('info', 'Auto-connect enabled', 'Will connect when device is plugged in')

    // Try ONCE on startup to connect to any already-authorized device
    // After this, the browser's USB connect event will handle new connections
    // (set up in jensen.ts setupUsbConnectListener via navigator.usb.onconnect)
    this.tryConnectSilent()

    // NO POLLING - rely entirely on browser USB connect events
    // When a device is plugged in, navigator.usb.onconnect fires and jensen.ts handles it
  }

  // Initialize auto-connect on app startup
  async initAutoConnect(): Promise<void> {
    // CRITICAL: Synchronous guard BEFORE any async work
    // This prevents duplicate initialization from React StrictMode double-invoking effects
    if (this.initAutoConnectStarted) {
      if (DEBUG_DEVICE) console.log('[HiDockDevice] initAutoConnect: Already started (sync guard), skipping')
      return
    }
    this.initAutoConnectStarted = true // Set immediately, before any await

    // Prevent duplicate initialization - check interval OR if already connected
    if (this.autoConnectInterval) {
      if (DEBUG_DEVICE) console.log('[HiDockDevice] initAutoConnect: Already initialized, skipping')
      return
    }

    // If already connected, don't try to reconnect (handles HMR scenarios)
    if (this.state.connected) {
      if (DEBUG_DEVICE) console.log('[HiDockDevice] initAutoConnect: Already connected, skipping')
      return
    }

    if (DEBUG_DEVICE) console.log('[HiDockDevice] initAutoConnect: Waiting for config to load...')

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
      if (DEBUG_DEVICE) console.log('[HiDockDevice] initAutoConnect: Config not yet loaded, waiting...')
      // Wait up to 2 seconds for config to load
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (this.configLoaded) break
      }
    }

    if (DEBUG_DEVICE) console.log(`[HiDockDevice] initAutoConnect: Config loaded=${this.configLoaded}, enabled=${this.autoConnectConfig.enabled}, connectOnStartup=${this.autoConnectConfig.connectOnStartup}`)

    // Silently start auto-connect if enabled - no activity log spam
    if (this.autoConnectConfig.enabled && this.autoConnectConfig.connectOnStartup) {
      this.startAutoConnect()
    }
  }

  stopAutoConnect(): void {
    // Clear any legacy interval if it exists
    if (this.autoConnectInterval) {
      clearInterval(this.autoConnectInterval)
      this.autoConnectInterval = null
    }
    this.autoConnectEnabled = false

    // Clean up USB connect listener to prevent memory leaks
    this.jensen.removeUsbConnectListener()
  }

  // Disable auto-connect (e.g., when user explicitly disconnects)
  disableAutoConnect(): void {
    this.autoConnectEnabled = false
    this.userInitiatedDisconnect = true
    // CRITICAL: Update persistent config so setting survives app restart
    this.autoConnectConfig.enabled = false
    this.autoConnectConfig.connectOnStartup = false
    this.saveAutoConnectConfig() // Persists to config.json
    this.stopAutoConnect()
    this.logActivity('info', 'Auto-connect disabled by user')
  }

  // Re-enable auto-connect (e.g., when user clicks connect)
  enableAutoConnect(): void {
    this.autoConnectEnabled = true
    this.userInitiatedDisconnect = false
    this.autoConnectConfig.enabled = true
    this.autoConnectConfig.connectOnStartup = true
    this.saveAutoConnectConfig() // Persist so setting survives app restart
    this.logActivity('info', 'Auto-connect re-enabled')
  }

  isAutoConnectEnabled(): boolean {
    return this.autoConnectEnabled && !this.userInitiatedDisconnect
  }

  // Try to auto-connect once (no polling - browser events handle reconnection)
  private async tryConnectSilent(): Promise<boolean> {
    if (this.state.connected) return true

    // Prevent overlapping auto-connect attempts
    if (this.autoConnectInProgress) {
      return false
    }

    // Don't try to connect if USB operations are in progress
    if (this.jensen.isOperationInProgress()) {
      this.logActivity('info', 'Auto-connect', 'Skipped - USB operation in progress')
      return false
    }

    this.autoConnectInProgress = true
    try {
      this.logActivity('info', 'Auto-connect', 'Checking for authorized HiDock devices...')
      const success = await this.jensen.tryConnect()
      // Note: handleConnect() is called via the onconnect callback in jensen.ts
      // We should NOT call it here to avoid duplicate initialization
      if (success) {
        this.updateStatus('opening', 'Device found, connecting...', 10)
        this.logActivity('success', 'Auto-connect', 'Device found and connected')
      } else {
        this.logActivity('info', 'Auto-connect', 'No authorized device found. Click Connect to authorize.')
      }
      return success
    } finally {
      this.autoConnectInProgress = false
    }
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

    // Create AbortController for connection timeout
    const controller = new AbortController()

    try {
      // Connect with 5-second timeout for USB operations
      const CONNECTION_TIMEOUT = 5000 // 5 seconds
      const success = await withTimeout(
        this.jensen.connect(controller.signal),
        CONNECTION_TIMEOUT,
        controller
      )

      // Note: handleConnect() is called via the onconnect callback in jensen.ts
      // We should NOT call it here to avoid duplicate initialization
      if (!success) {
        this.updateStatus('idle', 'Connection cancelled or failed')
        this.logActivity('info', 'Connection cancelled or no device selected')
      }
      return success
    } catch (error) {
      // Handle timeout/abort
      if (isAbortError(error)) {
        this.updateStatus('error', 'Connection timeout - device not responding', 0)
        this.logActivity('error', 'Connection timeout', 'Device did not respond within 5 seconds')
        console.error('[HiDockDevice] Connection timeout:', error)
      } else {
        this.updateStatus('idle', 'Connection failed')
        this.logActivity('error', 'Connection failed', error instanceof Error ? error.message : 'Unknown error')
        console.error('[HiDockDevice] Connection error:', error)
      }
      return false
    }
  }

  // Disconnect from device - this disables auto-connect until user clicks connect again
  async disconnect(): Promise<void> {
    this.logActivity('info', 'User initiated disconnect')
    // Abort any running initialization immediately
    this.initAborted = true
    // Disable auto-connect so we don't immediately reconnect
    this.disableAutoConnect()
    await this.jensen.disconnect()
  }

  // Reset device USB connection (for recovery from stuck state)
  async resetDevice(): Promise<boolean> {
    this.logActivity('info', 'Resetting USB device...')
    try {
      const success = await this.jensen.reset()
      if (success) {
        this.logActivity('success', 'Device reset successful')
        // Re-initialize the device after reset
        this.initializationComplete = false
        await this.handleConnect()
      } else {
        this.logActivity('error', 'Device reset failed')
      }
      return success
    } catch (error) {
      this.logActivity('error', 'Device reset error', error instanceof Error ? error.message : 'Unknown error')
      return false
    }
  }

  isConnected(): boolean {
    return this.state.connected && this.jensen.isConnected()
  }

  // Check if device initialization is complete (recordingCount populated)
  isInitialized(): boolean {
    return this.initializationComplete
  }

  // Get cached recordings list (available even when disconnected)
  getCachedRecordings(): HiDockRecording[] {
    return this.cachedRecordings || []
  }

  // Persist the in-memory cache to database storage (survives app restart)
  private persistCacheToStorage(): void {
    if (!this.cachedRecordings || this.cachedRecordings.length === 0) {
      return
    }

    // Convert to the format expected by deviceCache.saveAll
    // Must match CachedDeviceFile interface: { filename, size, duration, dateCreated }
    const cacheEntries = this.cachedRecordings.map(rec => ({
      filename: rec.filename,
      size: rec.size ?? 0,
      duration: rec.duration ?? 0,
      dateCreated: rec.dateCreated?.toISOString() || new Date().toISOString()
    }))

    // Fire and forget - don't block disconnect
    window.electronAPI.deviceCache.saveAll(cacheEntries).catch(err => {
      console.warn('[HiDockDevice] Failed to persist cache to storage:', err)
    })
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
  private logActivity(type: 'error' | 'success' | 'info' | 'usb-out' | 'usb-in' | 'warning', message: string, details?: string): void {
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

    // Notify listeners - log count for debugging
    const listenerCount = this.activityListeners.size
    if (DEBUG_DEVICE) {
      console.log(`[HiDockDevice] logActivity: ${type} "${message}" - notifying ${listenerCount} listeners`)
    }

    for (const listener of this.activityListeners) {
      try {
        listener(entry)
      } catch (e) {
        console.error('Activity listener error:', e)
      }
    }
  }

  // Public method to log activity from external components (for debugging flows)
  log(type: ActivityLogEntry['type'], message: string, details?: string): void {
    this.logActivity(type, message, details)
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
        // Device returns values in MiB (binary megabytes)
        // Convert to bytes for consistent internal representation: 1 MiB = 1024 * 1024 bytes
        const usedBytes = cardInfo.used * 1024 * 1024
        const capacityBytes = cardInfo.capacity * 1024 * 1024
        const freeBytes = cardInfo.free * 1024 * 1024
        this.state.storage = {
          used: usedBytes,
          capacity: capacityBytes,
          freePercent: cardInfo.capacity > 0 ? (cardInfo.free / cardInfo.capacity) * 100 : 0
        }

        // Format for human-readable logging (use GB for large values)
        const formatSize = (bytes: number): string => {
          if (bytes >= 1024 * 1024 * 1024) {
            return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
          }
          return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        }

        this.logActivity('usb-in', 'Card Info Received',
          `Free: ${formatSize(freeBytes)}, Used: ${formatSize(usedBytes)}, Total: ${formatSize(capacityBytes)}`)

        // Get file count as part of storage info (matches web app behavior)
        // This ensures recordingCount is populated early in initialization
        try {
          await this.getRecordingCount()
        } catch (e) {
          console.warn('[HiDockDevice] Failed to get file count during storage info:', e)
        }

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
    console.log('[HiDockDevice] >>> listRecordings ENTRY, connected:', this.isConnected(), 'initialized:', this.initializationComplete, 'forceRefresh:', forceRefresh)
    if (!this.isConnected()) {
      console.log('[HiDockDevice] >>> listRecordings: NOT CONNECTED, returning []')
      this.logActivity('error', 'Cannot list files', 'Device not connected')
      return []
    }

    // FL-02: Debounce — if called within 2s of a previous successful completion,
    // return cached data (prevents triple-fire on device connection/ready/poll)
    if (!forceRefresh && this.cachedRecordings !== null) {
      const timeSinceLast = Date.now() - this.listRecordingsLastCompleted
      if (timeSinceLast < HiDockDeviceService.LIST_RECORDINGS_DEBOUNCE_MS) {
        console.log(`[HiDockDevice] >>> listRecordings: DEBOUNCED (${timeSinceLast}ms since last), returning cached`)
        onProgress?.(this.cachedRecordings.length, this.cachedRecordings.length)
        return this.cachedRecordings
      }
    }

    // FL-01/FL-08: forceRefresh must wait for existing operation to complete,
    // then start a new one — never run concurrently
    if (forceRefresh && (this.listRecordingsLock || this.listRecordingsPromise)) {
      console.log('[HiDockDevice] >>> listRecordings: forceRefresh waiting for existing operation to complete')
      if (this.listRecordingsPromise) {
        try {
          await this.listRecordingsPromise
        } catch {
          // Ignore error from previous operation — we'll start a fresh one
        }
      }
      // After the existing operation completes, fall through to start a new one
    }

    // Lock-type-aware guard: examine which Jensen lock is held and respond appropriately
    // instead of blanket-rejecting all operations
    const lockHolder = this.jensen.getLockHolder()
    if (lockHolder) {
      // Case 1: File listing already in progress - wait for in-flight promise
      if (lockHolder === 'listFiles' && this.listRecordingsPromise) {
        console.log('[HiDockDevice] >>> listRecordings: listFiles lock held, waiting for in-flight promise')
        try {
          const result = await this.listRecordingsPromise
          onProgress?.(result.length, this.state.recordingCount || result.length)
          return result
        } catch {
          return this.cachedRecordings ?? []
        }
      }
      // Case 2: Download in progress - protect by returning cached data
      if (lockHolder.startsWith('downloadFile:')) {
        console.log('[HiDockDevice] >>> listRecordings: download in progress, returning cached')
        if (this.cachedRecordings !== null) {
          onProgress?.(this.cachedRecordings.length, this.cachedRecordings.length)
          return this.cachedRecordings
        }
        this.logActivity('info', 'Skipped file list', 'Download in progress')
        return []
      }
      // Case 3: Delete in progress - protect it
      if (lockHolder.startsWith('deleteFile:')) {
        console.log('[HiDockDevice] >>> listRecordings: delete in progress, returning cached')
        if (this.cachedRecordings !== null) {
          onProgress?.(this.cachedRecordings.length, this.cachedRecordings.length)
          return this.cachedRecordings
        }
        return []
      }
      // Case 4: Init commands (short-lived) - fall through to init-wait guard
      console.log(`[HiDockDevice] >>> listRecordings: init lock '${lockHolder}' held, falling through to init wait`)
    }

    // Wait for initialization to complete before listing files
    // This ensures recordingCount is populated for accurate progress reporting
    if (!this.initializationComplete) {
      console.log('[HiDockDevice] >>> listRecordings: WAITING FOR INIT')
      this.logActivity('info', 'Waiting for initialization', 'File list request waiting for device init...')
      // FL-06: Emit periodic status updates so the UI shows "Initializing device..."
      // instead of appearing frozen during the wait
      this.updateStatus('getting-info', 'Initializing device...', 15)
      // Wait up to 60 seconds for initialization (initialization itself can take up to 60s with 4x15s timeouts)
      const maxWait = 60000
      const startWait = Date.now()
      let lastProgressUpdate = 0
      while (!this.initializationComplete && Date.now() - startWait < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 100))
        // Check if disconnected during wait
        if (!this.isConnected()) {
          this.logActivity('error', 'List files aborted', 'Device disconnected while waiting for init')
          return []
        }
        // FL-06: Emit progress update every 5 seconds so UI doesn't appear frozen
        const elapsed = Date.now() - startWait
        const secondsElapsed = Math.floor(elapsed / 1000)
        if (secondsElapsed > lastProgressUpdate && secondsElapsed % 5 === 0) {
          lastProgressUpdate = secondsElapsed
          const progress = Math.min(15 + Math.round((elapsed / maxWait) * 50), 65)
          this.updateStatus('getting-info', `Initializing device... (${secondsElapsed}s)`, progress)
        }
      }
      if (!this.initializationComplete) {
        this.logActivity('error', 'List files timeout', 'Timed out waiting for device initialization')
        return []
      }
    }

    // Use already-known recording count from device init
    const expectedFileCount = this.state.recordingCount || 0

    // Check cache - if recording count hasn't changed AND not forcing refresh, return cached recordings
    const cacheValid = !forceRefresh &&
      this.cachedRecordings !== null &&
      this.cachedRecordingCount === expectedFileCount &&
      expectedFileCount > 0

    if (cacheValid) {
      console.log(`[HiDockDevice] >>> listRecordings: CACHE HIT, returning ${this.cachedRecordings!.length} files`)
      // Don't log cache hits - they're too noisy when multiple components request data
      // Report instant progress
      onProgress?.(expectedFileCount, expectedFileCount)
      return this.cachedRecordings!
    }
    console.log(`[HiDockDevice] >>> listRecordings: CACHE MISS, forceRefresh=${forceRefresh}, cached=${this.cachedRecordings?.length ?? 'null'}, cachedCount=${this.cachedRecordingCount}, expected=${expectedFileCount}`)

    // Prevent concurrent requests - use synchronous lock to prevent TOCTOU race
    // Check both the lock flag (set synchronously) and promise (set after lock)
    if ((this.listRecordingsLock || this.listRecordingsPromise) && !forceRefresh) {
      if (DEBUG_DEVICE) console.log('[HiDockDevice] listRecordings: Request already in progress, waiting...')
      // Don't log - this is just coordination between components
      // Wait for the promise if it exists, or poll for it if lock is set but promise not yet
      const waitForPromise = async (): Promise<HiDockRecording[]> => {
        // Wait for promise to be set (if only lock is set)
        let waitAttempts = 0
        while (this.listRecordingsLock && !this.listRecordingsPromise && waitAttempts < 50) {
          await new Promise(resolve => setTimeout(resolve, 100))
          waitAttempts++
        }
        if (this.listRecordingsPromise) {
          return this.listRecordingsPromise
        }
        // Lock cleared without promise - something went wrong, return empty
        return []
      }

      let timeoutId: ReturnType<typeof setTimeout>
      try {
        const result = await Promise.race([
          waitForPromise(),
          new Promise<HiDockRecording[]>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('Timed out waiting for existing request')), 120000)
          })
        ])
        clearTimeout(timeoutId!)
        onProgress?.(result.length, expectedFileCount)
        return result
      } catch (error) {
        clearTimeout(timeoutId!)
        // Do NOT clear listRecordingsPromise or listRecordingsLock here.
        // The promise owner (the IIFE at line 849) clears these in its finally block.
        // Clearing them from a waiter would:
        //   1. Break other concurrent waiters (their waitForPromise() loop sees null and returns [])
        //   2. Start a second concurrent USB operation (Jensen withLock would block it anyway)
        //   3. Create race conditions with the F01 lock-type-aware guard
        console.warn('[HiDockDevice] listRecordings: Timed out waiting for existing request, returning cached data')
        return this.cachedRecordings ?? []
      }
    }

    // Set lock IMMEDIATELY (synchronously) before any async work
    // This prevents the TOCTOU race where two callers both pass the check above
    this.listRecordingsLock = true

    // Only log to console (DEBUG), not activity log - cache invalidation is internal detail
    if (!forceRefresh && this.cachedRecordings !== null && DEBUG_DEVICE) {
      console.log(`[HiDockDevice] Cache invalid: cached=${this.cachedRecordingCount}, device=${expectedFileCount}`)
    }

    this.logActivity('usb-out', 'CMD: List Files', `Requesting file list (${expectedFileCount} files expected)`)
    console.log('[HiDockDevice] >>> listRecordings: CALLING JENSEN.LISTFILES(), expected:', expectedFileCount)

    // Send initial progress immediately so UI shows 0/N
    onProgress?.(0, expectedFileCount)

    // Start interpolated progress animation during device wait
    // Based on ~15 files/second observed rate for large lists, estimate total time
    // Use 1.5x multiplier so animation runs slightly slower than actual data arrival
    const estimatedTimeMs = Math.max(3000, (expectedFileCount / 15) * 1000 * 1.5)
    let animationProgress = 0
    let animationCancelled = false
    const animationStartTime = Date.now()

    // Animate progress from 0% to 100% during the wait period using ease-out curve
    // Real data takes over once it arrives - animation is just placeholder
    const animationInterval = setInterval(() => {
      if (animationCancelled) return
      const elapsed = Date.now() - animationStartTime
      // Use ease-out curve: starts fast, slows as it approaches 100%
      const t = Math.min(1, elapsed / estimatedTimeMs)
      const easeOut = 1 - Math.pow(1 - t, 3) // Cubic ease-out
      animationProgress = Math.floor(easeOut * expectedFileCount)
      // Removed verbose animation progress logging
      onProgress?.(animationProgress, expectedFileCount)
    }, 50) // Update every 50ms for smoother animation

    // Create and store the promise for concurrent request handling
    this.listRecordingsPromise = (async () => {
      try {
        const files = await this.jensen.listFiles((filesFound, expectedFiles) => {
          // Only cancel animation when real progress arrives (filesFound > animationProgress)
          // This prevents the initial 0/N callback from killing the animation
          if (filesFound > animationProgress) {
            animationCancelled = true
            clearInterval(animationInterval)
            onProgress?.(filesFound, expectedFiles)
          }
          // Removed verbose progress logging
        }, expectedFileCount)

        // Ensure animation is stopped
        animationCancelled = true
        clearInterval(animationInterval)

        if (DEBUG_DEVICE) console.log(`[HiDockDevice] listRecordings: Received ${files.length} files`)
        this.logActivity('usb-in', 'File List Received', `${files.length} files found`)

        const recordings = files.map((f) => this.fileInfoToRecording(f))

        // Update cache
        this.cachedRecordings = recordings
        this.cachedRecordingCount = expectedFileCount

        return recordings
      } catch (error) {
        animationCancelled = true
        clearInterval(animationInterval)
        console.error('[HiDockDevice] listRecordings error:', error)
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        const cachedCount = this.cachedRecordings?.length ?? 0
        this.logActivity('error', 'Failed to list files', `${errorMsg} (returned ${cachedCount} cached files)`)
        // Return cached data as fallback instead of empty array
        // This prevents waiters from receiving empty results on transient USB errors
        // Note: cached data may be stale if files changed between connects (acceptable tradeoff)
        return this.cachedRecordings ?? []
      } finally {
        // Clear the lock and promise when done (success or error)
        this.listRecordingsLock = false
        this.listRecordingsPromise = null
        // FL-02: Update debounce timestamp on completion
        this.listRecordingsLastCompleted = Date.now()
      }
    })()

    return this.listRecordingsPromise
  }

  async deleteRecording(filename: string): Promise<boolean> {
    if (!this.isConnected()) return false

    // SECURITY: Validate path to prevent directory traversal attacks
    if (!validateDevicePath(filename)) {
      this.logActivity('error', 'Delete rejected', `Invalid filename: ${filename}`)
      throw new Error(`Invalid filename: ${filename}`)
    }

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
    // AUD4-007: Pre-check device connection before starting format
    if (!this.isConnected()) {
      this.logActivity('error', 'Format aborted: device not connected')
      return false
    }

    this.logActivity('usb-out', 'CMD: Format Card', 'Formatting device storage')

    let result: { result: string } | null = null
    try {
      result = await this.jensen.formatCard()
    } catch (err) {
      // AUD4-007: Catch USB disconnection or communication errors during format
      const message = err instanceof Error ? err.message : 'Unknown error'
      this.logActivity('error', 'Format storage failed with exception', message)
      // Invalidate cache to force re-read on next access since state is unknown
      this.cachedRecordings = null
      this.cachedRecordingCount = -1
      throw new Error(`Format storage failed: ${message}. Check device connection and try again.`)
    }

    if (result?.result === 'success') {
      this.logActivity('success', 'Storage formatted')
      // Invalidate cache since all recordings were deleted
      this.cachedRecordings = null
      this.cachedRecordingCount = -1

      // AUD4-007: Post-check - verify format succeeded by checking file count
      try {
        const count = await this.getRecordingCount()
        if (count > 0) {
          this.logActivity('warning', 'Format may be incomplete', `${count} files still on device after format`)
        }
      } catch {
        // Post-check is best-effort; don't fail the overall operation
        this.logActivity('warning', 'Could not verify format result (device may have disconnected)')
      }

      return true
    } else {
      this.logActivity('error', 'Failed to format storage')
      // Invalidate cache since device state may be inconsistent
      this.cachedRecordings = null
      this.cachedRecordingCount = -1
      return false
    }
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
    onData: (chunk: Uint8Array) => void,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (!this.isConnected()) {
      this.logActivity('error', 'Download failed', 'Device not connected')
      return false
    }

    // SECURITY: Validate path to prevent directory traversal attacks
    if (!validateDevicePath(filename)) {
      this.logActivity('error', 'Download rejected', `Invalid filename: ${filename}`)
      throw new Error(`Invalid filename: ${filename}`)
    }

    const fileSizeStr = fileSize < 1024 * 1024
      ? `${(fileSize / 1024).toFixed(1)} KB`
      : `${(fileSize / (1024 * 1024)).toFixed(1)} MB`

    this.logActivity('usb-out', 'CMD: Download File', `${filename} (${fileSizeStr})`)

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
      },
      signal
    )

    if (success) {
      this.logActivity('success', 'Download complete', filename)
    } else {
      this.logActivity('error', 'Download failed', filename)
    }

    return success
  }

  // Download recording to a file (via IPC to main process)
  async downloadRecordingToFile(
    filename: string,
    fileSize: number,
    _savePath?: string, // Not used, storage service determines path
    onProgress?: (bytesReceived: number) => void,
    recordingDate?: Date // Original recording date from device
  ): Promise<boolean> {
    // SECURITY: Validate path to prevent directory traversal attacks
    if (!validateDevicePath(filename)) {
      this.logActivity('error', 'Download rejected', `Invalid filename: ${filename}`)
      throw new Error(`Invalid filename: ${filename}`)
    }

    // Create AbortController for this download
    const controller = new AbortController()
    this.abortControllers.set(filename, controller)

    try {
      const chunks: Uint8Array[] = []
      let totalReceived = 0

      this.logActivity('info', 'Starting file download', `${filename} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`)

      const success = await this.downloadRecording(filename, fileSize, (chunk) => {
        chunks.push(chunk)
        totalReceived += chunk.length
        onProgress?.(totalReceived)
      }, controller.signal)

      if (!success) {
        // Log detailed failure info
        const receivedMB = (totalReceived / 1024 / 1024).toFixed(2)
        const expectedMB = (fileSize / 1024 / 1024).toFixed(2)
        const errorMsg = `Download incomplete: received ${receivedMB}MB of ${expectedMB}MB`
        console.error(`[HiDockDevice] downloadRecordingToFile FAILED: ${filename} - ${errorMsg}`)
        this.logActivity('error', 'Download failed', `${filename}: ${errorMsg}`)
        return false
      }

      // Concatenate all chunks
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
      const combined = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        combined.set(chunk, offset)
        offset += chunk.length
      }

      // Verify we got all the data
      if (totalLength !== fileSize) {
        const errorMsg = `Data mismatch: got ${totalLength} bytes, expected ${fileSize}`
        console.error(`[HiDockDevice] downloadRecordingToFile FAILED: ${filename} - ${errorMsg}`)
        this.logActivity('error', 'Download failed', `${filename}: ${errorMsg}`)
        return false
      }

      // Save via IPC
      try {
        await window.electronAPI.storage.saveRecording(
          filename,
          Array.from(combined), // Convert to array for IPC
          recordingDate?.toISOString() // Pass original recording date to preserve it
        )
        this.logActivity('success', 'File saved', filename)
        return true
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        console.error(`[HiDockDevice] downloadRecordingToFile FAILED to save: ${filename} -`, error)
        this.logActivity('error', 'Failed to save file', `${filename}: ${errorMsg}`)
        return false
      }
    } finally {
      // Always cleanup the AbortController
      this.abortControllers.delete(filename)
    }
  }

  /**
   * Cancel an in-progress download
   * @param filename - The filename of the download to cancel
   * @returns true if a download was cancelled, false if no download was in progress
   */
  cancelDownload(filename: string): boolean {
    const controller = this.abortControllers.get(filename)
    if (controller) {
      console.log(`[HiDockDevice] Cancelling download: ${filename}`)
      controller.abort()
      this.abortControllers.delete(filename)
      this.logActivity('warning', 'Download cancelled', filename)
      return true
    }
    return false
  }

  /**
   * Cancel all in-progress downloads
   * @returns number of downloads cancelled
   */
  cancelAllDownloads(): number {
    let count = 0
    for (const [filename, controller] of this.abortControllers.entries()) {
      console.log(`[HiDockDevice] Cancelling download: ${filename}`)
      controller.abort()
      count++
    }
    this.abortControllers.clear()
    if (count > 0) {
      this.logActivity('warning', 'All downloads cancelled', `${count} download(s)`)
    }
    return count
  }

  // Private methods
  private async handleConnect(): Promise<void> {
    if (DEBUG_DEVICE) console.log('[HiDockDevice] handleConnect called')
    this.initAborted = false // Reset abort flag on new connection
    this.state.connected = true
    this.state.model = this.jensen.getModel()
    this.notifyStateChange()

    this.logActivity('success', 'USB device connected', `Model: ${this.state.model}`)
    console.log(`[HiDockDevice] Connected to ${this.state.model}`)

    // Initialize device - track failures to detect unresponsive device
    // Each step has a timeout to prevent hanging
    const INIT_STEP_TIMEOUT = 15000 // 15 seconds per step
    let timeoutCount = 0
    let successCount = 0
    const MAX_TIMEOUTS_BEFORE_FAIL = 2 // Fail initialization if 2+ steps timeout

    // Create AbortController for timeout management
    const controller = new AbortController()

    // Step 1: Get device info (critical - if this times out, device is likely unresponsive)
    if (this.initAborted) return
    this.updateStatus('getting-info', 'Reading device information...', 20)
    try {
      await withTimeout(this.refreshDeviceInfo(), INIT_STEP_TIMEOUT, controller)
      successCount++
    } catch (error) {
      const isTimeout = isAbortError(error)
      if (isTimeout) timeoutCount++
      console.warn('[HiDockDevice] Failed to get device info:', error)
      this.logActivity('error', 'Failed to get device info', error instanceof Error ? error.message : 'Unknown error')

      // If first command times out, device is likely unresponsive - suggest reset
      if (isTimeout) {
        this.logActivity('warning', 'Device may be unresponsive', 'Try disconnecting and reconnecting your device')
      }
    }

    // Check if we should abort due to too many timeouts
    if (timeoutCount >= MAX_TIMEOUTS_BEFORE_FAIL) {
      this.logActivity('error', 'Device initialization failed', 'Device is not responding. Please disconnect and reconnect your device.')
      this.updateStatus('error', 'Device not responding - try reconnecting', 0)
      this.initializationComplete = false
      return
    }

    // Step 2: Get storage info (non-fatal)
    if (this.initAborted) return
    this.updateStatus('getting-storage', 'Reading storage information...', 40)
    try {
      await withTimeout(this.refreshStorageInfo(), INIT_STEP_TIMEOUT, controller)
      successCount++
    } catch (error) {
      const isTimeout = isAbortError(error)
      if (isTimeout) timeoutCount++
      console.warn('[HiDockDevice] Failed to get storage info:', error)
      this.logActivity('error', 'Failed to get storage info', error instanceof Error ? error.message : 'Unknown error')
    }

    // Check if we should abort due to too many timeouts
    if (timeoutCount >= MAX_TIMEOUTS_BEFORE_FAIL) {
      this.logActivity('error', 'Device initialization failed', 'Device is not responding. Please disconnect and reconnect your device.')
      this.updateStatus('error', 'Device not responding - try reconnecting', 0)
      this.initializationComplete = false
      return
    }

    // Step 3: Get settings (non-fatal)
    if (this.initAborted) return
    this.updateStatus('getting-settings', 'Loading device settings...', 70)
    try {
      await withTimeout(this.refreshSettings(), INIT_STEP_TIMEOUT, controller)
      successCount++
    } catch (error) {
      const isTimeout = isAbortError(error)
      if (isTimeout) timeoutCount++
      console.warn('[HiDockDevice] Failed to get settings:', error)
      this.logActivity('error', 'Failed to get settings', error instanceof Error ? error.message : 'Unknown error')
    }

    // Check if we should abort due to too many timeouts
    if (timeoutCount >= MAX_TIMEOUTS_BEFORE_FAIL) {
      this.logActivity('error', 'Device initialization failed', 'Device is not responding. Please disconnect and reconnect your device.')
      this.updateStatus('error', 'Device not responding - try reconnecting', 0)
      this.initializationComplete = false
      return
    }

    // Note: File count is now retrieved as part of refreshStorageInfo() to match web app behavior
    // This ensures recordingCount is populated before initialization completes

    // Step 4: Sync time (non-fatal)
    if (this.initAborted) return
    this.updateStatus('syncing-time', 'Syncing device time...', 90)
    try {
      await withTimeout(this.syncTime(), INIT_STEP_TIMEOUT, controller)
      successCount++
    } catch (error) {
      const isTimeout = isAbortError(error)
      if (isTimeout) timeoutCount++
      console.warn('[HiDockDevice] Failed to sync time:', error)
      this.logActivity('error', 'Failed to sync time', error instanceof Error ? error.message : 'Unknown error')
    }

    // Done - only if not aborted
    if (this.initAborted) return

    // Check final state - if we got at least some data, consider it a partial success
    if (successCount === 0) {
      this.logActivity('error', 'Device initialization failed', 'Could not communicate with device. Please disconnect and reconnect.')
      this.updateStatus('error', 'Device not responding', 0)
      this.initializationComplete = false
      return
    }

    this.initializationComplete = true  // Mark initialization as complete
    if (timeoutCount > 0) {
      this.updateStatus('ready', `Device ready (${timeoutCount} feature(s) unavailable)`, 100)
      this.logActivity('warning', 'Device initialization complete with warnings', `${successCount}/4 features available`)
    } else {
      this.updateStatus('ready', 'Device ready', 100)
      this.logActivity('success', 'Device initialization complete')
    }

    // Notify listeners
    this.notifyConnectionChange(true)
  }

  private handleDisconnect(): void {
    // Abort any running initialization immediately
    this.initAborted = true
    this.initializationComplete = false  // Reset initialization flag

    // Persist cache to survive app restart
    this.persistCacheToStorage()

    this.state.connected = false
    this.state.serialNumber = null
    this.state.firmwareVersion = null
    this.state.storage = null
    this.state.settings = null
    // Invalidate cache count to force fresh fetch on reconnect
    // (cachedRecordings preserved for instant UI display via getCachedRecordings())
    // TODO: FL-07: Setting cachedRecordingCount = -1 forces a full re-fetch on reconnect
    // even if no recordings changed. Consider comparing counts on reconnect before
    // triggering a full list refresh to avoid unnecessary data transfers.
    this.cachedRecordingCount = -1
    // NOTE: Do NOT clear cachedRecordings on disconnect!
    // The recordings array survives disconnect for instant Phase 1 display.
    // Cache count is reset to -1 so reconnect always fetches fresh data.
    this.notifyStateChange()
    this.logActivity('info', 'USB device disconnected', 'Recording count and cache preserved for quick reconnect')
    this.updateStatus('idle', 'Device disconnected')
    this.notifyConnectionChange(false)
  }

  private updateStatus(step: ConnectionStep, message: string, progress?: number): void {
    this.connectionStatus = { step, message, progress }
    this.notifyStatusChange(this.connectionStatus)
  }

  private notifyConnectionChange(connected: boolean): void {
    // FL-09: If a 'ready' status notification just fired (within dedup window),
    // skip the connection change notification for 'connected=true' to prevent
    // duplicate refresh triggers in subscribers
    if (connected && Date.now() - this.lastReadyStatusTimestamp < HiDockDeviceService.READY_DEDUP_MS) {
      console.log('[HiDockDevice] Skipping notifyConnectionChange(true) - ready status just fired')
      return
    }
    for (const listener of this.connectionListeners) {
      try {
        listener(connected)
      } catch (e) {
        console.error('Connection listener error:', e)
      }
    }
  }

  private notifyStatusChange(status: ConnectionStatus): void {
    // FL-09: Record timestamp when 'ready' status fires for dedup with connection change
    if (status.step === 'ready') {
      this.lastReadyStatusTimestamp = Date.now()
    }
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
export type { RealtimeSettings, RealtimeData, BatteryStatus, BluetoothStatus }
