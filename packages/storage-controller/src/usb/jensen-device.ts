import usb from 'usb'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JensenMessage, parseResponseHeader } from './jensen-message.js'
import { parseFileListBuffer } from './file-list-parser.js'
import { CMD, USB_VENDOR_IDS, EP_OUT, EP_IN, PRODUCT_ID_MODEL_MAP } from './constants.js'
import type { DeviceModel, FileEntry, CardInfo, RawDeviceInfo } from '../core/types.js'

// On Windows, node-usb's bundled libusb can't access devices without WinUSB driver.
// The desktop app bundles a libusb-1.0.dll that works with the default Windows driver.
// Pre-loading that DLL makes node-usb use it instead of its static build.
function preloadLibusb(): void {
  if (process.platform !== 'win32') return

  const candidates = [
    // Relative to this package (monorepo layout)
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'apps', 'desktop', 'libusb-1.0.dll'),
    // Relative to cwd
    join(process.cwd(), 'apps', 'desktop', 'libusb-1.0.dll'),
    // Relative to repo root patterns
    join(process.cwd(), 'libusb-1.0.dll'),
  ]

  for (const dllPath of candidates) {
    if (existsSync(dllPath)) {
      try {
        process.dlopen({ exports: {} } as any, dllPath)
      } catch {
        // dlopen reports "not self-registered" for non-Node addons — that's fine,
        // the DLL is still loaded into the process address space.
      }
      return
    }
  }
}

preloadLibusb()

