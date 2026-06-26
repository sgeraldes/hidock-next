/**
 * Jensen Protocol Implementation for HiDock devices — transport-agnostic core.
 *
 * Architecture: Event-driven continuous read loop + command queue + handler dispatch
 * Direct port of the official HiDock HiNotes jensen.js (apps/web/jensen.js)
 *
 * Key mechanisms (matching jensen.js):
 *  1. Continuous read loop: transferIn always pending, data flows into buffer
 *  2. Command queue: one command at a time, next sent when current resolves
 *  3. Handler registry: each command type has a handler that decides when done
 *  4. Debounced parse: 10ms for simple cmds, 1000ms for file transfers
 *  5. Promise map: tag-keyed, resolved when handler returns truthy value
 *
 * Transport independence:
 *  The protocol logic is identical regardless of how USB bytes are moved. The
 *  `USB` interface (WebUSB) is injected via the constructor, so the SAME class
 *  serves both the browser (`navigator.usb`) and the Electron main process
 *  (`new WebUSB()` from the node `usb` package). No environment-specific imports
 *  live in this module — only the WebUSB *types*.
 */

// WebUSB types (USB, USBDevice, USBInTransferResult, etc.). Type-only — this
// module imports no runtime USB backend; the backend is injected.
/// <reference types="w3c-web-usb" />

// USBConnectionEvent is not declared by node-usb's WebUSB shim — define locally.
interface USBConnectionEvent extends Event {
  readonly device: USBDevice
}

class USBAbortError extends Error {
  readonly name = 'AbortError'
  constructor(message = 'The operation was aborted') { super(message) }
}

// USBInvalidStateError not needed — disconnect detection uses error.name string check instead

// ============================================================
// Constants
// ============================================================

export const CMD = {
  GET_DEVICE_INFO: 1,
  GET_DEVICE_TIME: 2,
  SET_DEVICE_TIME: 3,
  GET_FILE_LIST: 4,
  TRANSFER_FILE: 5,
  GET_FILE_COUNT: 6,
  DELETE_FILE: 7,
  REQUEST_FIRMWARE_UPGRADE: 8,
  FIRMWARE_UPLOAD: 9,
  GET_SETTINGS: 11,
  SET_SETTINGS: 12,
  GET_FILE_BLOCK: 13,
  GET_CARD_INFO: 16,
  FORMAT_CARD: 17,
  GET_RECORDING_FILE: 18,
  RESTORE_FACTORY_SETTINGS: 19,
  SEND_MEETING_SCHEDULE_INFO: 20,
  TRANSFER_FILE_PARTIAL: 21,
  REQUEST_TONE_UPDATE: 22,
  TONE_UPDATE: 23,
  REQUEST_UAC_UPDATE: 24,
  UAC_UPDATE: 25,
  REALTIME_READ_SETTING: 32,
  REALTIME_CONTROL: 33,
  REALTIME_TRANSFER: 34,
  BLUETOOTH_SCAN: 4097,
  BLUETOOTH_CMD: 4098,
  BLUETOOTH_STATUS: 4099,
  GET_BATTERY_STATUS: 4100,
  BT_SCAN: 4101,
  BT_DEV_LIST: 4102,
  BT_GET_PAIRED_DEV_LIST: 4103,
  BT_REMOVE_PAIRED_DEV: 4104,
  FACTORY_RESET: 61451,
  BLUE_B_TIMEOUT: 61457
} as const

export const USB_VENDOR_ID = 0x10d6
export const USB_ALTERNATE_VENDOR_ID = 0x3887
export const USB_VENDOR_IDS: number[] = [0x10d6, 0x3887]

export const USB_PRODUCT_IDS = {
  H1: 0xaf0c,
  H1E_OLD: 0xaf0d,
  H1E: 0xb00d,
  P1_OLD: 0xaf0e,
  P1: 0xb00e,
  P1_MINI: 0xaf0f,
  H1_ALT1: 0x0100,
  H1E_ALT1: 0x0101,
  H1_ALT2: 0x0102,
  H1E_ALT2: 0x0103,
  P1_ALT: 0x2040,
  P1_MINI_ALT: 0x2041
}

export const EP_OUT = 0x01
export const EP_IN = 0x82

// ============================================================
// Types
// ============================================================

export type DeviceModel = 'hidock-h1' | 'hidock-h1e' | 'hidock-p1' | 'hidock-p1-mini' | 'unknown'

export interface DeviceInfo {
  versionCode: string
  versionNumber: number
  serialNumber: string
  model: DeviceModel
}

export interface FileInfo {
  name: string
  createDate: string
  createTime: string
  time: Date | null
  duration: number
  version: number
  length: number
  signature: string
}

export interface CardInfo {
  used: number
  capacity: number
  free: number
  status: string
}

export interface DeviceSettings {
  autoRecord: boolean
  autoPlay: boolean
  notification?: boolean
  bluetoothTone?: boolean
}

export interface RealtimeSettings {
  enabled: boolean
  sampleRate?: number
  channels?: number
  bitDepth?: number
}

export interface RealtimeData {
  rest: number
  data: Uint8Array
}

export interface BatteryStatus {
  status: 'idle' | 'charging' | 'full'
  batteryLevel: number
  voltage?: number
}

export interface BluetoothDevice {
  name: string
  address: string
  rssi?: number
  paired?: boolean
}

export interface BluetoothStatus {
  connected: boolean
  deviceName?: string
  deviceAddress?: string
}

// ============================================================
// Logging — configurable per environment.
//   Main process: defaults to always-on (terminal/log file).
//   Renderer: bind the QA-toggle predicate via setJensenLogging() so device
//   logs respect the QA Logs setting (see project QA logging rules).
// ============================================================

let shouldLogFn: () => boolean = () => true

/** Bind the predicate that decides whether Jensen logs are emitted. */
export function setJensenLogging(fn: () => boolean): void {
  shouldLogFn = fn
}

const shouldLog = (): boolean => shouldLogFn()

// ============================================================
// Duration calculation (unchanged from original)
// ============================================================

function calculateDurationSeconds(fileLength: number, fileVersion: number): number {
  const WAV_HEADER_SIZE = 44
  const CHANNELS = 2
  const BYTES_PER_SAMPLE = 1
  const CORRECTION_FACTOR = 4

  if (fileVersion === 1) {
    return Math.round(fileLength / 8000)
  } else if (fileVersion === 2) {
    const effectiveBps = (48000 * CHANNELS * BYTES_PER_SAMPLE) / CORRECTION_FACTOR
    return fileLength > WAV_HEADER_SIZE ? Math.round((fileLength - WAV_HEADER_SIZE) / effectiveBps) : 0
  } else if (fileVersion === 3) {
    const effectiveBps = (24000 * CHANNELS * BYTES_PER_SAMPLE) / CORRECTION_FACTOR
    return fileLength > WAV_HEADER_SIZE ? Math.round((fileLength - WAV_HEADER_SIZE) / effectiveBps) : 0
  } else if (fileVersion === 5) {
    return Math.round(fileLength / (12000 / CORRECTION_FACTOR))
  } else {
    return Math.round(fileLength / ((16000 * CHANNELS * BYTES_PER_SAMPLE) / CORRECTION_FACTOR))
  }
}

// ============================================================
// Message builder (matches jensen.js `c` constructor)
// ============================================================

class JensenMessage {
  command: number
  msgBody: number[] = []
  index: number = 0
  expireTime: number = 0
  onprogress?: (current: number, total: number) => void

  constructor(command: number) {
    this.command = command
  }

  body(data: number[]): this {
    this.msgBody = data
    return this
  }

  sequence(seq: number): this {
    this.index = seq
    return this
  }

  expireAfter(seconds: number): void {
    this.expireTime = Date.now() + seconds * 1000
  }

  make(): Uint8Array {
    const buffer = new Uint8Array(12 + this.msgBody.length)
    let pos = 0
    buffer[pos++] = 0x12
    buffer[pos++] = 0x34
    buffer[pos++] = (this.command >> 8) & 0xff
    buffer[pos++] = this.command & 0xff
    buffer[pos++] = (this.index >> 24) & 0xff
    buffer[pos++] = (this.index >> 16) & 0xff
    buffer[pos++] = (this.index >> 8) & 0xff
    buffer[pos++] = this.index & 0xff
    const len = this.msgBody.length
    buffer[pos++] = (len >> 24) & 0xff
    buffer[pos++] = (len >> 16) & 0xff
    buffer[pos++] = (len >> 8) & 0xff
    buffer[pos++] = len & 0xff
    for (let i = 0; i < this.msgBody.length; i++) {
      buffer[pos++] = this.msgBody[i] & 0xff
    }
    return buffer
  }
}

// ============================================================
// Internal types
// ============================================================

interface ResponseMessage {
  id: number
  sequence: number
  body: Uint8Array
}

interface PendingCommand {
  tag: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout> | null
}

interface QueueEntry {
  msg: JensenMessage
  operationName: string
}

type CommandHandler = (msg: ResponseMessage | null, device: JensenDevice) => unknown

