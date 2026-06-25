/**
 * DevicePipelineService — the single main-process coordinator for all USB
 * device activity (Slice 3 of the USB Device Pipeline refactor).
 *
 * Design: docs/superpowers/specs/2026-03-26-usb-device-pipeline-design.md
 * Rationale: .claude/architecture-decisions/ADR-0005-device-actions-flow-through-coordinators.md
 *
 * Responsibilities (per spec §"DevicePipelineService"):
 *  - Owns ONE JensenDevice (the existing main-process singleton) and the existing
 *    DownloadService — it never creates a second JensenDevice (USB contention) or
 *    a second download queue.
 *  - Runs the strictly-linear phase machine on connect:
 *      CONNECT → INIT → SCAN → RECONCILE → DOWNLOAD → IDLE
 *  - SCAN is skipped when the device file count is unchanged from cache.
 *  - DOWNLOAD is SCOPED to the requested file set — it never blanket-drains the
 *    whole pending queue (kills the "download one → downloads all" defect).
 *  - After a file downloads, post-processing (transcription) is left to the
 *    Slice-2 single funnel: the RecordingWatcher detecting the saved file calls
 *    `queueTranscriptionIfEnabled`. This service NEVER re-implements the
 *    auto-transcribe gate; it only invokes the existing funnel (gated inside).
 *  - Auto-connect: the USB plug listener is ALWAYS registered and re-reads
 *    `config.device.autoConnect` INSIDE the handler at event time, so toggling
 *    the preference takes effect live (spec §"Auto-Connect Flow"; ADR-0005 C).
 *
 * ⚠ ADDITIVE-ONLY (Slice 3). This service is built and unit-tested but NOT yet
 * wired into index.ts and registers NO IPC handlers — the cutover to it as the
 * sole initiator happens in Slices 4-6. It exposes an EventEmitter so a later
 * slice can bridge `device-pipeline:*` IPC without touching this file.
 *
 * Dependencies are injected via the constructor (with real-singleton defaults)
 * purely so the unit tests can drive the phase machine with mocks and NEVER
 * touch real USB hardware (CLAUDE.md device-safety rules).
 */

import { EventEmitter } from 'events'
import type { DeviceModel, FileInfo } from '@hidock/jensen-protocol'

// ---------------------------------------------------------------------------
// Phase machine
// ---------------------------------------------------------------------------

export type PipelinePhase =
  | 'disconnected'
  | 'connecting'
  | 'initializing'
  | 'scanning'
  | 'reconciling'
  | 'downloading'
  | 'idle'
  | 'error'

export interface PipelineDeviceState {
  model: DeviceModel
  serialNumber: string | null
  firmwareVersion: string | null
  storage: { used: number; capacity: number; freePercent: number } | null
  settings: { autoRecord: boolean } | null
  recordingCount: number
}

export interface PipelineDownloadProgress {
  filename: string
  current: number
  total: number
  bytesDownloaded: number
  totalBytes: number
  eta: number | null
}

export interface PipelineState {
  phase: PipelinePhase
  device: PipelineDeviceState | null
  scanProgress: { current: number; total: number } | null
  downloadProgress: PipelineDownloadProgress | null
  error: string | null
}

/** A file selected for download — the scoped unit the pipeline operates on. */
export interface DownloadItem {
  filename: string
  size: number
  duration?: number
  dateCreated?: Date
}

// ---------------------------------------------------------------------------
// Injected collaborator shapes (structural — keeps the unit tests pure)
//
// These intentionally describe ONLY the members the pipeline touches, so a
// hand-rolled mock satisfies them without re-implementing the whole class.
// ---------------------------------------------------------------------------

export interface PipelineJensen {
  connect(signal?: AbortSignal): Promise<boolean>
  tryConnect(preAuthorizedDevice?: unknown): Promise<boolean>
  disconnect(): Promise<void>
  reset(): Promise<boolean>
  isConnected(): boolean
  getModel(): DeviceModel
  getDeviceInfo(): Promise<{ serialNumber: string; versionCode: string; versionNumber: number } | null>
  getCardInfo(): Promise<{ used: number; capacity: number; free: number } | null>
  getFileCount(): Promise<{ count: number } | null>
  getSettings(): Promise<{ autoRecord: boolean } | null>
  setTime(date: Date): Promise<{ result: string } | null>
  setAutoRecord(enabled: boolean): Promise<{ result: string } | null>
  listFiles(
    onProgress?: (found: number, expected: number) => void,
    expectedCount?: number,
    onNewFiles?: (files: FileInfo[]) => void
  ): Promise<FileInfo[] | null>
  downloadFile(
    filename: string,
    size: number,
    onChunk: (data: Uint8Array) => void,
    onProgress?: (received: number) => void,
    signal?: AbortSignal
  ): Promise<boolean>
  deleteFile(filename: string): Promise<{ result: string } | null>
  formatCard(): Promise<{ result: string } | null>
  serialNumber: string | null
  versionCode: string | null
  onconnect?: () => void
  ondisconnect?: () => void
}