export class JensenDevice {
  private rawDevice: usb.Device | null = null
  private epOut: usb.OutEndpoint | null = null
  private epIn: usb.InEndpoint | null = null
  private sequenceId = 0
  private _model: DeviceModel = 'unknown'
  private _serialNumber: string | null = null
  private _firmwareVersion: string | null = null

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
    // Scan all known VID/PID combos
    for (const vid of USB_VENDOR_IDS) {
      for (const [pid, model] of Object.entries(PRODUCT_ID_MODEL_MAP)) {
        if (Math.floor(Number(pid) / 0x100) === Math.floor(vid / 0x100) || true) {
          const dev = usb.findByIds(vid, Number(pid))
          if (dev) {
            return this.openDevice(dev, model as DeviceModel)
          }
        }
      }
    }
    return false
  }

  async disconnect(): Promise<void> {
    if (this.rawDevice) {
      try {
        const iface = this.rawDevice.interface(0)
        iface.release(() => {
          try { this.rawDevice?.close() } catch { /* already closed */ }
        })
      } catch {
        try { this.rawDevice.close() } catch { /* already closed */ }
      }
      this.rawDevice = null
      this.epOut = null
      this.epIn = null
      this._model = 'unknown'
      this._serialNumber = null
      this._firmwareVersion = null
      this.sequenceId = 0
    }
  }

  async getDeviceInfo(timeout = 10000): Promise<RawDeviceInfo | null> {
    const response = await this.sendAndReceive(CMD.GET_DEVICE_INFO, Buffer.alloc(0), timeout)
    if (!response || response.length < 16) return null

    const body = response
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
    const response = await this.sendAndReceive(CMD.GET_FILE_COUNT, Buffer.alloc(0), timeout)
    if (!response || response.length < 4) return 0
    return (response[0] << 24) | (response[1] << 16) | (response[2] << 8) | response[3]
  }

  async getCardInfo(timeout = 10000): Promise<CardInfo | null> {
    const response = await this.sendAndReceive(CMD.GET_CARD_INFO, Buffer.alloc(0), timeout)
    if (!response || response.length < 12) return null
    const b = response
    const free = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]
    const capacity = (b[4] << 24) | (b[5] << 16) | (b[6] << 8) | b[7]
    const statusRaw = (b[8] << 24) | (b[9] << 16) | (b[10] << 8) | b[11]
    return { used: capacity - free, capacity, free, status: statusRaw.toString(16) }
  }

  async listFiles(timeout = 120000): Promise<FileEntry[]> {
    if (!this.epOut || !this.epIn) return []

    const msg = new JensenMessage(CMD.GET_FILE_LIST).sequence(this.sequenceId++)
    await this.transferOut(msg.make())

    const allData: Buffer[] = []
    const deadline = Date.now() + timeout

    while (Date.now() < deadline) {
      let data: Buffer
      try {
        data = await this.transferIn(51200, Math.min(10000, deadline - Date.now()))
      } catch {
        break
      }

      if (data.length === 0) continue

      // Parse Jensen messages from received data
      let pos = 0
      while (pos + 12 <= data.length) {
        if (data[pos] !== 0x12 || data[pos + 1] !== 0x34) { pos++; continue }
        const header = parseResponseHeader(new Uint8Array(data.buffer, data.byteOffset + pos, data.length - pos))
        if (!header) { pos++; continue }
        const totalLen = 12 + header.bodyLength
        if (pos + totalLen > data.length) break

        if (header.command === CMD.GET_FILE_LIST) {
          if (header.bodyLength === 0) {
            // End of transmission
            const combined = Buffer.concat(allData)
            return parseFileListBuffer(new Uint8Array(combined.buffer, combined.byteOffset, combined.length))
          }
          allData.push(data.subarray(pos + 12, pos + totalLen))
        }
        pos += totalLen
      }
    }

    // Timeout — parse what we have
    const combined = Buffer.concat(allData)
    return parseFileListBuffer(new Uint8Array(combined.buffer, combined.byteOffset, combined.length))
  }

  async downloadFile(
    filename: string,
    fileSize: number,
    onChunk?: (data: Uint8Array) => void,
    timeout = 300000
  ): Promise<Uint8Array | null> {
    if (!this.epOut || !this.epIn) return null

    const nameBytes: number[] = []
    for (let i = 0; i < filename.length; i++) nameBytes.push(filename.charCodeAt(i))

    const msg = new JensenMessage(CMD.TRANSFER_FILE).body(nameBytes).sequence(this.sequenceId++)
    await this.transferOut(msg.make())

    const chunks: Buffer[] = []
    let received = 0
    const deadline = Date.now() + timeout

    while (received < fileSize && Date.now() < deadline) {
      let data: Buffer
      try {
        data = await this.transferIn(51200, Math.min(10000, deadline - Date.now()))
      } catch {
        break
      }

      if (data.length === 0) continue

      let pos = 0
      while (pos + 12 <= data.length) {
        if (data[pos] !== 0x12 || data[pos + 1] !== 0x34) { pos++; continue }
        const header = parseResponseHeader(new Uint8Array(data.buffer, data.byteOffset + pos, data.length - pos))
        if (!header) { pos++; continue }
        const totalLen = 12 + header.bodyLength
        if (pos + totalLen > data.length) break

        if (header.command === CMD.TRANSFER_FILE && header.bodyLength > 0) {
          const payload = data.subarray(pos + 12, pos + totalLen)
          chunks.push(Buffer.from(payload))
          received += payload.length
          onChunk?.(new Uint8Array(payload))
        }
        pos += totalLen
      }
    }

    if (received < fileSize) return null
    const result = Buffer.concat(chunks)
    return new Uint8Array(result.buffer, result.byteOffset, result.length)
  }

  // --- Private ---

  private openDevice(dev: usb.Device, model: DeviceModel): boolean {
    try {
      dev.open()
      const iface = dev.interface(0)

      // On Linux, detach kernel driver if active
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

      this.rawDevice = dev
      this._model = model
      this.sequenceId = 0
      return true
    } catch (e) {
      console.error('[JensenDevice] Failed to open device:', e)
      try { dev.close() } catch { /* ignore */ }
      return false
    }
  }

  private async transferOut(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      this.epOut!.transfer(Buffer.from(data), (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  private async transferIn(length: number, timeout?: number): Promise<Buffer> {
    const ep = this.epIn!
    const prevTimeout = ep.timeout
    if (timeout !== undefined) ep.timeout = timeout

    return new Promise((resolve, reject) => {
      ep.transfer(length, (err, data) => {
        ep.timeout = prevTimeout
        if (err) reject(err)
        else resolve(data ?? Buffer.alloc(0))
      })
    })
  }

  private async sendAndReceive(
    command: number,
    body: Buffer = Buffer.alloc(0),
    timeout = 10000
  ): Promise<Buffer | null> {
    if (!this.epOut || !this.epIn) return null

    const bodyArray = Array.from(body)
    const msg = new JensenMessage(command).body(bodyArray).sequence(this.sequenceId++)
    await this.transferOut(msg.make())

    const deadline = Date.now() + timeout

    while (Date.now() < deadline) {
      let data: Buffer
      try {
        data = await this.transferIn(512, Math.min(5000, deadline - Date.now()))
      } catch {
        return null
      }

      if (data.length < 12) continue

      let pos = 0
      while (pos + 12 <= data.length) {
        if (data[pos] !== 0x12 || data[pos + 1] !== 0x34) { pos++; continue }
        const header = parseResponseHeader(new Uint8Array(data.buffer, data.byteOffset + pos, data.length - pos))
        if (!header) { pos++; continue }
        const totalLen = 12 + header.bodyLength
        if (pos + totalLen > data.length) break

        if (header.command === command) {
          return data.subarray(pos + 12, pos + totalLen)
        }
        pos += totalLen
      }
    }

    return null
  }
}