// Fix 3: Incremental file list parsing state — stored in device.data['filelist']
// instead of the old Uint8Array[] accumulator, eliminating O(N^2) re-parsing.
interface FileListState {
  tailBuffer: Uint8Array // Unparsed tail bytes from last parse (may be partial record)
  tailLen: number        // Valid bytes in tailBuffer
  files: FileInfo[]      // Running list of fully-parsed files
  headerTotal: number    // File count from 0xFF 0xFF header (0 if not yet seen)
  headerParsed: boolean  // Whether the optional 0xFF 0xFF header has been processed
}

// ============================================================
// JensenDevice — event-driven architecture matching jensen.js
// ============================================================

export class JensenDevice {
  // === USB device ===
  private device: USBDevice | null = null
  private sequenceId = 0

  // === Command queue (jensen.js: a[], h, n{}) ===
  private commandQueue: QueueEntry[] = []
  private currentCommandTag: string | null = null
  private currentOperationName: string | null = null
  private pendingPromises: Map<string, PendingCommand> = new Map()

  // === Continuous read loop (jensen.js: r[], k, y) ===
  private receiveChunks: DataView[] = []
  private readLoopRunning = false
  private totalBytesReceived = 0

  // Carry buffer for partial Jensen messages between processBufferedData() calls
  private carryBuffer: Uint8Array = new Uint8Array(0)
  private carryLen: number = 0

  // === Parse timing (jensen.js: decodeTimeout, timewait) ===
  private decodeTimer: ReturnType<typeof setTimeout> | null = null
  private parseDelay = 10

  // === Handler registry (jensen.js: s.handlers) ===
  private handlers: Map<number, CommandHandler> = new Map()

  // === Progress callback (jensen.js: onreceive) ===
  onreceive: ((bytes: number) => void) | null = null

  // === Device state ===
  versionCode: string | null = null
  versionNumber: number | null = null
  serialNumber: string | null = null
  model: DeviceModel = 'unknown'

  // jensen.js uses this.data = {} for listFiles accumulator
  data: Record<string, unknown> = {}

  // === Event callbacks ===
  ondisconnect?: () => void
  onconnect?: () => void

  /**
   * Optional gate for the USB hot-plug auto-connect. When set and it returns
   * false, a `connect` USB event for a HiDock device is ignored instead of
   * triggering tryConnect(). Manual connect()/tryConnect() calls are unaffected.
   * Consumers wire this to their "auto-connect" preference.
   */
  autoConnectGate: (() => boolean) | null = null

  // === USB event handlers ===
  private usbDisconnectHandler: ((event: USBConnectionEvent) => void) | null = null
  private usbConnectHandler: ((event: USBConnectionEvent) => void) | null = null
  private usbListenersActive = false

  // === USB backend (WebUSB interface) ===
  // Optionally injected (Electron main / Node: new WebUSB() from the `usb`
  // package). When not injected, resolves navigator.usb lazily on each access
  // so the browser's WebUSB can be installed/replaced after construction.
  private readonly injectedUsb?: USB

  protected get usb(): USB {
    return (this.injectedUsb ?? (globalThis as { navigator?: { usb?: USB } }).navigator?.usb) as USB
  }

  constructor(usb?: USB) {
    this.injectedUsb = usb
    this.registerDefaultHandlers()
  }

  // ================================================================
  // Static
  // ================================================================

  /**
   * Whether a WebUSB backend is available. Pass the injected backend when the
   * caller binds a non-default one (e.g. node-usb's WebUSB in the main process);
   * otherwise falls back to the browser's navigator.usb.
   */
  static isSupported(usb: USB | undefined = (globalThis as { navigator?: { usb?: USB } }).navigator?.usb): boolean {
    return usb !== null && usb !== undefined
  }

  // ================================================================
  // Connection — matches jensen.js connect/tryconnect/disconnect/setup
  // ================================================================

  async connect(signal?: AbortSignal): Promise<boolean> {
    if (!this.usb) {
      console.error('WebUSB not supported')
      return false
    }
    if (signal?.aborted) throw new USBAbortError('Connection aborted')

    // jensen.js: if (await g.tryconnect()) return
    if (await this.tryConnect()) return true

    if (signal?.aborted) throw new USBAbortError('Connection aborted')

    // Fall back to device auto-select (node-usb with allowAllDevices bypasses browser picker)
    let picked: USBDevice
    try {
      picked = await this.usb.requestDevice({
        filters: USB_VENDOR_IDS.map(vendorId => ({ vendorId }))
      })
    } catch {
      return false
    }

    if (signal?.aborted) throw new USBAbortError('Connection aborted')

    try {
      await picked.open()
      this.device = picked
      await this.setup()
      return true
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      console.error('[Jensen] Connection failed:', error)
      return false
    }
  }

  /**
   * Auto-connect to a previously authorized HiDock device.
   * Matches jensen.js tryconnect(): disconnect first, find device, open, setup.
   */
  async tryConnect(preAuthorizedDevice?: USBDevice): Promise<boolean> {
    if (!this.usb) return false

    // Don't reconnect if already connected
    if (this.isConnected()) {
      if (shouldLog()) console.log('[Jensen] tryConnect: already connected')
      return true
    }

    // Don't try while operation in progress
    if (this.isOperationInProgress()) {
      if (shouldLog()) console.log(`[Jensen] tryConnect: operation in progress (${this.currentOperationName})`)
      return false
    }

    // jensen.js: await this.disconnect()
    await this.disconnect()

    try {
      let target = preAuthorizedDevice

      if (target && !this.isHiDockUsbDevice(target)) {
        if (shouldLog()) console.log('[Jensen] tryConnect: provided device is not HiDock')
        return false
      }

      if (!target) {
        const devices = await this.usb.getDevices()
        target = devices.find(d => this.isHiDockUsbDevice(d))
      }

      if (!target) return false

      if (shouldLog()) console.log('[Jensen] tryConnect: detected', target.productName)
      await target.open()
      this.device = target
      await this.setup()
      return true
    } catch {
      return false
    }
  }

  /**
   * Device setup after USB open — matches jensen.js I() function.
   * Claims interface, detects model, resets state, fires onconnect.
   */
  private async setup(): Promise<void> {
    if (!this.device) return

    // Reset state (jensen.js: g.versionCode = null, g.versionNumber = null, a.length = 0)
    this.versionCode = null
    this.versionNumber = null
    this.commandQueue.length = 0

    try {
      await this.device.selectConfiguration(1)
      await this.device.claimInterface(0)
      await this.device.selectAlternateInterface(0, 0)
      this.model = this.detectModel(this.device.productId)
    } catch (error) {
      console.error('[Jensen] setup error:', error)
    }

    // Reset protocol state (jensen.js: h = null, k = false)
    this.currentCommandTag = null
    this.currentOperationName = null
    this.readLoopRunning = false
    this.sequenceId = 0
    this.receiveChunks.length = 0
    this.carryLen = 0
    this.totalBytesReceived = 0
    this.serialNumber = null
    this.data = {}

    if (shouldLog()) console.log(`[Jensen] Connected to ${this.model}`)

    // Brief stabilization delay after USB interface claim — some devices (especially H1E)
    // need time before firmware is ready to accept Jensen protocol commands
    await new Promise(resolve => setTimeout(resolve, 300))

    // Set up USB disconnect listener
    this.setupUsbDisconnectListener()

    // Fire onconnect (jensen.js fires synchronously in I())
    // Use setTimeout(0) so connect() returns before handleConnect starts commands
    setTimeout(() => this.onconnect?.(), 0)
  }

  isConnected(): boolean {
    return this.device !== null
  }

  async disconnect(): Promise<void> {
    this.removeUsbDisconnectListener()

    if (this.device) {
      // Release the claimed interface BEFORE closing. Without this, the device's
      // interface stays claimed/active and the next connect's claimInterface(0)
      // fails with LIBUSB_ERROR_ACCESS — locking the device after a
      // disconnect → reconnect cycle.
      try { await this.device.releaseInterface(0) } catch { /* not claimed / already released */ }
      try { await this.device.close() } catch { /* ignore */ }
      this.device = null
    }

    // Reset all state
    this.currentCommandTag = null
    this.currentOperationName = null
    this.readLoopRunning = false
    this.sequenceId = 0
    this.receiveChunks.length = 0
    this.carryLen = 0
    this.commandQueue.length = 0
    this.data = {}

    if (this.decodeTimer) {
      clearTimeout(this.decodeTimer)
      this.decodeTimer = null
    }

    // Resolve all pending promises with null
    for (const [, pending] of this.pendingPromises) {
      if (pending.timeout) clearTimeout(pending.timeout)
      pending.resolve(null)
    }
    this.pendingPromises.clear()

    this.ondisconnect?.()
  }

  /**
   * Reset USB device to recover from stuck state.
   * Not in jensen.js but needed by hidock-device.ts.
   */
  async reset(): Promise<boolean> {
    if (!this.device) return false

    if (shouldLog()) console.log('[Jensen] Resetting device...')
    try {
      // Clear protocol state
      this.sequenceId = 0
      this.currentCommandTag = null
      this.currentOperationName = null
      this.readLoopRunning = false
      this.receiveChunks.length = 0
      this.carryLen = 0
      this.commandQueue.length = 0
      this.data = {}

      for (const [, pending] of this.pendingPromises) {
        if (pending.timeout) clearTimeout(pending.timeout)
        pending.resolve(null)
      }
      this.pendingPromises.clear()

      if (this.device.opened) {
        try {
          await this.device.reset()
        } catch {
          await this.device.close()
          await this.device.open()
          await this.device.selectConfiguration(1)
          await this.device.claimInterface(0)
          await this.device.selectAlternateInterface(0, 0)
        }
      }
      return true
    } catch (error) {
      console.error('[Jensen] Reset failed:', error)
      return false
    }
  }

