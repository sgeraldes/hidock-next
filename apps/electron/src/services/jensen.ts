/**
 * Jensen Protocol Implementation for HiDock devices
 * TypeScript port of the Jensen protocol for USB communication
 */

// Command IDs from the Jensen protocol
// Source: Official HiDock HiNotes jensen.js (December 2025)
export const CMD = {
  // Basic device commands
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

  // New commands from HiNotes
  TRANSFER_FILE_PARTIAL: 21,
  REQUEST_TONE_UPDATE: 22,
  TONE_UPDATE: 23,
  REQUEST_UAC_UPDATE: 24,
  UAC_UPDATE: 25,

  // Realtime streaming commands (ALL devices)
  REALTIME_READ_SETTING: 32,
  REALTIME_CONTROL: 33,
  REALTIME_TRANSFER: 34,

  // Bluetooth commands (P1 devices only)
  BLUETOOTH_SCAN: 4097,
  BLUETOOTH_CMD: 4098,
  BLUETOOTH_STATUS: 4099,
  GET_BATTERY_STATUS: 4100,
  BT_SCAN: 4101,
  BT_DEV_LIST: 4102,
  BT_GET_PAIRED_DEV_LIST: 4103,
  BT_REMOVE_PAIRED_DEV: 4104,

  // Factory/debug commands
  FACTORY_RESET: 61451,
  BLUE_B_TIMEOUT: 61457
} as const

// USB Constants
export const USB_VENDOR_ID = 0x10d6 // Actions Semiconductor
export const USB_PRODUCT_IDS = {
  // Original product IDs (hex)
  H1: 0xaf0c,       // 45068 decimal
  H1E_OLD: 0xaf0d,  // 45069 decimal
  H1E: 0xb00d,
  P1_OLD: 0xaf0e,   // 45070 decimal
  P1: 0xb00e,
  P1_MINI: 0xaf0f,  // 45071 decimal
  // Alternative product IDs
  H1_ALT1: 0x0100,  // 256 decimal
  H1E_ALT1: 0x0101, // 257 decimal
  H1_ALT2: 0x0102,  // 258 decimal
  H1E_ALT2: 0x0103, // 259 decimal
  P1_ALT: 0x2040,   // 8256 decimal
  P1_MINI_ALT: 0x2041 // 8257 decimal
}

export const EP_OUT = 0x01
export const EP_IN = 0x82

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
  used: number      // Used space in MiB
  capacity: number  // Total capacity in MiB
  free: number      // Free space in MiB
  status: string    // Status code as hex string
}

/**
 * Calculate recording duration based on file version and length.
 *
 * IMPORTANT: Matches the Python desktop app's _calculate_file_duration() which applies
 * a 4x correction factor to all calculations. The device reports compressed/encoded
 * file sizes, so the formula must account for the actual audio bitrate.
 *
 * Audio format constants (from Python):
 * - CHANNELS = 2 (stereo)
 * - BYTES_PER_SAMPLE = 1 (8-bit samples)
 * - WAV_HEADER_SIZE = 44
 *
 * Different firmware versions use different audio formats:
 * - Version 1: Custom compressed format: (bytes/32)*2*4 = bytes/4
 * - Version 2: 48kHz stereo 8-bit WAV with 4x correction
 * - Version 3: 24kHz stereo 8-bit WAV with 4x correction
 * - Version 5: 12kHz format with 4x correction
 * - Default: 16kHz stereo 8-bit with 4x correction
 */
function calculateDurationSeconds(fileLength: number, fileVersion: number): number {
  console.log(`[Jensen] calculateDurationSeconds: fileLength=${fileLength}, fileVersion=${fileVersion}`)

  const WAV_HEADER_SIZE = 44
  const CHANNELS = 2  // Stereo
  const BYTES_PER_SAMPLE = 1  // 8-bit samples
  const CORRECTION_FACTOR = 4  // Applied to all versions per Python implementation

  if (fileVersion === 1) {
    // Version 1: HDA compressed format - verified against real recordings
    // Example: 15.7MB file = 1959 seconds = 32m39s at 8000 bytes/sec effective rate
    // Note: Python uses different formula but this was empirically verified
    const duration = Math.round(fileLength / 8000)
    console.log(`[Jensen] Version 1 duration: ${duration} seconds (${Math.floor(duration/60)}m ${duration%60}s)`)
    return duration
  } else if (fileVersion === 2) {
    // Version 2: 48kHz stereo 8-bit WAV with 4x correction
    // Python: (file_size - 44) / (48000 * 2 * 1) * 4 = (file_size - 44) / 24000
    const bytesPerSecond = 48000 * CHANNELS * BYTES_PER_SAMPLE  // 96000
    const effectiveBps = bytesPerSecond / CORRECTION_FACTOR  // 24000
    const duration = fileLength > WAV_HEADER_SIZE ? Math.round((fileLength - WAV_HEADER_SIZE) / effectiveBps) : 0
    console.log(`[Jensen] Version 2 duration: ${duration} seconds`)
    return duration
  } else if (fileVersion === 3) {
    // Version 3: 24kHz stereo 8-bit WAV with 4x correction
    // Python: (file_size - 44) / (24000 * 2 * 1) * 4 = (file_size - 44) / 12000
    const bytesPerSecond = 24000 * CHANNELS * BYTES_PER_SAMPLE  // 48000
    const effectiveBps = bytesPerSecond / CORRECTION_FACTOR  // 12000
    const duration = fileLength > WAV_HEADER_SIZE ? Math.round((fileLength - WAV_HEADER_SIZE) / effectiveBps) : 0
    console.log(`[Jensen] Version 3 duration: ${duration} seconds`)
    return duration
  } else if (fileVersion === 5) {
    // Version 5: 12kHz format with 4x correction
    // Python: (file_size / 12000) * 4 = file_size / 3000
    const effectiveBps = 12000 / CORRECTION_FACTOR  // 3000
    const duration = Math.round(fileLength / effectiveBps)
    console.log(`[Jensen] Version 5 duration: ${duration} seconds`)
    return duration
  } else {
    // Default: 16kHz stereo 8-bit with 4x correction
    // Python: (file_size / (16000 * 2 * 1)) * 4 = file_size / 8000
    const bytesPerSecond = 16000 * CHANNELS * BYTES_PER_SAMPLE  // 32000
    const effectiveBps = bytesPerSecond / CORRECTION_FACTOR  // 8000
    const duration = Math.round(fileLength / effectiveBps)
    console.log(`[Jensen] Default (version ${fileVersion}) duration: ${duration} seconds`)
    return duration
  }
}

export interface DeviceSettings {
  autoRecord: boolean
  autoPlay: boolean
  notification?: boolean
  bluetoothTone?: boolean
}

// Realtime streaming interfaces
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

// Battery status interface (P1 devices only)
export interface BatteryStatus {
  status: 'idle' | 'charging' | 'full'
  batteryLevel: number
  voltage?: number
}

// Bluetooth interfaces (P1 devices only)
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

