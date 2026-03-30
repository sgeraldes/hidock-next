import usb from 'usb'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JensenMessage, parseResponseHeader } from './jensen-message.js'
import { parseFileListBuffer } from './file-list-parser.js'
import { CMD, USB_VENDOR_IDS, PRODUCT_ID_MODEL_MAP } from './constants.js'
import type { DeviceModel, FileEntry, CardInfo, RawDeviceInfo } from '../core/types.js'

// On Windows, pre-load the desktop app's libusb-1.0.dll if available.
function preloadLibusb(): void {
  if (process.platform !== 'win32') return

  const startDirs = [
    dirname(fileURLToPath(import.meta.url)),
    process.cwd(),
  ]

  const candidates: string[] = []
  for (const start of startDirs) {
    let dir = start
    for (let i = 0; i < 8; i++) {
      candidates.push(join(dir, 'apps', 'desktop', 'libusb-1.0.dll'))
      candidates.push(join(dir, 'libusb-1.0.dll'))
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }

  for (const dllPath of candidates) {
    if (existsSync(dllPath)) {
      try {
        process.dlopen({ exports: {} } as any, dllPath)
      } catch {
        // Expected — DLL loads into address space despite "not self-registered" error
      }
      return
    }
  }
}

preloadLibusb()

// ============================================================
// Types for the handler-based architecture
// ============================================================

/** Handler receives parsed body buffer, returns result (truthy = done) or undefined (keep waiting) */
type CommandHandler = (body: Buffer) => unknown

interface PendingCommand {
  resolve: (value: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

// ============================================================
// JensenDevice — perpetual read loop architecture
// ============================================================

export class JensenDevice {
  private rawDevice: usb.Device | null = null
  private epOut: usb.OutEndpoint | null = null
  private epIn: usb.InEndpoint | null = null
  private sequenceId = 0
  private _model: DeviceModel = 'unknown'
  private _serialNumber: string | null = null
  private _firmwareVersion: string | null = null

  // Perpetual read loop state
  private readLoopRunning = false
  private carryBuffer = Buffer.alloc(0)

  // Handler registry — each command has a handler that processes incoming data
  private handlers = new Map<number, CommandHandler>()
  private pendingPromises = new Map<number, PendingCommand>()

  isConnected(): boolean {
    return this.rawDevice !== null && this.epOut !== null && this.epIn !== null
  }

  getModel(): DeviceModel {
    return this._model
  }

  getSerialNumber(): string | null {
    return this._serialNumber
  }

  getFirmwareVersion(): string | null {
    return this._firmwareVersion
  }

  async connect(): Promise<boolean> {
    for (const vid of USB_VENDOR_IDS) {
      for (const [pid, model] of Object.entries(PRODUCT_ID_MODEL_MAP)) {
        const dev = usb.findByIds(vid, Number(pid))
        if (dev) {
          return this.openDevice(dev, model as DeviceModel)
        }
      }
    }
    return false
  }

  async disconnect(): Promise<void> {

    this.readLoopRunning = false

    // Resolve any pending promises
    for (const [, pending] of this.pendingPromises) {
      clearTimeout(pending.timer)
      pending.resolve(null)
    }
    this.pendingPromises.clear()
    this.handlers.clear()

    if (this.rawDevice) {
      const dev = this.rawDevice

      // Wait for the pending transferIn to complete/timeout.
      // The read loop uses 5s timeout, so we wait up to 6s.
      // Once readLoopRunning=false, the callback won't re-post.
      await new Promise<void>((resolve) => setTimeout(resolve, 6000))

      try {
        const iface = dev.interface(0)
        await new Promise<void>((resolve) => {
          iface.release(true, () => {
            try { dev.close() } catch { /* ignore */ }
            resolve()
          })
        })
      } catch {
        try { dev.close() } catch { /* ignore */ }
      }

      this.rawDevice = null
      this.epOut = null
      this.epIn = null
      this._model = 'unknown'
      this._serialNumber = null
      this._firmwareVersion = null
      this.sequenceId = 0
      this.carryBuffer = Buffer.alloc(0)
    }
  }

  /** Drain any pending USB data — recovery mechanism when device is in locked state */
  async drain(): Promise<void> {
    if (!this.epIn) return
    this.epIn.timeout = 1000
    return new Promise<void>((resolve) => {
      const drainRead = (): void => {
        this.epIn!.transfer(51200, (err) => {
          if (err) {
            this.epIn!.timeout = 0
            resolve()
            return
          }
          drainRead()
        })
      }
      drainRead()
    })
  }

  // ================================================================
  // Public API — simple commands
  // ================================================================

  async getDeviceInfo(timeout = 10000): Promise<RawDeviceInfo | null> {
    const body = await this.sendCommand<Buffer | null>(CMD.GET_DEVICE_INFO, [], timeout)
    if (!body || body.length < 4) return null

    const versionCode = `${body[1]}.${body[2]}.${body[3]}`
    const versionNumber = (body[0] << 24) | (body[1] << 16) | (body[2] << 8) | body[3]

    let serialNumber = ''
    if (body.length >= 20) {
      serialNumber = Array.from(body.subarray(4, 20)).map((b) => b.toString(16).padStart(2, '0')).join('')
    }

    this._serialNumber = serialNumber
    this._firmwareVersion = versionCode
    return { versionCode, versionNumber, serialNumber, model: this._model }
  }

  async getFileCount(timeout = 10000): Promise<number> {
    const body = await this.sendCommand<Buffer | null>(CMD.GET_FILE_COUNT, [], timeout)
    if (!body || body.length < 4) return 0
    return (body[0] << 24) | (body[1] << 16) | (body[2] << 8) | body[3]
  }

  async getCardInfo(timeout = 10000): Promise<CardInfo | null> {
    const body = await this.sendCommand<Buffer | null>(CMD.GET_CARD_INFO, [], timeout)
    if (!body || body.length < 12) return null
    const b = body
    const free = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]
    const capacity = (b[4] << 24) | (b[5] << 16) | (b[6] << 8) | b[7]
    const statusRaw = (b[8] << 24) | (b[9] << 16) | (b[10] << 8) | b[11]
    return { used: capacity - free, capacity, free, status: statusRaw.toString(16) }
  }

  // ================================================================
  // Public API — multi-packet commands
  // ================================================================

  async listFiles(timeout = 300000): Promise<FileEntry[]> {
    if (!this.epOut || !this.epIn) return []

    // Clear carry buffer before starting — prevents residual data from previous commands
    this.carryBuffer = Buffer.alloc(0)

    return new Promise<FileEntry[]>((resolve) => {
      const allData: Buffer[] = []

      // Register handler for GET_FILE_LIST — accumulates data packets
      this.handlers.set(CMD.GET_FILE_LIST, (body) => {
        if (body.length === 0) {
          // End of file list
          const combined = Buffer.concat(allData)
          return parseFileListBuffer(new Uint8Array(combined.buffer, combined.byteOffset, combined.length))
        }
        allData.push(Buffer.from(body))
        return undefined // Keep waiting for more packets
      })

      // Send command
      const msg = new JensenMessage(CMD.GET_FILE_LIST).sequence(this.sequenceId++)
      this.epOut!.transfer(Buffer.from(msg.make()), (err) => {
        if (err) {
          this.handlers.delete(CMD.GET_FILE_LIST)
          resolve([])
          return
        }
      })

      // Set up timeout and promise
      const timer = setTimeout(() => {
        this.handlers.delete(CMD.GET_FILE_LIST)
        this.pendingPromises.delete(CMD.GET_FILE_LIST)
        const combined = Buffer.concat(allData)
        resolve(parseFileListBuffer(new Uint8Array(combined.buffer, combined.byteOffset, combined.length)))
      }, timeout)

      this.pendingPromises.set(CMD.GET_FILE_LIST, {
        resolve: (value) => {
          clearTimeout(timer)
          this.handlers.delete(CMD.GET_FILE_LIST)
          this.pendingPromises.delete(CMD.GET_FILE_LIST)
          resolve(value as FileEntry[])
        },
        timer
      })
    })
  }

  async downloadFile(
    filename: string,
    fileSize: number,
    onChunk?: (data: Uint8Array) => void,
    timeout = 300000
  ): Promise<Uint8Array | null> {
    if (!this.epOut || !this.epIn) return null

    return new Promise<Uint8Array | null>((resolve) => {
      const chunks: Buffer[] = []
      let received = 0

      // Register handler for TRANSFER_FILE
      this.handlers.set(CMD.TRANSFER_FILE, (body) => {
        if (body.length === 0) return null // Transfer failed/ended

        chunks.push(Buffer.from(body))
        received += body.length
        onChunk?.(new Uint8Array(body))

        if (received >= fileSize) {
          const result = Buffer.concat(chunks)
          return new Uint8Array(result.buffer, result.byteOffset, result.length)
        }
        return undefined // Keep waiting
      })

      // Send command
      const nameBytes: number[] = []
      for (let i = 0; i < filename.length; i++) nameBytes.push(filename.charCodeAt(i))

      const msg = new JensenMessage(CMD.TRANSFER_FILE).body(nameBytes).sequence(this.sequenceId++)
      this.epOut!.transfer(Buffer.from(msg.make()), (err) => {
        if (err) {
          this.handlers.delete(CMD.TRANSFER_FILE)
          resolve(null)
          return
        }
      })

      const timer = setTimeout(() => {
        this.handlers.delete(CMD.TRANSFER_FILE)
        this.pendingPromises.delete(CMD.TRANSFER_FILE)
        resolve(received > 0 ? (() => {
          const result = Buffer.concat(chunks)
          return new Uint8Array(result.buffer, result.byteOffset, result.length)
        })() : null)
      }, timeout)

      this.pendingPromises.set(CMD.TRANSFER_FILE, {
        resolve: (value) => {
          clearTimeout(timer)
          this.handlers.delete(CMD.TRANSFER_FILE)
          this.pendingPromises.delete(CMD.TRANSFER_FILE)
          resolve(value as Uint8Array | null)
        },
        timer
      })
    })
  }

  // ================================================================
  // Private — perpetual read loop (core architecture)
  // ================================================================

  /**
   * Start the perpetual USB read loop.
   * Always keeps a transferIn pending so the device can send data at any time.
   * Incoming data is parsed and dispatched to registered handlers.
   * The loop is self-sustaining — it immediately posts the next read
   * BEFORE processing data, ensuring there's always a pending read.
   */
  private startReadLoop(): void {
    if (this.readLoopRunning || !this.epIn) return
    this.readLoopRunning = true
    this.readNext()
  }

  private readNext(): void {
    if (!this.readLoopRunning || !this.epIn) return

    this.epIn.transfer(51200, (err, data) => {
      if (!this.readLoopRunning) {
        return
      }

      // IMMEDIATELY post next read — before processing data.
      // This ensures a transferIn is always pending (device ACK).
      this.readNext()

      // Now process the data we received
      if (err) {
        // Timeout errors are expected — the device may take minutes to respond
        return
      }
      if (!data || data.length === 0) return
      // Log raw header for debugging
      const hdr = Array.from(data.subarray(0, Math.min(24, data.length))).map(b => b.toString(16).padStart(2, '0')).join(' ')
      console.error(`[Jensen] read: ${data.length} bytes — ${hdr}`)

      this.processIncomingData(data)
    })
  }

  /**
   * Parse Jensen messages from raw USB data and dispatch to handlers.
   * Handles carry buffer for messages split across USB packets.
   */
  private processIncomingData(data: Buffer): void {
    // Prepend carry buffer from previous incomplete message
    let work: Buffer
    if (this.carryBuffer.length > 0) {
      work = Buffer.concat([this.carryBuffer, data])
      this.carryBuffer = Buffer.alloc(0)
    } else {
      work = data
    }

    let pos = 0
    while (pos + 12 <= work.length) {
      // Look for sync markers
      if (work[pos] !== 0x12 || work[pos + 1] !== 0x34) { pos++; continue }

      const header = parseResponseHeader(new Uint8Array(work.buffer, work.byteOffset + pos, work.length - pos))
      if (!header) { pos++; continue }

      const totalLen = 12 + header.bodyLength + header.checksumLength
      if (pos + totalLen > work.length) {
        // Incomplete message — save as carry buffer for next packet
        this.carryBuffer = Buffer.from(work.subarray(pos))
        return
      }

      // Extract body (exclude checksum bytes at the end)
      const body = Buffer.from(work.subarray(pos + 12, pos + 12 + header.bodyLength))
      const cmd = header.command

      const handler = this.handlers.get(cmd)
      if (handler) {
        const result = handler(body)
        if (result !== undefined) {
          // Handler returned a result — resolve the pending promise
          const pending = this.pendingPromises.get(cmd)
          if (pending) {
            pending.resolve(result)
          }
        }
      }

      pos += totalLen
    }

    // Save any unprocessed tail
    if (pos < work.length) {
      this.carryBuffer = Buffer.from(work.subarray(pos))
    }
  }

  // ================================================================
  // Private — send command with handler-based response
  // ================================================================

  /**
   * Send a simple command and wait for a single response.
   * Registers a one-shot handler that resolves on first matching response.
   */
  private sendCommand<T>(command: number, body: number[] = [], timeout = 10000): Promise<T> {
    return new Promise<T>((resolve) => {
      // Register one-shot handler — returns body on first response
      this.handlers.set(command, (responseBody) => {
        return responseBody // Return body = resolve promise
      })

      // Set up timeout
      const timer = setTimeout(() => {
        this.handlers.delete(command)
        this.pendingPromises.delete(command)
        resolve(null as T)
      }, timeout)

      this.pendingPromises.set(command, {
        resolve: (value) => {
          clearTimeout(timer)
          this.handlers.delete(command)
          this.pendingPromises.delete(command)
          resolve(value as T)
        },
        timer
      })

      // Send the command
      const msg = new JensenMessage(command).body(body).sequence(this.sequenceId++)
      this.epOut!.transfer(Buffer.from(msg.make()), (err) => {
        if (err) {
          clearTimeout(timer)
          this.handlers.delete(command)
          this.pendingPromises.delete(command)
          resolve(null as T)
        }
        // Read loop is already running — response will arrive there
      })
    })
  }

  // ================================================================
  // Private — device open
  // ================================================================

  private openDevice(dev: usb.Device, model: DeviceModel): boolean {
    try {
      dev.open()
      const iface = dev.interface(0)

      if (process.platform === 'linux') {
        try {
          if (iface.isKernelDriverActive()) {
            iface.detachKernelDriver()
          }
        } catch { /* not supported on all platforms */ }
      }

      iface.claim()

      this.epOut = iface.endpoints.find((e): e is usb.OutEndpoint => e.direction === 'out') ?? null
      this.epIn = iface.endpoints.find((e): e is usb.InEndpoint => e.direction === 'in') ?? null

      if (!this.epOut || !this.epIn) {
        dev.close()
        return false
      }

      // Timeout on IN endpoint — allows the read loop to yield periodically.
      // The loop immediately re-posts a transferIn, so no data is lost.
      // This timeout is essential for clean disconnect (pending transfer must complete).
      this.epIn.timeout = 5000

      this.rawDevice = dev
      this._model = model
      this.sequenceId = 0
      this.carryBuffer = Buffer.alloc(0)

      // Start perpetual read loop — always keep a transferIn pending
      this.startReadLoop()

      return true
    } catch (e) {
      console.error('[JensenDevice] Failed to open device:', e)
      try { dev.close() } catch { /* ignore */ }
      return false
    }
  }
}