  // ================================================================
  // USB helpers
  // ================================================================

  private isHiDockUsbDevice(device: USBDevice): boolean {
    if (!USB_VENDOR_IDS.includes(device.vendorId)) return false
    const name = device.productName?.toLowerCase() ?? ''
    if (name.includes('hidock') || name.includes('jensen')) return true
    return Object.values(USB_PRODUCT_IDS).includes(device.productId)
  }

  private detectModel(productId: number): DeviceModel {
    switch (productId) {
      case USB_PRODUCT_IDS.H1:
      case USB_PRODUCT_IDS.H1_ALT1:
      case USB_PRODUCT_IDS.H1_ALT2:
        return 'hidock-h1'
      case USB_PRODUCT_IDS.H1E_OLD:
      case USB_PRODUCT_IDS.H1E:
      case USB_PRODUCT_IDS.H1E_ALT1:
      case USB_PRODUCT_IDS.H1E_ALT2:
        return 'hidock-h1e'
      case USB_PRODUCT_IDS.P1_OLD:
      case USB_PRODUCT_IDS.P1:
      case USB_PRODUCT_IDS.P1_ALT:
        return 'hidock-p1'
      case USB_PRODUCT_IDS.P1_MINI:
      case USB_PRODUCT_IDS.P1_MINI_ALT:
        return 'hidock-p1-mini'
      default:
        return 'unknown'
    }
  }

  getModel(): DeviceModel {
    return this.model
  }

  // ================================================================
  // USB event listeners
  // ================================================================

  private handleDisconnect(): void {
    if (shouldLog()) console.log('[Jensen] USB device physically disconnected')
    this.device = null
    this.sequenceId = 0
    this.readLoopRunning = false
    this.receiveChunks.length = 0
    this.carryLen = 0
    this.currentCommandTag = null
    this.currentOperationName = null
    this.commandQueue.length = 0

    for (const [, pending] of this.pendingPromises) {
      if (pending.timeout) clearTimeout(pending.timeout)
      pending.resolve(null)
    }
    this.pendingPromises.clear()

    this.ondisconnect?.()
  }

  private setupUsbDisconnectListener(): void {
    if (!this.device) return
    this.usbDisconnectHandler = (event: USBConnectionEvent) => {
      if (event.device === this.device) this.handleDisconnect()
    }
    this.usb.addEventListener('disconnect', this.usbDisconnectHandler)
  }

  private removeUsbDisconnectListener(): void {
    if (this.usbDisconnectHandler) {
      this.usb.removeEventListener('disconnect', this.usbDisconnectHandler)
      this.usbDisconnectHandler = null
    }
  }

  /**
   * Set up USB connect listener for device plug-in detection.
   * Matches jensen.js: navigator.usb.onconnect = () => g.tryconnect()
   */
  setupUsbConnectListener(): void {
    if (this.usbListenersActive) return
    if (!this.usb) return

    this.usbConnectHandler = (event: USBConnectionEvent) => {
      if (this.isHiDockUsbDevice(event.device)) {
        if (this.autoConnectGate && !this.autoConnectGate()) {
          if (shouldLog()) console.log('[Jensen] USB connect event ignored (auto-connect disabled)')
          return
        }
        if (shouldLog()) console.log('[Jensen] USB connect event, triggering tryConnect')
        this.tryConnect(event.device)
      }
    }
    this.usb.addEventListener('connect', this.usbConnectHandler as EventListener)
    this.usbListenersActive = true
  }

  removeUsbConnectListener(): void {
    if (!this.usbListenersActive) return
    if (this.usbConnectHandler) {
      this.usb.removeEventListener('connect', this.usbConnectHandler as EventListener)
    }
    this.usbConnectHandler = null
    this.usbListenersActive = false
  }

  // ================================================================
  // CORE: Command queue — matches jensen.js send/sendNext/createPromise
  // ================================================================

  /**
   * Queue a command and return a promise for its result.
   * Matches jensen.js send(): assign seq, push to queue, call sendNext, return promise.
   */
  private sendCommand<T>(msg: JensenMessage, timeoutSec?: number, operationName?: string): Promise<T> {
    msg.sequence(this.sequenceId++)
    if (timeoutSec) msg.expireAfter(timeoutSec)

    this.commandQueue.push({
      msg,
      operationName: operationName ?? `cmd-${msg.command}`
    })

    // Try to send immediately
    this.sendNextCommand()

    // Create and return promise
    return this.createPromise<T>(msg, timeoutSec)
  }

  /**
   * Pop next command from queue and send it.
   * Matches jensen.js j(): if (h) return; pop queue; set h; transferOut; start read loop.
   */
  private sendNextCommand(): void {
    // One command at a time (jensen.js: if (h) return)
    if (this.currentCommandTag) return
    if (!this.device) return

    // Pop from queue, skip expired commands
    const now = Date.now()
    let entry: QueueEntry | undefined
    while (this.commandQueue.length > 0) {
      entry = this.commandQueue.shift()!
      if (entry.msg.expireTime > 0 && entry.msg.expireTime < now) {
        if (shouldLog()) console.log(`[Jensen] expired: cmd-${entry.msg.command}-${entry.msg.index}`)
        this.expireCommand(`cmd-${entry.msg.command}-${entry.msg.index}`)
        entry = undefined
        continue
      }
      break
    }
    if (!entry) return

    const tag = `cmd-${entry.msg.command}-${entry.msg.index}`
    this.currentCommandTag = tag
    this.currentOperationName = entry.operationName

    if (shouldLog()) console.log(`[Jensen] sendNext: ${entry.operationName} (${tag})`)

    // Set parse delay based on command type
    // jensen.js: g.timewait = d.command == 5 || d.command == G ? 1e3 : 10
    this.parseDelay =
      (entry.msg.command === CMD.TRANSFER_FILE || entry.msg.command === CMD.GET_FILE_BLOCK)
        ? 1000 : 10

    // Send command
    const data = entry.msg.make()
    this.device.transferOut(EP_OUT, data as BufferSource).then(
      () => {
        if (entry!.msg.onprogress) entry!.msg.onprogress(1, 1)
        // Reset byte counter
        this.totalBytesReceived = 0
        // Start read loop if not running (jensen.js: k == 0 ? R() : (k = !0))
        if (!this.readLoopRunning) {
          this.startReadLoop()
        }
      },
      (error) => {
        console.error('[Jensen] transferOut failed:', error)
        this.versionCode = null
        this.versionNumber = null
        // Clear command tag to unblock queue (was missing — caused permanent stall)
        this.currentCommandTag = null
        this.currentOperationName = null
        this.sendNextCommand()
      }
    )
  }

  /**
   * Create a promise for a queued command.
   * Matches jensen.js B(): tag-keyed promise stored in map, optional timeout.
   */
  private createPromise<T>(msg: JensenMessage, timeoutSec?: number): Promise<T> {
    const tag = `cmd-${msg.command}-${msg.index}`
    const timer = timeoutSec
      ? setTimeout(() => this.expireCommand(tag), timeoutSec * 1000)
      : null

    return new Promise<T>((resolve, reject) => {
      this.pendingPromises.set(tag, {
        tag,
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout: timer
      })
    })
  }

  /**
   * Expire a command by resolving its promise with null.
   * Matches jensen.js x(): resolve with null, delete from map.
   */
  private expireCommand(tag: string): void {
    if (shouldLog()) console.log(`[Jensen] timeout: ${tag}`)
    const pending = this.pendingPromises.get(tag)
    if (!pending) return
    pending.resolve(null)
    this.pendingPromises.delete(tag)
  }

  // ================================================================
  // CORE: Continuous read loop — matches jensen.js R/N/E
  // ================================================================

  /**
   * Start (or continue) the continuous USB read loop.
   * Matches jensen.js R(): transferIn(2, 51200).then(N)
   * The loop is self-sustaining: onDataReceived calls startReadLoop again.
   * It stops naturally when device is null (disconnected).
   */
  private startReadLoop(): void {
    if (!this.device) return
    this.readLoopRunning = true

    this.device.transferIn(2, 51200).then(
      (result) => this.onDataReceived(result),
      (error) => {
        this.readLoopRunning = false
        const isDisconnect =
          (error instanceof Error && error.name === 'InvalidStateError') ||
          (error instanceof Error && /NO_DEVICE|NOT_FOUND|LIBUSB_TRANSFER_NO_DEVICE|LIBUSB_ERROR_NO_DEVICE/.test(error.message))
        if (isDisconnect) {
          this.handleDisconnect()
        } else {
          // Log non-disconnect USB errors (previously swallowed silently)
          console.warn('[Jensen] USB read error (non-disconnect):', error instanceof Error ? error.message : error)
        }
      }
    )
  }