export interface PipelineDownloadService {
  getFilesToSync(
    deviceFiles: Array<{ filename: string; size: number; duration: number; dateCreated: Date }>
  ): Array<{ filename: string; size: number; duration: number; dateCreated: Date; skipReason?: string }>
  processDownload(
    filename: string,
    data: Buffer
  ): Promise<{ success: boolean; filePath?: string; error?: string }>
  cancelActiveDownloads(reason?: string): number
}

/** Minimal WebUSB-like event target for the hot-plug listeners. */
export interface PipelineUsbEvents {
  addEventListener(type: 'connect' | 'disconnect', listener: (event: { device: unknown }) => void): void
  removeEventListener(type: 'connect' | 'disconnect', listener: (event: { device: unknown }) => void): void
  getDevices(): Promise<unknown[]>
}

export interface DevicePipelineOptions {
  /** Reads the persisted config; used at ACTION TIME for the auto-connect gate. */
  getConfig?: () => { device?: { autoConnect?: boolean } }
  /** Slice-2 single transcription funnel (gate is INSIDE this fn — never duplicated). */
  queueTranscriptionIfEnabled?: (recordingId: string) => boolean
  /** Resolves a recording id from a saved filename (for the funnel call). */
  getRecordingByFilename?: (filename: string) => { id: string } | null | undefined
  /** WebUSB-like event source for hot-plug auto-connect; optional in tests. */
  usbEvents?: PipelineUsbEvents
  /** Predicate identifying a HiDock device from a plug event (default: accept all). */
  isHiDockDevice?: (device: unknown) => boolean
}

const INITIAL_STATE: PipelineState = {
  phase: 'disconnected',
  device: null,
  scanProgress: null,
  downloadProgress: null,
  error: null
}

export class DevicePipelineService extends EventEmitter {
  private jensen: PipelineJensen
  private downloadService: PipelineDownloadService
  private opts: DevicePipelineOptions

  private state: PipelineState = { ...INITIAL_STATE }

  private cachedFiles: FileInfo[] | null = null
  private cachedFileCount = -1

  private abortController: AbortController | null = null
  private autoConnectListenersBound = false
  private connectHandler: ((event: { device: unknown }) => void) | null = null
  private disconnectHandler: ((event: { device: unknown }) => void) | null = null

  constructor(
    jensen: PipelineJensen,
    downloadService: PipelineDownloadService,
    options: DevicePipelineOptions = {}
  ) {
    super()
    this.jensen = jensen
    this.downloadService = downloadService
    this.opts = options
  }

  // ==========================================================================
  // State + emitter (NOT wired to ipcMain yet — Slice 4 bridges this)
  // ==========================================================================

  getState(): PipelineState {
    return this.state
  }

  getFiles(): FileInfo[] {
    return this.cachedFiles ?? []
  }

  private setPhase(phase: PipelinePhase): void {
    this.state = { ...this.state, phase }
    this.emit('state', this.state)
  }

