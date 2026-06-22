/**
 * JensenIpcClient — renderer-side façade for the Jensen device.
 *
 * Instead of talking to WebUSB directly, every method delegates to the
 * main-process singleton via `window.electronAPI.jensen.*`.  This file is
 * intentionally thin: it owns no device state — the main process does.
 *
 * Design notes:
 *  - `onconnect` / `ondisconnect`: stored as settable properties; the
 *    constructor subscribes to the corresponding preload push events and
 *    invokes the assigned callbacks.
 *  - `downloadFile`: reassembles the batched chunks streamed over IPC into
 *    the same `(onChunk, onProgress)` callback contract the package's
 *    JensenDevice uses.  The main process handles abort via `cancelDownload`.
 *  - `isOperationInProgress` / `getLockHolder`: return safe defaults — the
 *    main process serialises operations; the renderer does not need to gate.
 *  - `setupUsbConnectListener` / `removeUsbConnectListener`: no-ops; the main
 *    process owns the USB lifecycle.
 *  - `tryConnect(preAuthorizedDevice?)`: the IPC surface does not accept a
 *    USBDevice arg — the main process manages its own device selection.
 */

import type {
  DeviceModel,
  DeviceInfo,
  FileInfo,
  CardInfo,
  DeviceSettings,
  RealtimeSettings,
  RealtimeData,
  BatteryStatus,
  BluetoothStatus,
} from '@hidock/jensen-protocol'

// ---------------------------------------------------------------------------
// Minimal type for the IPC-pushed connection state
// ---------------------------------------------------------------------------

interface JensenIpcState {
  connected: boolean
  model: string | null
  serialNumber: string | null
  versionCode: string | null
  versionNumber: number | null
}

// ---------------------------------------------------------------------------
// JensenIpcClient
// ---------------------------------------------------------------------------

export class JensenIpcClient {
  // Public properties that hidock-device.ts reads directly
  serialNumber: string | null = null
  versionCode: string | null = null
  versionNumber: number | null = null

  // Settable callbacks — wired up by hidock-device.ts constructor
  onconnect: (() => void) | null = null
  ondisconnect: (() => void) | null = null

  // Local cache of the connection state pushed from main process
  private _connected: boolean = false
  private _model: string | null = null

  // Cleanup functions returned by the preload event subscriptions
  private _cleanupConnect: (() => void) | null = null
  private _cleanupDisconnect: (() => void) | null = null
  private _cleanupState: (() => void) | null = null

  constructor() {
    this._subscribeToEvents()
  }

  // -------------------------------------------------------------------------
  // Event subscriptions (preload push events → local state + user callbacks)
  // -------------------------------------------------------------------------

  private _subscribeToEvents(): void {
    if (typeof window === 'undefined' || !window.electronAPI?.jensen) return

    // State changes (connected, model, serialNumber, …)
    this._cleanupState = window.electronAPI.jensen.onStateChanged((state: JensenIpcState) => {
      this._connected = state.connected
      this._model = state.model
      this.serialNumber = state.serialNumber
      this.versionCode = state.versionCode
      this.versionNumber = state.versionNumber
    })

    // Connect event → fire onconnect callback
    this._cleanupConnect = window.electronAPI.jensen.onConnect(() => {
      this.onconnect?.()
    })

    // Disconnect event → fire ondisconnect callback
    this._cleanupDisconnect = window.electronAPI.jensen.onDisconnect(() => {
      this.ondisconnect?.()
    })
  }

  /** Release all preload event listeners. Call when tearing down the client. */
  destroy(): void {
    this._cleanupState?.()
    this._cleanupConnect?.()
    this._cleanupDisconnect?.()
  }

  // -------------------------------------------------------------------------
  // Core device operations
  // -------------------------------------------------------------------------

  async connect(_signal?: AbortSignal): Promise<boolean> {
    const result = await window.electronAPI.jensen.connect()
    const ok = result ?? false
    // Update the cache immediately; a jensen:state-changed broadcast will follow.
    if (ok) this._connected = true
    return ok
  }

  async tryConnect(_preAuthorizedDevice?: USBDevice): Promise<boolean> {
    // Note: the IPC surface does not accept a pre-authorized USBDevice argument.
    // The main process manages its own device selection; we simply delegate.
    const result = await window.electronAPI.jensen.tryConnect()
    const ok = result ?? false
    if (ok) this._connected = true
    return ok
  }

  async disconnect(): Promise<void> {
    await window.electronAPI.jensen.disconnect()
    this._connected = false
  }

  async reset(): Promise<boolean> {
    const result = await window.electronAPI.jensen.reset()
    return result ?? false
  }

  isConnected(): boolean {
    return this._connected
  }

  getModel(): DeviceModel {
    return (this._model as DeviceModel) ?? ('unknown' as DeviceModel)
  }

  isP1Device(): boolean {
    const model = this.getModel() as string
    return model === 'hidock-p1' || model === 'hidock-p1-mini'
  }

  // -------------------------------------------------------------------------
  // Device info & settings
  // -------------------------------------------------------------------------

  async getDeviceInfo(): Promise<DeviceInfo | null> {
    return window.electronAPI.jensen.getDeviceInfo()
  }

  async getCardInfo(): Promise<CardInfo | null> {
    return window.electronAPI.jensen.getCardInfo()
  }

  async getFileCount(): Promise<{ count: number } | null> {
    return window.electronAPI.jensen.getFileCount()
  }

  async getSettings(): Promise<DeviceSettings | null> {
    return window.electronAPI.jensen.getSettings()
  }

  async setTime(_date: Date): Promise<{ result: string } | null> {
    // The IPC handler uses the main-process clock, ignoring the renderer-supplied date.
    return window.electronAPI.jensen.setTime()
  }