  /**
   * Handle data received from USB.
   * Matches jensen.js N(): push data, restart loop, debounce parse, fire onreceive.
   */
  private onDataReceived(result: USBInTransferResult): void {
    if (result.data && result.data.byteLength > 0) {
      this.totalBytesReceived += result.data.byteLength
      this.receiveChunks.push(result.data)
    }

    // Restart read loop immediately (perpetual — matches jensen.js: R() in N())
    this.startReadLoop()

    // Debounce parse (matches jensen.js: clearTimeout + setTimeout(E, timewait))
    if (this.decodeTimer) clearTimeout(this.decodeTimer)
    this.decodeTimer = setTimeout(() => this.processBufferedData(), this.parseDelay)

    // Real-time progress callback (matches jensen.js: g.onreceive(y))
    if (this.onreceive) {
      try { this.onreceive(this.totalBytesReceived) } catch { /* ignore */ }
    }
  }

  /**
   * Parse all buffered data and dispatch to handlers.
   * Matches jensen.js E(): concatenate chunks, parse packets, call handlers.
   */
  private processBufferedData(): void {
    // 100KB work buffer (matches jensen.js: new ArrayBuffer(102400))
    const workBuffer = new Uint8Array(102400)
    let workLen = 0
    let decodeError = false

    // Prepend carry bytes from previous call (partial Jensen messages)
    if (this.carryLen > 0) {
      workBuffer.set(this.carryBuffer.subarray(0, this.carryLen), 0)
      workLen = this.carryLen
      this.carryLen = 0
    }

    const chunkCount = this.receiveChunks.length
    for (let qi = 0; qi < chunkCount; qi++) {
      const chunk = this.receiveChunks.shift()!

      // Copy chunk to flat buffer (jensen.js uses getInt8 — bit pattern preserved in Uint8Array)
      for (let i = 0; i < chunk.byteLength; i++) {
        workBuffer[i + workLen] = chunk.getInt8(i)
      }
      workLen += chunk.byteLength

      // Parse all complete messages
      let consumed = 0
      for (;;) {
        let parsed: { message: ResponseMessage; length: number } | null = null
        try {
          parsed = this.parsePacket(workBuffer, consumed, workLen)
        } catch {
          decodeError = true
          break
        }
        if (!parsed) break

        consumed += parsed.length
        const msg = parsed.message

        if (shouldLog() && msg.id !== CMD.TRANSFER_FILE) {
          console.log(`[Jensen] recv: cmd=${msg.id}, seq=${msg.sequence}, bodyLen=${msg.body.length}`)
        }

        // Dispatch to handler (jensen.js: s.handlers[S.id](S, g))
        try {
          const handler = this.handlers.get(msg.id)
          if (handler) {
            const result = handler(msg, this)
            // If handler returns truthy → resolve promise (jensen.js: A && m(A, S.id))
            if (result !== undefined && result !== null) {
              this.triggerResolve(result, msg.id)
            }
          }
        } catch (error) {
          // Handler threw — matches jensen.js: m(A) with no cmdId
          this.triggerResolve(error)
        }

        // Try to send next command after each message (matches jensen.js: j() in E loop)
        this.sendNextCommand()
      }

      // Decode error recovery (matches jensen.js decode error handling in E())
      if (decodeError) {
        if (this.currentCommandTag) {
          const cmdIdMatch = this.currentCommandTag.match(/^cmd-(\d+)-/)
          const cmdId = cmdIdMatch ? parseInt(cmdIdMatch[1]) : -1
          let resolved = false
          if (cmdId >= 0) {
            try {
              const handler = this.handlers.get(cmdId)
              if (handler) {
                const partialResult = handler(null, this)
                // Use partial results if handler returned them (e.g., partially parsed file list)
                if (partialResult !== undefined && partialResult !== null) {
                  this.triggerResolve(partialResult, cmdId)
                  resolved = true
                }
              }
            } catch (error) {
              this.triggerResolve(error)
              resolved = true
            }
          }
          if (!resolved) {
            this.triggerResolve(null, cmdId >= 0 ? cmdId : undefined)
          }
          // Unblock the command queue (was missing — caused permanent stall after decode error)
          this.sendNextCommand()
        }
        this.receiveChunks.length = 0
        this.carryLen = 0
        break
      }

      // Shift consumed data out of work buffer
      for (let i = 0; i < workLen - consumed; i++) {
        workBuffer[i] = workBuffer[i + consumed]
      }
      workLen -= consumed
    }

    // Save any remaining unparsed bytes for the next call
    if (workLen > 0 && !decodeError) {
      if (this.carryBuffer.length < workLen) {
        this.carryBuffer = new Uint8Array(workLen * 2)
      }
      this.carryBuffer.set(workBuffer.subarray(0, workLen), 0)
      this.carryLen = workLen
    }
  }

  // ================================================================
  // CORE: Packet parser — matches jensen.js Z()
  // ================================================================

  /**
   * Parse one Jensen protocol message from buffer at offset.
   * Returns null if not enough data. Throws on invalid header.
   * Matches jensen.js Z() exactly.
   */
  private parsePacket(
    buffer: Uint8Array,
    offset: number,
    totalLength: number
  ): { message: ResponseMessage; length: number } | null {
    const available = totalLength - offset
    if (available < 12) return null

    // Check sync marker (jensen.js: d[u+0] !== 18 || d[u+1] !== 52)
    if (buffer[offset] !== 0x12 || buffer[offset + 1] !== 0x34) {
      throw new Error('invalid header')
    }

    // Command ID — 16-bit big-endian (jensen.js: F(d[u+C], d[u+C+1]))
    const cmdId = ((buffer[offset + 2] & 0xff) << 8) | (buffer[offset + 3] & 0xff)

    // Sequence — 32-bit big-endian
    const seqId =
      ((buffer[offset + 4] & 0xff) << 24) |
      ((buffer[offset + 5] & 0xff) << 16) |
      ((buffer[offset + 6] & 0xff) << 8) |
      (buffer[offset + 7] & 0xff)

    // Body length — bottom 24 bits; top byte is padding (jensen.js: M = ..., L = (M >> 24) & 255, M &= 16777215)
    const raw =
      ((buffer[offset + 8] & 0xff) << 24) |
      ((buffer[offset + 9] & 0xff) << 16) |
      ((buffer[offset + 10] & 0xff) << 8) |
      (buffer[offset + 11] & 0xff)
    const padding = (raw >> 24) & 0xff
    const bodyLen = raw & 0xffffff

    // Check if full message available
    if (available < 12 + bodyLen + padding) return null

    // Extract body (jensen.js: d.slice(u + H, u + H + M))
    let pos = 12
    const body = buffer.slice(offset + pos, offset + pos + bodyLen)
    pos += bodyLen
    pos += padding

    return { message: { id: cmdId, sequence: seqId, body }, length: pos }
  }

  // ================================================================
  // CORE: Promise resolution — matches jensen.js m()
  // ================================================================

  /**
   * Resolve the current command's promise.
   * Matches jensen.js m(d, u): check tag matches cmdId, resolve, clear h.
   */
  private triggerResolve(value: unknown, cmdId?: number): void {
    if (!this.currentCommandTag) return

    if (cmdId !== undefined) {
      // Check if current command's cmdId matches (jensen.js: h.substring(0, h.lastIndexOf("-")) != "cmd-" + u)
      const lastDash = this.currentCommandTag.lastIndexOf('-')
      const prefix = this.currentCommandTag.substring(0, lastDash)
      if (prefix !== `cmd-${cmdId}`) {
        // Mismatch — clear current tag (matches jensen.js: return void (h = null))
        this.currentCommandTag = null
        this.currentOperationName = null
        return
      }
    } else {
      // No cmdId provided (handler threw) — always mismatch (matches jensen.js: m(A) with undefined u)
      this.currentCommandTag = null
      this.currentOperationName = null
      return
    }

    const pending = this.pendingPromises.get(this.currentCommandTag)
    if (!pending) return

    if (pending.timeout) clearTimeout(pending.timeout)
    pending.resolve(value)
    this.pendingPromises.delete(this.currentCommandTag)
    this.currentCommandTag = null
    this.currentOperationName = null
  }

  // ================================================================
  // Lock compatibility (for hidock-device.ts)
  // ================================================================

  isOperationInProgress(): boolean {
    return this.currentCommandTag !== null
  }

  getLockHolder(): string | null {
    return this.currentOperationName
  }

  // ================================================================
  // Default handlers — matches jensen.js s.registerHandler() calls
  // ================================================================

  private registerDefaultHandlers(): void {
    // GET_DEVICE_INFO (1)
    this.handlers.set(CMD.GET_DEVICE_INFO, (msg, device) => {
      if (!msg) return null
      const body = msg.body
      const versionParts: number[] = []
      let versionNumber = 0
      for (let i = 0; i < 4; i++) {
        const byte = body[i] & 0xff
        if (i > 0) versionParts.push(byte)
        versionNumber |= byte << (8 * (3 - i))
      }
      const snChars: string[] = []
      for (let i = 0; i < 16; i++) {
        const byte = body[i + 4]
        if (byte > 0) snChars.push(String.fromCharCode(byte))
      }
      device.versionCode = versionParts.join('.')
      device.versionNumber = versionNumber
      device.serialNumber = snChars.join('')
      return {
        versionCode: device.versionCode,
        versionNumber: device.versionNumber,
        serialNumber: device.serialNumber,
        model: device.model
      }
    })

    // GET_DEVICE_TIME (2)
    this.handlers.set(CMD.GET_DEVICE_TIME, (msg, device) => {
      if (!msg) return null
      const bcd = device.fromBcd(msg.body[0], msg.body[1], msg.body[2], msg.body[3], msg.body[4], msg.body[5], msg.body[6])
      return {
        time: bcd === '00000000000000'
          ? 'unknown'
          : bcd.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/gi, '$1-$2-$3 $4:$5:$6')
      }
    })

