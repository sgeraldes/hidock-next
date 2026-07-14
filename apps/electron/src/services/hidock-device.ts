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
  BluetoothStatus,
  USB_VENDOR_IDS,
  USB_PRODUCT_IDS
} from './jensen'
import { validateDevicePath } from '../utils/path-validation'
import { withTimeout, isAbortError } from '../utils/timeout'
import { shouldLogQa } from './qa-monitor'

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
  /**
   * A connect attempt (auto or manual) just failed while a device was reachable —
   * drives the titlebar's honest "Connection failed — retry" pill instead of the
   * generic "Connect device". Cleared automatically by any later status update
   * (a retry, a successful connect, or a disconnect all emit a fresh status).
   */
  connectFailed?: boolean
  /** Whether an authorized HiDock was present when the failure occurred (busy hint). */
  devicePresent?: boolean
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

// Import shared activity log constant
import { MAX_ACTIVITY_LOG_ENTRIES } from '../constants/activity-log'

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
  private autoConnectEnabled: boolean = false
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

  // Fix 6: Retry backoff counters — reset on success or disconnect
  private listRecordingsFailureCount: number = 0
  private listRecordingsLastFailure: number = 0

  // Flag to prevent overlapping auto-connect attempts
  private autoConnectInProgress: boolean = false

  // Gentle re-attempt: the boot auto-connect is a single shot, so a device that is
  // present-but-busy at launch (e.g. actively recording — the moment the user most
  // needs it) would otherwise never reconnect. While auto-connect is enabled and we
  // are not connected, we re-attempt ONE clean connect on a slow timer and on USB
  // attach — never in a tight loop, and never within a minute of a prior failure.
  private reconnectTimer: number | null = null
  private lastConnectFailureAt: number = 0
  private usbAttachHandler: ((e: Event) => void) | null = null
  private usbDetachHandler: ((e: Event) => void) | null = null
  private static readonly RECONNECT_INTERVAL_MS = 3 * 60 * 1000
  private static readonly RECONNECT_FAILURE_COOLDOWN_MS = 60 * 1000

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
      if (shouldLogQa()) console.log('[HiDockDevice] Loading config from main process...')

      // Wait a small amount for electronAPI to be available (may not be ready immediately)
      let attempts = 0
      const maxAttempts = 20 // Increased to 2 seconds for slower startup
      while (!window.electronAPI?.config?.get && attempts < maxAttempts) {
        if (shouldLogQa()) console.log(`[HiDockDevice] Waiting for electronAPI... attempt ${attempts + 1}/${maxAttempts}`)
        await new Promise((resolve) => setTimeout(resolve, 100))
        attempts++
      }

      // Use Electron IPC to get config from main process
      if (window.electronAPI?.config?.get) {
        if (shouldLogQa()) console.log('[HiDockDevice] electronAPI available, fetching config...')
        const result = await window.electronAPI.config.get()
        if (shouldLogQa()) console.log('[HiDockDevice] Config result received:', result?.success)

        if (result?.success && result?.data?.device) {
          const config = result.data
          // Use explicit boolean check - undefined/null defaults to false (safe default)
          this.autoConnectConfig.enabled = config.device.autoConnect === true
          this.autoConnectConfig.connectOnStartup = config.device.autoConnect === true
          this.configLoaded = true
          if (shouldLogQa()) console.log(`[HiDockDevice] Config loaded: autoConnect = ${this.autoConnectConfig.enabled}`)
        } else if (result?.success) {
          console.warn('[HiDockDevice] Config loaded but device section missing, defaulting to disabled')
          this.configLoaded = true // Mark as loaded even without device section
        } else {
          console.warn('[HiDockDevice] Config load failed, defaulting to disabled')
          this.configLoaded = true // Mark as loaded to prevent infinite waiting
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

    // Try ONCE on startup to connect to any already-authorized device.
    this.tryConnectSilent()

    // A single boot attempt isn't enough: a device present-but-busy at launch would
    // never reconnect (no new attach event fires for an already-plugged device).
    // Arm a gentle re-attempt on a slow timer + on USB attach (both heavily guarded).
    this.startReconnectWatch()
  }

  // Initialize auto-connect on app startup
  async initAutoConnect(): Promise<void> {
    // CRITICAL: Synchronous guard BEFORE any async work
    // This prevents duplicate initialization from React StrictMode double-invoking effects
    if (this.initAutoConnectStarted) {
      if (shouldLogQa()) console.log('[HiDockDevice] initAutoConnect: Already started (sync guard), skipping')
      return
    }
    this.initAutoConnectStarted = true // Set immediately, before any await

    // Prevent duplicate initialization - check interval OR if already connected
    if (this.autoConnectInterval) {
      if (shouldLogQa()) console.log('[HiDockDevice] initAutoConnect: Already initialized, skipping')
      return
    }

    // If already connected, don't try to reconnect (handles HMR scenarios)
    if (this.state.connected) {
      if (shouldLogQa()) console.log('[HiDockDevice] initAutoConnect: Already connected, skipping')
      return
    }

    if (shouldLogQa()) console.log('[HiDockDevice] initAutoConnect: Waiting for config to load...')

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
      if (shouldLogQa()) console.log('[HiDockDevice] initAutoConnect: Config not yet loaded, waiting...')
      // Wait up to 2 seconds for config to load
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (this.configLoaded) break
      }
    }

    if (shouldLogQa()) console.log(`[HiDockDevice] initAutoConnect: Config loaded=${this.configLoaded}, enabled=${this.autoConnectConfig.enabled}, connectOnStartup=${this.autoConnectConfig.connectOnStartup}`)

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
    this.stopReconnectWatch()

    // Clean up USB connect listener to prevent memory leaks
    this.jensen.removeUsbConnectListener()
  }

  /**
   * Reset the initAutoConnect guard so it can run again after a renderer reload.
   *
   * In development mode, the "Restart" button calls webContents.reload() which
   * only reloads the renderer — the service singleton persists with
   * initAutoConnectStarted = true. App.tsx calls initAutoConnect() on mount but
   * the guard blocks it silently. Calling this during cleanup lets the next mount
   * trigger auto-connect correctly.
   *
   * Must be called from App.tsx cleanup (useEffect return).
   */
  resetInitAutoConnect(): void {
    this.initAutoConnectStarted = false
  }

  // Disable auto-connect attempts for this session (e.g. user clicked Disconnect).
  //
  // IMPORTANT: This sets SESSION STATE only. It does NOT touch config.json.
  // config.autoConnect is the USER'S PREFERENCE and is only changed by
  // setAutoConnectConfig() when the user toggles the switch.
  // On next app startup (new service instance), userInitiatedDisconnect resets
  // to false and auto-connect fires again if config.autoConnect is true.
  disableAutoConnect(): void {
    this.autoConnectEnabled = false
    this.userInitiatedDisconnect = true
    this.stopAutoConnect()
    this.logActivity('info', 'Auto-connect disabled for this session')
  }

  // Re-enable auto-connect attempts (e.g. user clicked Connect).
  //
  // IMPORTANT: SESSION STATE only. Does not touch config.json.
  enableAutoConnect(): void {
    this.autoConnectEnabled = true
    this.userInitiatedDisconnect = false
    this.logActivity('info', 'Auto-connect resumed')
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

      const authorizedDevices = await navigator.usb.getDevices()
      const authorizedHiDock = authorizedDevices.find((device) => {
        if (!USB_VENDOR_IDS.includes(device.vendorId)) {
          return false
        }

        const productName = device.productName?.toLowerCase() ?? ''
        if (productName.includes('hidock') || productName.includes('jensen')) {
          return true
        }

        return Object.values(USB_PRODUCT_IDS).includes(device.productId)
      })

      if (!authorizedHiDock) {
        this.logActivity('info', 'Auto-connect', 'No authorized device found. Click Connect to authorize.')
        return false
      }

      // BUG-005: Add 8s timeout so a non-responsive device doesn't hang auto-connect indefinitely
      const TIMEOUT_MS = 8000
      const timeoutPromise = new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), TIMEOUT_MS)
      )
      const success = await Promise.race([this.jensen.tryConnect(authorizedHiDock), timeoutPromise])

      // Note: handleConnect() is called via the onconnect callback in jensen.ts
      // We should NOT call it here to avoid duplicate initialization
      if (success) {
        this.updateStatus('opening', 'Device found, connecting...', 10)
        this.logActivity('success', 'Auto-connect', 'Device found and connected')
      } else {
        // A device is plugged in but wouldn't open — most often it's busy (e.g.
        // recording). Surface the honest failed state and arm the retry cooldown.
        this.logActivity('info', 'Auto-connect', 'Found authorized device but connection failed')
        this.markConnectFailure(true)
      }
      return success
    } finally {
      this.autoConnectInProgress = false
    }
  }

  /** Whether an authorized HiDock is currently attached (best-effort; false on error). */
  private async hasAuthorizedDevice(): Promise<boolean> {
    try {
      const devices = await navigator.usb.getDevices()
      return devices.some((device) => {
        if (!USB_VENDOR_IDS.includes(device.vendorId)) return false
        const name = device.productName?.toLowerCase() ?? ''
        if (name.includes('hidock') || name.includes('jensen')) return true
        return Object.values(USB_PRODUCT_IDS).includes(device.productId)
      })
    } catch {
      return false
    }
  }

  /**
   * Record a connect-attempt failure and light up the honest "Connection failed —
   * retry" pill. `devicePresent` gates the busy hint. Emitting a fresh status here
   * (and on any later retry/success/disconnect) is what clears the flag again.
   */
  private markConnectFailure(devicePresent: boolean): void {
    this.lastConnectFailureAt = Date.now()
    this.connectionStatus = {
      step: 'idle',
      message: devicePresent ? 'Connection failed — device may be busy' : 'Connection failed',
      connectFailed: true,
      devicePresent
    }
    this.notifyStatusChange(this.connectionStatus)
  }

  /**
   * One guarded re-attempt at reconnecting to an already-authorized device. Used by
   * the slow timer and the USB-attach handler. USB-safe: at most a single clean
   * attempt, skipped entirely when connected, disabled, mid-operation, or within the
   * failure cooldown.
   */
  private async gentleReattempt(reason: string): Promise<void> {
    if (this.state.connected) return
    if (!this.autoConnectConfig.enabled) return
    if (this.userInitiatedDisconnect) return
    if (this.autoConnectInProgress) return
    if (Date.now() - this.lastConnectFailureAt < HiDockDeviceService.RECONNECT_FAILURE_COOLDOWN_MS) return
    if (!(await this.hasAuthorizedDevice())) return

    if (shouldLogQa()) console.log(`[HiDockDevice] gentle reconnect attempt (${reason})`)
    await this.tryConnectSilent()
  }

  private startReconnectWatch(): void {
    if (this.reconnectTimer === null) {
      this.reconnectTimer = setInterval(() => {
        void this.gentleReattempt('timer')
      }, HiDockDeviceService.RECONNECT_INTERVAL_MS) as unknown as number
    }
    if (!this.usbAttachHandler && typeof navigator !== 'undefined' && navigator.usb?.addEventListener) {
      this.usbAttachHandler = () => {
        void this.gentleReattempt('usb-attach')
      }
      this.usbDetachHandler = () => {
        // Device unplugged: clear a stale "failed" pill so it reverts to the neutral
        // "Connect device" state (nothing to retry until it's plugged back in).
        if (!this.state.connected && this.connectionStatus.connectFailed) {
          this.updateStatus('idle', 'Device disconnected')
        }
      }
      navigator.usb.addEventListener('connect', this.usbAttachHandler)
      navigator.usb.addEventListener('disconnect', this.usbDetachHandler)
    }
  }

  private stopReconnectWatch(): void {
    if (this.reconnectTimer !== null) {
      clearInterval(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (typeof navigator !== 'undefined' && navigator.usb?.removeEventListener) {
      if (this.usbAttachHandler) navigator.usb.removeEventListener('connect', this.usbAttachHandler)
      if (this.usbDetachHandler) navigator.usb.removeEventListener('disconnect', this.usbDetachHandler)
    }
    this.usbAttachHandler = null
    this.usbDetachHandler = null
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
      // A genuine connect failure (timeout or error) — mark it so the titlebar shows
      // the honest "Connection failed — retry" pill (with a busy hint if a device is
      // attached), rather than silently reverting to "Connect device".
      const devicePresent = await this.hasAuthorizedDevice()
      if (isAbortError(error)) {
        this.logActivity('error', 'Connection timeout', 'Device did not respond within 5 seconds')
        console.error('[HiDockDevice] Connection timeout:', error)
      } else {
        this.logActivity('error', 'Connection failed', error instanceof Error ? error.message : 'Unknown error')
        console.error('[HiDockDevice] Connection error:', error)
      }
      this.markConnectFailure(devicePresent)
      return false
    }
  }

  // Disconnect from device.
  // Always calls disableAutoConnect() which sets session state only —
  // it no longer writes to config.json, so auto-connect setting is always preserved.
  async disconnect(): Promise<void> {
    this.logActivity('info', 'Disconnecting')
    // Abort any running initialization immediately
    this.initAborted = true
    // Sets session state (userInitiatedDisconnect=true). Does NOT touch config.json.
    this.disableAutoConnect()
    await this.jensen.disconnect()
  }

  // Reset device USB connection (for recovery from stuck state).
  // A "reset" is a clean disconnect + reconnect. The old path used the libusb
  // device.reset(), which RE-ENUMERATES the device on Windows and leaves it
  // locked (LIBUSB_ERROR_ACCESS / NOT_FOUND). The reliable recovery is to fully
  // release the handle (disconnect → reset+close internally) and re-acquire it.
  async resetDevice(): Promise<boolean> {
    this.logActivity('info', 'Resetting USB connection...')
    try {
      await this.disconnect()
      // Brief settle so the OS fully releases the handle before re-acquiring.
      await new Promise(resolve => setTimeout(resolve, 300))
      const success = await this.connect()
      this.logActivity(
        success ? 'success' : 'error',
        success ? 'Device reset complete' : 'Reset failed to reconnect'
      )
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
    // Add listener to the set first
    this.activityListeners.add(listener)

    // Replay historical logs to the new listener
    // Use snapshot to prevent concurrent modification during iteration
    const logsSnapshot = [...this.activityLog]

    for (const entry of logsSnapshot) {
      try {
        listener(entry)
      } catch (e) {
        console.error('Activity listener error during replay:', e)
      }
    }

    // Return unsubscribe function
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
    if (this.activityLog.length > MAX_ACTIVITY_LOG_ENTRIES) {
      this.activityLog = this.activityLog.slice(-MAX_ACTIVITY_LOG_ENTRIES)
    }

    // Notify listeners - log count for debugging
    const listenerCount = this.activityListeners.size
    if (shouldLogQa()) {
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
    if (shouldLogQa()) console.log('[HiDockDevice] >>> listRecordings ENTRY, connected:', this.isConnected(), 'initialized:', this.initializationComplete, 'forceRefresh:', forceRefresh)
    if (!this.isConnected()) {
      if (shouldLogQa()) console.log('[HiDockDevice] >>> listRecordings: NOT CONNECTED, returning []')
      this.logActivity('error', 'Cannot list files', 'Device not connected')
      return []
    }

    // FL-02: Debounce — if called within 2s of a previous successful completion,
    // return cached data (prevents triple-fire on device connection/ready/poll)
    if (!forceRefresh && this.cachedRecordings !== null) {
      const timeSinceLast = Date.now() - this.listRecordingsLastCompleted
      if (timeSinceLast < HiDockDeviceService.LIST_RECORDINGS_DEBOUNCE_MS) {
        if (shouldLogQa()) console.log(`[HiDockDevice] >>> listRecordings: DEBOUNCED (${timeSinceLast}ms since last), returning cached`)
        onProgress?.(this.cachedRecordings.length, this.cachedRecordings.length)
        return this.cachedRecordings
      }
    }

    // Fix 6: Retry backoff after repeated failures — prevents hammering a broken device
    if (!forceRefresh && this.listRecordingsFailureCount > 0) {
      const timeSinceFailure = Date.now() - this.listRecordingsLastFailure

      // After 5+ failures, stop auto-retrying entirely until user forces refresh
      if (this.listRecordingsFailureCount >= 5) {
        if (shouldLogQa()) console.log('[HiDockDevice] listRecordings: backoff - 5+ failures, stopped auto-retry')
        this.logActivity('error', 'File listing failed repeatedly', 'Please disconnect and reconnect your device')
        return this.cachedRecordings ?? []
      }

      // After 3+ failures use 60s delay, otherwise 10s delay
      const backoffMs = this.listRecordingsFailureCount >= 3 ? 60_000 : 10_000
      if (timeSinceFailure < backoffMs) {
        if (shouldLogQa()) console.log(`[HiDockDevice] listRecordings: backoff - ${this.listRecordingsFailureCount} failures, waiting ${backoffMs / 1000}s`)
        return this.cachedRecordings ?? []
      }
    }

    // FL-01/FL-08: forceRefresh must wait for existing operation to complete,
    // then start a new one — never run concurrently
    if (forceRefresh && (this.listRecordingsLock || this.listRecordingsPromise)) {
      if (shouldLogQa()) console.log('[HiDockDevice] >>> listRecordings: forceRefresh waiting for existing operation to complete')
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
        if (shouldLogQa()) console.log('[HiDockDevice] >>> listRecordings: listFiles lock held, waiting for in-flight promise')
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
        if (shouldLogQa()) console.log('[HiDockDevice] >>> listRecordings: download in progress, returning cached')
        if (this.cachedRecordings !== null) {
          onProgress?.(this.cachedRecordings.length, this.cachedRecordings.length)
          return this.cachedRecordings
        }
        this.logActivity('info', 'Skipped file list', 'Download in progress')
        return []
      }
      // Case 3: Delete in progress - protect it
      if (lockHolder.startsWith('deleteFile:')) {
        if (shouldLogQa()) console.log('[HiDockDevice] >>> listRecordings: delete in progress, returning cached')
        if (this.cachedRecordings !== null) {
          onProgress?.(this.cachedRecordings.length, this.cachedRecordings.length)
          return this.cachedRecordings
        }
        return []
      }
      // Case 4: Init commands (short-lived) - fall through to init-wait guard
      if (shouldLogQa()) console.log(`[HiDockDevice] >>> listRecordings: init lock '${lockHolder}' held, falling through to init wait`)
    }

    // Wait for initialization to complete before listing files
    // This ensures recordingCount is populated for accurate progress reporting
    if (!this.initializationComplete) {
      if (shouldLogQa()) console.log('[HiDockDevice] >>> listRecordings: WAITING FOR INIT')
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

    // Check cache — if recording count hasn't changed, ALWAYS return cache (even with forceRefresh).
    // The only reason to re-scan USB is if the device has NEW recordings (count changed).
    // forceRefresh only bypasses the time-based debounce, not the count-based cache.
    const cacheValid =
      this.cachedRecordings !== null &&
      this.cachedRecordingCount === expectedFileCount &&
      expectedFileCount > 0

    if (cacheValid) {
      if (shouldLogQa()) console.log(`[HiDockDevice] >>> listRecordings: CACHE HIT (count unchanged at ${expectedFileCount}), returning ${this.cachedRecordings!.length} files`)
      onProgress?.(expectedFileCount, expectedFileCount)
      return this.cachedRecordings!
    }
    if (shouldLogQa()) console.log(`[HiDockDevice] >>> listRecordings: CACHE MISS (cached=${this.cachedRecordingCount}, device=${expectedFileCount}), scanning device`)

    // Prevent concurrent requests - use synchronous lock to prevent TOCTOU race
    // Check both the lock flag (set synchronously) and promise (set after lock)
    if ((this.listRecordingsLock || this.listRecordingsPromise) && !forceRefresh) {
      if (shouldLogQa()) console.log('[HiDockDevice] listRecordings: Request already in progress, waiting...')
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

    // User-visible scan start entry in Activity Log
    this.logActivity('info', 'Scanning device files...', `Requesting file list (${expectedFileCount} total on device)`)

    // Only log to console (DEBUG), not activity log - cache invalidation is internal detail
    if (!forceRefresh && this.cachedRecordings !== null && shouldLogQa()) {
      console.log(`[HiDockDevice] Cache invalid: cached=${this.cachedRecordingCount}, device=${expectedFileCount}`)
    }

    this.logActivity('usb-out', 'CMD: List Files', `Requesting list of ${expectedFileCount} total files on device`)
    if (shouldLogQa()) console.log('[HiDockDevice] >>> listRecordings: CALLING JENSEN.LISTFILES(), expected:', expectedFileCount)

    // BUG-002: Update connection status so UI shows scan progress instead of frozen "ready"
    this.updateStatus('counting-files', `Scanning files (0/${expectedFileCount})...`, 0)

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
    let lastStatusUpdateProgress = -1
    const animationInterval = setInterval(() => {
      if (animationCancelled) return
      const elapsed = Date.now() - animationStartTime
      const t = Math.min(1, elapsed / estimatedTimeMs)
      const easeOut = 1 - Math.pow(1 - t, 3)
      animationProgress = Math.floor(easeOut * expectedFileCount)
      onProgress?.(animationProgress, expectedFileCount)
      const pct = expectedFileCount > 0 ? Math.round((animationProgress / expectedFileCount) * 100) : 0
      if (pct !== lastStatusUpdateProgress && pct % 5 === 0) {
        lastStatusUpdateProgress = pct
        this.updateStatus('counting-files', `Scanning files (${animationProgress}/${expectedFileCount})...`, pct)
      }
    }, 50)

    // Create and store the promise for concurrent request handling
    this.listRecordingsPromise = (async () => {
      try {
        const files = await this.jensen.listFiles((filesFound, expectedFiles) => {
          if (filesFound > animationProgress) {
            animationCancelled = true
            clearInterval(animationInterval)
            onProgress?.(filesFound, expectedFiles)
            const pct = expectedFiles > 0 ? Math.round((filesFound / expectedFiles) * 100) : 0
            this.updateStatus('counting-files', `Scanning files (${filesFound}/${expectedFiles})...`, pct)
          }
        }, expectedFileCount)

        // Ensure animation is stopped
        animationCancelled = true
        clearInterval(animationInterval)

        // Fix 1: Guard against null response (disconnect, timeout, decode error).
        // Do NOT poison the cache or report an empty device — return whatever we
        // already have so the UI keeps its existing list.
        if (!files) {
          this.logActivity('error', 'Device returned no file data', 'Received null response from listFiles — device may have disconnected')
          return this.cachedRecordings ?? []
        }

        // An empty result while the device reports recordings means the scan was
        // INTERRUPTED (disconnect / cancel / stall mid-stream), not an empty device.
        // Treat it as a failed scan: keep the cache untouched and do not log
        // "storage empty" — otherwise the poisoned cache (count==expected, list==[])
        // would make every subsequent call a "cache hit" returning 0 files forever.
        if (files.length === 0 && expectedFileCount > 0) {
          this.logActivity(
            'error',
            'File scan interrupted',
            `Device reports ${expectedFileCount} recording${expectedFileCount === 1 ? '' : 's'} but the scan returned none — keeping existing list (likely disconnected mid-scan)`
          )
          // Count as a failure so the backoff/retry logic re-scans rather than
          // trusting this empty result.
          this.listRecordingsFailureCount++
          this.listRecordingsLastFailure = Date.now()
          return this.cachedRecordings ?? []
        }

        if (shouldLogQa()) console.log(`[HiDockDevice] listRecordings: Received ${files.length} files`)
        this.logActivity('usb-in', 'File List Received', `${files.length} files found`)
        // User-facing result entry
        if (files.length === 0) {
          this.logActivity('info', 'No recordings on device', 'Device storage is empty')
        } else {
          this.logActivity('success', `Found ${files.length} recording${files.length === 1 ? '' : 's'} on device`)
        }

        const recordings = files.map((f) => this.fileInfoToRecording(f))

        // Update cache
        this.cachedRecordings = recordings
        this.cachedRecordingCount = expectedFileCount

        // Fix 6: Reset failure counters on success
        this.listRecordingsFailureCount = 0
        this.listRecordingsLastFailure = 0

        // Fix 6: Only stamp debounce timestamp on success (was in finally — prevented failures
        // from triggering a fresh retry immediately after the backoff window expired)
        this.listRecordingsLastCompleted = Date.now()

        return recordings
      } catch (error) {
        animationCancelled = true
        clearInterval(animationInterval)
        console.error('[HiDockDevice] listRecordings error:', error)
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        const cachedCount = this.cachedRecordings?.length ?? 0
        this.logActivity('error', 'Failed to list files', `${errorMsg} (returned ${cachedCount} cached files)`)

        // Fix 6: Track failure for backoff
        this.listRecordingsFailureCount++
        this.listRecordingsLastFailure = Date.now()

        return this.cachedRecordings ?? []
      } finally {
        if (this.state.connected && this.connectionStatus.step === 'counting-files') {
          this.updateStatus('ready', 'Device ready', 100)
        }
        this.listRecordingsLock = false
        this.listRecordingsPromise = null
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
      if (shouldLogQa()) console.log(`[HiDockDevice] Cancelling download: ${filename}`)
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
      if (shouldLogQa()) console.log(`[HiDockDevice] Cancelling download: ${filename}`)
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
    if (shouldLogQa()) console.log('[HiDockDevice] handleConnect called')
    this.initAborted = false // Reset abort flag on new connection
    this.state.connected = true
    this.state.model = this.jensen.getModel()
    this.notifyStateChange()

    this.logActivity('success', 'USB device connected', `Model: ${this.state.model}`)
    if (shouldLogQa()) console.log(`[HiDockDevice] Connected to ${this.state.model}`)

    const INIT_STEP_TIMEOUT = 15000
    const FIRST_CMD_TIMEOUT = 5000
    let timeoutCount = 0
    let successCount = 0
    const MAX_TIMEOUTS_BEFORE_FAIL = 2

    const controller = new AbortController()

    // Step 1: Get device info — use short timeout + retry.
    // After USB setup (selectConfiguration, claimInterface, clearHalt), the device
    // firmware may need extra stabilization time. A quick 5s probe + retry handles
    // this without making the user wait 15s on a truly unresponsive device.
    if (this.initAborted) return
    this.updateStatus('getting-info', 'Reading device information...', 20)
    let deviceInfo: DeviceInfo | null = null
    try {
      deviceInfo = await withTimeout(this.refreshDeviceInfo(), FIRST_CMD_TIMEOUT, new AbortController())
      if (deviceInfo) successCount++
    } catch (firstError) {
      if (isAbortError(firstError) && !this.initAborted) {
        this.logActivity('info', 'Device not ready', 'Retrying...')
        this.updateStatus('getting-info', 'Device initializing, retrying...', 20)
        await new Promise(r => setTimeout(r, 500))

        if (!this.initAborted) {
          try {
            deviceInfo = await withTimeout(this.refreshDeviceInfo(), INIT_STEP_TIMEOUT, new AbortController())
            if (deviceInfo) successCount++
          } catch (retryError) {
            if (isAbortError(retryError)) timeoutCount++
            console.warn('[HiDockDevice] Failed to get device info (retry):', retryError)
            this.logActivity('error', 'Failed to get device info', retryError instanceof Error ? retryError.message : 'Unknown error')
            this.logActivity('warning', 'Device may be unresponsive', 'Try disconnecting and reconnecting your device')
          }
        }
      } else {
        if (isAbortError(firstError)) timeoutCount++
        console.warn('[HiDockDevice] Failed to get device info:', firstError)
        this.logActivity('error', 'Failed to get device info', firstError instanceof Error ? firstError.message : 'Unknown error')
      }
    }

    // Device info is the one non-negotiable init step: without it we have no serial
    // number, model or firmware, and every later command is unreliable. If it failed
    // — a timeout OR a null response from a desynced device — FAIL THE CONNECT
    // CLEANLY. Never sit in a half-connected "unknown / SN null" state: besides being
    // dishonest, the USB handle stays open, so the next tryConnect short-circuits on
    // "already connected" (isConnected() is true) and never re-initializes. Closing
    // the handle here forces the next attempt to do a fresh open + setup, which — now
    // that command serialization prevents the init desync — succeeds.
    if (deviceInfo === null || timeoutCount >= MAX_TIMEOUTS_BEFORE_FAIL) {
      this.logActivity('error', 'Device initialization failed', 'Could not read device info — reconnecting cleanly.')
      this.initializationComplete = false
      this.state.connected = false
      this.state.serialNumber = null
      this.state.firmwareVersion = null
      this.state.storage = null
      this.state.settings = null
      this.notifyStateChange()
      try {
        await this.jensen.disconnect()
      } catch {
        /* best effort — device may already be gone */
      }
      this.markConnectFailure(true)
      this.notifyConnectionChange(false)
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
      // Try USB reset before giving up — device firmware may need a hard reset after first open
      this.logActivity('warning', 'Device not responding — attempting USB reset...')
      this.updateStatus('getting-info', 'Resetting device...', 10)
      let resetAndReconnected = false
      try {
        const resetOk = await this.jensen.reset()
        if (resetOk && !this.initAborted) {
          this.logActivity('info', 'USB reset successful, retrying connection...')
          await this.jensen.disconnect()
          await new Promise(r => setTimeout(r, 1000))
          if (!this.initAborted) {
            const reconnected = await this.jensen.tryConnect()
            if (reconnected) {
              // handleConnect will be called via the onconnect callback — return cleanly
              resetAndReconnected = true
            }
          }
        }
      } catch (resetError) {
        console.warn('[HiDockDevice] USB reset failed:', resetError)
      }

      if (resetAndReconnected) {
        return
      }

      // Reset failed or reconnect failed — disconnect cleanly so user isn't stuck in limbo
      this.logActivity('error', 'Device initialization failed', 'Could not communicate with device after USB reset. Please unplug and reconnect your device.')
      this.updateStatus('error', 'Device not responding — please reconnect', 0)
      this.initializationComplete = false
      this.state.connected = false
      this.state.serialNumber = null
      this.state.firmwareVersion = null
      this.state.storage = null
      this.state.settings = null
      this.notifyStateChange()
      this.notifyConnectionChange(false)
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

    // Fix 6: Reset retry backoff on disconnect so reconnect starts fresh
    this.listRecordingsFailureCount = 0
    this.listRecordingsLastFailure = 0

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
      if (shouldLogQa()) console.log('[HiDockDevice] Skipping notifyConnectionChange(true) - ready status just fired')
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