  async setAutoRecord(enabled: boolean): Promise<{ result: string } | null> {
    return window.electronAPI.jensen.setAutoRecord(enabled)
  }

  // -------------------------------------------------------------------------
  // File operations
  // -------------------------------------------------------------------------

  async listFiles(
    onProgress?: (filesFound: number, expectedFiles: number) => void
  ): Promise<FileInfo[] | null> {
    // Wire up scan-progress events for the duration of this call
    let cleanup: (() => void) | null = null

    if (onProgress && window.electronAPI?.jensen?.onScanProgress) {
      cleanup = window.electronAPI.jensen.onScanProgress(
        (data: { current: number; total: number }) => {
          onProgress(data.current, data.total)
        }
      )
    }

    try {
      const result = await window.electronAPI.jensen.listFiles()
      return result ?? null
    } finally {
      cleanup?.()
    }
  }

  /**
   * Download a file from the device.
   *
   * The main process streams data as `jensen:download-chunk` events (batched)
   * and `jensen:download-progress` events.  This method reassembles the stream
   * and presents the same `(onChunk, onProgress)` callback contract as the
   * package's `JensenDevice.downloadFile`.
   *
   * Abort: we call `cancelDownload` on the IPC surface; the main process then
   * aborts the underlying USB transfer.
   */
  async downloadFile(
    filename: string,
    fileSize: number,
    onChunk: (data: Uint8Array) => void,
    onProgress?: (received: number) => void,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (signal?.aborted) return false

    // Subscribe to chunk and progress push events before starting the download
    let cleanupChunk: (() => void) | null = null
    let cleanupProgress: (() => void) | null = null

    cleanupChunk = window.electronAPI.jensen.onDownloadChunk(
      (data: { filename: string; data: Uint8Array }) => {
        if (data.filename === filename) {
          onChunk(new Uint8Array(data.data))
        }
      }
    )

    if (onProgress) {
      cleanupProgress = window.electronAPI.jensen.onDownloadProgress(
        (data: { filename: string; bytesReceived: number; totalBytes: number }) => {
          if (data.filename === filename) {
            onProgress(data.bytesReceived)
          }
        }
      )
    }

    // Handle abort by cancelling the IPC-side download
    let abortCleanup: (() => void) | null = null
    if (signal) {
      const abortHandler = (): void => {
        window.electronAPI.jensen.cancelDownload()
      }
      signal.addEventListener('abort', abortHandler, { once: true })
      abortCleanup = () => signal.removeEventListener('abort', abortHandler)
    }

    try {
      const result = await window.electronAPI.jensen.downloadFile(filename, fileSize)
      return result ?? false
    } finally {
      cleanupChunk?.()
      cleanupProgress?.()
      abortCleanup?.()
    }
  }

  async deleteFile(filename: string): Promise<{ result: string } | null> {
    return window.electronAPI.jensen.deleteFile(filename)
  }

  async formatCard(): Promise<{ result: string } | null> {
    return window.electronAPI.jensen.formatCard()
  }

  // -------------------------------------------------------------------------
  // Realtime streaming
  // -------------------------------------------------------------------------

  async getRealtimeSettings(): Promise<RealtimeSettings | null> {
    return window.electronAPI.jensen.getRealtimeSettings()
  }

  async startRealtime(): Promise<{ result: string } | null> {
    return window.electronAPI.jensen.startRealtime()
  }

  async pauseRealtime(): Promise<{ result: string } | null> {
    return window.electronAPI.jensen.pauseRealtime()
  }

  async stopRealtime(): Promise<{ result: string } | null> {
    return window.electronAPI.jensen.stopRealtime()
  }

  async getRealtimeData(offset: number): Promise<RealtimeData | null> {
    return window.electronAPI.jensen.getRealtimeData(offset)
  }

  // -------------------------------------------------------------------------
  // Battery & Bluetooth
  // -------------------------------------------------------------------------

  async getBatteryStatus(): Promise<BatteryStatus | null> {
    return window.electronAPI.jensen.getBatteryStatus()
  }

  async startBluetoothScan(duration?: number): Promise<{ result: string } | null> {
    return window.electronAPI.jensen.startBluetoothScan(duration)
  }

  async stopBluetoothScan(): Promise<{ result: string } | null> {
    return window.electronAPI.jensen.stopBluetoothScan()
  }

  async getBluetoothStatus(): Promise<BluetoothStatus | null> {
    return window.electronAPI.jensen.getBluetoothStatus()
  }

  // -------------------------------------------------------------------------
  // Lock state (used by hidock-device.ts to gate concurrent operations)
  //
  // The main process owns the USB lock; the renderer cannot observe it
  // synchronously.  We return safe defaults so the service does not block
  // itself.  The main process already serialises all device commands.
  // -------------------------------------------------------------------------

  isOperationInProgress(): boolean {
    // Safe default: report no operation in progress from the renderer's POV.
    // The main-process command queue handles real serialisation.
    return false
  }

  getLockHolder(): string | null {
    // Safe default: no lock seen from the renderer.
    return null
  }

  // -------------------------------------------------------------------------
  // USB connect listener management
  //
  // In the IPC architecture the main process owns the USB event loop.
  // These are no-ops from the renderer's perspective.
  // -------------------------------------------------------------------------

  setupUsbConnectListener(): void {
    // No-op: the main process handles USB connect events internally.
  }

  removeUsbConnectListener(): void {
    // No-op: the main process handles USB connect events internally.
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let ipcClientInstance: JensenIpcClient | null = null

export function getJensenIpcClient(): JensenIpcClient {
  if (!ipcClientInstance) {
    ipcClientInstance = new JensenIpcClient()
  }
  return ipcClientInstance
}