    // GET_FILE_COUNT (6)
    this.handlers.set(CMD.GET_FILE_COUNT, (msg) => {
      if (!msg) return null
      if (msg.body.length === 0) return { count: 0 }
      const count =
        ((msg.body[0] & 0xff) << 24) |
        ((msg.body[1] & 0xff) << 16) |
        ((msg.body[2] & 0xff) << 8) |
        (msg.body[3] & 0xff)
      return { count }
    })

    // GET_SETTINGS (11)
    this.handlers.set(CMD.GET_SETTINGS, (msg) => {
      if (!msg) return null
      return {
        autoRecord: msg.body[3] === 1,
        autoPlay: msg.body[7] === 1,
        bluetoothTone: msg.body[15] !== 1,
        notification: msg.body.length >= 12 ? msg.body[11] === 1 : undefined
      }
    })

    // GET_CARD_INFO (16)
    this.handlers.set(CMD.GET_CARD_INFO, (msg) => {
      if (!msg) return null
      let pos = 0
      const freeMiB =
        ((msg.body[pos++] & 0xff) << 24) |
        ((msg.body[pos++] & 0xff) << 16) |
        ((msg.body[pos++] & 0xff) << 8) |
        (msg.body[pos++] & 0xff)
      const capacityMiB =
        ((msg.body[pos++] & 0xff) << 24) |
        ((msg.body[pos++] & 0xff) << 16) |
        ((msg.body[pos++] & 0xff) << 8) |
        (msg.body[pos++] & 0xff)
      const statusRaw =
        ((msg.body[pos++] & 0xff) << 24) |
        ((msg.body[pos++] & 0xff) << 16) |
        ((msg.body[pos++] & 0xff) << 8) |
        (msg.body[pos] & 0xff)
      return {
        used: capacityMiB - freeMiB,
        capacity: capacityMiB,
        free: freeMiB,
        status: statusRaw.toString(16)
      }
    })

    // DELETE_FILE (7)
    this.handlers.set(CMD.DELETE_FILE, (msg) => {
      if (!msg) return null
      let result = 'failed'
      if (msg.body[0] === 0) result = 'success'
      else if (msg.body[0] === 1) result = 'not-exists'
      return { result }
    })

    // Generic result handler for simple success/fail commands
    const resultHandler: CommandHandler = (msg) => {
      if (!msg) return null
      return { result: msg.body[0] === 0 ? 'success' : 'failed' }
    }

    this.handlers.set(CMD.SET_DEVICE_TIME, resultHandler)
    this.handlers.set(CMD.SET_SETTINGS, resultHandler)
    this.handlers.set(CMD.FORMAT_CARD, resultHandler)
    this.handlers.set(CMD.RESTORE_FACTORY_SETTINGS, resultHandler)
    this.handlers.set(CMD.FACTORY_RESET, resultHandler)
    this.handlers.set(CMD.REALTIME_CONTROL, resultHandler)
    this.handlers.set(CMD.FIRMWARE_UPLOAD, resultHandler)
    this.handlers.set(CMD.TONE_UPDATE, resultHandler)
    this.handlers.set(CMD.UAC_UPDATE, resultHandler)
    this.handlers.set(CMD.SEND_MEETING_SCHEDULE_INFO, resultHandler)
    this.handlers.set(CMD.BLUETOOTH_CMD, resultHandler)
    this.handlers.set(CMD.BLUETOOTH_SCAN, resultHandler)
    this.handlers.set(CMD.BT_SCAN, resultHandler)
    this.handlers.set(CMD.BT_REMOVE_PAIRED_DEV, resultHandler)
    this.handlers.set(CMD.GET_FILE_BLOCK, resultHandler)

    // REALTIME_READ_SETTING (32) — return raw
    this.handlers.set(CMD.REALTIME_READ_SETTING, (msg) => {
      if (!msg) return null
      return msg
    })

    // REALTIME_TRANSFER (34)
    this.handlers.set(CMD.REALTIME_TRANSFER, (msg) => {
      if (!msg) return null
      const rest =
        ((msg.body[0] & 0xff) << 24) |
        ((msg.body[1] & 0xff) << 16) |
        ((msg.body[2] & 0xff) << 8) |
        (msg.body[3] & 0xff)
      return { rest, data: msg.body.slice(4) }
    })

    // GET_BATTERY_STATUS (4100)
    this.handlers.set(CMD.GET_BATTERY_STATUS, (msg) => {
      if (!msg) return null
      const statusByte = msg.body[0] & 0xff
      let status: 'idle' | 'charging' | 'full' = 'idle'
      if (statusByte === 1) status = 'charging'
      else if (statusByte === 2) status = 'full'
      const batteryLevel = msg.body[1] & 0xff
      const voltage = msg.body.length >= 6
        ? ((msg.body[2] & 0xff) << 24) | ((msg.body[3] & 0xff) << 16) | ((msg.body[4] & 0xff) << 8) | (msg.body[5] & 0xff)
        : undefined
      return { status, batteryLevel, voltage }
    })

    // BLUETOOTH_STATUS (4099)
    this.handlers.set(CMD.BLUETOOTH_STATUS, (msg) => {
      if (!msg) return null
      return { connected: msg.body[0] === 1, raw: msg.body }
    })

    // BT_DEV_LIST / BT_GET_PAIRED_DEV_LIST — return raw
    this.handlers.set(CMD.BT_DEV_LIST, (msg) => {
      if (!msg) return null
      return { raw: msg.body }
    })
    this.handlers.set(CMD.BT_GET_PAIRED_DEV_LIST, (msg) => {
      if (!msg) return null
      return { raw: msg.body }
    })

    // REQUEST_FIRMWARE_UPGRADE (8)
    this.handlers.set(CMD.REQUEST_FIRMWARE_UPGRADE, (msg) => {
      if (!msg) return null
      const code = msg.body[0]
      let result = 'unknown'
      if (code === 0) result = 'accepted'
      else if (code === 1) result = 'wrong-version'
      else if (code === 2) result = 'busy'
      else if (code === 3) result = 'card-full'
      else if (code === 4) result = 'card-error'
      return { result }
    })

    // Tone/UAC update request handlers
    const updateRequestHandler: CommandHandler = (msg) => {
      if (!msg) return null
      const code = msg.body[0]
      let result = 'success'
      if (code === 1) result = 'length-mismatch'
      else if (code === 2) result = 'busy'
      else if (code === 3) result = 'card-full'
      else if (code === 4) result = 'card-error'
      else if (code !== 0) result = String(code)
      return { code, result }
    }
    this.handlers.set(CMD.REQUEST_TONE_UPDATE, updateRequestHandler)
    this.handlers.set(CMD.REQUEST_UAC_UPDATE, updateRequestHandler)

    // TRANSFER_FILE_PARTIAL (21)
    this.handlers.set(CMD.TRANSFER_FILE_PARTIAL, (msg) => {
      if (!msg) return null
      const data = new Uint8Array(msg.body.length)
      for (let i = 0; i < msg.body.length; i++) data[i] = msg.body[i] & 0xff
      return data
    })