// Message builder for Jensen protocol
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

    // Header magic
    buffer[pos++] = 0x12
    buffer[pos++] = 0x34

    // Command ID (16-bit big-endian)
    buffer[pos++] = (this.command >> 8) & 0xff
    buffer[pos++] = this.command & 0xff

    // Sequence ID (32-bit big-endian)
    buffer[pos++] = (this.index >> 24) & 0xff
    buffer[pos++] = (this.index >> 16) & 0xff
    buffer[pos++] = (this.index >> 8) & 0xff
    buffer[pos++] = this.index & 0xff

    // Body length (32-bit big-endian)
    const len = this.msgBody.length
    buffer[pos++] = (len >> 24) & 0xff
    buffer[pos++] = (len >> 16) & 0xff
    buffer[pos++] = (len >> 8) & 0xff
    buffer[pos++] = len & 0xff

    // Body
    for (let i = 0; i < this.msgBody.length; i++) {
      buffer[pos++] = this.msgBody[i] & 0xff
    }

    return buffer
  }
}

// Parsed response message
interface ResponseMessage {
  id: number
  sequence: number
  body: Uint8Array
}

// Logging configuration - set to true for debugging download issues
const DEBUG_USB = false // Enable detailed USB transfer logging
const DEBUG_PROTOCOL = true // Enable protocol-level logging

// Main Jensen device class
export class JensenDevice {
  private device: USBDevice | null = null
  private sequenceId = 0
  private receiveBuffer: Uint8Array = new Uint8Array(0)

  // USB operation mutex - prevents concurrent USB operations that cause InvalidStateError
  private operationLock: Promise<void> = Promise.resolve()
  private lockHolder: string | null = null

  versionCode: string | null = null
  versionNumber: number | null = null
  serialNumber: string | null = null
  model: DeviceModel = 'unknown'

  ondisconnect?: () => void
  onconnect?: () => void
  onprogress?: (bytes: number) => void

  /**
   * Execute a USB operation with exclusive lock.
   * This prevents concurrent USB operations that cause InvalidStateError.
   * All USB transferIn/transferOut calls should go through this.
   */
  private async withLock<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
    // Wait for any pending operations to complete
    const previousLock = this.operationLock
    let releaseLock: () => void

    // Create a new lock that subsequent operations will wait on
    this.operationLock = new Promise((resolve) => {
      releaseLock = resolve
    })