  private patchState(patch: Partial<PipelineState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.state)
  }

  private setError(message: string): void {
    this.state = { ...this.state, phase: 'error', error: message }
    this.emit('state', this.state)
  }

  // ==========================================================================
  // Phase machine — strictly linear (spec §"Phase Sequence on Connect")
  // ==========================================================================

  async runPipeline(): Promise<void> {
    // INIT
    this.setPhase('initializing')
    const initOk = await this.initialize()
    if (!initOk) {
      await this.handleInitFailure()
      return
    }

    if (this.aborted()) return

    // SCAN (skipped if recording count unchanged)
    if (this.shouldScan()) {
      this.setPhase('scanning')
      const files = await this.scanFiles()
      this.cachedFiles = files
      this.cachedFileCount = this.state.device?.recordingCount ?? 0
      this.emit('files', this.getFiles())
    }

    if (this.aborted()) return

    // RECONCILE (CPU only — no USB)
    this.setPhase('reconciling')
    const toDownload = this.reconcile(this.cachedFiles ?? [])

    if (this.aborted()) return

    // DOWNLOAD (sequential, scoped to the reconciled set)
    if (toDownload.length > 0) {
      this.setPhase('downloading')
      await this.downloadAll(toDownload)
    }

    if (this.aborted()) return

    this.patchState({ downloadProgress: null })
    this.setPhase('idle')
  }

  // ==========================================================================
  // INIT
  // ==========================================================================

  /**
   * Populate device state: info, storage, file count, settings, time sync.
   * Returns false only when EVERY command failed (total init failure) — partial
   * success continues with whatever data is available (spec Error Handling table).
   */
  async initialize(): Promise<boolean> {
    let anySucceeded = false

    const info = await this.safe(() => this.jensen.getDeviceInfo())
    if (info) anySucceeded = true

    const card = await this.safe(() => this.jensen.getCardInfo())
    if (card) anySucceeded = true

    const fileCount = await this.safe(() => this.jensen.getFileCount())
    if (fileCount) anySucceeded = true

    const settings = await this.safe(() => this.jensen.getSettings())
    if (settings) anySucceeded = true

    const timeResult = await this.safe(() => this.jensen.setTime(new Date()))
    if (timeResult) anySucceeded = true

    if (!anySucceeded) return false

    const recordingCount = fileCount?.count ?? this.state.device?.recordingCount ?? 0

    this.patchState({
      device: {
        model: this.jensen.getModel(),
        serialNumber: info?.serialNumber ?? this.jensen.serialNumber ?? null,
        firmwareVersion: info?.versionCode ?? this.jensen.versionCode ?? null,
        storage: card
          ? {
              used: card.used,
              capacity: card.capacity,
              freePercent: card.capacity > 0 ? Math.round((card.free / card.capacity) * 100) : 0
            }
          : null,
        settings: settings ? { autoRecord: settings.autoRecord } : null,
        recordingCount
      },
      error: null
    })

    return true
  }

  /**
   * Total init failure: USB reset → reconnect → retry the pipeline ONCE. If it
   * still fails, disconnect cleanly and surface an error (spec §"Init failure").
   */
  private async handleInitFailure(): Promise<void> {
    await this.safe(() => this.jensen.reset())

    const reconnected = await this.safe(() => this.jensen.tryConnect())
    if (reconnected) {
      this.setPhase('initializing')
      const retryOk = await this.initialize()
      if (retryOk) {
        // Continue the rest of the pipeline after a successful retry.
        if (this.shouldScan()) {
          this.setPhase('scanning')
          this.cachedFiles = await this.scanFiles()
          this.cachedFileCount = this.state.device?.recordingCount ?? 0
          this.emit('files', this.getFiles())
        }
        this.setPhase('reconciling')
        const toDownload = this.reconcile(this.cachedFiles ?? [])
        if (toDownload.length > 0) {
          this.setPhase('downloading')
          await this.downloadAll(toDownload)
        }
        this.patchState({ downloadProgress: null })
        this.setPhase('idle')
        return
      }
    }

    await this.safe(() => this.jensen.disconnect())
    this.setError('Device initialization failed. Please unplug and reconnect.')
  }

  // ==========================================================================
  // SCAN
  // ==========================================================================

  /**
   * Skip SCAN when the cached file list is still valid: we already have files
   * AND the device's recording count is unchanged AND there is at least one file.
   * (spec shouldScan)
   */
  shouldScan(): boolean {
    const deviceCount = this.state.device?.recordingCount ?? 0
    return this.cachedFiles === null || this.cachedFileCount !== deviceCount || deviceCount === 0
  }

  async scanFiles(): Promise<FileInfo[]> {
    const expected = this.state.device?.recordingCount ?? 0
    const onProgress = (current: number, total: number): void => {
      this.patchState({ scanProgress: { current, total } })
    }
    const files = await this.safe(() => this.jensen.listFiles(onProgress, expected))
    this.patchState({ scanProgress: null })
    return files ?? []
  }

  // ==========================================================================
  // RECONCILE (CPU only — delegates to DownloadService)
  // ==========================================================================

  reconcile(files: FileInfo[]): DownloadItem[] {
    const deviceFiles = files.map((f) => ({
      filename: f.name,
      size: f.length,
      duration: f.duration,
      dateCreated: f.time ?? new Date()
    }))

    const reconciled = this.downloadService.getFilesToSync(deviceFiles)
    return reconciled
      .filter((r) => !r.skipReason)
      .map((r) => ({
        filename: r.filename,
        size: r.size,
        duration: r.duration,
        dateCreated: r.dateCreated
      }))
  }

  // ==========================================================================
  // DOWNLOAD — scoped & sequential
  // ==========================================================================

  async downloadAll(files: DownloadItem[]): Promise<void> {
    if (!this.abortController) this.abortController = new AbortController()

    let index = 0
    for (const file of files) {
      index++
      if (this.abortController?.signal.aborted) break
      if (!this.jensen.isConnected()) break
      await this.downloadOne(file, index, files.length)
    }
  }

  /**
   * Download a SINGLE file and hand it to DownloadService for save + state.
   * Post-download transcription is intentionally NOT triggered here — the
   * Slice-2 RecordingWatcher funnel owns the (gated) queueing. We invoke the
   * single funnel only as a best-effort belt-and-braces when a recording row is
   * resolvable, never re-checking the auto-transcribe preference ourselves.
   */
  async downloadOne(
    file: DownloadItem,
    current = 1,
    total = 1
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    const chunks: Uint8Array[] = []
    let bytesDownloaded = 0

    this.patchState({
      downloadProgress: {
        filename: file.filename,
        current,
        total,
        bytesDownloaded: 0,
        totalBytes: file.size,
        eta: null
      }
    })

    const onChunk = (data: Uint8Array): void => {
      chunks.push(data)
    }
    const onProgress = (received: number): void => {
      bytesDownloaded = received
      this.patchState({
        downloadProgress: {
          filename: file.filename,
          current,
          total,
          bytesDownloaded: received,
          totalBytes: file.size,
          eta: null
        }
      })
    }

    const ok = await this.safe(() =>
      this.jensen.downloadFile(
        file.filename,
        file.size,
        onChunk,
        onProgress,
        this.abortController?.signal
      )
    )

    if (!ok) {
      return { success: false, error: 'Download failed or aborted' }
    }

    // Assemble the transferred bytes and hand off to DownloadService, which
    // performs the integrity check + save + sync-state (one queue, one check).
    const total2 = chunks.reduce((n, c) => n + c.length, 0)
    const merged = Buffer.alloc(total2)
    let offset = 0
    for (const c of chunks) {
      merged.set(c, offset)
      offset += c.length
    }
    void bytesDownloaded // progress already emitted; kept for clarity

    const result = await this.downloadService.processDownload(file.filename, merged)

    if (result.success) {
      this.triggerTranscriptionFunnel(file.filename)
    }

    return result
  }

  /**
   * Invoke the SINGLE Slice-2 transcription funnel (gate lives inside it). Never
   * duplicates the auto-transcribe preference check. Best-effort: a failure to
   * resolve the recording row simply means the RecordingWatcher funnel will pick
   * it up when the file lands on disk.
   */
  private triggerTranscriptionFunnel(filename: string): void {
    const resolve = this.opts.getRecordingByFilename
    const funnel = this.opts.queueTranscriptionIfEnabled
    if (!resolve || !funnel) return
    try {
      const rec = resolve(filename) ?? resolve(filename.replace(/\.hda$/i, '.mp3'))
      if (rec?.id) funnel(rec.id)
    } catch {
      /* best-effort — RecordingWatcher remains the authoritative funnel */
    }
  }

  // ==========================================================================
  // User actions
  // ==========================================================================

  /** Manual connect — never passes through the auto-connect gate (always works). */
  async connect(): Promise<boolean> {
    this.abortController = new AbortController()
    this.setPhase('connecting')
    const ok = await this.safe(() => this.jensen.connect(this.abortController?.signal))
    if (!ok) {
      this.setError('Failed to connect to device')
      return false
    }
    await this.runPipeline()
    return true
  }

  async disconnect(): Promise<void> {
    this.abortController?.abort()
    this.downloadService.cancelActiveDownloads('Device disconnected')
    await this.safe(() => this.jensen.disconnect())
    this.cachedFiles = null
    this.cachedFileCount = -1
    this.state = { ...INITIAL_STATE }
    this.emit('state', this.state)
  }

  /** Re-scan: abort any in-flight downloads, invalidate cache, re-run pipeline. */
  async manualSync(): Promise<void> {
    this.abortController?.abort()
    this.downloadService.cancelActiveDownloads('Re-sync requested')
    // Force a fresh scan regardless of the cached count.
    this.cachedFiles = null
    this.cachedFileCount = -1
    this.abortController = new AbortController()
    await this.runPipeline()
  }

  /** Cancel downloads only — return to IDLE without disconnecting. */
  async cancelDownloads(): Promise<void> {
    this.abortController?.abort()
    this.downloadService.cancelActiveDownloads('Cancelled by user')
    this.patchState({ downloadProgress: null })
    this.setPhase('idle')
  }

  async deleteFile(filename: string): Promise<{ result: string } | null> {
    return this.safe(() => this.jensen.deleteFile(filename))
  }

  async formatDevice(): Promise<{ result: string } | null> {
    const result = await this.safe(() => this.jensen.formatCard())
    // Card wiped — invalidate cache and re-scan.
    this.cachedFiles = null
    this.cachedFileCount = -1
    this.abortController = new AbortController()
    await this.runPipeline()
    return result
  }

  async setAutoRecord(enabled: boolean): Promise<{ result: string } | null> {
    const result = await this.safe(() => this.jensen.setAutoRecord(enabled))
    if (result && this.state.device) {
      this.patchState({
        device: { ...this.state.device, settings: { autoRecord: enabled } }
      })
    }
    return result
  }

  // ==========================================================================
  // Auto-connect — listener ALWAYS registered, policy re-checked AT EVENT TIME
  // (spec §"Auto-Connect Flow"; ADR-0005 category C)
  // ==========================================================================

  async initAutoConnect(): Promise<void> {
    const usb = this.opts.usbEvents
    if (usb && !this.autoConnectListenersBound) {
      const isHiDock = this.opts.isHiDockDevice ?? (() => true)

      this.connectHandler = (event: { device: unknown }) => {
        if (!isHiDock(event.device)) return
        // Event-time policy gate — re-read the preference EVERY time it fires.
        if (!this.autoConnectEnabled()) return
        void this.connect()
      }
      this.disconnectHandler = (_event: { device: unknown }) => {
        void this.handleDisconnect()
      }

      usb.addEventListener('connect', this.connectHandler)
      usb.addEventListener('disconnect', this.disconnectHandler)
      this.autoConnectListenersBound = true
    }

    // Startup: only auto-connect to an already-attached device if enabled NOW.
    if (!this.autoConnectEnabled()) return
    if (!usb) return
    const devices = await this.safe(() => usb.getDevices())
    const hidock = (devices ?? []).find((d) => (this.opts.isHiDockDevice ?? (() => true))(d))
    if (hidock) await this.connect()
  }

  removeAutoConnect(): void {
    const usb = this.opts.usbEvents
    if (!usb || !this.autoConnectListenersBound) return
    if (this.connectHandler) usb.removeEventListener('connect', this.connectHandler)
    if (this.disconnectHandler) usb.removeEventListener('disconnect', this.disconnectHandler)
    this.connectHandler = null
    this.disconnectHandler = null
    this.autoConnectListenersBound = false
  }

  private autoConnectEnabled(): boolean {
    try {
      return this.opts.getConfig?.().device?.autoConnect ?? false
    } catch {
      return false
    }
  }

  private async handleDisconnect(): Promise<void> {
    this.abortController?.abort()
    this.downloadService.cancelActiveDownloads('Device disconnected')
    this.cachedFiles = null
    this.cachedFileCount = -1
    this.state = { ...INITIAL_STATE }
    this.emit('state', this.state)
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private aborted(): boolean {
    return this.abortController?.signal.aborted ?? false
  }

  /** Run a device call, swallowing throws to null so one bad command can't crash the phase machine. */
  private async safe<T>(fn: () => Promise<T> | T): Promise<T | null> {
    try {
      return await fn()
    } catch {
      return null
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor (lazy — defaults to the REAL Jensen + DownloadService
// singletons, plus the real config / transcription funnel). NOT registered in
// index.ts during Slice 3; a later slice wires it + IPC.
// ---------------------------------------------------------------------------

let pipelineInstance: DevicePipelineService | null = null

export function getDevicePipelineService(): DevicePipelineService {
  if (!pipelineInstance) {
    // Lazy requires keep this module importable in pure unit tests (no electron
    // / native usb at module load) while defaulting to the real singletons in
    // the running app.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getJensenDevice } = require('./jensen') as typeof import('./jensen')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getDownloadService } = require('./download-service') as typeof import('./download-service')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getConfig } = require('./config') as typeof import('./config')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { queueTranscriptionIfEnabled } = require('./transcription') as typeof import('./transcription')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getRecordingByFilename } = require('./database') as typeof import('./database')

    pipelineInstance = new DevicePipelineService(
      getJensenDevice() as unknown as PipelineJensen,
      getDownloadService() as unknown as PipelineDownloadService,
      {
        getConfig: () => getConfig() as { device?: { autoConnect?: boolean } },
        queueTranscriptionIfEnabled,
        getRecordingByFilename: (filename: string) =>
          getRecordingByFilename(filename) as { id: string } | null | undefined
      }
    )
  }
  return pipelineInstance
}

/** Test-only: reset the singleton between suites. */
export function __resetDevicePipelineServiceForTests(): void {
  pipelineInstance = null
}