    // GET_RECORDING_FILE (18)
    this.handlers.set(CMD.GET_RECORDING_FILE, (msg) => {
      if (!msg || !msg.body || msg.body.length === 0) return { recording: null }
      const chars: string[] = []
      for (let i = 0; i < msg.body.length; i++) {
        chars.push(String.fromCharCode(msg.body[i]))
      }
      return { recording: chars.join(''), name: chars.join('') }
    })
  }

  // ================================================================
  // Public API — simple commands
  // ================================================================

  async getDeviceInfo(timeout = 10): Promise<DeviceInfo | null> {
    try {
      return await this.sendCommand<DeviceInfo | null>(
        new JensenMessage(CMD.GET_DEVICE_INFO), timeout, 'getDeviceInfo')
    } catch {
      return null
    }
  }

  async getTime(timeout = 5): Promise<{ time: string } | null> {
    try {
      return await this.sendCommand<{ time: string } | null>(
        new JensenMessage(CMD.GET_DEVICE_TIME), timeout, 'getTime')
    } catch {
      return null
    }
  }

  async setTime(date: Date, timeout = 5): Promise<{ result: string } | null> {
    const dateStr = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
      String(date.getHours()).padStart(2, '0'),
      String(date.getMinutes()).padStart(2, '0'),
      String(date.getSeconds()).padStart(2, '0')
    ].join('')
    try {
      return await this.sendCommand<{ result: string } | null>(
        new JensenMessage(CMD.SET_DEVICE_TIME).body(this.toBcd(dateStr)), timeout, 'setTime')
    } catch {
      return null
    }
  }

  async getFileCount(timeout = 15): Promise<{ count: number } | null> {
    try {
      return await this.sendCommand<{ count: number } | null>(
        new JensenMessage(CMD.GET_FILE_COUNT), timeout, 'getFileCount')
    } catch {
      return null
    }
  }

  async getSettings(timeout = 5): Promise<DeviceSettings | null> {
    if (this.versionNumber && this.versionNumber < 327714) {
      return { autoRecord: false, autoPlay: false }
    }
    try {
      return await this.sendCommand<DeviceSettings | null>(
        new JensenMessage(CMD.GET_SETTINGS), timeout, 'getSettings')
    } catch {
      return null
    }
  }

  async setAutoRecord(enabled: boolean, timeout = 5): Promise<{ result: string } | null> {
    if (this.versionNumber && this.versionNumber < 327714) {
      return { result: 'unsupported' }
    }
    try {
      return await this.sendCommand<{ result: string } | null>(
        new JensenMessage(CMD.SET_SETTINGS).body([0, 0, 0, enabled ? 1 : 2]), timeout, 'setAutoRecord')
    } catch {
      return null
    }
  }

  async getCardInfo(timeout = 10): Promise<CardInfo | null> {
    if (this.versionNumber !== null && this.versionNumber < 327733) return null
    try {
      return await this.sendCommand<CardInfo | null>(
        new JensenMessage(CMD.GET_CARD_INFO), timeout, 'getCardInfo')
    } catch {
      return null
    }
  }

  async formatCard(timeout = 30): Promise<{ result: string } | null> {
    if (this.versionNumber && this.versionNumber < 327733) return null
    try {
      return await this.sendCommand<{ result: string } | null>(
        new JensenMessage(CMD.FORMAT_CARD).body([1, 2, 3, 4]), timeout, 'formatCard')
    } catch {
      return null
    }
  }

  async deleteFile(filename: string, timeout = 10): Promise<{ result: string } | null> {
    const body: number[] = []
    for (let i = 0; i < filename.length; i++) body.push(filename.charCodeAt(i))
    try {
      return await this.sendCommand<{ result: string } | null>(
        new JensenMessage(CMD.DELETE_FILE).body(body), timeout, `deleteFile:${filename}`)
    } catch {
      return null
    }
  }

  // ================================================================
  // Public API — listFiles (handler-based, matching jensen.js)
  // ================================================================

  /**
   * List files on device. Uses dynamic handler that accumulates multi-packet response.
   * Matches jensen.js s.prototype.listFiles exactly:
   * - Checks filelist lock
   * - Gets file count for old firmware
   * - Fix 3: Uses incremental stateful parser — each packet only parses NEW data,
   *   eliminating the O(N^2) re-parse-everything behaviour of the old implementation.
   * - Handler returns file array when complete, undefined when waiting
   */
  async listFiles(
    onProgress?: (filesFound: number, expectedFiles: number) => void,
    expectedFileCount?: number,
    onNewFiles?: (files: FileInfo[]) => void
  ): Promise<FileInfo[] | null> {
    const key = 'filelist'

    // Prevent concurrent listing (jensen.js: if (this[e] != null) return null)
    if (this.data[key] != null) return []

    let fileCount: { count: number } | null = null

    // Get file count for old firmware (jensen.js version check)
    if (this.versionNumber === undefined || this.versionNumber === null || this.versionNumber <= 327722) {
      fileCount = await this.getFileCount(5)
      if (fileCount == null) return []
    }
    if (fileCount && fileCount.count === 0) return []

    // Fix 3: Initialize incremental state object instead of Uint8Array[] accumulator.
    const TAIL_BUFFER_SIZE = 4096 // Generous upper bound for a single file entry
    const state: FileListState = {
      tailBuffer: new Uint8Array(TAIL_BUFFER_SIZE),
      tailLen: 0,
      files: [],
      headerTotal: 0,
      headerParsed: false
    }
    this.data[key] = state
    const totalExpected = expectedFileCount ?? fileCount?.count ?? 0
    onProgress?.(0, totalExpected)

    const LISTFILES_STALL_TIMEOUT_MS = 10 * 60_000
    let stallTimeoutId: ReturnType<typeof setTimeout> | null = null

    const settlePartialFileList = (): void => {
      const st = this.data[key] as FileListState | null
      this.data[key] = null

      // Replace handler with no-op absorber so late packets do not re-trigger anything.
      this.handlers.set(CMD.GET_FILE_LIST, () => undefined)

      let result: FileInfo[]
      if (st && st.files.length > 0) {
        result = st.files.filter(f => f.time !== null)
        console.warn(
          `[Jensen] listFiles stalled for ${LISTFILES_STALL_TIMEOUT_MS / 60_000} minutes — ` +
          `returning ${result.length} partial files`
        )
      } else {
        result = []
        console.warn(
          `[Jensen] listFiles stalled for ${LISTFILES_STALL_TIMEOUT_MS / 60_000} minutes — ` +
          `no files parsed (handler called: ${st ? 'yes' : 'no'}, tailLen: ${st?.tailLen ?? 'N/A'})`
        )
      }

      if (this.currentCommandTag) {
        const pending = this.pendingPromises.get(this.currentCommandTag)
        if (pending) {
          if (pending.timeout) clearTimeout(pending.timeout)
          pending.resolve(result)
          this.pendingPromises.delete(this.currentCommandTag)
        }
        this.currentCommandTag = null
        this.currentOperationName = null
        this.sendNextCommand()
      }
    }

    const armListFilesStallTimeout = (): void => {
      if (stallTimeoutId) clearTimeout(stallTimeoutId)
      stallTimeoutId = setTimeout(settlePartialFileList, LISTFILES_STALL_TIMEOUT_MS)
    }

    // Register dynamic handler for GET_FILE_LIST (matches jensen.js handler registration)
    this.handlers.set(CMD.GET_FILE_LIST, (msg, device) => {
      const st = device.data[key] as FileListState | null

      // Empty body = end of file list (jensen.js: if (n.body.length == 0) return (r[e] = null), [])
      if (!msg || msg.body.length === 0) {
        device.data[key] = null
        if (!st) return []

        // Try one final parse of any remaining tail bytes
        if (st.tailLen > 0) {
          const finalBuf = st.tailBuffer.slice(0, st.tailLen)
          const { files: extraFiles } = device.parseFileListFlat(finalBuf)
          if (extraFiles.length > 0) {
            st.files.push(...extraFiles)
          }
        }
        return st.files.filter(f => f.time !== null)
      }

      if (!st) return undefined // Lock released by timeout; absorb late packet

      // The device can spend several minutes preparing and streaming large file lists.
      // Treat only prolonged silence as a stall; do not enforce a short total deadline.
      armListFilesStallTimeout()

      // Fix 3: Build working buffer = tail bytes from previous packet + current body
      const bodyLen = msg.body.length
      const workLen = st.tailLen + bodyLen
      const work = new Uint8Array(workLen)
      work.set(st.tailBuffer.subarray(0, st.tailLen), 0)
      work.set(msg.body, st.tailLen)

      // Handle optional 0xFF 0xFF header (only in the very first bytes)
      let parseStart = 0
      if (!st.headerParsed) {
        st.headerParsed = true
        if (workLen >= 6 && (work[0] & 0xff) === 0xff && (work[1] & 0xff) === 0xff) {
          st.headerTotal =
            ((work[2] & 0xff) << 24) |
            ((work[3] & 0xff) << 16) |
            ((work[4] & 0xff) << 8) |
            (work[5] & 0xff)
          parseStart = 6
        }
      }

      // Incrementally parse file entries from the working buffer
      const prevCount = st.files.length
      let pos = parseStart

      // Diagnostic: log first packet with data dump to debug parsing
      if (prevCount === 0 && st.tailLen === 0) {
        // Sanitize all USB-derived values before logging to prevent log injection
        const hexDump = Array.from(work.slice(0, Math.min(40, workLen)))
          .map(b => (b & 0xff).toString(16).padStart(2, '0')).join(' ').replace(/[^\da-f ]/gi, '')
        const safeBodyLen = Math.trunc(bodyLen)
        const safeWorkLen = Math.trunc(workLen)
        const safeHeaderTotal = Math.trunc(st.headerTotal)
        const safeParseStart = Math.trunc(parseStart)
        console.log(`[Jensen] listFiles handler: bodyLen=${safeBodyLen}, workLen=${safeWorkLen}, headerParsed=${st.headerParsed}, headerTotal=${safeHeaderTotal}, parseStart=${safeParseStart}`)
        console.log(`[Jensen] listFiles first 40 bytes: ${hexDump}`)
        if (parseStart < workLen) {
          const firstVersion = Math.trunc(work[parseStart] & 0xff)
          const nameLen = parseStart + 4 <= workLen
            ? Math.trunc(((work[parseStart + 1] & 0xff) << 16) | ((work[parseStart + 2] & 0xff) << 8) | (work[parseStart + 3] & 0xff))
            : -1
          console.log(`[Jensen] listFiles first entry: version=${firstVersion}, nameLen=${nameLen}`)
        }
      }

      while (pos < workLen) {
        const entryStart = pos

        // Each entry: 1 byte version + 3 bytes name-len + name + 4 bytes file-len + 6 bytes padding + 16 bytes sig
        if (pos + 4 > workLen) break // Need at least version + nameLen bytes

        const fileVersion = work[pos++] & 0xff

        if (pos + 3 > workLen) { pos = entryStart; break }
        const nameLen =
          ((work[pos] & 0xff) << 16) |
          ((work[pos + 1] & 0xff) << 8) |
          (work[pos + 2] & 0xff)
        pos += 3

        if (pos + nameLen > workLen) { pos = entryStart; break }
        const nameChars: string[] = []
        for (let i = 0; i < nameLen; i++) {
          const ch = work[pos++] & 0xff
          if (ch > 0) nameChars.push(String.fromCharCode(ch))
        }

        if (pos + 4 > workLen) { pos = entryStart; break }
        const fileLength =
          ((work[pos] & 0xff) << 24) |
          ((work[pos + 1] & 0xff) << 16) |
          ((work[pos + 2] & 0xff) << 8) |
          (work[pos + 3] & 0xff)
        pos += 4

        if (pos + 6 > workLen) { pos = entryStart; break }
        pos += 6 // padding

        if (pos + 16 > workLen) { pos = entryStart; break }
        const sigParts: string[] = []
        for (let i = 0; i < 16; i++) {
          const hex = (work[pos++] & 0xff).toString(16)
          sigParts.push(hex.length === 1 ? '0' + hex : hex)
        }

        const filename = nameChars.join('')
        const { createDate, createTime, time } = device.parseFilenameDateTime(filename)
        const duration = calculateDurationSeconds(fileLength, fileVersion)

        st.files.push({
          name: filename,
          createDate,
          createTime,
          time,
          duration,
          version: fileVersion,
          length: fileLength,
          signature: sigParts.join('')
        })
      }

      // Save unparsed tail bytes for the next packet
      const remaining = workLen - pos
      if (remaining > 0) {
        // Grow tail buffer if needed (shouldn't happen with 4KB but be safe)
        if (remaining > st.tailBuffer.length) {
          st.tailBuffer = new Uint8Array(remaining * 2)
        }
        st.tailBuffer.set(work.subarray(pos), 0)
      }
      st.tailLen = remaining

      // Diagnostic: log parse results for first few packets
      const newlyParsed = st.files.length - prevCount
      if (st.files.length <= 200 || newlyParsed === 0) {
        // Sanitize USB-derived numeric values before logging to prevent log injection
        const safeNewly = Math.trunc(newlyParsed)
        const safeTotal = Math.trunc(st.files.length)
        const safeRemaining = Math.trunc(remaining)
        const safeWLen = Math.trunc(workLen)
        console.log(`[Jensen] listFiles parse: +${safeNewly} files (total: ${safeTotal}), remaining tail: ${safeRemaining} bytes, workLen: ${safeWLen}`)
      }

      // Emit only newly-parsed files for streaming display
      if (onNewFiles && st.files.length > prevCount) {
        onNewFiles(st.files.slice(prevCount))
      }

      const effectiveTotal = st.headerTotal > 0 ? st.headerTotal : totalExpected
      onProgress?.(st.files.length, effectiveTotal > 0 ? effectiveTotal : st.files.length)

      // Check if complete (jensen.js: (t && h.length >= t.count) || (a > -1 && h.length >= a))
      // Fix 2: Also resolve when expectedFileCount (totalExpected) is reached — handles firmware
      // > v327722 that doesn't send the 0xFF total header, so headerTotal stays 0.
      const countTarget = fileCount?.count ?? 0
      if ((countTarget > 0 && st.files.length >= countTarget) || (st.headerTotal > 0 && st.files.length >= st.headerTotal) || (totalExpected > 0 && st.files.length >= totalExpected)) {
        device.data[key] = null
        return st.files.filter(f => f.time !== null)
      }

      // Not done yet — return undefined to keep waiting
      return undefined
    })

    // Send command with no per-command timeout; the stall watchdog only fires after prolonged silence.
    const commandPromise = this.sendCommand<FileInfo[]>(
      new JensenMessage(CMD.GET_FILE_LIST), undefined, 'listFiles')
    armListFilesStallTimeout()

    try {
      return await commandPromise
    } finally {
      if (stallTimeoutId) clearTimeout(stallTimeoutId)
    }
  }

  // ================================================================
  // Public API — downloadFile (handler-based, matching jensen.js streaming/getFile)
  // ================================================================

  /**
   * Download a file from device. Uses dynamic handler that accumulates data.
   * Matches jensen.js streaming()/getFile():
   * - Sets onreceive for real-time byte progress
   * - Registers handler that calls onChunk for each packet
   * - Handler returns true when received >= fileSize
   */
  async downloadFile(
    filename: string,
    fileSize: number,
    onChunk: (data: Uint8Array) => void,
    onProgress?: (received: number) => void,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (!this.device) return false
    if (signal?.aborted) return false

    let received = 0
    let aborted = false

    // Set real-time progress callback (jensen.js: this.onreceive = r)
    this.onreceive = onProgress ? () => onProgress(received) : null

    // Abort handling
    const abortHandler = (): void => {
      aborted = true
      // Replace handler with no-op absorber for remaining data
      this.handlers.set(CMD.TRANSFER_FILE, () => undefined)
      this.onreceive = null
      // Force-resolve the pending promise with false
      if (this.currentCommandTag) {
        const pending = this.pendingPromises.get(this.currentCommandTag)
        if (pending) {
          if (pending.timeout) clearTimeout(pending.timeout)
          pending.resolve(false)
          this.pendingPromises.delete(this.currentCommandTag)
          this.currentCommandTag = null
          this.currentOperationName = null
          this.sendNextCommand()
        }
      }
    }
    signal?.addEventListener('abort', abortHandler, { once: true })

    if (shouldLog()) console.log(`[Jensen] downloadFile: ${filename}, size=${fileSize}`)

    // Register handler for TRANSFER_FILE (matches jensen.js: s.registerHandler(5, ...))
    this.handlers.set(CMD.TRANSFER_FILE, (msg) => {
      if (aborted) return undefined // Absorb stale data after abort

      // null msg = transfer fail (jensen.js: if (b == null) ... return "fail")
      if (!msg) {
        if (shouldLog()) console.log('[Jensen] downloadFile: transfer fail (null msg)')
        signal?.removeEventListener('abort', abortHandler)
        this.onreceive = null
        return false
      }

      // Accumulate data (jensen.js: a += b.body.length, n(b.body))
      received += msg.body.length
      onChunk(new Uint8Array(msg.body))

      // Check if complete (jensen.js: if (h >= t) return "OK")
      if (received >= fileSize) {
        if (shouldLog()) console.log(`[Jensen] downloadFile: complete, ${received}/${fileSize}`)
        signal?.removeEventListener('abort', abortHandler)
        this.onreceive = null
        return true
      }

      return undefined // Keep waiting
    })

    // Build command body (jensen.js: filename as char codes)
    const body: number[] = []
    for (let i = 0; i < filename.length; i++) body.push(filename.charCodeAt(i))

    try {
      const result = await this.sendCommand<boolean>(
        new JensenMessage(CMD.TRANSFER_FILE).body(body), undefined, `downloadFile:${filename}`)
      this.onreceive = null
      signal?.removeEventListener('abort', abortHandler)
      return result ?? false
    } catch {
      this.onreceive = null
      signal?.removeEventListener('abort', abortHandler)
      return false
    }
  }

  // ================================================================
  // Public API — Realtime streaming
  // ================================================================

  async getRealtimeSettings(timeout = 5): Promise<RealtimeSettings | null> {
    try {
      const result = await this.sendCommand<ResponseMessage | null>(
        new JensenMessage(CMD.REALTIME_READ_SETTING), timeout, 'getRealtimeSettings')
      if (!result) return null
      return {
        enabled: result.body && result.body.length > 0 ? result.body[0] === 1 : false,
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16
      }
    } catch {
      return null
    }
  }

  async startRealtime(timeout = 5): Promise<{ result: string } | null> {
    try {
      return await this.sendCommand<{ result: string } | null>(
        new JensenMessage(CMD.REALTIME_CONTROL).body([0, 0, 0, 0, 0, 0, 0, 1]), timeout, 'startRealtime')
    } catch {
      return null
    }
  }

  async pauseRealtime(timeout = 5): Promise<{ result: string } | null> {
    try {
      return await this.sendCommand<{ result: string } | null>(
        new JensenMessage(CMD.REALTIME_CONTROL).body([0, 0, 0, 1, 0, 0, 0, 1]), timeout, 'pauseRealtime')
    } catch {
      return null
    }
  }

  async stopRealtime(timeout = 5): Promise<{ result: string } | null> {
    try {
      return await this.sendCommand<{ result: string } | null>(
        new JensenMessage(CMD.REALTIME_CONTROL).body([0, 0, 0, 2, 0, 0, 0, 1]), timeout, 'stopRealtime')
    } catch {
      return null
    }
  }

  async getRealtimeData(offset: number, timeout = 5): Promise<RealtimeData | null> {
    try {
      return await this.sendCommand<RealtimeData | null>(
        new JensenMessage(CMD.REALTIME_TRANSFER).body([
          (offset >> 24) & 0xff, (offset >> 16) & 0xff, (offset >> 8) & 0xff, offset & 0xff
        ]), timeout, 'getRealtimeData')
    } catch {
      return null
    }
  }

  // ================================================================
  // Public API — Battery (P1 only)
  // ================================================================

  isP1Device(): boolean {
    return this.model === 'hidock-p1' || this.model === 'hidock-p1-mini'
  }

  async getBatteryStatus(timeout = 5): Promise<BatteryStatus | null> {
    if (!this.isP1Device()) return null
    try {
      return await this.sendCommand<BatteryStatus | null>(
        new JensenMessage(CMD.GET_BATTERY_STATUS), timeout, 'getBatteryStatus')
    } catch {
      return null
    }
  }

  // ================================================================
  // Public API — Bluetooth (P1 only)
  // ================================================================

  async scanBluetoothDevices(timeout = 35): Promise<{ result: string } | null> {
    if (!this.isP1Device()) return null
    try {
      return await this.sendCommand<{ result: string } | null>(
        new JensenMessage(CMD.BLUETOOTH_SCAN), timeout, 'scanBluetoothDevices')
    } catch {
      return null
    }
  }

  async startBluetoothScan(duration = 30, timeout = 35): Promise<{ result: string } | null> {
    if (!this.isP1Device()) return null
    try {
      return await this.sendCommand<{ result: string } | null>(
        new JensenMessage(CMD.BT_SCAN).body([1, duration & 0xff]), timeout, 'startBluetoothScan')
    } catch {
      return null
    }
  }

  async stopBluetoothScan(timeout = 5): Promise<{ result: string } | null> {
    if (!this.isP1Device()) return null
    try {
      return await this.sendCommand<{ result: string } | null>(
        new JensenMessage(CMD.BT_SCAN).body([0]), timeout, 'stopBluetoothScan')
    } catch {
      return null
    }
  }

  async getBluetoothDeviceList(timeout = 10): Promise<{ raw: Uint8Array } | null> {
    if (!this.isP1Device()) return null
    try {
      return await this.sendCommand<{ raw: Uint8Array } | null>(
        new JensenMessage(CMD.BT_DEV_LIST), timeout, 'getBluetoothDeviceList')
    } catch {
      return null
    }
  }

  async getPairedDevices(timeout = 10): Promise<{ raw: Uint8Array } | null> {
    if (!this.isP1Device()) return null
    try {
      return await this.sendCommand<{ raw: Uint8Array } | null>(
        new JensenMessage(CMD.BT_GET_PAIRED_DEV_LIST), timeout, 'getPairedDevices')
    } catch {
      return null
    }
  }

  async removePairedDevices(timeout = 10): Promise<{ result: string } | null> {
    if (!this.isP1Device()) return null
    try {
      return await this.sendCommand<{ result: string } | null>(
        new JensenMessage(CMD.BT_REMOVE_PAIRED_DEV).body([0]), timeout, 'removePairedDevices')
    } catch {
      return null
    }
  }

  async connectBluetoothDevice(timeout = 10): Promise<{ result: string } | null> {
    if (!this.isP1Device()) return null
    try {
      return await this.sendCommand<{ result: string } | null>(
        new JensenMessage(CMD.BLUETOOTH_CMD).body([1]), timeout, 'connectBluetoothDevice')
    } catch {
      return null
    }
  }

  async disconnectBluetoothDevice(timeout = 10): Promise<{ result: string } | null> {
    if (!this.isP1Device()) return null
    try {
      return await this.sendCommand<{ result: string } | null>(
        new JensenMessage(CMD.BLUETOOTH_CMD).body([0]), timeout, 'disconnectBluetoothDevice')
    } catch {
      return null
    }
  }

  async getBluetoothStatus(timeout = 5): Promise<BluetoothStatus | null> {
    if (!this.isP1Device()) return null
    try {
      return await this.sendCommand<BluetoothStatus | null>(
        new JensenMessage(CMD.BLUETOOTH_STATUS), timeout, 'getBluetoothStatus')
    } catch {
      return null
    }
  }

  // ================================================================
  // Helpers — BCD, file parsing
  // ================================================================

  private toBcd(str: string): number[] {
    const result: number[] = []
    for (let i = 0; i < str.length; i += 2) {
      const high = (str.charCodeAt(i) - 48) & 0xf
      const low = (str.charCodeAt(i + 1) - 48) & 0xf
      result.push((high << 4) | low)
    }
    return result
  }

  fromBcd(...bytes: number[]): string {
    let result = ''
    for (const byte of bytes) {
      result += ((byte >> 4) & 0xf).toString()
      result += (byte & 0xf).toString()
    }
    return result
  }

  /**
   * Parse file list from flat byte buffer.
   * Matches jensen.js file parsing in the GET_FILE_LIST handler.
   */
  parseFileListFlat(buffer: Uint8Array): { files: FileInfo[]; headerTotal: number } {
    const files: FileInfo[] = []
    let pos = 0
    let headerTotal = 0

    // Check for header (0xFF 0xFF + 4 byte count)
    if (buffer.length >= 6 && (buffer[0] & 0xff) === 0xff && (buffer[1] & 0xff) === 0xff) {
      headerTotal =
        ((buffer[2] & 0xff) << 24) |
        ((buffer[3] & 0xff) << 16) |
        ((buffer[4] & 0xff) << 8) |
        (buffer[5] & 0xff)
      pos = 6
    }

    // Parse file entries (matches jensen.js parse loop)
    while (pos < buffer.length) {
      const startPos = pos

      if (pos + 4 > buffer.length) break

      // File version (1 byte)
      const fileVersion = buffer[pos++] & 0xff

      // Filename length (3 bytes big-endian)
      if (pos + 3 > buffer.length) { pos = startPos; break }
      const nameLen =
        ((buffer[pos] & 0xff) << 16) |
        ((buffer[pos + 1] & 0xff) << 8) |
        (buffer[pos + 2] & 0xff)
      pos += 3

      // Filename
      if (pos + nameLen > buffer.length) { pos = startPos; break }
      const nameChars: string[] = []
      for (let i = 0; i < nameLen; i++) {
        const ch = buffer[pos++] & 0xff
        if (ch > 0) nameChars.push(String.fromCharCode(ch))
      }

      // File length (4 bytes big-endian)
      if (pos + 4 > buffer.length) { pos = startPos; break }
      const fileLength =
        ((buffer[pos] & 0xff) << 24) |
        ((buffer[pos + 1] & 0xff) << 16) |
        ((buffer[pos + 2] & 0xff) << 8) |
        (buffer[pos + 3] & 0xff)
      pos += 4

      // Skip 6 bytes padding
      if (pos + 6 > buffer.length) { pos = startPos; break }
      pos += 6

      // Signature (16 bytes)
      if (pos + 16 > buffer.length) { pos = startPos; break }
      const sigParts: string[] = []
      for (let i = 0; i < 16; i++) {
        const hex = (buffer[pos++] & 0xff).toString(16)
        sigParts.push(hex.length === 1 ? '0' + hex : hex)
      }

      const filename = nameChars.join('')
      const { createDate, createTime, time } = this.parseFilenameDateTime(filename)
      const duration = calculateDurationSeconds(fileLength, fileVersion)

      files.push({
        name: filename,
        createDate,
        createTime,
        time,
        duration,
        version: fileVersion,
        length: fileLength,
        signature: sigParts.join('')
      })
    }

    return { files, headerTotal }
  }

  /**
   * Parse date/time from HiDock recording filename.
   * Handles all known formats from H1, H1E, P1 devices.
   */
  parseFilenameDateTime(filename: string): { createDate: string; createTime: string; time: Date | null } {
    const monthNames: Record<string, number> = {
      'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
      'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
    }

    // Format 1: 2025May13-160405-Rec59.hda (YYYYMonDD-HHMMSS)
    const monthNameMatch = filename.match(/(\d{4})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{1,2})-(\d{2})(\d{2})(\d{2})/)
    if (monthNameMatch) {
      const [, year, monthName, day, hour, minute, second] = monthNameMatch
      const month = monthNames[monthName]
      const createDate = `${year}-${String(month + 1).padStart(2, '0')}-${day.padStart(2, '0')}`
      const createTime = `${hour}:${minute}:${second}`
      const time = new Date(parseInt(year), month, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second))
      return { createDate, createTime, time }
    }

    // Format 2: YYYYMMDDHHMMSS pattern (e.g., 20250513160405REC001.wav)
    const oldWavMatch = filename.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})REC/)
    if (oldWavMatch) {
      const [, year, month, day, hour, minute, second] = oldWavMatch
      const createDate = `${year}-${month}-${day}`
      const createTime = `${hour}:${minute}:${second}`
      const time = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second))
      return { createDate, createTime, time }
    }

    // Format 3: HDA_YYYYMMDD_HHMMSS or generic numeric
    const numericMatch = filename.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})[-_](\d{2})(\d{2})(\d{2})?/)
    if (numericMatch) {
      const [, year, month, day, hour, minute, second = '00'] = numericMatch
      const createDate = `${year}-${month}-${day}`
      const createTime = `${hour}:${minute}:${second}`
      const time = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second))
      return { createDate, createTime, time }
    }

    return { createDate: '', createTime: '', time: null }
  }
}

// NOTE: The process-wide singleton (getJensenDevice) lives in the consuming
// adapter, not here — each environment binds its own USB backend before
// constructing the shared JensenDevice. See:
//   - apps/electron/electron/main/services/jensen.ts (node-usb WebUSB)
//   - apps/web device service (navigator.usb)