    try {
      // Wait for previous operation to complete
      await previousLock

      // We now hold the lock
      this.lockHolder = operationName
      if (DEBUG_PROTOCOL) console.log(`[Jensen] Lock acquired for: ${operationName}`)

      // Execute the operation
      return await operation()
    } finally {
      // Release the lock
      if (DEBUG_PROTOCOL) console.log(`[Jensen] Lock released for: ${operationName}`)
      this.lockHolder = null
      releaseLock!()
    }
  }

  // Check if WebUSB is available
  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'usb' in navigator
  }

  // Request and connect to a HiDock device
  // Follows official jensen.js pattern: disconnect first, then connect
  async connect(): Promise<boolean> {
    if (!JensenDevice.isSupported()) {
      console.error('WebUSB not supported')
      return false
    }

    // CRITICAL: Always disconnect first to clean up any stale connections
    // This matches official jensen.js behavior and fixes "device in use" errors
    await this.disconnect()

    try {
      if (DEBUG_PROTOCOL) console.log('connect: Starting connection process')

      // First try to find already authorized devices
      const devices = await navigator.usb.getDevices()
      if (DEBUG_PROTOCOL) console.log('connect: Found', devices.length, 'authorized devices')

      let device = devices.find(
        (d) => d.vendorId === USB_VENDOR_ID && d.productName?.includes('HiDock')
      )

      if (!device) {
        if (DEBUG_PROTOCOL) console.log('connect: No authorized HiDock found, showing device picker')
        // Request a new device
        device = await navigator.usb.requestDevice({
          filters: [{ vendorId: USB_VENDOR_ID }]
        })
      } else {
        if (DEBUG_PROTOCOL) console.log('connect: Found authorized HiDock:', device.productName)
      }

      if (!device) {
        if (DEBUG_PROTOCOL) console.log('connect: No device selected')
        return false
      }

      if (DEBUG_PROTOCOL) console.log('connect: Opening device...')
      await device.open()
      if (DEBUG_PROTOCOL) console.log('connect: Device opened, selecting configuration...')
      await device.selectConfiguration(1)
      if (DEBUG_PROTOCOL) console.log('connect: Claiming interface...')
      await device.claimInterface(0)
      if (DEBUG_PROTOCOL) console.log('connect: Interface claimed successfully')

      this.device = device

      // Log device configuration for debugging
      if (DEBUG_USB) {
        console.log('[Jensen] Device configuration:', {
          vendorId: device.vendorId.toString(16),
          productId: device.productId.toString(16),
          productName: device.productName,
          configurations: device.configurations?.length
        })

        // Log the claimed interface and endpoints
        if (device.configuration) {
          const iface = device.configuration.interfaces[0]
          console.log('[Jensen] Interface 0 alternates:', iface.alternates.length)
          const alternate = iface.alternates[0]
          console.log('[Jensen] Endpoints:', alternate.endpoints.map(ep => ({
            endpointNumber: ep.endpointNumber,
            direction: ep.direction,
            type: ep.type,
            packetSize: ep.packetSize
          })))
        }
      }

      // Determine model from product ID
      switch (device.productId) {
        case USB_PRODUCT_IDS.H1:
        case USB_PRODUCT_IDS.H1_ALT1:
        case USB_PRODUCT_IDS.H1_ALT2:
          this.model = 'hidock-h1'
          break
        case USB_PRODUCT_IDS.H1E_OLD:
        case USB_PRODUCT_IDS.H1E:
        case USB_PRODUCT_IDS.H1E_ALT1:
        case USB_PRODUCT_IDS.H1E_ALT2:
          this.model = 'hidock-h1e'
          break
        case USB_PRODUCT_IDS.P1_OLD:
        case USB_PRODUCT_IDS.P1:
        case USB_PRODUCT_IDS.P1_ALT:
          this.model = 'hidock-p1'
          break
        case USB_PRODUCT_IDS.P1_MINI:
        case USB_PRODUCT_IDS.P1_MINI_ALT:
          this.model = 'hidock-p1-mini'
          break
        default:
          this.model = 'unknown'
      }

      console.log(`[Jensen] Connected to ${this.model}`)

      // Reset ALL protocol state on new connection (matches official jensen.js setup function)
      // This is critical for proper sequencing and prevents stale data issues
      this.sequenceId = 0
      this.receiveBuffer = new Uint8Array(0)
      this.versionCode = null
      this.versionNumber = null
      this.serialNumber = null

      this.onconnect?.()
      return true
    } catch (error) {
      console.error('[Jensen] Connection failed:', error)
      return false
    }
  }

  // Check if an operation is in progress (for external callers to check)
  isOperationInProgress(): boolean {
    return this.lockHolder !== null
  }

  // Try to auto-connect to previously authorized device
  // Follows official jensen.js pattern: disconnect first, then connect
  async tryConnect(): Promise<boolean> {
    if (!JensenDevice.isSupported()) return false

    // Don't reconnect if already connected - prevents race conditions during HMR
    if (this.isConnected()) {
      console.log('[Jensen] tryConnect: Already connected, skipping')
      return true
    }

    // Don't try to connect if an operation is in progress
    if (this.isOperationInProgress()) {
      console.log(`[Jensen] tryConnect: Operation in progress (${this.lockHolder}), skipping`)
      return false
    }

    // CRITICAL: Always disconnect first to clean up any stale connections
    // This matches official jensen.js behavior and fixes "device in use" errors
    await this.disconnect()

    try {
      const devices = await navigator.usb.getDevices()
      const device = devices.find(
        (d) => d.vendorId === USB_VENDOR_ID && d.productName?.includes('HiDock')
      )

      if (!device) return false

      await device.open()
      await device.selectConfiguration(1)
      await device.claimInterface(0)

      this.device = device

      // Determine model
      switch (device.productId) {
        case USB_PRODUCT_IDS.H1:
        case USB_PRODUCT_IDS.H1_ALT1:
        case USB_PRODUCT_IDS.H1_ALT2:
          this.model = 'hidock-h1'
          break
        case USB_PRODUCT_IDS.H1E_OLD:
        case USB_PRODUCT_IDS.H1E:
        case USB_PRODUCT_IDS.H1E_ALT1:
        case USB_PRODUCT_IDS.H1E_ALT2:
          this.model = 'hidock-h1e'
          break
        case USB_PRODUCT_IDS.P1_OLD:
        case USB_PRODUCT_IDS.P1:
        case USB_PRODUCT_IDS.P1_ALT:
          this.model = 'hidock-p1'
          break
        case USB_PRODUCT_IDS.P1_MINI:
        case USB_PRODUCT_IDS.P1_MINI_ALT:
          this.model = 'hidock-p1-mini'
          break
        default:
          this.model = 'unknown'
      }

      // Reset ALL protocol state on new connection (matches official jensen.js setup function)
      // This is critical for proper sequencing and prevents stale data issues
      this.sequenceId = 0
      this.receiveBuffer = new Uint8Array(0)
      this.versionCode = null
      this.versionNumber = null
      this.serialNumber = null

      this.onconnect?.()
      return true
    } catch {
      return false
    }
  }

  isConnected(): boolean {
    return this.device !== null && this.device.opened
  }

  async disconnect(): Promise<void> {
    if (this.device) {
      try {
        // Release interface before closing (critical for proper USB cleanup)
        if (this.device.opened) {
          try {
            await this.device.releaseInterface(0)
          } catch (e) {
            console.warn('[Jensen] Error releasing interface:', e)
          }
        }
        await this.device.close()
      } catch (e) {
        console.warn('[Jensen] Error closing device:', e)
      }
      this.device = null
      // Reset protocol state
      this.sequenceId = 0
      this.receiveBuffer = new Uint8Array(0)
      // Reset the operation lock to prevent stale locks from blocking future operations
      this.operationLock = Promise.resolve()
      this.lockHolder = null
      this.ondisconnect?.()
    }
  }

  getModel(): DeviceModel {
    return this.model
  }

  // Small delay helper
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // Read data from USB and append to receive buffer
  // Uses the same pattern as the working web app implementation
  private async readToBuffer(): Promise<boolean> {
    if (!this.device || !this.device.opened) return false

    try {
      // Read data from device with larger buffer for better performance (same as web app)
      const readSize = 4096 * 16 // 64KB buffer
      const result = await this.device.transferIn(2, readSize)

      if (result.status === 'ok' && result.data && result.data.byteLength > 0) {
        // Append to receive buffer
        // Important: Use slice() to create a copy, as the underlying buffer may be reused
        const newData = new Uint8Array(result.data.buffer.slice(result.data.byteOffset, result.data.byteOffset + result.data.byteLength))
        const combined = new Uint8Array(this.receiveBuffer.length + newData.length)
        combined.set(this.receiveBuffer)
        combined.set(newData, this.receiveBuffer.length)
        this.receiveBuffer = combined
        if (DEBUG_USB) console.log(`[Jensen] Read ${newData.length} bytes, buffer now ${this.receiveBuffer.length} bytes`)
        return true
      }
      return false
    } catch (error) {
      // Handle DOMException errors like the web app does
      if (error instanceof DOMException) {
        if (error.name === 'NetworkError') {
          // Timeout is expected, continue trying
          return false
        } else if (error.name === 'InvalidStateError') {
          console.error('[Jensen] Device connection lost')
          return false
        }
      }
      console.warn('[Jensen] USB read error:', error)
      return false
    }
  }

  // Try to parse a complete message from the receive buffer
  // Returns the message if found, null otherwise
  private tryParseMessage(): ResponseMessage | null {
    if (this.receiveBuffer.length < 12) return null

    // Find sync marker
    let syncPos = -1
    for (let i = 0; i <= this.receiveBuffer.length - 2; i++) {
      if (this.receiveBuffer[i] === 0x12 && this.receiveBuffer[i + 1] === 0x34) {
        syncPos = i
        break
      }
    }

    if (syncPos === -1) {
      // No sync marker found, clear buffer
      this.receiveBuffer = new Uint8Array(0)
      return null
    }

    // Discard any data before sync marker
    if (syncPos > 0) {
      if (DEBUG_USB) console.warn(`[Jensen] Discarding ${syncPos} bytes before sync marker`)
      this.receiveBuffer = this.receiveBuffer.slice(syncPos)
    }

    if (this.receiveBuffer.length < 12) return null

    // Parse header
    const cmdId = (this.receiveBuffer[2] << 8) | this.receiveBuffer[3]
    const seqId =
      (this.receiveBuffer[4] << 24) |
      (this.receiveBuffer[5] << 16) |
      (this.receiveBuffer[6] << 8) |
      this.receiveBuffer[7]

    const bodyLenRaw =
      (this.receiveBuffer[8] << 24) |
      (this.receiveBuffer[9] << 16) |
      (this.receiveBuffer[10] << 8) |
      this.receiveBuffer[11]

    const padding = (bodyLenRaw >> 24) & 0xff
    const bodyLen = bodyLenRaw & 0xffffff
    const totalLen = 12 + bodyLen + padding

    if (this.receiveBuffer.length < totalLen) {
      // Not enough data yet
      return null
    }

    // Extract body and consume from buffer
    const body = this.receiveBuffer.slice(12, 12 + bodyLen)
    this.receiveBuffer = this.receiveBuffer.slice(totalLen)

    return { id: cmdId, sequence: seqId, body }
  }

  // Receive a response matching expected sequence ID
  // Matches the working web app implementation pattern exactly
  private async receiveResponse(expectedCmdId: number, expectedSeqId: number, timeoutSec: number): Promise<ResponseMessage> {
    const startTime = Date.now()
    const timeoutMs = timeoutSec * 1000
    let readAttempts = 0

    if (DEBUG_PROTOCOL) console.log(`[Jensen] receiveResponse: waiting for cmd=${expectedCmdId}, seq=${expectedSeqId}, timeout=${timeoutSec}s`)

    while (Date.now() - startTime < timeoutMs) {
      try {
        readAttempts++
        // Read data from device with larger buffer for better performance (same as web app)
        const readSize = 4096 * 16 // 64KB buffer
        if (DEBUG_USB) console.log(`[Jensen] receiveResponse: attempt ${readAttempts}, calling transferIn(2, ${readSize})...`)
        const result = await this.device!.transferIn(2, readSize)
        if (DEBUG_USB) console.log(`[Jensen] receiveResponse: transferIn returned, status=${result.status}, bytesRead=${result.data?.byteLength || 0}`)

        if (result.status === 'ok' && result.data && result.data.byteLength > 0) {
          // Append to receive buffer
          // Important: Use slice() to create a copy, as the underlying buffer may be reused
          const newData = new Uint8Array(result.data.buffer.slice(result.data.byteOffset, result.data.byteOffset + result.data.byteLength))
          const combined = new Uint8Array(this.receiveBuffer.length + newData.length)
          combined.set(this.receiveBuffer)
          combined.set(newData, this.receiveBuffer.length)
          this.receiveBuffer = combined
          if (DEBUG_USB) console.log(`[Jensen] Read ${newData.length} bytes, buffer now ${this.receiveBuffer.length} bytes`)

          // Try to parse all complete packets in buffer
          let packetParsed = true
          while (packetParsed) {
            const msg = this.tryParseMessage()
            if (!msg) {
              packetParsed = false
              break
            }

            if (DEBUG_PROTOCOL) console.log(`[Jensen] Received: cmd=${msg.id}, seq=${msg.sequence}, bodyLen=${msg.body.length}`)

            // Check if this is the response we're waiting for (match by sequence ID like web app)
            if (msg.sequence === expectedSeqId) {
              return msg
            }

            // Unexpected message, log and continue (don't discard - might be for different command)
            if (DEBUG_PROTOCOL) console.warn(`[Jensen] Unexpected seq: expected seq=${expectedSeqId}, got cmd=${msg.id} seq=${msg.sequence}. Discarding.`)
          }
        }
      } catch (error) {
        // Handle DOMException errors like the web app does
        if (error instanceof DOMException) {
          if (DEBUG_USB) console.log(`[Jensen] receiveResponse: DOMException caught: ${error.name} - ${error.message}`)
          if (error.name === 'NetworkError') {
            // Timeout is expected, continue trying
            continue
          } else if (error.name === 'InvalidStateError') {
            console.error('[Jensen] Device connection lost')
            throw new Error('Device connection lost')
          }
        }
        console.error(`[Jensen] receiveResponse: Unexpected error:`, error)
        throw error
      }

      // Small delay to prevent busy waiting (same as web app)
      await this.delay(10)
    }

    console.error(`[Jensen] receiveResponse: Timeout after ${readAttempts} attempts`)
    throw new Error(`Response timeout for cmd=${expectedCmdId} seq=${expectedSeqId}`)
  }

  private parseResponse(msg: ResponseMessage): unknown {
    const body = msg.body

    switch (msg.id) {
      case CMD.GET_DEVICE_INFO: {
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

        this.versionCode = versionParts.join('.')
        this.versionNumber = versionNumber
        this.serialNumber = snChars.join('')

        return {
          versionCode: this.versionCode,
          versionNumber: this.versionNumber,
          sn: this.serialNumber
        }
      }

      case CMD.GET_DEVICE_TIME: {
        const bcd = this.fromBcd(body[0], body[1], body[2], body[3], body[4], body[5], body[6])
        return {
          time:
            bcd === '00000000000000'
              ? 'unknown'
              : bcd.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/gi, '$1-$2-$3 $4:$5:$6')
        }
      }

      case CMD.GET_FILE_COUNT: {
        if (body.length === 0) return { count: 0 }
        const count =
          ((body[0] & 0xff) << 24) |
          ((body[1] & 0xff) << 16) |
          ((body[2] & 0xff) << 8) |
          (body[3] & 0xff)
        return { count }
      }

      case CMD.GET_SETTINGS: {
        return {
          autoRecord: body[3] === 1,
          autoPlay: body[7] === 1,
          bluetoothTone: body[15] !== 1,
          notification: body.length >= 12 ? body[11] === 1 : undefined
        }
      }

      case CMD.GET_CARD_INFO: {
        // Parse storage info from device
        // IMPORTANT: Device returns values in MiB (binary megabytes)
        // Byte order: FREE space first (4 bytes), then CAPACITY (4 bytes), then status (4 bytes)
        // This matches the web app's working implementation
        let pos = 0
        const freeMiB =
          ((body[pos++] & 0xff) << 24) |
          ((body[pos++] & 0xff) << 16) |
          ((body[pos++] & 0xff) << 8) |
          (body[pos++] & 0xff)
        const capacityMiB =
          ((body[pos++] & 0xff) << 24) |
          ((body[pos++] & 0xff) << 16) |
          ((body[pos++] & 0xff) << 8) |
          (body[pos++] & 0xff)
        const statusRaw =
          ((body[pos++] & 0xff) << 24) |
          ((body[pos++] & 0xff) << 16) |
          ((body[pos++] & 0xff) << 8) |
          (body[pos] & 0xff)

        // Calculate used space (capacity - free)
        const usedMiB = capacityMiB - freeMiB

        if (DEBUG_PROTOCOL) {
          console.log(`[Jensen] Storage: free=${freeMiB} MiB, capacity=${capacityMiB} MiB, used=${usedMiB} MiB, status=0x${statusRaw.toString(16)}`)
        }

        return {
          // Return values in MiB for consistency with interface
          used: usedMiB,
          capacity: capacityMiB,
          free: freeMiB,
          status: statusRaw.toString(16)
        }
      }

      case CMD.DELETE_FILE: {
        let result = 'failed'
        if (body[0] === 0) result = 'success'
        else if (body[0] === 1) result = 'not-exists'
        return { result }
      }

      case CMD.SET_DEVICE_TIME:
      case CMD.SET_SETTINGS:
      case CMD.FORMAT_CARD:
      case CMD.RESTORE_FACTORY_SETTINGS:
      case CMD.FACTORY_RESET:
      case CMD.REALTIME_CONTROL:
        return { result: body[0] === 0 ? 'success' : 'failed' }

      case CMD.REALTIME_READ_SETTING:
        // Returns raw settings data - device-specific format
        return { raw: body }

      case CMD.REALTIME_TRANSFER: {
        // Format: 4 bytes rest count + audio data
        const rest =
          ((body[0] & 0xff) << 24) |
          ((body[1] & 0xff) << 16) |
          ((body[2] & 0xff) << 8) |
          (body[3] & 0xff)
        return {
          rest,
          data: body.slice(4)
        }
      }

      case CMD.GET_BATTERY_STATUS: {
        // Format: status byte, battery level, voltage bytes
        const statusByte = body[0] & 0xff
        let status: 'idle' | 'charging' | 'full' = 'idle'
        if (statusByte === 1) status = 'charging'
        else if (statusByte === 2) status = 'full'

        const batteryLevel = body[1] & 0xff
        const voltage =
          body.length >= 6
            ? ((body[2] & 0xff) << 24) |
              ((body[3] & 0xff) << 16) |
              ((body[4] & 0xff) << 8) |
              (body[5] & 0xff)
            : undefined

        return { status, batteryLevel, voltage }
      }

      case CMD.BLUETOOTH_STATUS: {
        return {
          connected: body[0] === 1,
          raw: body
        }
      }

      default:
        return { raw: body }
    }
  }

  // Send a command and wait for response (synchronous request-response)
  private async send<T>(msg: JensenMessage, timeoutSec?: number): Promise<T> {
    if (!this.device) {
      throw new Error('Device not connected')
    }

    if (!this.device.opened) {
      throw new Error('Device not opened')
    }

    const seqId = this.sequenceId++
    msg.sequence(seqId)

    const timeout = timeoutSec ?? 10
    if (DEBUG_PROTOCOL) console.log(`[Jensen] Sending: cmd=${msg.command}, seq=${seqId}`)

    const data = msg.make()

    try {
      await this.device.transferOut(1, data as unknown as BufferSource)
      if (DEBUG_PROTOCOL) console.log(`[Jensen] Command sent: cmd=${msg.command}, seq=${seqId}`)
    } catch (error) {
      console.error(`[Jensen] Failed to send cmd=${msg.command}:`, error)
      throw new Error(`Failed to send USB command: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Wait for response
    const response = await this.receiveResponse(msg.command, seqId, timeout)
    return this.parseResponse(response) as T
  }

  // BCD encoding/decoding
  private toBcd(str: string): number[] {
    const result: number[] = []
    for (let i = 0; i < str.length; i += 2) {
      const high = (str.charCodeAt(i) - 48) & 0xf
      const low = (str.charCodeAt(i + 1) - 48) & 0xf
      result.push((high << 4) | low)
    }
    return result
  }

  private fromBcd(...bytes: number[]): string {
    let result = ''
    for (const byte of bytes) {
      result += ((byte >> 4) & 0xf).toString()
      result += (byte & 0xf).toString()
    }
    return result
  }

  // API Methods

  async getDeviceInfo(timeout = 10): Promise<DeviceInfo | null> {
    return this.withLock('getDeviceInfo', async () => {
      try {
        if (DEBUG_PROTOCOL) console.log('getDeviceInfo: Sending CMD_GET_DEVICE_INFO')
        const result = await this.send<{ versionCode: string; versionNumber: number; sn: string }>(
          new JensenMessage(CMD.GET_DEVICE_INFO),
          timeout
        )
        if (DEBUG_PROTOCOL) console.log('getDeviceInfo: Received result:', result)
        return {
          versionCode: result.versionCode,
          versionNumber: result.versionNumber,
          serialNumber: result.sn,
          model: this.model
        }
      } catch (error) {
        console.error('[Jensen] getDeviceInfo error:', error)
        return null
      }
    })
  }

  async getTime(timeout = 5): Promise<{ time: string } | null> {
    try {
      return await this.send<{ time: string }>(new JensenMessage(CMD.GET_DEVICE_TIME), timeout)
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
      return await this.send<{ result: string }>(
        new JensenMessage(CMD.SET_DEVICE_TIME).body(this.toBcd(dateStr)),
        timeout
      )
    } catch {
      return null
    }
  }

  async getFileCount(timeout = 15): Promise<{ count: number } | null> {
    return this.withLock('getFileCount', async () => {
      try {
        return await this.send<{ count: number }>(new JensenMessage(CMD.GET_FILE_COUNT), timeout)
      } catch {
        return null
      }
    })
  }

  async getSettings(timeout = 5): Promise<DeviceSettings | null> {
    if (this.versionNumber && this.versionNumber < 327714) {
      return { autoRecord: false, autoPlay: false }
    }
    try {
      return await this.send<DeviceSettings>(new JensenMessage(CMD.GET_SETTINGS), timeout)
    } catch {
      return null
    }
  }

  async setAutoRecord(enabled: boolean, timeout = 5): Promise<{ result: string } | null> {
    if (this.versionNumber && this.versionNumber < 327714) {
      return { result: 'unsupported' }
    }
    try {
      return await this.send<{ result: string }>(
        new JensenMessage(CMD.SET_SETTINGS).body([0, 0, 0, enabled ? 1 : 2]),
        timeout
      )
    } catch {
      return null
    }
  }

  async getCardInfo(timeout = 10): Promise<CardInfo | null> {
    // Version check: firmware below 5.0.37 (327733) doesn't support this command
    // But if versionNumber is not yet set (e.g., getDeviceInfo hasn't completed),
    // we should still try since it might succeed
    if (this.versionNumber !== null && this.versionNumber < 327733) {
      if (DEBUG_PROTOCOL) console.log('getCardInfo: Firmware too old, returning null')
      return null
    }
    return this.withLock('getCardInfo', async () => {
      try {
        if (DEBUG_PROTOCOL) console.log('getCardInfo: Sending CMD_GET_CARD_INFO')
        const result = await this.send<CardInfo>(new JensenMessage(CMD.GET_CARD_INFO), timeout)
        if (DEBUG_PROTOCOL) console.log('getCardInfo: Received result:', result)
        return result
      } catch (error) {
        console.error('[Jensen] getCardInfo error:', error)
        return null
      }
    })
  }

  async formatCard(timeout = 30): Promise<{ result: string } | null> {
    if (this.versionNumber && this.versionNumber < 327733) {
      return null
    }
    try {
      return await this.send<{ result: string }>(
        new JensenMessage(CMD.FORMAT_CARD).body([1, 2, 3, 4]),
        timeout
      )
    } catch {
      return null
    }
  }

  async deleteFile(filename: string, timeout = 10): Promise<{ result: string } | null> {
    return this.withLock(`deleteFile:${filename}`, async () => {
      const body: number[] = []
      for (let i = 0; i < filename.length; i++) {
        body.push(filename.charCodeAt(i))
      }
      try {
        return await this.send<{ result: string }>(new JensenMessage(CMD.DELETE_FILE).body(body), timeout)
      } catch {
        return null
      }
    })
  }

  // List files - streams data from device
  // expectedFileCount is optional - if not provided, progress will show 0 as expected
  async listFiles(onProgress?: (bytesReceived: number, expectedFiles: number) => void, expectedFileCount?: number): Promise<FileInfo[]> {
    return this.withLock('listFiles', async () => {
      if (DEBUG_PROTOCOL) console.log('[Jensen] listFiles called, expectedFileCount:', expectedFileCount)
      if (!this.device) {
        console.error('[Jensen] listFiles: Device not connected')
        throw new Error('Device not connected')
      }

      if (!this.device.opened) {
        console.error('[Jensen] listFiles: Device not opened')
        throw new Error('Device not opened')
      }

      // Use provided count or 0 (progress will still work, just won't show expected total)
      let expectedFiles = expectedFileCount || 0
      if (DEBUG_PROTOCOL) console.log(`[Jensen] Fetching file list, expected files: ${expectedFiles}`)
      onProgress?.(0, expectedFiles)

      // Send GET_FILE_LIST command
      const seqId = this.sequenceId++
      const msg = new JensenMessage(CMD.GET_FILE_LIST)
      msg.sequence(seqId)
      await this.device.transferOut(1, msg.make() as unknown as BufferSource)
      if (DEBUG_PROTOCOL) console.log(`[Jensen] Sent GET_FILE_LIST command, seq=${seqId}`)

      // Incremental parsing state
      const allFiles: FileInfo[] = []
      let partialBuffer = new Uint8Array(0)
      let totalFilesFromHeader = 0
      let totalBytesReceived = 0
      let packetsReceived = 0
      const startTime = Date.now()
      // Timeout strategy:
      // - 120 second overall timeout (large file lists can take a while)
      // - Stop when we get all expected files OR receive empty terminator
      // - 5 second idle timeout (no new data)
      const overallTimeout = 120000 // 2 minutes max for large lists
      let lastDataTime = startTime

      while (Date.now() - startTime < overallTimeout) {
        try {
          // Read data directly from USB
          // Note: WebUSB transferIn has implicit short timeout behavior
          const readSize = 4096 * 16 // 64KB buffer
          const result = await this.device.transferIn(2, readSize)

          if (result.status === 'ok' && result.data && result.data.byteLength > 0) {
            lastDataTime = Date.now() // Update last data time

            // Append to receive buffer with proper slice handling
            const newData = new Uint8Array(result.data.buffer.slice(result.data.byteOffset, result.data.byteOffset + result.data.byteLength))
            const combined = new Uint8Array(this.receiveBuffer.length + newData.length)
            combined.set(this.receiveBuffer)
            combined.set(newData, this.receiveBuffer.length)
            this.receiveBuffer = combined

            // Try to extract file list messages from buffer
            let packetParsed = true
            while (packetParsed) {
              const parsedMsg = this.tryParseMessage()
              if (!parsedMsg) {
                packetParsed = false
                break
              }

              // Accept packets that match our command OR sequence
              if (parsedMsg.id === CMD.GET_FILE_LIST || parsedMsg.sequence === seqId) {
                if (parsedMsg.body.length === 0) {
                  // Empty body signals end of transmission
                  if (DEBUG_PROTOCOL) console.log(`[Jensen] listFiles: Empty body, end of file list. Total: ${allFiles.length} files`)
                  return allFiles
                }

                packetsReceived++
                totalBytesReceived += parsedMsg.body.length

                // Combine with partial buffer from previous packet
                const currentData = new Uint8Array(partialBuffer.length + parsedMsg.body.length)
                currentData.set(partialBuffer)
                currentData.set(parsedMsg.body, partialBuffer.length)

                // Parse files incrementally
                const { parsedFiles, remainingBuffer, headerTotal } = this.parsePartialFileList(currentData, totalFilesFromHeader)

                // Update total from header if found
                if (headerTotal > 0 && totalFilesFromHeader === 0) {
                  totalFilesFromHeader = headerTotal
                  expectedFiles = headerTotal
                }

                // Add newly parsed files
                allFiles.push(...parsedFiles)
                partialBuffer = remainingBuffer

                // Report progress with actual file count (verbose logging only)
                if (parsedFiles.length > 0 && DEBUG_USB) {
                  console.log(`[Jensen] listFiles: Packet ${packetsReceived}: +${parsedFiles.length} files (total: ${allFiles.length}/${expectedFiles || '?'})`)
                }
                onProgress?.(allFiles.length, expectedFiles)

                // Yield to event loop to allow UI updates (every packet)
                await new Promise(resolve => setTimeout(resolve, 0))
              }
            }

            // STOP CONDITIONS:
            // 1. If we have ALL expected files (from param or header), stop immediately
            const effectiveExpected = expectedFiles > 0 ? expectedFiles : totalFilesFromHeader
            if (effectiveExpected > 0 && allFiles.length >= effectiveExpected) {
              if (DEBUG_PROTOCOL) console.log(`[Jensen] listFiles: Got all ${allFiles.length}/${effectiveExpected} files, stopping`)
              break
            }
          }
        } catch (error) {
          // Handle DOMException errors
          if (error instanceof DOMException) {
            if (error.name === 'NetworkError') {
              // USB timeout - check if we should stop (5 second idle timeout)
              if (allFiles.length > 0 && Date.now() - lastDataTime > 5000) {
                if (DEBUG_PROTOCOL) console.log(`[Jensen] listFiles: Idle timeout after 5s with ${allFiles.length} files`)
                break
              }
              // Timeout is expected when waiting for more data, continue
              continue
            } else if (error.name === 'InvalidStateError') {
              console.error('[Jensen] listFiles: Device connection lost')
              throw new Error('Device connection lost')
            }
          }
          throw error
        }
      }

      if (DEBUG_PROTOCOL) console.log(`[Jensen] listFiles: Completed with ${allFiles.length} files from ${packetsReceived} packets, ${totalBytesReceived} bytes`)
      return allFiles
    })
  }

  // Parse file list data from collected chunks
  private parseFileListData(chunks: Uint8Array[]): FileInfo[] {
    // Combine all chunks
    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    if (totalSize === 0) return []

    const buffer = new Uint8Array(totalSize)
    let offset = 0
    for (const chunk of chunks) {
      buffer.set(chunk, offset)
      offset += chunk.length
    }

    return this.parseFileListBuffer(buffer)
  }

  // Parse file list data from a combined buffer
  private parseFileListBuffer(buffer: Uint8Array): FileInfo[] {
    if (buffer.length === 0) return []

    const files: FileInfo[] = []
    let pos = 0

    // Check for header (0xFF 0xFF + 4 byte count)
    let expectedCount = -1
    if (buffer.length >= 6 && buffer[0] === 0xff && buffer[1] === 0xff) {
      expectedCount =
        ((buffer[2] & 0xff) << 24) |
        ((buffer[3] & 0xff) << 16) |
        ((buffer[4] & 0xff) << 8) |
        (buffer[5] & 0xff)
      pos = 6
    }

    // Parse file entries
    while (pos < buffer.length && (expectedCount === -1 || files.length < expectedCount)) {
      try {
        // Minimum entry size check
        if (pos + 4 > buffer.length) break

        // File version (1 byte)
        const fileVersion = buffer[pos++]

        // Filename length (3 bytes, big-endian)
        if (pos + 3 > buffer.length) break
        const nameLen =
          ((buffer[pos] & 0xff) << 16) |
          ((buffer[pos + 1] & 0xff) << 8) |
          (buffer[pos + 2] & 0xff)
        pos += 3

        // Filename
        if (pos + nameLen > buffer.length) break
        let filename = ''
        for (let i = 0; i < nameLen; i++) {
          const char = buffer[pos + i]
          if (char > 0) filename += String.fromCharCode(char)
        }
        pos += nameLen

        // File length (4 bytes, big-endian)
        if (pos + 4 > buffer.length) break
        const fileLength =
          ((buffer[pos] & 0xff) << 24) |
          ((buffer[pos + 1] & 0xff) << 16) |
          ((buffer[pos + 2] & 0xff) << 8) |
          (buffer[pos + 3] & 0xff)
        pos += 4

        // Skip 6 bytes
        if (pos + 6 > buffer.length) break
        pos += 6

        // Signature (16 bytes)
        if (pos + 16 > buffer.length) break
        let signature = ''
        for (let i = 0; i < 16; i++) {
          signature += buffer[pos + i].toString(16).padStart(2, '0')
        }
        pos += 16

        // Parse filename for date/time (format: HDA_YYYYMMDD_HHMMSS.hda)
        const { createDate, createTime, time } = this.parseFilenameDateTime(filename)

        // Calculate duration based on file version (different audio formats)
        const duration = calculateDurationSeconds(fileLength, fileVersion)

        files.push({
          name: filename,
          createDate,
          createTime,
          time,
          duration,
          version: fileVersion,
          length: fileLength,
          signature
        })
      } catch {
        break
      }
    }

    if (DEBUG_PROTOCOL) console.log(`Parsed ${files.length} files from device`)
    return files
  }

  // Parse partial file list data, returning parsed files and remaining unparsed buffer
  private parsePartialFileList(
    buffer: Uint8Array,
    knownTotal: number
  ): { parsedFiles: FileInfo[]; remainingBuffer: Uint8Array; headerTotal: number } {
    const files: FileInfo[] = []
    let pos = 0
    let totalFilesFromHeader = knownTotal

    // Check for header (0xFF 0xFF + 4 byte count) only if we haven't seen it yet
    if (totalFilesFromHeader === 0 && buffer.length >= 6 && buffer[0] === 0xff && buffer[1] === 0xff) {
      totalFilesFromHeader =
        ((buffer[2] & 0xff) << 24) |
        ((buffer[3] & 0xff) << 16) |
        ((buffer[4] & 0xff) << 8) |
        (buffer[5] & 0xff)
      pos = 6
      if (DEBUG_PROTOCOL) console.log(`[Jensen] Found total files in header: ${totalFilesFromHeader}`)
    }

    // Parse file entries until we run out of complete records
    while (pos < buffer.length) {
      const startPos = pos

      try {
        // Minimum entry size check
        if (pos + 4 > buffer.length) {
          pos = startPos
          break
        }

        // File version (1 byte)
        const fileVersion = buffer[pos++]

        // Filename length (3 bytes, big-endian)
        if (pos + 3 > buffer.length) {
          pos = startPos
          break
        }
        const nameLen =
          ((buffer[pos] & 0xff) << 16) |
          ((buffer[pos + 1] & 0xff) << 8) |
          (buffer[pos + 2] & 0xff)
        pos += 3

        // Filename
        if (pos + nameLen > buffer.length) {
          pos = startPos
          break
        }
        let filename = ''
        for (let i = 0; i < nameLen; i++) {
          const char = buffer[pos + i]
          if (char > 0) filename += String.fromCharCode(char)
        }
        pos += nameLen

        // File length (4 bytes, big-endian)
        if (pos + 4 > buffer.length) {
          pos = startPos
          break
        }
        const fileLength =
          ((buffer[pos] & 0xff) << 24) |
          ((buffer[pos + 1] & 0xff) << 16) |
          ((buffer[pos + 2] & 0xff) << 8) |
          (buffer[pos + 3] & 0xff)
        pos += 4

        // Skip 6 bytes
        if (pos + 6 > buffer.length) {
          pos = startPos
          break
        }
        pos += 6

        // Signature (16 bytes)
        if (pos + 16 > buffer.length) {
          pos = startPos
          break
        }
        let signature = ''
        for (let i = 0; i < 16; i++) {
          signature += buffer[pos + i].toString(16).padStart(2, '0')
        }
        pos += 16

        // Parse filename for date/time
        const { createDate, createTime, time } = this.parseFilenameDateTime(filename)

        // Calculate duration based on file version (different audio formats)
        const duration = calculateDurationSeconds(fileLength, fileVersion)

        files.push({
          name: filename,
          createDate,
          createTime,
          time,
          duration,
          version: fileVersion,
          length: fileLength,
          signature
        })
      } catch {
        pos = startPos
        break
      }
    }

    // Return parsed files and the remaining unparsed buffer
    const remainingBuffer = buffer.slice(pos)
    return { parsedFiles: files, remainingBuffer, headerTotal: totalFilesFromHeader }
  }

  // Parse date/time from HiDock filename
  private parseFilenameDateTime(filename: string): { createDate: string; createTime: string; time: Date | null } {
    // Month name mapping
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
      const time = new Date(
        parseInt(year),
        month,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        parseInt(second)
      )
      return { createDate, createTime, time }
    }

    // Format 2: HDA_YYYYMMDD_HHMMSS.hda or 2025-12-08_0044.hda
    const numericMatch = filename.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})[-_](\d{2})(\d{2})(\d{2})?/)
    if (numericMatch) {
      const [, year, month, day, hour, minute, second = '00'] = numericMatch
      const createDate = `${year}-${month}-${day}`
      const createTime = `${hour}:${minute}:${second}`
      const time = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        parseInt(second)
      )
      return { createDate, createTime, time }
    }

    return { createDate: '', createTime: '', time: null }
  }

  // Download a file - streams data
  async downloadFile(
    filename: string,
    fileSize: number,
    onChunk: (data: Uint8Array) => void,
    onProgress?: (received: number) => void
  ): Promise<boolean> {
    return this.withLock(`downloadFile:${filename}`, async () => {
      if (!this.device || !this.device.opened) return false

      if (DEBUG_PROTOCOL) console.log(`[Jensen] downloadFile: Starting download of ${filename}, size=${fileSize}`)

      const body: number[] = []
      for (let i = 0; i < filename.length; i++) {
        body.push(filename.charCodeAt(i))
      }

      // Send transfer file command
      const seqId = this.sequenceId++
      const msg = new JensenMessage(CMD.TRANSFER_FILE).body(body)
      msg.sequence(seqId)
      await this.device.transferOut(1, msg.make() as unknown as BufferSource)
      if (DEBUG_PROTOCOL) console.log(`[Jensen] downloadFile: Sent TRANSFER_FILE command, seq=${seqId}`)

      // Receive file data
      let received = 0
      let consecutiveTimeouts = 0
      const maxTimeouts = 100 // More tolerance for slow USB
      const startTime = Date.now()
      const overallTimeout = 300000 // 5 minutes max for large files

      let lastProgressLog = 0
      while (received < fileSize && consecutiveTimeouts < maxTimeouts && Date.now() - startTime < overallTimeout) {
        // Read more data from USB
        const gotData = await this.readToBuffer()

        if (!gotData) {
          consecutiveTimeouts++
          // Small delay to prevent busy-waiting and give USB time to buffer data
          await this.delay(20)
          continue
        }
        consecutiveTimeouts = 0

        // Try to extract file data messages from buffer
        while (received < fileSize) {
          const msg = this.tryParseMessage()
          if (!msg) break

          if (msg.id === CMD.TRANSFER_FILE && msg.body.length > 0) {
            onChunk(msg.body)
            received += msg.body.length
            onProgress?.(received)

            // Log progress every 10%
            const percent = Math.floor((received / fileSize) * 100)
            if (percent >= lastProgressLog + 10) {
              console.log(`[Jensen] Download progress: ${percent}% (${received}/${fileSize} bytes)`)
              lastProgressLog = percent
            }
          }
        }
      }

      const success = received >= fileSize
      if (!success) {
        console.error(`[Jensen] downloadFile FAILED: received=${received}/${fileSize}, consecutiveTimeouts=${consecutiveTimeouts}, elapsed=${Date.now() - startTime}ms`)
      } else if (DEBUG_PROTOCOL) {
        console.log(`[Jensen] downloadFile: Complete, received=${received}/${fileSize} in ${Date.now() - startTime}ms`)
      }
      return success
    })
  }

  // ==========================================
  // REALTIME STREAMING METHODS (All devices)
  // ==========================================

  async getRealtimeSettings(timeout = 5): Promise<RealtimeSettings | null> {
    try {
      const result = await this.send<{ raw: Uint8Array }>(
        new JensenMessage(CMD.REALTIME_READ_SETTING),
        timeout
      )
      // Parse raw settings - format is device-specific
      return {
        enabled: result.raw && result.raw.length > 0 ? result.raw[0] === 1 : false,
        sampleRate: 16000, // Default HiDock sample rate
        channels: 1,
        bitDepth: 16
      }
    } catch {
      return null
    }
  }

  async startRealtime(timeout = 5): Promise<{ result: string } | null> {
    try {
      // Body: [0,0,0,0,0,0,0,1] - Start realtime
      return await this.send<{ result: string }>(
        new JensenMessage(CMD.REALTIME_CONTROL).body([0, 0, 0, 0, 0, 0, 0, 1]),
        timeout
      )
    } catch {
      return null
    }
  }

  async pauseRealtime(timeout = 5): Promise<{ result: string } | null> {
    try {
      // Body: [0,0,0,1,0,0,0,1] - Pause realtime
      return await this.send<{ result: string }>(
        new JensenMessage(CMD.REALTIME_CONTROL).body([0, 0, 0, 1, 0, 0, 0, 1]),
        timeout
      )
    } catch {
      return null
    }
  }

  async stopRealtime(timeout = 5): Promise<{ result: string } | null> {
    try {
      // Body: [0,0,0,2,0,0,0,1] - Stop realtime
      return await this.send<{ result: string }>(
        new JensenMessage(CMD.REALTIME_CONTROL).body([0, 0, 0, 2, 0, 0, 0, 1]),
        timeout
      )
    } catch {
      return null
    }
  }

  async getRealtimeData(offset: number, timeout = 5): Promise<RealtimeData | null> {
    try {
      // Body: 4-byte offset (big-endian)
      const body = [
        (offset >> 24) & 0xff,
        (offset >> 16) & 0xff,
        (offset >> 8) & 0xff,
        offset & 0xff
      ]
      return await this.send<RealtimeData>(
        new JensenMessage(CMD.REALTIME_TRANSFER).body(body),
        timeout
      )
    } catch {
      return null
    }
  }

  // ==========================================
  // BATTERY STATUS (P1 devices only)
  // ==========================================

  isP1Device(): boolean {
    return this.model === 'hidock-p1' || this.model === 'hidock-p1-mini'
  }

  async getBatteryStatus(timeout = 5): Promise<BatteryStatus | null> {
    if (!this.isP1Device()) {
      console.warn('getBatteryStatus is only supported on P1 devices')
      return null
    }
    try {
      return await this.send<BatteryStatus>(
        new JensenMessage(CMD.GET_BATTERY_STATUS),
        timeout
      )
    } catch {
      return null
    }
  }

  // ==========================================
  // BLUETOOTH METHODS (P1 devices only)
  // ==========================================

  async scanBluetoothDevices(timeout = 35): Promise<{ result: string } | null> {
    if (!this.isP1Device()) {
      console.warn('Bluetooth scanning is only supported on P1 devices')
      return null
    }
    try {
      return await this.send<{ result: string }>(
        new JensenMessage(CMD.BLUETOOTH_SCAN),
        timeout
      )
    } catch {
      return null
    }
  }

  async startBluetoothScan(duration: number = 30, timeout = 35): Promise<{ result: string } | null> {
    if (!this.isP1Device()) {
      console.warn('Bluetooth scanning is only supported on P1 devices')
      return null
    }
    try {
      // Body: [1, duration] - Start scan with duration
      return await this.send<{ result: string }>(
        new JensenMessage(CMD.BT_SCAN).body([1, duration & 0xff]),
        timeout
      )
    } catch {
      return null
    }
  }

  async stopBluetoothScan(timeout = 5): Promise<{ result: string } | null> {
    if (!this.isP1Device()) {
      return null
    }
    try {
      // Body: [0] - Stop scan
      return await this.send<{ result: string }>(
        new JensenMessage(CMD.BT_SCAN).body([0]),
        timeout
      )
    } catch {
      return null
    }
  }

  async getBluetoothDeviceList(timeout = 10): Promise<{ raw: Uint8Array } | null> {
    if (!this.isP1Device()) {
      return null
    }
    try {
      return await this.send<{ raw: Uint8Array }>(
        new JensenMessage(CMD.BT_DEV_LIST),
        timeout
      )
    } catch {
      return null
    }
  }

  async getPairedDevices(timeout = 10): Promise<{ raw: Uint8Array } | null> {
    if (!this.isP1Device()) {
      return null
    }
    try {
      return await this.send<{ raw: Uint8Array }>(
        new JensenMessage(CMD.BT_GET_PAIRED_DEV_LIST),
        timeout
      )
    } catch {
      return null
    }
  }

  async removePairedDevices(timeout = 10): Promise<{ result: string } | null> {
    if (!this.isP1Device()) {
      return null
    }
    try {
      // Body: [0] - Remove all paired devices
      return await this.send<{ result: string }>(
        new JensenMessage(CMD.BT_REMOVE_PAIRED_DEV).body([0]),
        timeout
      )
    } catch {
      return null
    }
  }

  async connectBluetoothDevice(timeout = 10): Promise<{ result: string } | null> {
    if (!this.isP1Device()) {
      return null
    }
    try {
      return await this.send<{ result: string }>(
        new JensenMessage(CMD.BLUETOOTH_CMD).body([1]),
        timeout
      )
    } catch {
      return null
    }
  }

  async disconnectBluetoothDevice(timeout = 10): Promise<{ result: string } | null> {
    if (!this.isP1Device()) {
      return null
    }
    try {
      return await this.send<{ result: string }>(
        new JensenMessage(CMD.BLUETOOTH_CMD).body([0]),
        timeout
      )
    } catch {
      return null
    }
  }

  async getBluetoothStatus(timeout = 5): Promise<BluetoothStatus | null> {
    if (!this.isP1Device()) {
      return null
    }
    try {
      return await this.send<BluetoothStatus>(
        new JensenMessage(CMD.BLUETOOTH_STATUS),
        timeout
      )
    } catch {
      return null
    }
  }
}

// Singleton instance
let deviceInstance: JensenDevice | null = null

export function getJensenDevice(): JensenDevice {
  if (!deviceInstance) {
    deviceInstance = new JensenDevice()
  }
  return deviceInstance
}
